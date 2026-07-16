// The AI-vs-AI match driver, extracted from main.ts. It owns the turn-loop
// lifecycle (start / pause / resume / stop) and its cancellation state, and runs
// beside the render tick (it awaits the network + each move's settle); a held live
// lease keeps frames flowing so the HUD wisps animate while we wait. main.ts owns
// the surrounding UI — the setup modal, the commentary toast, and the
// illegal-moves flag — and injects the seams below.
import { runMatch } from '../../ai/match.ts';
import { ModelPlayer } from '../../ai/model-player.ts';
import { HumanPlayer } from '../../ai/human-player.ts';
import type { Player } from '../../ai/player.ts';
import type { ChessGameScene } from '../games/chess/scene.ts';
import type { Move } from '../../rules/chess/types.ts';
import { normalizerModel } from './models.ts';

// One side of a match: an AI model (a Gateway slug) or a human at the keyboard.
// The setup modal produces a pair of these; a human seat has no wisp and is played
// through the board (see ChessGameScene.requestHumanMove).
export type Seat = { kind: 'ai'; model: string } | { kind: 'human' };

const creatorOf = (slug: string): string => slug.split('/')[0] ?? slug;

export interface AiMatchDeps {
  chessGame: ChessGameScene;
  // Update the renderer's live lease (a running match needs frames flowing).
  syncLive(): void;
  requestRender(): void;
  // Surface a pre-move rationale (main routes it into the chat thread) — the model
  // slug tags the line with its name + creator color.
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

  // Start a fresh game from the initial position with the chosen seats. Each side is
  // an AI model or a human; any mix works (AI-vs-AI, human-vs-AI, hotseat), since a
  // HumanPlayer and a ModelPlayer are interchangeable in `runMatch`. Human sides get
  // no wisp (beginMatch is passed null for them).
  start(white: Seat, black: Seat): void {
    this.deps.chessGame.beginMatch(
      white.kind === 'ai' ? creatorOf(white.model) : null,
      black.kind === 'ai' ? creatorOf(black.model) : null,
    );
    this.paused = false;
    this.players = [this.makePlayer(white), this.makePlayer(black)];
    this.runLoop();
  }

  // Build a side's player: an LLM-backed ModelPlayer, or a HumanPlayer whose move is
  // awaited from the board (the loop passes the abort signal through so pausing a
  // human's turn cancels the wait cleanly).
  private makePlayer(seat: Seat): Player<Move> {
    if (seat.kind === 'human') {
      return new HumanPlayer<Move>({ name: 'you', awaitMove: (_state, ctx) => this.deps.chessGame.requestHumanMove(ctx?.signal) });
    }
    return new ModelPlayer<Move>({ model: seat.model, gameName: 'chess', allowIllegal: this.deps.allowIllegal, normalizer: normalizerModel() });
  }

  // Swap one side's player mid-match (the in-game model switch): rebuild that
  // side's ModelPlayer in place, so the next turn is decided by the new model.
  // The caller pauses first (cancelling any in-flight thinking for a clean
  // handoff) and resumes after. No-op when idle (no players yet).
  setPlayer(index: number, model: string): void {
    if (!this.players || index < 0 || index >= this.players.length) return;
    this.players[index] = new ModelPlayer<Move>({ model, gameName: 'chess', allowIllegal: this.deps.allowIllegal, normalizer: normalizerModel() });
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
