// The poker session driver, the analog of AiMatch for chess. It owns the SESSION —
// the seats, their carried stacks, the dealer button — and loops hands: build a
// fresh HoldemState from the live stacks, run the generic turn-loop (runMatch) over
// it, apply the per-seat chip deltas, rotate the button, and deal again, until only
// one seat has chips (or it's stopped). The scene renders each hand and provides the
// human seam; main owns the surrounding UI (setup modal, commentary, HUD).

import { runMatch } from '../../ai/match.ts';
import { ModelPlayer, type MoveNotation } from '../../ai/model-player.ts';
import { HumanPlayer } from '../../ai/human-player.ts';
import type { Player } from '../../ai/player.ts';
import { HoldemState, type PokerAction } from '../../rules/poker/holdem.ts';
import type { PokerGameScene, PokerSeatView } from '../games/poker/poker-scene.ts';
import { shortModel } from '../games/chess/hud.ts';

// One seat in the session: the human hero or an AI model (a Gateway slug).
export type PokerSeatSpec = { kind: 'human' } | { kind: 'ai'; model: string };

const STARTING_STACK = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const RESULT_HOLD_MS = 3000; // linger on the revealed hand — cards shown, chips won, winner's strip gold — before the gather/reshuffle interlude (no winner splash; the lingered state IS the celebration)

// How poker moves are written, for the model prompt/schema (see ModelPlayer).
const POKER_NOTATION: MoveNotation = {
  description: 'a poker action — one of "fold", "check", "call", "bet <amount>", "raise <amount>", or "allin" (amounts are TOTAL chips to put in this street)',
  examples: '"call", "raise 120", "fold", "allin"',
};

const providerOf = (slug: string): string => slug.split('/')[0] ?? slug;

export interface PokerMatchDeps {
  scene: PokerGameScene;
  syncLive(): void;
  requestRender(): void;
  onCommentary(text: string, name: string): void;
  onHandOver(): void; // refresh the HUD / show the result between hands
}

export class PokerMatch {
  private seats: PokerSeatSpec[] = [];
  private stacks: number[] = [];
  private button = 0;
  private players: Player<PokerAction>[] = [];
  private abort: AbortController | null = null;
  private paused = false;
  private running = false;
  private handTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: PokerMatchDeps) {}

  isRunning(): boolean {
    return this.running;
  }
  isPaused(): boolean {
    return this.paused;
  }
  seatSpecs(): readonly PokerSeatSpec[] {
    return this.seats;
  }

  // Start a fresh session with the chosen seats (seat 0 is the human hero). Resets
  // stacks + button, seeds the scene, builds the players, and deals the first hand.
  start(seats: PokerSeatSpec[]): void {
    this.stop();
    this.seats = seats.slice();
    this.stacks = seats.map(() => STARTING_STACK);
    this.button = 0;
    const views: PokerSeatView[] = seats.map((s) =>
      s.kind === 'human' ? { kind: 'human', label: 'You' } : { kind: 'ai', label: shortModel(s.model), provider: providerOf(s.model) },
    );
    this.deps.scene.beginSession(views);
    this.players = seats.map((s) => this.makePlayer(s));
    this.running = true;
    this.paused = false;
    this.deps.syncLive();
    this.dealHand();
  }

  private makePlayer(seat: PokerSeatSpec): Player<PokerAction> {
    if (seat.kind === 'human') {
      return new HumanPlayer<PokerAction>({ name: 'you', awaitMove: (_s, ctx) => this.deps.scene.requestHumanMove(ctx?.signal) });
    }
    return new ModelPlayer<PokerAction>({
      model: seat.model,
      gameName: "no-limit Texas Hold'em poker",
      moveNotation: POKER_NOTATION,
      // The rationale is spoken TABLE TALK, not analysis: banter about the action, your
      // read or confidence, or a little needle at an opponent — one short casual line.
      // Crucially it must never reveal your own hole cards (this is live poker).
      rationaleGuide:
        'a single short line of casual table talk said out loud to the other players — react to the action, hint at your confidence, or needle an opponent, in your own voice. NEVER state or reveal your own hole cards or exact hand.',
    });
  }

  private aliveCount(): number {
    return this.stacks.filter((s) => s > 0).length;
  }
  private nextAlive(from: number): number {
    for (let i = 1; i <= this.stacks.length; i++) {
      const s = (from + i) % this.stacks.length;
      if (this.stacks[s] > 0) return s;
    }
    return from;
  }

  // Build a new HoldemState from the live stacks and play it out.
  private dealHand(): void {
    if (!this.running) return;
    if (this.aliveCount() < 2) {
      this.finishSession();
      return;
    }
    if (this.stacks[this.button] <= 0) this.button = this.nextAlive(this.button);
    const state = new HoldemState({ stacks: this.stacks.slice(), button: this.button, smallBlind: SMALL_BLIND, bigBlind: BIG_BLIND });
    this.deps.scene.beginHand(state);
    this.deps.onHandOver(); // refresh HUD for the fresh hand
    // Hold the first action until every card is dealt and the table has settled for a beat.
    this.deps.scene
      .awaitDeal()
      .then(() => {
        // `abort === null` guards against a stale resolve (e.g. cancelled by pause then
        // resumed, which starts the loop itself) double-starting the turn loop.
        if (this.running && !this.paused && this.abort === null) this.runCurrentHand();
      })
      .catch(() => {});
  }

  // Run the turn-loop over the scene's current hand (used to start a hand and to
  // resume a paused one — runMatch reads scene.state(), so it continues from the
  // current turn). On natural completion: apply the chip deltas, rotate the button,
  // and schedule the next hand.
  private runCurrentHand(): void {
    const ctrl = new AbortController();
    this.abort = ctrl;
    this.deps.syncLive();
    this.deps.requestRender();
    const state = this.deps.scene.state();
    runMatch<PokerAction>(this.deps.scene, this.players, {
      signal: ctrl.signal,
      onCommentary: (text, player) => this.deps.onCommentary(text, player.name),
    })
      .then(() => {
        if (ctrl.signal.aborted || this.abort !== ctrl) return; // paused / stopped mid-hand
        const r = state.returns();
        for (let i = 0; i < this.stacks.length; i++) this.stacks[i] += r[i];
        this.abort = null;
        this.deps.onHandOver();
        this.deps.requestRender();
        this.button = this.nextAlive(this.button);
        if (this.running && !this.paused) this.scheduleNext();
      })
      .catch(() => {}); // aborted mid-decision — fine
  }

  // After a short hold to read the result, run the scene's gather + reshuffle interlude,
  // then deal the next hand. The interlude animates the finished hand's cards back into
  // the deck and shuffles it twice (cards never teleport); it resolves when squared.
  private scheduleNext(): void {
    if (this.handTimer) clearTimeout(this.handTimer);
    this.handTimer = setTimeout(() => {
      this.handTimer = null;
      if (!this.running || this.paused) return;
      this.deps.scene
        .runInterlude()
        .then(() => {
          if (this.running && !this.paused) this.dealHand();
        })
        .catch(() => {});
    }, RESULT_HOLD_MS);
  }

  // Pause on whoever's turn it is: cancel any in-flight thinking / human wait and the
  // inter-hand timer, and freeze the wisps. The hand stays alive for resume.
  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.deps.scene.setPaused(true);
    this.abort?.abort();
    this.abort = null;
    if (this.handTimer) {
      clearTimeout(this.handTimer);
      this.handTimer = null;
    }
    this.deps.scene.cancelInterlude(); // drop any in-flight gather/reshuffle
    this.deps.scene.cancelDeal(); // and any pending post-deal wait
    this.deps.requestRender();
  }

  // Resume: continue the current hand if one is mid-play, else deal the next.
  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.deps.scene.setPaused(false);
    let hasHand = false;
    try {
      hasHand = !this.deps.scene.state().isTerminal();
    } catch {
      hasHand = false;
    }
    if (hasHand) this.runCurrentHand();
    else this.dealHand();
  }

  // Fully stop the session: cancel the loop + timer and tear down the scene session.
  stop(): void {
    this.abort?.abort();
    this.abort = null;
    if (this.handTimer) {
      clearTimeout(this.handTimer);
      this.handTimer = null;
    }
    this.running = false;
    this.paused = false;
    this.deps.scene.cancelInterlude();
    this.deps.scene.cancelDeal();
    this.deps.scene.endSession();
  }

  // Swap one seat's model mid-session (the wisp-swap popup): rebuild that seat's
  // ModelPlayer + wisp. Takes effect on its next turn.
  setSeatModel(seat: number, model: string): void {
    if (seat < 0 || seat >= this.players.length) return;
    if (this.seats[seat]?.kind !== 'ai') return;
    this.seats[seat] = { kind: 'ai', model };
    this.players[seat] = this.makePlayer(this.seats[seat]);
    this.deps.scene.setSeatProvider(seat, providerOf(model));
  }

  // The session is over (one seat has all the chips). Leave it on screen; the HUD
  // shows the winner. main clears it on navigating away / new match.
  private finishSession(): void {
    this.running = false;
    this.deps.onHandOver();
    this.deps.syncLive();
    this.deps.requestRender();
  }
}
