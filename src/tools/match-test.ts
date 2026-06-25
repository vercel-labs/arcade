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
import { RenderTarget } from '../engine/index.ts';
import { Screen } from '../tui/index.ts';
import { ChessGameScene } from '../arcade/chess-game.ts';
import { buildBar, buildGameOver, type BarActions } from '../arcade/bars.ts';
import { buildChessGameRoot, mountChessHud, movesToPgn, refreshMoveHistory } from '../arcade/chess-hud.ts';
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

    // Regression: minimize then expand must STILL show the list (the ScrollBox
    // must not be auto-unmounted while collapsed). The copy button is hidden when
    // minimized and returns when expanded.
    root(true);
    const minFrame = ui.frameComposited(() => {});
    check('minimized overlay hides the copy button', !minFrame.includes('⧉'));
    root(false);
    const reFrame = ui.frameComposited(() => {});
    check('move list + copy button survive a minimize → expand cycle', reFrame.includes('e4') && reFrame.includes('Nf3') && reFrame.includes('⧉'));
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

  console.log(failures === 0 ? '\nmatch: all checks pass ✓' : `\nmatch: ${failures} FAILED ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
