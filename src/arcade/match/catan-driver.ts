// The Catan session driver: turns the setup panel's seat choices into `Player`s and runs
// them through the rules engine, mirroring how poker-driver wraps its match loop. main
// owns the surrounding UI (setup panel, HUD, status line); this owns the session.
//
// The driver owns the whole match lifecycle: snake placement, rolls, robber/discards, builds,
// trades, development cards, and the terminal victory state. The rules state remains the only
// authority; this layer merely connects seats to it and records presentation-friendly history.

import { HumanPlayer } from '../../ai/human-player.ts';
import type { Player } from '../../ai/player.ts';
import { CatanState } from '../../rules/catan/catan.ts';
import type { CatanAction, PlayerColor } from '../../rules/catan/types.ts';
import { createCatanModelPlayer, runCatanMatch } from './catan-setup.ts';
import { disambiguateLabels } from './labels.ts';
import { shortModel } from './model-label.ts';
import { normalizerModel } from './models.ts';

// One seat in the session: you, or an AI model (a Gateway slug). The color is the seat's
// piece color — picked in setup and distinct per seat.
export type CatanSeatSpec = { kind: 'human'; color: PlayerColor } | { kind: 'ai'; model: string; color: PlayerColor };

// What the board scene must offer the driver: the live state, an animated apply, and the
// human seam. Deliberately the same shape as `MatchScene` plus `requestHumanMove`, so the
// scene stays swappable and the driver never reaches into rendering.
export interface CatanBoardScene {
  beginSession(state: CatanState, colors: PlayerColor[], viewerSeat: number): void;
  endSession(): void;
  state(): CatanState;
  playMove(action: CatanAction): Promise<void>;
  requestHumanMove(signal?: AbortSignal): Promise<CatanAction>;
}

export interface CatanDriverDeps {
  scene: CatanBoardScene;
  /** Repaint after any state the HUD reads has changed. */
  syncLive: () => void;
  /** Optional player factory for alternate controllers and deterministic tests. */
  createPlayer?: (spec: CatanSeatSpec, seat: number, label: string) => Player<CatanAction>;
}

// One entry in the public action/chat log the rail shows.
export interface CatanLogEntry {
  seat: number;
  color: PlayerColor;
  actor: string;
  message: string;
  chat?: boolean;
}

export class CatanDriver {
  private seats: CatanSeatSpec[] = [];
  private labels: string[] = [];
  private players: Player<CatanAction>[] = [];
  private live: CatanState | null = null;
  private abort: AbortController | null = null;
  private running = false;
  private complete = false;
  private log: CatanLogEntry[] = [];
  private failure: string | null = null;

  constructor(private readonly deps: CatanDriverDeps) {}

  isRunning(): boolean {
    return this.running;
  }
  // A completed match has a rules-authoritative winner.
  isComplete(): boolean {
    return this.complete;
  }
  state(): CatanState | null {
    return this.live;
  }
  seatSpecs(): readonly CatanSeatSpec[] {
    return this.seats;
  }
  history(): readonly CatanLogEntry[] {
    return this.log;
  }
  // Set when the session ended on an error rather than on completion, so the HUD can say so
  // instead of silently looking idle.
  error(): string | null {
    return this.failure;
  }
  labelOf(seat: number): string {
    return this.labels[seat] ?? `P${seat}`;
  }
  colorOf(seat: number): PlayerColor {
    return this.seats[seat]?.color ?? 'red';
  }
  seatCount(): number {
    return this.seats.length;
  }
  winner(): number {
    return this.live?.winner() ?? -1;
  }
  // Which seat you occupy, or -1 when spectating.
  humanSeat(): number {
    return this.seats.findIndex((s) => s.kind === 'human');
  }

  // Build the state + players and run the full match. Returns immediately; the loop
  // runs in the background and calls syncLive() as it progresses. `autoRun: false` sets the
  // session up without starting the loop — the snapshot tool drives placement itself so a
  // still needs no model call. `rng` makes the session reproducible — it seeds everything the
  // state draws from: the board layout, the dev-card deck, the dice, and the robber's steal.
  // Live sessions leave it unset and keep Math.random.
  start(seats: CatanSeatSpec[], opts?: { autoRun?: boolean; rng?: () => number; maxActions?: number }): CatanState {
    this.stop();
    this.seats = seats.slice();
    this.labels = disambiguateLabels(
      seats.map((seat, index) =>
        seat.kind === 'human'
          ? { key: `human:${index}`, label: 'You' }
          : { key: seat.model, label: shortModel(seat.model) },
      ),
    );
    this.log = [];
    this.failure = null;
    this.complete = false;
    const state = new CatanState({
      numPlayers: seats.length,
      seatNames: this.labels,
      domesticTrade: true,
      ...(seats.every((seat) => seat.kind === 'ai') ? { domesticTradeOfferLimit: 3 } : {}),
      rng: opts?.rng,
    });
    this.live = state;
    this.players = seats.map((s, i) => this.makePlayer(s, i));
    this.abort = new AbortController();
    // Install the authoritative state in the scene before the runner can synchronously read it.
    // Keeping this inside the driver makes session creation atomic for the app and tools alike.
    const humanSeat = seats.findIndex((seat) => seat.kind === 'human');
    this.deps.scene.beginSession(state, seats.map((seat) => seat.color), humanSeat >= 0 ? humanSeat : 0);
    this.running = opts?.autoRun !== false;
    if (this.running) void this.run(opts?.maxActions);
    return state;
  }

  private makePlayer(spec: CatanSeatSpec, seat: number): Player<CatanAction> {
    const custom = this.deps.createPlayer?.(spec, seat, this.labels[seat]);
    if (custom) return custom;
    if (spec.kind === 'human') {
      return new HumanPlayer<CatanAction>({
        name: 'you',
        awaitMove: (_s, ctx) => this.deps.scene.requestHumanMove(ctx?.signal),
      });
    }
    return createCatanModelPlayer({
      model: spec.model,
      name: this.labels[seat],
      normalizer: normalizerModel(),
    });
  }

  private async run(maxActions = 10_000): Promise<void> {
    const signal = this.abort?.signal;
    try {
      await runCatanMatch(this.deps.scene, this.players, {
        signal,
        maxActions,
        onCommentary: (text, _player, playerIndex) => {
          this.log.push({
            seat: playerIndex,
            color: this.colorOf(playerIndex),
            actor: this.labelOf(playerIndex),
            message: text,
            chat: true,
          });
          this.deps.syncLive();
        },
        onActionApplied: (info) => {
          this.record(info.playerIndex, info.choice.action);
          this.deps.syncLive();
        },
      });
      // An aborted run unwinds through here too; only a terminal rules state counts as complete.
      if (!signal?.aborted) this.complete = this.live?.isTerminal() ?? false;
    } catch (err) {
      // An abort is the expected way a session ends early (leaving the screen, a new game),
      // so it is not a failure worth surfacing.
      if (!signal?.aborted) this.failure = err instanceof Error ? err.message : String(err);
    } finally {
      if (!signal?.aborted) {
        this.running = false;
        this.deps.syncLive();
      }
    }
  }

  private record(seat: number, action: CatanAction): void {
    const message =
      action.type === 'initialSettlement'
        ? `placed a settlement on node ${action.node}`
        : action.type === 'initialRoad'
          ? `placed a road on edge ${action.edge}`
          : action.type === 'roll'
            ? `rolled ${this.live?.dice()?.join(' + ') ?? ''}`.trim()
          : this.live?.actionToString(action) ?? action.type;
    this.log.push({ seat, color: this.colorOf(seat), actor: this.labelOf(seat), message });
  }

  // Abort the session loop. Safe to call when nothing is running.
  stop(): void {
    this.abort?.abort();
    this.abort = null;
    this.running = false;
    this.players = [];
  }

  // Leaving the screen entirely: stop and clear, so re-entering shows setup again.
  reset(): void {
    this.stop();
    this.deps.scene.endSession();
    this.live = null;
    this.seats = [];
    this.labels = [];
    this.log = [];
    this.complete = false;
    this.failure = null;
  }
}
