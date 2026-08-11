// The Catan session driver: turns the setup panel's seat choices into `Player`s and runs
// them through the rules engine, mirroring how poker-driver wraps its match loop. main
// owns the surrounding UI (setup panel, HUD, status line); this owns the session.
//
// SCOPE: this drives the INITIAL PLACEMENT phase only — `runCatanInitialPlacement` stops
// the loop the moment `initialPlacementComplete()` is true. Roll/build/trade are not wired
// yet on purpose; extending to a full game is a matter of swapping in `runCatanMatch`, and
// the state, players, and history plumbing here are already what that needs.

import { HumanPlayer } from '../../ai/human-player.ts';
import type { Player } from '../../ai/player.ts';
import { CatanState } from '../../rules/catan/catan.ts';
import type { CatanAction, PlayerColor } from '../../rules/catan/types.ts';
import { createCatanSetupModelPlayer, runCatanInitialPlacement } from './catan-setup.ts';
import { shortModel } from '../games/chess/hud.ts';

// One seat in the session: you, or an AI model (a Gateway slug). The color is the seat's
// piece color — picked in setup and distinct per seat.
export type CatanSeatSpec = { kind: 'human'; color: PlayerColor } | { kind: 'ai'; model: string; color: PlayerColor };

// What the board scene must offer the driver: the live state, an animated apply, and the
// human seam. Deliberately the same shape as `MatchScene` plus `requestHumanMove`, so the
// scene stays swappable and the driver never reaches into rendering.
export interface CatanBoardScene {
  state(): CatanState;
  playMove(action: CatanAction): Promise<void>;
  requestHumanMove(signal?: AbortSignal): Promise<CatanAction>;
}

export interface CatanDriverDeps {
  scene: CatanBoardScene;
  /** Repaint after any state the HUD reads has changed. */
  syncLive: () => void;
}

// One entry in the placement log the rail shows.
export interface CatanLogEntry {
  seat: number;
  color: PlayerColor;
  actor: string;
  message: string;
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
  // Placement finished — the point this phase deliberately stops at.
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
  // Which seat you occupy, or -1 when spectating.
  humanSeat(): number {
    return this.seats.findIndex((s) => s.kind === 'human');
  }

  // Build the state + players and run the placement phase. Returns immediately; the loop
  // runs in the background and calls syncLive() as it progresses. `autoRun: false` sets the
  // session up without starting the loop — the snapshot tool drives placement itself so a
  // still needs no model call. `rng` seeds the board so a snapshot lands the same hexes
  // twice; live sessions leave it unset for a fresh board each game.
  start(seats: CatanSeatSpec[], opts?: { autoRun?: boolean; rng?: () => number }): CatanState {
    this.stop();
    this.seats = seats.slice();
    this.labels = seats.map((s) => (s.kind === 'human' ? 'You' : shortModel(s.model)));
    this.log = [];
    this.failure = null;
    this.complete = false;
    const state = new CatanState({ numPlayers: seats.length, seatNames: this.labels, rng: opts?.rng });
    this.live = state;
    this.players = seats.map((s, i) => this.makePlayer(s, i));
    this.abort = new AbortController();
    this.running = opts?.autoRun !== false;
    if (this.running) void this.run();
    return state;
  }

  private makePlayer(spec: CatanSeatSpec, seat: number): Player<CatanAction> {
    if (spec.kind === 'human') {
      return new HumanPlayer<CatanAction>({
        name: 'you',
        awaitMove: (_s, ctx) => this.deps.scene.requestHumanMove(ctx?.signal),
      });
    }
    return createCatanSetupModelPlayer({ model: spec.model, name: this.labels[seat] });
  }

  private async run(): Promise<void> {
    const signal = this.abort?.signal;
    try {
      await runCatanInitialPlacement(this.deps.scene, this.players, {
        signal,
        onActionApplied: (info) => {
          this.record(info.playerIndex, info.choice.action);
          this.deps.syncLive();
        },
      });
      // An aborted run unwinds through here too; only a genuinely finished placement counts.
      if (!signal?.aborted) this.complete = this.live?.initialPlacementComplete() ?? false;
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
          : this.live?.actionToString(action) ?? action.type;
    this.log.push({ seat, color: this.colorOf(seat), actor: this.labelOf(seat), message });
  }

  // Abort the session and drop its state. Safe to call when nothing is running.
  stop(): void {
    this.abort?.abort();
    this.abort = null;
    this.running = false;
    this.players = [];
  }

  // Leaving the screen entirely: stop and clear, so re-entering shows setup again.
  reset(): void {
    this.stop();
    this.live = null;
    this.seats = [];
    this.labels = [];
    this.log = [];
    this.complete = false;
    this.failure = null;
  }
}
