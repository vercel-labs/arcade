// Headless tests for the AI match seam — NO network. Validates:
//   1. runMatch drives a real ChessState to a terminal state via the MatchScene
//      contract, alternating players, with a valid zero-sum/draw returns vector.
//   2. ModelPlayer's structured-output path: a model that answers with an illegal
//      move is re-prompted, and a model that only ever answers illegally falls
//      back to a legal move (the match never deadlocks). Driven by a mock model.
//
//   pnpm exec tsx src/tools/match-test.ts
import { MockLanguageModelV3 } from 'ai/test';
import { ChessState } from '../games/chess/chess.ts';
import type { GameState } from '../games/game.ts';
import { type MatchScene, runMatch } from '../ai/match.ts';
import { ModelPlayer } from '../ai/model-player.ts';
import type { Player } from '../ai/player.ts';
import type { Move } from '../games/chess/types.ts';
import { RenderTarget, stringWidth } from '../engine/index.ts';
import { Screen } from '../tui/index.ts';
import { ChessGameScene } from '../arcade/chess-game.ts';
import { buildBar, buildGameOver, type BarActions } from '../arcade/bars.ts';
import { buildChessGameRoot, mountChessHud, moveHistory, movesToPgn, refreshMoveHistory } from '../arcade/chess-hud.ts';
import { BLACK } from '../games/chess/types.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

// A headless MatchScene: a live ChessState with instant (no-animation) moves, so
// runMatch can be exercised without the renderer. Records a SAN log like the real
// scene does, and counts plies for the alternation check.
class HeadlessScene implements MatchScene<Move> {
  private game = new ChessState();
  readonly log: string[] = [];
  readonly players: number[] = []; // currentPlayer at each ply, to verify alternation
  state(): GameState<Move> {
    return this.game;
  }
  async playMove(move: Move): Promise<void> {
    this.players.push(this.game.currentPlayer());
    this.log.push(this.game.actionToString(move));
    this.game.applyAction(move);
  }
}

// A deterministic stub Player: always plays the first legal action.
class FirstMovePlayer implements Player<Move> {
  constructor(readonly name: string) {}
  async chooseAction(state: GameState<Move>): Promise<{ action: Move; rationale?: string }> {
    return { action: state.legalActions()[0], rationale: `${this.name} plays the first legal move` };
  }
}

// Build a mock LanguageModel that returns the given JSON objects in sequence (one
// per generateText call). generateText with Output.object reads the model's text
// as JSON, so we emit `{ move, rationale }` strings.
type GenResult = Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>;
function mockModel(replies: { move: string; rationale: string }[]): MockLanguageModelV3 {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const reply = replies[Math.min(i++, replies.length - 1)];
      // Minimal valid v3 generate result; cast for the verbose nested usage shape.
      return {
        content: [{ type: 'text', text: JSON.stringify(reply) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      } as unknown as GenResult;
    },
  });
}

async function main(): Promise<void> {
  // 1. runMatch drives to terminal with deterministic players.
  {
    const scene = new HeadlessScene();
    const players = [new FirstMovePlayer('White'), new FirstMovePlayer('Black')];
    // Cap iterations as a safety net against a regression that never terminates.
    let returns: number[] = [];
    const guarded = Promise.race([
      runMatch<Move>(scene, players),
      new Promise<number[]>((_, rej) => setTimeout(() => rej(new Error('did not terminate')), 10_000)),
    ]);
    try {
      returns = await guarded;
    } catch (e) {
      check('runMatch terminates', false, (e as Error).message);
    }
    check('runMatch reaches a terminal state', scene.state().isTerminal());
    check('match played at least a few plies', scene.log.length > 4, `${scene.log.length} plies`);
    const alternates = scene.players.every((p, k) => p === k % 2);
    check('players strictly alternate White/Black', alternates);
    const sum = returns.reduce((a, b) => a + b, 0);
    check('returns is zero-sum (win/loss) or draw', returns.length === 2 && sum === 0, `[${returns}]`);
    const valid = returns.every((r) => r === 1 || r === -1 || r === 0);
    check('returns entries are +1/-1/0', valid, `[${returns}]`);
  }

  // 2. ModelPlayer re-prompts an illegal move, then accepts a legal one.
  {
    const state = new ChessState(); // start position; "e5" is illegal for White, "e4" legal
    const player = new ModelPlayer<Move>({
      model: mockModel([
        { move: 'e5', rationale: 'illegal for white from the start' },
        { move: 'e4', rationale: 'king pawn two squares' },
      ]),
      name: 'mock',
      gameName: 'chess',
    });
    const { action } = await player.chooseAction(state);
    check('ModelPlayer retries past an illegal move to a legal one', state.actionToString(action) === 'e4', state.actionToString(action));
  }

  // 3. ModelPlayer that NEVER answers legally falls back to a legal move.
  {
    const state = new ChessState();
    const player = new ModelPlayer<Move>({
      model: mockModel([{ move: 'zz99', rationale: 'always nonsense' }]),
      name: 'mock-bad',
      maxRetries: 1,
      gameName: 'chess',
    });
    const { action } = await player.chooseAction(state);
    const legal = state.legalActions().some((m) => m.from === action.from && m.to === action.to && m.promotion === action.promotion);
    check('ModelPlayer falls back to a legal move after exhausting retries', legal);
  }

  // 3b. actionFromString soft-matches mangled-but-legal SAN (the common reason a
  //     model's legal move was wrongly rejected → fallback). Exact match still
  //     wins; ambiguous under-specified input stays null so the caller re-prompts.
  {
    const open = new ChessState();
    for (const m of ['e4', 'd5']) open.applyAction(open.actionFromString(m)!);
    const soft = (s: string): string => {
      const m = open.actionFromString(s);
      return m ? open.actionToString(m) : 'null';
    };
    check('soft-match: dropped capture x ("ed5" → exd5)', soft('ed5') === 'exd5', soft('ed5'));
    check('soft-match: lowercase piece ("nf3" → Nf3)', soft('nf3') === 'Nf3', soft('nf3'));
    check('soft-match: leading move number ("2. Nf3" → Nf3)', soft('2. Nf3') === 'Nf3', soft('2. Nf3'));
    check('soft-match: trailing capture colon ("exd5:" → exd5)', soft('exd5:') === 'exd5', soft('exd5:'));

    const promo = new ChessState('7k/4P3/8/8/8/8/8/4K3 w - - 0 1');
    const sp = (s: string): string => {
      const m = promo.actionFromString(s);
      return m ? promo.actionToString(m) : 'null';
    };
    check('soft-match: promotion without "=" ("e8Q" → e8=Q+)', sp('e8Q') === 'e8=Q+', sp('e8Q'));
    check('soft-match: bare "e8" stays null (ambiguous promotion)', promo.actionFromString('e8') === null);

    const amb = new ChessState('7k/8/8/8/8/5N2/8/1N2K3 w - - 0 1'); // knights b1 & f3 both reach d2
    check('soft-match: ambiguous "Nd2" stays null (re-prompt)', amb.actionFromString('Nd2') === null);
    check('soft-match: explicit "Nbd2" resolves', amb.actionFromString('Nbd2') !== null);
  }

  // 4. The chess-game overlay composites through the real Screen/Slot path: the
  //    move-history ScrollBox expands and the commentary toast renders.
  {
    const noop = (): void => {};
    const actions: BarActions = { chessGame: noop, demo: noop, logos: noop, ui: noop, back: noop, reset: noop, mode: noop, quit: noop, aiMatch: noop, resetGame: noop };
    const ui = new Screen(80, 30);
    mountChessHud(ui);
    refreshMoveHistory(['e4', 'e5', 'Nf3', 'Nc6']);
    const root = (minimized: boolean): void =>
      ui.setRoot(
        buildChessGameRoot({ x: 0, y: 0, w: 80, h: 30 }, buildBar('chess-game', 'ascii', actions), {
          minimized,
          onToggle: noop,
          onCopy: noop,
          commentary: { text: 'developing the knight', model: 'anthropic/claude-opus-4.8', until: 99 },
          t: 0,
        }),
        { x: 0, y: 0, w: 80, h: 30 },
      );
    root(false);
    const frame = ui.frameComposited(() => {});
    check('overlay renders move history (SAN visible)', frame.includes('e4') && frame.includes('Nf3'));
    check('overlay renders commentary toast', frame.includes('developing the knight'));
    check('expanded overlay shows the copy button', frame.includes('⧉'));
    // The header controls must measure one cell each, or the header comes up short
    // vs the body (terminals render these text-presentation, not emoji-wide).
    check('✕ and ⧉ measure one cell (header aligns with body)', stringWidth('✕') === 1 && stringWidth('⧉') === 1);

    // Regression: minimize then expand must STILL show the list (the ScrollBox
    // must not be auto-unmounted while collapsed). The copy button is hidden when
    // minimized and returns when expanded.
    root(true);
    const minFrame = ui.frameComposited(() => {});
    check('minimized overlay hides the copy button', !minFrame.includes('⧉'));
    root(false);
    const reFrame = ui.frameComposited(() => {});
    check('move list + copy button survive a minimize → expand cycle', reFrame.includes('e4') && reFrame.includes('Nf3') && reFrame.includes('⧉'));

    // Regression: a modal popup (game-over result) replaces the whole root, so the
    // Slot leaves the tree and the Screen auto-unmounts the ScrollBox. First show
    // the bug is real (returning to the overlay WITHOUT re-mounting loses the list),
    // then that re-mounting (as syncBar's chess-game branch now does) restores it —
    // so Close preserves the game for review / PGN copy.
    ui.setRoot(buildGameOver({ title: 'White wins', subtitle: 'by checkmate', tint: [232, 228, 216] }, noop, noop), { x: 0, y: 0, w: 80, h: 30 });
    ui.frameComposited(() => {}); // expand() here unmounts 'chess-history'
    root(false); // back to the overlay WITHOUT re-mounting → reproduces the bug
    const bugFrame = ui.frameComposited(() => {});
    check('a popup unmounts the move list (bug reproduced)', !bugFrame.includes('Nf3'));
    mountChessHud(ui); // the fix syncBar applies on return to the overlay
    root(false);
    const afterClose = ui.frameComposited(() => {});
    check('re-mount restores the move list after a popup → close cycle', afterClose.includes('e4') && afterClose.includes('Nf3'));
  }

  // 7b. A scroll key (↑/↓) over the hovered move panel scrolls it without focus,
  //     and the wheel step moves several rows per notch (snappier than 1).
  {
    const noop = (): void => {};
    const actions: BarActions = { chessGame: noop, demo: noop, logos: noop, ui: noop, back: noop, reset: noop, mode: noop, quit: noop, aiMatch: noop, resetGame: noop };
    const ui = new Screen(80, 30);
    mountChessHud(ui);
    refreshMoveHistory(Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 'Nf3' : 'Nc6'))); // 30 rows → scrollable, snapped to bottom
    ui.setRoot(
      buildChessGameRoot({ x: 0, y: 0, w: 80, h: 30 }, buildBar('chess-game', 'ascii', actions), { minimized: false, onToggle: noop, onCopy: noop, commentary: null, t: 0 }),
      { x: 0, y: 0, w: 80, h: 30 },
    );
    ui.frameComposited(() => {}); // expand + layout
    const atBottom = moveHistory.scroll;
    const upKey = { name: 'up', raw: '', sequence: '', ctrl: false, shift: false, meta: false, eventType: 'press' } as const;
    const consumed = ui.tryScrollKey(8, 8, upKey); // (8,8) is over the list area
    check('↑ over the hovered panel scrolls it (no focus needed)', consumed && moveHistory.scroll === atBottom - 1, `consumed=${consumed} ${atBottom}→${moveHistory.scroll}`);
    const beforeWheel = moveHistory.scroll;
    ui.wheel(8, 8, -1); // one wheel notch up
    check('a wheel notch scrolls multiple rows', beforeWheel - moveHistory.scroll === 3, `${beforeWheel}→${moveHistory.scroll}`);

    // Scroll input must mark the screen dirty so the render-on-demand tick repaints
    // right away — previously the scroll only showed after an unrelated click.
    check('scroll input marks the screen dirty (repaints without a click)', ui.dirty());
    ui.frameComposited(() => {});
    check('dirty clears after the frame is painted', !ui.dirty());
    ui.tryScrollKey(8, 8, upKey);
    check('arrow-scroll over the panel also marks dirty', ui.dirty());

    // Regression: a non-scrollable (short) panel must NOT swallow scroll keys, so
    // camera pan still fires when the cursor is over a panel with nothing to scroll.
    refreshMoveHistory(['e4', 'e5']); // 1 row < viewport → maxScroll 0
    ui.setRoot(
      buildChessGameRoot({ x: 0, y: 0, w: 80, h: 30 }, buildBar('chess-game', 'ascii', actions), { minimized: false, onToggle: noop, onCopy: noop, commentary: null, t: 0 }),
      { x: 0, y: 0, w: 80, h: 30 },
    );
    ui.frameComposited(() => {});
    check('short panel does not consume scroll keys (pan passes through)', !ui.tryScrollKey(8, 8, upKey));
  }

  // 8. movesToPgn produces pasteable PGN movetext with a result token.
  {
    const pgn = movesToPgn(['e4', 'c5', 'Nf3', 'Nc6'], '1-0');
    check('movesToPgn → numbered movetext + result', pgn === '1. e4 c5 2. Nf3 Nc6 1-0', JSON.stringify(pgn));
    const odd = movesToPgn(['e4'], '*');
    check('movesToPgn handles a trailing white-only move', odd === '1. e4 *', JSON.stringify(odd));
  }

  // 5. The real ChessGameScene logs every move played via playMove (the AI path),
  //    so the move-history panel tracks an AI game as it progresses. Drive a few
  //    moves and pump renderScene past each animation's settle.
  {
    const scene = new ChessGameScene();
    scene.beginMatch();
    const target = new RenderTarget(120, 80);
    const play = (san: string): void => {
      const m = scene.state().actionFromString(san);
      if (!m) throw new Error(`illegal in test: ${san}`);
      scene.playMove(m);
      // Pump enough frames to advance the animation to settle (ANIM_FRAMES = 9);
      // moveLog is appended synchronously at settle inside renderScene.
      for (let i = 0; i < 20; i++) scene.renderScene(target, i / 30);
    };
    play('e4');
    play('c5');
    play('Nf3');
    const moves = scene.moves();
    check('ChessGameScene logs moves played via playMove (AI path)', moves.length === 3 && moves[0] === 'e4' && moves[2] === 'Nf3', `[${moves}]`);

    // resetGame restores the start position, clears history, and leaves AI mode.
    scene.resetGame();
    check(
      'resetGame restores start position + clears history + stops match',
      scene.moves().length === 0 && scene.state().legalActions().length === 20 && !scene.isMatchActive(),
      `moves=${scene.moves().length} legal=${scene.state().legalActions().length} match=${scene.isMatchActive()}`,
    );
  }

  // 6. ChessState.result() reports winner + reason at terminal states.
  {
    const fools = new ChessState(); // fool's mate: 1.f3 e5 2.g4 Qh4#
    for (const san of ['f3', 'e5', 'g4', 'Qh4']) {
      const m = fools.actionFromString(san);
      if (!m) throw new Error(`illegal in test: ${san}`);
      fools.applyAction(m);
    }
    const mate = fools.result();
    check('result(): checkmate → Black wins', mate?.winner === BLACK && mate?.reason === 'checkmate', JSON.stringify(mate));

    const stale = new ChessState('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').result();
    check('result(): stalemate → draw', stale?.winner === null && stale?.reason === 'stalemate', JSON.stringify(stale));

    const insuf = new ChessState('8/8/8/8/8/5k2/8/6K1 w - - 0 1').result();
    check('result(): K vs K → draw by insufficient material', insuf?.winner === null && insuf?.reason === 'insufficient-material', JSON.stringify(insuf));

    const ongoing = new ChessState().result();
    check('result(): start position is not terminal', ongoing === null);
  }

  // 7. The game-over popup renders the outcome + reason + actions.
  {
    const ui = new Screen(80, 30);
    ui.setRoot(buildGameOver({ title: 'Black wins', subtitle: 'by checkmate', tint: [184, 126, 74] }, () => {}, () => {}), { x: 0, y: 0, w: 80, h: 30 });
    const frame = ui.frameComposited(() => {});
    check('game-over popup shows outcome + reason + actions', frame.includes('Black wins') && frame.includes('by checkmate') && frame.includes('New game'));
  }

  // 9. Pause/resume: aborting the signal mid-think halts the loop WITHOUT playing
  //    the aborted move (stays on the current turn); a fresh loop resumes from
  //    that position and runs to terminal.
  {
    const scene = new HeadlessScene();
    const ctrl = new AbortController();
    let calls = 0;
    const pausingPlayer: Player<Move> = {
      name: 'pause-on-think',
      async chooseAction(state) {
        calls++;
        ctrl.abort(); // simulate Pause arriving while this side is "thinking"
        return { action: state.legalActions()[0] };
      },
    };
    await runMatch<Move>(scene, [pausingPlayer, pausingPlayer], { signal: ctrl.signal });
    check('pause halts the loop without playing the aborted move', calls === 1 && scene.log.length === 0 && !scene.state().isTerminal());

    // resume: a new loop (new signal) continues from the same live position.
    await runMatch<Move>(scene, [new FirstMovePlayer('W'), new FirstMovePlayer('B')], {});
    check('resume continues from the paused position to terminal', scene.state().isTerminal() && scene.log.length > 0);
  }

  // 10. Commentary seam (voice-ready): a player that streams via ctx.emit routes
  //     each chunk to onCommentary in real time, and the returned rationale is NOT
  //     additionally emitted; a player that only returns a rationale still has it
  //     surfaced once (the text fallback). This is the path a future VoicePlayer
  //     pushes speech through.
  {
    const scene = new HeadlessScene();
    const chunks: string[] = [];
    const streamer: Player<Move> = {
      name: 'streamer',
      async chooseAction(state, ctx) {
        ctx?.emit?.('chunk-a');
        return { action: state.legalActions()[0], rationale: 'RET' };
      },
    };
    await runMatch<Move>(scene, [streamer, streamer], { onCommentary: (t) => chunks.push(t) });
    check('commentary: emit() chunks routed to onCommentary', chunks.includes('chunk-a'));
    check('commentary: streamed → returned rationale not double-emitted', !chunks.includes('RET'));

    const scene2 = new HeadlessScene();
    const said: string[] = [];
    await runMatch<Move>(scene2, [new FirstMovePlayer('W'), new FirstMovePlayer('B')], { onCommentary: (t) => said.push(t) });
    check('commentary: returned rationale emitted once when not streamed', said.length > 0 && said.every((s) => s.includes('first legal move')));
  }

  // 11. Persona + banter wiring: the persona is sent as the system prompt, and the
  //     opponent's last line reaches the prompt ONLY when banter is enabled — the
  //     move-decision prompt stays clean by default. Uses a capturing mock model.
  {
    let lastPrompt = '';
    const capture = new MockLanguageModelV3({
      doGenerate: async (opts: { prompt: unknown }) => {
        lastPrompt = JSON.stringify(opts.prompt);
        return {
          content: [{ type: 'text', text: JSON.stringify({ move: 'e4', rationale: 'ok' }) }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        } as unknown as GenResult;
      },
    });

    const withPersona = new ModelPlayer<Move>({ model: capture, gameName: 'chess', persona: 'You are Tal; sacrifice everything' });
    await withPersona.chooseAction(new ChessState(), {});
    check('persona: sent as the system prompt', lastPrompt.includes('sacrifice everything'));

    lastPrompt = '';
    const chatty = new ModelPlayer<Move>({ model: capture, gameName: 'chess', banter: true });
    await chatty.chooseAction(new ChessState(), { opponentSaid: 'I will crush you' });
    check('banter on: opponent line reaches the prompt', lastPrompt.includes('I will crush you'));

    lastPrompt = '';
    const quiet = new ModelPlayer<Move>({ model: capture, gameName: 'chess' }); // banter off (default)
    await quiet.chooseAction(new ChessState(), { opponentSaid: 'I will crush you' });
    check('banter off: opponent line kept out of the decision prompt', !lastPrompt.includes('I will crush you'));
  }

  console.log(failures === 0 ? '\nmatch: all checks pass ✓' : `\nmatch: ${failures} FAILED ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
