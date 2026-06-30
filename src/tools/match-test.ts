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
import { type RealtimeCodec, RealtimeSession, type RealtimeSocket } from '../voice/realtime-session.ts';
import type { Move } from '../games/chess/types.ts';
import { readFileSync } from 'node:fs';
import { decodePng, RenderTarget, stringWidth } from '../engine/index.ts';
import { Dropdown, Screen } from '../tui/index.ts';
import { ChessGameScene } from '../arcade/chess-game.ts';
import { buildBar, buildGameOver, type BarActions } from '../arcade/bars.ts';
import { buildChessGameRoot, mountChessHud, moveHistory, movesToPgn, refreshMoveHistory } from '../arcade/chess-hud.ts';
import { BISHOP, BLACK, FLAG_CAPTURE, KING, pieceColor, pieceType, QUEEN, ROOK, square, WHITE } from '../games/chess/types.ts';
import { modelsFor, providers } from '../arcade/models.ts';
import { matchSetupReady, matchSetupSelection, mountMatchSetup } from '../arcade/match-setup.ts';
import { deriveTint, providerTint } from '../arcade/wisp.ts';
import { BRAND_HUE } from '../arcade/logos.ts';
import type { KeyEvent } from '../platform/input.ts';

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

// A mock that emits RAW text (not JSON) — used to exercise ModelPlayer's plain-
// text fallback: structured Output.object parsing fails on prose, so it drops to
// the text path and soft-parses the move.
function mockTextModel(texts: string[]): MockLanguageModelV3 {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const text = texts[Math.min(i++, texts.length - 1)];
      return {
        content: [{ type: 'text', text }],
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

  // 3c. Text fallback: a model that can't emit the JSON schema (structured output
  //     errors on prose) still works — ModelPlayer drops to plain text and soft-
  //     parses the move, both from an explicit "MOVE:" line and from bare prose.
  {
    const state = new ChessState();
    const marked = new ModelPlayer<Move>({ model: mockTextModel(['Develop the knight.\nMOVE: Nf3']), name: 'mock-text', gameName: 'chess' });
    const a1 = await marked.chooseAction(state);
    check('text fallback parses an explicit MOVE: line', state.actionToString(a1.action) === 'Nf3', state.actionToString(a1.action));

    const prose = new ModelPlayer<Move>({ model: mockTextModel(["I'll play e4 to take the center."]), name: 'mock-prose', gameName: 'chess' });
    const a2 = await prose.chooseAction(state);
    check('text fallback soft-parses a move from bare prose', state.actionToString(a2.action) === 'e4', state.actionToString(a2.action));
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
    const actions: BarActions = { chessGame: noop, demo: noop, logos: noop, ui: noop, back: noop, reset: noop, mode: noop, quit: noop, aiMatch: noop, resetGame: noop, illegalMoves: noop, evalBar: noop, audioModel: noop };
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
          evalVisible: false,
          evalCp: 0,
          evalResult: null,
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

  // 4b. Illegal-toggle moves render RED in the move panel. The panel is given a
  //     parallel illegal[] flag array; the flagged ply's SAN must paint reddish
  //     while legal moves stay light, and the red must vanish when nothing's flagged.
  {
    const noop = (): void => {};
    const actions: BarActions = { chessGame: noop, demo: noop, logos: noop, ui: noop, back: noop, reset: noop, mode: noop, quit: noop, aiMatch: noop, resetGame: noop, illegalMoves: noop, evalBar: noop, audioModel: noop };
    const ui = new Screen(80, 30);
    mountChessHud(ui);
    const render = (): void =>
      ui.setRoot(
        buildChessGameRoot({ x: 0, y: 0, w: 80, h: 30 }, buildBar('chess-game', 'ascii', actions), { minimized: false, onToggle: noop, onCopy: noop, commentary: null, t: 0, evalVisible: false, evalCp: 0, evalResult: null }),
        { x: 0, y: 0, w: 80, h: 30 },
      );
    // The illegal tint ([226,92,86]) emits a truecolor fg SGR (38;2;226;92;86) in
    // the composited frame; legal moves use the light fg, so the red code is absent.
    const RED_SGR = '38;2;226;92;86';
    refreshMoveHistory(['e4', 'Qxf7'], [false, true]); // black's Qxf7 is the illegal one
    render();
    const redFrame = ui.frameComposited(() => {});
    check('an illegal move paints red in the panel', redFrame.includes(RED_SGR) && redFrame.includes('Qxf7'));
    refreshMoveHistory(['e4', 'e5'], [false, false]); // all legal → no red
    render();
    const cleanFrame = ui.frameComposited(() => {});
    check('legal moves never paint red', !cleanFrame.includes(RED_SGR));
  }

  // 7b. A scroll key (↑/↓) over the hovered move panel scrolls it without focus,
  //     and the wheel step moves several rows per notch (snappier than 1).
  {
    const noop = (): void => {};
    const actions: BarActions = { chessGame: noop, demo: noop, logos: noop, ui: noop, back: noop, reset: noop, mode: noop, quit: noop, aiMatch: noop, resetGame: noop, illegalMoves: noop, evalBar: noop, audioModel: noop };
    const ui = new Screen(80, 30);
    mountChessHud(ui);
    refreshMoveHistory(Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 'Nf3' : 'Nc6'))); // 30 rows → scrollable, snapped to bottom
    ui.setRoot(
      buildChessGameRoot({ x: 0, y: 0, w: 80, h: 30 }, buildBar('chess-game', 'ascii', actions), { minimized: false, onToggle: noop, onCopy: noop, commentary: null, t: 0, evalVisible: false, evalCp: 0, evalResult: null }),
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
      buildChessGameRoot({ x: 0, y: 0, w: 80, h: 30 }, buildBar('chess-game', 'ascii', actions), { minimized: false, onToggle: noop, onCopy: noop, commentary: null, t: 0, evalVisible: false, evalCp: 0, evalResult: null }),
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

  // 5b. Illegal-toggle moves: a loosely-parsed illegal move played via playMove is
  //     logged AND flagged illegal (illegalFlags() parallel to moves()), while a
  //     legal move flags false. An illegal CAPTURE still animates the take — the
  //     captured piece leaves the board (its square ends empty after settle).
  {
    const scene = new ChessGameScene();
    scene.beginMatch();
    const target = new RenderTarget(120, 80);
    const pump = (): void => {
      for (let i = 0; i < 20; i++) scene.renderScene(target, i / 30);
    };
    const playLoose = (san: string): void => {
      const m = scene.state().actionFromStringLoose(san);
      if (!m) throw new Error(`unparseable in test: ${san}`);
      scene.playMove(m);
      pump();
    };
    playLoose('e4'); // legal
    playLoose('Qd6'); // white queen teleports d1→d6 (no rules) — illegal
    const flags = scene.illegalFlags();
    check('illegalFlags() flags an illegal-toggle move (not the legal one)', scene.moves().length === 2 && flags[0] === false && flags[1] === true, `moves=[${scene.moves()}] flags=[${flags}]`);

    // Illegal capture animates the take: queen d6 → e7 grabs black's e7 pawn.
    const e7 = square(4, 6);
    const before = scene.state().board.squares[e7];
    playLoose('Qxe7'); // illegal capture of the e7 pawn
    const after = scene.state().board.squares[e7];
    check('an illegal capture still removes the captured piece (take animates)', !!before && pieceType(before) === 1 /* PAWN */ && pieceType(after) === QUEEN, `before=${before} after=${after}`);
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

  // 10. Match-setup picker: Start gating + provider→model clearing. Drive the
  //     real Dropdown instances (via the Screen registry) the way clicks/Enter would.
  {
    const ui = new Screen(120, 40);
    mountMatchSetup(ui);
    const wp = ui.component('setup-white-provider') as Dropdown;
    const wm = ui.component('setup-white-model') as Dropdown;
    const provs = providers();
    const commit = (s: Dropdown, i: number): void => s.pick(i); // commit a choice (Enter/click path)

    // TEMP demo default pre-commits both models (see match-setup.ts), so the modal
    // opens ready. (When that's reverted, both start null and this is !ready.)
    check('setup: opens ready (both models pre-committed for the demo)', matchSetupReady() && matchSetupSelection() !== null);

    // Changing a provider clears THAT side's model → not ready until re-picked.
    const otherProv = provs.findIndex((p) => p.slug !== 'anthropic');
    commit(wp, otherProv);
    check('setup: changing provider clears that side’s model', !matchSetupReady());
    commit(wm, 0); // re-pick a model under the new provider
    check('setup: re-picking a model restores ready', matchSetupReady() && matchSetupSelection() !== null);
    // Picking a different model under the SAME provider keeps it ready.
    if ((ui.component('setup-white-model') as Dropdown).items.length > 1) commit(wm, 1);
    check('setup: switching model under same provider stays ready', matchSetupReady());

    // Open/close behavior: a closed dropdown opens on Enter; Esc closes it (so the
    // modal's Esc-cancel only fires when no list is open); Enter then commits.
    const enter = { name: 'enter', raw: '', sequence: '', ctrl: false, shift: false, meta: false, eventType: 'press' } as KeyEvent;
    const esc = { name: 'escape', raw: '', sequence: '', ctrl: false, shift: false, meta: false, eventType: 'press' } as KeyEvent;
    const fresh = ui.component('setup-black-provider') as Dropdown;
    const openConsumed = fresh.onKey?.(enter);
    check('dropdown: Enter opens the list (consumed)', openConsumed === true && fresh.open);
    const escConsumed = fresh.onKey?.(esc);
    check('dropdown: Esc closes an open list (consumed, shadows modal cancel)', escConsumed === true && !fresh.open);
    check('dropdown: Esc on a CLOSED list is not consumed (modal handles it)', fresh.onKey?.(esc) === false);
  }

  // 11. Brand tints: colored marks derive a hue; the tuned 4 use their override.
  {
    const mistral = deriveTint(decodePng(readFileSync('public/assets/logos/mistral.png')));
    check('deriveTint: mistral reads orange (r highest, has chroma)', mistral.x > 150 && mistral.x > mistral.z + 40, JSON.stringify(mistral));
    const oa = providerTint('openai');
    check('providerTint: openai uses the BRAND_HUE override', oa.x === BRAND_HUE.openai[0] && oa.y === BRAND_HUE.openai[1], JSON.stringify(oa));
    const mi = providerTint('minimax'); // no override → derived (red-ish)
    check('providerTint: minimax derives a non-grey hue', Math.max(mi.x, mi.y, mi.z) - Math.min(mi.x, mi.y, mi.z) > 30, JSON.stringify(mi));
  }

  // 12. Unsupported providers are hidden from the picker but still resolvable by
  //     name (so the probe can re-test them).
  {
    const slugs = providers().map((p) => p.slug);
    const hidden = ['arcee-ai', 'meituan', 'sakana'];
    check('picker hides the unsupported providers', hidden.every((s) => !slugs.includes(s)), slugs.join(','));
    check('hidden providers still resolve by name', modelsFor('arcee-ai').length > 0);
  }

  // 13. Illegal-moves loose parse: any piece → any square, no rules.
  {
    const f7 = square(5, 6);
    const e2 = square(4, 1);
    const a5 = square(0, 4);

    const cap = new ChessState();
    const bxf7 = cap.actionFromStringLoose('Bxf7'); // illegal from start, but parseable
    check('loose: Bxf7 → capture move to f7', bxf7 !== null && bxf7.to === f7 && (bxf7.flags & FLAG_CAPTURE) !== 0, JSON.stringify(bxf7 && { to: bxf7.to, flags: bxf7.flags }));
    cap.applyAction(bxf7!);
    check('loose: applying it relocates a white bishop to f7', pieceType(cap.board.squares[f7]) === BISHOP && pieceColor(cap.board.squares[f7]) === WHITE);

    const own = new ChessState();
    own.applyAction(own.actionFromStringLoose('Ke2')!); // king "captures" its own pawn
    check('loose: a piece can capture its own (Ke2 onto the e-pawn)', pieceType(own.board.squares[e2]) === KING);

    const uci = new ChessState();
    uci.applyAction(uci.actionFromStringLoose('a1a5')!); // rook teleports through its own pawn
    check('loose: UCI a1a5 teleports the rook to a5', pieceType(uci.board.squares[a5]) === ROOK && uci.board.squares[square(0, 0)] === 0);

    check('loose: unparseable input is null', new ChessState().actionFromStringLoose('hello there') === null);
  }

  // 14. ModelPlayer honours the allowIllegal toggle; legal mode lists legal moves
  //     on the retry prompt.
  {
    const state = new ChessState();
    const f7 = square(5, 6);
    const loose = new ModelPlayer<Move>({ model: mockModel([{ move: 'Bxf7', rationale: 'aggressive' }]), allowIllegal: () => true, gameName: 'chess' });
    const la = await loose.chooseAction(state);
    check('allowIllegal: an illegal move is accepted as-is', la.action.to === f7, String(la.action.to));

    const strictModel = mockModel([{ move: 'Bxf7', rationale: 'aggressive' }]); // always illegal
    const strict = new ModelPlayer<Move>({ model: strictModel, allowIllegal: () => false, maxRetries: 1, gameName: 'chess' });
    const sa = await strict.chooseAction(state);
    const legalMove = state.legalActions().some((m) => m.from === sa.action.from && m.to === sa.action.to);
    check('legal mode: rejects the illegal move and falls back to a legal one', legalMove);
    const retryPrompt = JSON.stringify(strictModel.doGenerateCalls[1] ?? {});
    check('legal mode: the retry prompt lists the legal moves', /legal moves are/i.test(retryPrompt));
  }

  // 12. RealtimeSession drives the voice seam over a mock socket (no network): a
  //     user text turn serializes to item-create + response-create client events,
  //     and server transcript/audio/done/error frames fan out to the handlers
  //     (base64 audio decoded to PCM bytes). This is the type-to-talk contract.
  {
    const sent: string[] = [];
    const listeners: Record<string, (arg?: unknown) => void> = {};
    const socket: RealtimeSocket = {
      send: (d) => sent.push(d),
      close: () => {},
      on: (ev, cb) => {
        listeners[ev] = cb;
      },
    };
    // Identity codec: client events pass through; server frames are already in the
    // normalized { type, delta } shape the session reads.
    const codec: RealtimeCodec = { serializeClientEvent: (e) => e, parseServerEvent: (d) => d };
    const got = { transcript: '', audio: [] as Buffer[], status: [] as string[], error: '', speech: [] as string[], userTranscript: '' };
    const session = new RealtimeSession(codec, socket, {
      onTranscript: (d) => {
        got.transcript += d;
      },
      onAudio: (p) => got.audio.push(p),
      onStatus: (s) => got.status.push(s),
      onError: (m) => {
        got.error = m;
      },
      onSpeechStarted: () => got.speech.push('started'),
      onSpeechStopped: () => got.speech.push('stopped'),
      onUserTranscript: (text) => {
        got.userTranscript = text;
      },
    });

    listeners.open?.(); // socket connects → flush queue + open status
    await session.say('hello there');
    check(
      'realtime: say() sends item-create + response-create',
      sent.length === 2 && sent[0].includes('conversation-item-create') && sent[0].includes('hello there') && sent[1].includes('response-create'),
      `${sent.length} sent`,
    );
    check('realtime: say() reports responding', got.status.includes('responding'));

    const pcm = Buffer.from([1, 2, 3, 4]);
    listeners.message?.(JSON.stringify({ type: 'audio-transcript-delta', delta: 'Hel' }));
    listeners.message?.(JSON.stringify({ type: 'audio-transcript-delta', delta: 'lo' }));
    listeners.message?.(JSON.stringify({ type: 'audio-delta', delta: pcm.toString('base64') }));
    listeners.message?.(JSON.stringify({ type: 'response-done' }));
    check('realtime: transcript deltas accumulate', got.transcript === 'Hello', got.transcript);
    check('realtime: audio-delta base64 → PCM bytes', got.audio.length === 1 && got.audio[0].equals(pcm));
    check('realtime: response-done → done status', got.status.includes('done'));

    // Full-duplex pieces: server VAD events drive barge-in / turn-taking, and the
    // user's transcription surfaces the human side of the conversation.
    listeners.message?.(JSON.stringify({ type: 'speech-started' }));
    listeners.message?.(JSON.stringify({ type: 'input-transcription-completed', transcript: 'hi model' }));
    listeners.message?.(JSON.stringify({ type: 'speech-stopped' }));
    check('realtime: VAD speech-started/stopped → handlers', got.speech.includes('started') && got.speech.includes('stopped'));
    check('realtime: input-transcription-completed → onUserTranscript', got.userTranscript === 'hi model');

    // Client→server audio + config events (sent now that the socket is open).
    const micPcm = Buffer.from([5, 6, 7, 8]);
    session.updateSession({ turnDetection: { type: 'server-vad' }, inputAudioFormat: { type: 'audio/pcm', rate: 24000 } });
    session.appendAudio(micPcm);
    await new Promise((r) => setTimeout(r, 0)); // let the async sends flush
    check('realtime: updateSession sends session-update', sent.some((s) => s.includes('session-update') && s.includes('server-vad')));
    check('realtime: appendAudio sends input-audio-append (base64 PCM)', sent.some((s) => s.includes('input-audio-append') && s.includes(micPcm.toString('base64'))));

    listeners.error?.({ message: 'boom' });
    check('realtime: socket error → onError', got.error === 'boom');
    listeners.close?.();
    check('realtime: open/close → status transitions', got.status.includes('open') && got.status.includes('closed'));

    listeners.message?.('not json{'); // a malformed frame must be ignored, not throw
    check('realtime: non-JSON frame ignored', got.transcript === 'Hello');
  }

  // 12b. Regression for the "closed before the connection was established" bug:
  //      a say() BEFORE the socket opens must queue (not send, which would throw),
  //      then flush in order once 'open' fires.
  {
    const sent: string[] = [];
    const listeners: Record<string, (arg?: unknown) => void> = {};
    const socket: RealtimeSocket = { send: (d) => sent.push(d), close: () => {}, on: (ev, cb) => { listeners[ev] = cb; } };
    const codec: RealtimeCodec = { serializeClientEvent: (e) => e, parseServerEvent: (d) => d };
    const session = new RealtimeSession(codec, socket, {});
    await session.say('queued hi'); // socket not open yet
    check('realtime: sends queue until the socket opens', sent.length === 0, `${sent.length} sent early`);
    listeners.open?.();
    await new Promise((r) => setTimeout(r, 0)); // let flushOutbox drain
    check('realtime: queued sends flush in order on open', sent.length === 2 && sent[0].includes('queued hi'), `${sent.length} flushed`);
  }

  console.log(failures === 0 ? '\nmatch: all checks pass ✓' : `\nmatch: ${failures} FAILED ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
