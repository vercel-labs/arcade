// The AI-vs-AI match driver, extracted from main.ts. It owns the turn-loop
// lifecycle (start / pause / resume / stop) and its cancellation state, and runs
// beside the render tick (it awaits the network + each move's settle); a held live
// lease keeps frames flowing so the HUD wisps animate while we wait. main.ts owns
// the surrounding UI — the setup modal, the commentary toast, and the
// illegal-moves flag — and injects the seams below.
import { runMatch } from '../../ai/match.ts';
import { ModelPlayer } from '../../ai/model-player.ts';
import type { Player } from '../../ai/player.ts';
import type { ChessGameScene } from '../games/chess/scene.ts';
import type { Move } from '../../rules/chess/types.ts';

export interface AiMatchDeps {
  chessGame: ChessGameScene;
  // Update the renderer's live lease (a running match needs frames flowing).
  syncLive(): void;
  requestRender(): void;
  // Surface a pre-move rationale toast (main builds the timed Commentary object).
  onCommentary(text: string, model: string): void;
  // Live illegal-moves flag, read per move by each ModelPlayer.
  allowIllegal(): boolean;
}

export class AiMatch {
  // Cancels the running turn-loop (pause / stop / navigate away).
  private abort: AbortController | null = null;
  // The two players for the current game — kept across a pause so resume continues
  // with them.
  private players: Player<Move>[] | null = null;
  // Halts the loop on the current turn (no thinking/moves) while keeping the match
  // alive.
  private paused = false;

  constructor(private readonly deps: AiMatchDeps) {}

  isPaused(): boolean {
    return this.paused;
  }

  // Fully stop the match: cancel the loop, drop the players, and leave spectator
  // mode (the final position stays on the board). Safe to call when idle. Used by
  // reset-game and on navigating away — NOT by pause.
  stop(): void {
    this.abort?.abort();
    this.abort = null;
    this.players = null;
    this.paused = false;
    this.deps.chessGame.setMatchPaused(false);
    this.deps.chessGame.endMatch();
  }

  // Run the turn-loop for the current players against the live board. A new
  // AbortController per run lets pause/stop cancel an in-flight model call. On exit:
  // if paused, the match stays alive on the current turn; otherwise it ended
  // (terminal or stopped) and we leave spectator mode.
  private runLoop(): void {
    if (!this.players) return;
    const ctrl = new AbortController();
    this.abort = ctrl;
    this.deps.syncLive();
    this.deps.requestRender();
    runMatch<Move>(this.deps.chessGame, this.players, {
      signal: ctrl.signal,
      onCommentary: (text, player) => {
        this.deps.onCommentary(text, player.name);
      },
    })
      .catch(() => {}) // aborted mid-decision (pause/stop) — fine
      .finally(() => {
        if (this.abort === ctrl) this.abort = null;
        if (this.paused) return; // paused: keep the match alive on the current turn
        this.deps.chessGame.endMatch(); // ended (terminal or stopped); final position stays up
        this.players = null;
        this.deps.syncLive();
        this.deps.requestRender();
      });
  }

  // Start a fresh AI-vs-AI game from the initial position with the chosen models.
  start(whiteSlug: string, blackSlug: string): void {
    const providerOf = (slug: string): string => slug.split('/')[0] ?? slug;
    this.deps.chessGame.beginMatch(providerOf(whiteSlug), providerOf(blackSlug));
    this.paused = false;
    this.players = [
      new ModelPlayer<Move>({ model: whiteSlug, gameName: 'chess', allowIllegal: this.deps.allowIllegal }),
      new ModelPlayer<Move>({ model: blackSlug, gameName: 'chess', allowIllegal: this.deps.allowIllegal }),
    ];
    this.runLoop();
  }

  // Pause on whoever's turn it is: cancel the in-flight model call (stop thinking)
  // and halt the loop, but keep the match + HUD alive. The side-to-move wisp stops
  // pulsing to show it's idle.
  pause(): void {
    this.paused = true;
    this.deps.chessGame.setMatchPaused(true);
    this.abort?.abort(); // cancel any in-flight thinking
    this.abort = null;
    this.deps.requestRender();
  }

  // Resume from the current turn: the same players continue against the live board.
  resume(): void {
    this.paused = false;
    this.deps.chessGame.setMatchPaused(false);
    this.runLoop();
  }
}
