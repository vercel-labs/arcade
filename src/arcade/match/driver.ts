// The AI-vs-AI match driver, extracted from main.ts. It owns the turn-loop
// lifecycle (start / pause / resume / stop) and its cancellation state, and runs
// beside the render tick (it awaits the network + each move's settle); a held live
// lease keeps frames flowing so the HUD wisps animate while we wait. main.ts owns
// the surrounding UI — the setup modal, the commentary toast, and the
// illegal-moves flag — and injects the seams below.
import { runMatch } from '../../ai/match.ts';
import { FALLBACK_RATIONALE, isFallbackRationale, ModelPlayer } from '../../ai/model-player.ts';
import { HumanPlayer } from '../../ai/human-player.ts';
import type { Player } from '../../ai/player.ts';
import type { ChessGameScene } from '../games/chess/scene.ts';
import type { ChessState } from '../../rules/chess/chess.ts';
import type { Move } from '../../rules/chess/types.ts';
import { disambiguateLabels } from './labels.ts';
import { normalizerModel } from './models.ts';
import { isTelemetryEnabled, localPlayerKey, trackMatchEnded, trackMatchRecord, trackMatchStarted, trackModelFallback } from '../../telemetry/index.ts';
import { ChessGameRecorder, type RecorderController } from './game-recorders.ts';
import type { RecordEndReason } from '../../telemetry/records.ts';
import { shortModel } from './model-label.ts';

// A seat's telemetry identity: the model slug, or 'human' for a keyboard seat.
const seatId = (seat: Seat): string => (seat.kind === 'ai' ? seat.model : 'human');
// Summarize the pairing for analytics: ai_vs_ai (spectated), human_vs_ai, or hotseat.
const matchMode = (seats: Seat[]): string => {
  const ai = seats.filter((s) => s.kind === 'ai').length;
  return ai === 2 ? 'ai_vs_ai' : ai === 1 ? 'human_vs_ai' : 'hotseat';
};

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
  onCommentary(text: string, model: string, label: string): void;
  // Live illegal-moves flag, read per move by each ModelPlayer.
  allowIllegal(): boolean;
}

export class AiMatch {
  // Cancels the running turn-loop (pause / stop / navigate away).
  private abort: AbortController | null = null;
  // The two players for the current game — kept across a pause so resume continues
  // with them.
  private players: Player<Move>[] | null = null;
  // Parallel seat identity + resolved display labels. Keeping these separate from the
  // Player name preserves the full slug for chat color while duplicate labels stay distinct.
  private seats: Seat[] | null = null;
  private labels: string[] = [];
  // Halts the loop on the current turn (no thinking/moves) while keeping the match
  // alive.
  private paused = false;
  private recorder: ChessGameRecorder | null = null;

  constructor(private readonly deps: AiMatchDeps) {}

  isPaused(): boolean {
    return this.paused;
  }

  // Fully stop the match: cancel the loop, drop the players, and leave spectator
  // mode (the final position stays on the board). Safe to call when idle. Used by
  // reset-game and on navigating away — NOT by pause.
  stop(reason: Exclude<RecordEndReason, 'natural'> = 'navigation'): void {
    const partial = this.record(() => this.recorder?.abandoned(reason, this.deps.chessGame.state().fen()));
    if (partial) trackMatchRecord(partial);
    this.recorder = null;
    this.abort?.abort();
    this.abort = null;
    this.players = null;
    this.seats = null;
    this.labels = [];
    this.paused = false;
    this.deps.chessGame.setMatchPaused(false);
    this.deps.chessGame.endMatch();
  }

  // Run a recorder call in isolation: telemetry must never stall a match. Any fault
  // drops the recorder (stop recording this match) rather than throw into the game loop
  // or the finalize path.
  private record<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch {
      this.recorder = null;
      return undefined;
    }
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
    let finalReturns: number[] | null = null;
    runMatch<Move>(this.deps.chessGame, this.players, {
      signal: ctrl.signal,
      onCommentary: (text, player) => {
        const index = this.players?.indexOf(player) ?? -1;
        const seat = index >= 0 ? this.seats?.[index] : null;
        const model = seat?.kind === 'ai' ? seat.model : player.name;
        const label = index >= 0 ? (this.labels[index] ?? shortModel(model)) : shortModel(model);
        if (seat?.kind === 'ai' && isFallbackRationale(text)) {
          trackModelFallback({ game: 'chess', model, reason: text === FALLBACK_RATIONALE.unavailable ? 'unavailable' : 'exhausted' });
        }
        this.deps.onCommentary(text, model, label);
      },
      onActionChosen: ({ player, playerIndex, choice, state }) => {
        this.record(() =>
          this.recorder?.actionChosen(
            playerIndex,
            player,
            choice,
            state as ChessState,
            player instanceof HumanPlayer,
            this.deps.allowIllegal(),
          ),
        );
      },
      onActionApplied: ({ state }) => {
        this.record(() => {
          // Reuse the scene's authoritative SAN + legality history (the same source
          // as the PGN copy button) instead of independently rebuilding move text.
          const sans = this.deps.chessGame.moves();
          const illegal = this.deps.chessGame.illegalFlags();
          const last = sans.length - 1;
          this.recorder?.actionApplied(state as ChessState, sans[last] ?? '', illegal[last] ?? false);
          const checkpoint = this.recorder?.checkpoint((state as ChessState).fen());
          if (checkpoint) trackMatchRecord(checkpoint);
        });
      },
    })
      .then((returns) => {
        finalReturns = returns;
      })
      .catch(() => {}) // aborted mid-decision (pause/stop) — fine
      .finally(() => {
        if (this.abort === ctrl) this.abort = null;
        if (this.paused) return; // paused: keep the match alive on the current turn
        // A genuine finish (checkmate / stalemate / draw) reaches a terminal position; a
        // stop or navigate-away does not. Only the former is a reportable result — the
        // winner falls out of the returns vector (white index 0, black index 1).
        const seats = this.seats;
        if (seats && finalReturns && this.deps.chessGame.state().isTerminal()) {
          const [w, b] = finalReturns;
          const winner = w > b ? seatId(seats[0]) : b > w ? seatId(seats[1]) : 'draw';
          trackMatchEnded({ game: 'chess', mode: matchMode(seats), models: seats.map(seatId), winner });
          const result = this.deps.chessGame.state().result();
          if (result) {
            const record = this.record(() => this.recorder?.completed(result, this.deps.chessGame.state().fen()));
            if (record) trackMatchRecord(record);
          }
          this.recorder = null;
        }
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
    if (this.recorder) this.stop('user_stopped');
    this.seats = [white, black];
    this.computeLabels();
    this.deps.chessGame.beginMatch(
      white.kind === 'ai' ? creatorOf(white.model) : null,
      black.kind === 'ai' ? creatorOf(black.model) : null,
    );
    const controller = (seat: Seat): RecorderController =>
      seat.kind === 'human' ? { kind: 'human' } : { kind: 'model', model: seat.model };
    this.recorder = isTelemetryEnabled()
      ? new ChessGameRecorder(
          matchMode(this.seats) as 'ai_vs_ai' | 'human_vs_ai' | 'hotseat',
          this.seats.map(controller),
          this.deps.chessGame.state().fen(),
          this.deps.allowIllegal(),
          localPlayerKey(),
        )
      : null;
    trackMatchStarted({
      game: 'chess',
      mode: matchMode(this.seats),
      models: this.seats.map(seatId),
      humans: this.seats.filter((s) => s.kind === 'human').length,
    });
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

  private computeLabels(): void {
    this.labels = disambiguateLabels(
      (this.seats ?? []).map((seat, index) =>
        seat.kind === 'human'
          ? { key: `human:${index}`, label: 'you' }
          : { key: seat.model, label: shortModel(seat.model) },
      ),
    );
  }

  // Swap one side's player mid-match (the in-game model switch): rebuild that
  // side's ModelPlayer in place, so the next turn is decided by the new model.
  // The caller pauses first (cancelling any in-flight thinking for a clean
  // handoff) and resumes after. No-op when idle (no players yet).
  setPlayer(index: number, model: string): void {
    if (!this.players || index < 0 || index >= this.players.length) return;
    this.players[index] = new ModelPlayer<Move>({ model, gameName: 'chess', allowIllegal: this.deps.allowIllegal, normalizer: normalizerModel() });
    if (this.seats) this.seats[index] = { kind: 'ai', model };
    this.computeLabels();
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
