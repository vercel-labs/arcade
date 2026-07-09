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
import { type HandPublicRecord, HoldemState, type PokerAction } from '../../rules/poker/holdem.ts';
import type { PokerGameScene, PokerSeatView } from '../games/poker/poker-scene.ts';
import { shortModel } from '../games/chess/hud.ts';
import { PokerMemory } from './poker-memory.ts';

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

// System prompt for the AI seats. Kept minimal on purpose: state the setup and the one
// hard rule (the spoken rationale is heard by everyone, so cards stay secret unless
// bluffing) without prescribing a playing style, so the model's own behaviour comes
// through. Lives in `system` (see ModelPlayer.persona) so it outranks the per-turn board.
const POKER_PERSONA =
  "You are playing live no-limit Texas Hold'em against the other players at the table. " +
  'Your rationale is spoken aloud for everyone to hear, so do not reveal your own cards or ' +
  'hand strength unless you are bluffing.';

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
  // Session-scoped opponent notes (the "home game" memory) + the display labels the
  // models refer to players by ("the human" / a model's short name, seat-qualified when a
  // model repeats). Each AI seat reflects on the finished hand during the inter-hand hold.
  private readonly memory = new PokerMemory();
  private labels: string[] = [];
  private reflecting: Promise<void> | null = null;
  private reflectAbort: AbortController | null = null;

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

  // ── Opponent notes, for the HUD notes modal ────────────────────────────────────
  // The AI seats that keep notes (the observers you can page through), with their labels.
  noteObservers(): { seat: number; label: string }[] {
    const out: { seat: number; label: string }[] = [];
    for (let s = 0; s < this.seats.length; s++) if (this.seats[s].kind === 'ai') out.push({ seat: s, label: this.labelOf(s) });
    return out;
  }
  // One observer's reads on every OTHER seat at the table (label + its notes), for the
  // modal body. Includes seats with no notes yet so the whole table is shown.
  notesView(observer: number): { label: string; notes: string[] }[] {
    const subjects: number[] = [];
    for (let s = 0; s < this.seats.length; s++) if (s !== observer) subjects.push(s);
    return this.memory.view(observer, subjects).map(({ subject, notes }) => ({ label: this.labelOf(subject), notes }));
  }

  // Start a fresh session with the chosen seats (seat 0 is the human hero). Resets
  // stacks + button, seeds the scene, builds the players, and deals the first hand.
  start(seats: PokerSeatSpec[]): void {
    this.stop();
    this.seats = seats.slice();
    this.stacks = seats.map(() => STARTING_STACK);
    this.button = 0;
    this.memory.reset();
    this.computeLabels();
    const views: PokerSeatView[] = seats.map((s) =>
      s.kind === 'human' ? { kind: 'human', label: 'You' } : { kind: 'ai', label: shortModel(s.model), provider: providerOf(s.model) },
    );
    this.deps.scene.beginSession(views);
    this.players = seats.map((s, i) => this.makePlayer(s, i));
    this.running = true;
    this.paused = false;
    this.deps.syncLive();
    this.dealHand();
  }

  private makePlayer(seat: PokerSeatSpec, index: number): Player<PokerAction> {
    if (seat.kind === 'human') {
      return new HumanPlayer<PokerAction>({ name: 'you', awaitMove: (_s, ctx) => this.deps.scene.requestHumanMove(ctx?.signal) });
    }
    return new ModelPlayer<PokerAction>({
      model: seat.model,
      gameName: "no-limit Texas Hold'em poker",
      moveNotation: POKER_NOTATION,
      // Identity + card-secrecy rule (system prompt).
      persona: POKER_PERSONA,
      // What the rationale field is: the spoken line, kept short. Concealment and context
      // live in the persona; this just says it is talk, not analysis.
      rationaleGuide: 'one short line of table talk.',
      // Per-turn context: chip standings + this seat's private opponent notes, read live.
      contextProvider: () => this.moveContext(index),
    });
  }

  // The extra context woven into a seat's move prompt: session chip standings (who leads)
  // plus that seat's private reads on the other players. Read live so notes taken during
  // the last inter-hand hold are in play this hand.
  private moveContext(observer: number): string {
    const notes = this.memory.renderForPrompt(observer, this.otherLiveSeats(observer), (s) => this.labelOf(s));
    return [this.standings(), notes].filter(Boolean).join('\n\n');
  }

  // Session chip standings by player name, with the current leader called out. Uses the
  // carried (start-of-hand) stacks — a session-level "who's winning", distinct from the
  // precise in-hand stacks the model already sees in its game view.
  private standings(): string {
    if (!this.stacks.length) return '';
    let leader = 0;
    for (let s = 1; s < this.stacks.length; s++) if (this.stacks[s] > this.stacks[leader]) leader = s;
    const parts = this.stacks.map((chips, s) => `${this.labelOf(s)} ${chips}`);
    return `Chip standings: ${parts.join(', ')}. Chip leader: ${this.labelOf(leader)}.`;
  }

  // Player display labels: "the human" for the hero, a model's short name otherwise,
  // seat-qualified ("gpt-5.4 #2") when the same model sits in more than one seat so notes
  // never conflate two seats. Recomputed on session start and on a mid-session model swap.
  private computeLabels(): void {
    const base = this.seats.map((s) => (s.kind === 'human' ? 'the human' : shortModel(s.model)));
    const total = new Map<string, number>();
    for (const b of base) total.set(b, (total.get(b) ?? 0) + 1);
    const seen = new Map<string, number>();
    this.labels = base.map((b) => {
      if ((total.get(b) ?? 0) <= 1) return b;
      const k = (seen.get(b) ?? 0) + 1;
      seen.set(b, k);
      return `${b} #${k}`;
    });
  }
  private labelOf(seat: number): string {
    return this.labels[seat] ?? `P${seat}`;
  }
  // Other seats still in the session (chips > 0), for notes/reflection subjects.
  private otherLiveSeats(observer: number): number[] {
    const out: number[] = [];
    for (let s = 0; s < this.seats.length; s++) if (s !== observer && this.stacks[s] > 0) out.push(s);
    return out;
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
        // Let each AI seat update its opponent notes from this hand, concurrently with the
        // result hold + interlude (scheduleNext awaits it before dealing the next hand).
        this.startReflections(state.publicRecord());
        if (this.running && !this.paused) this.scheduleNext();
      })
      .catch(() => {}); // aborted mid-decision — fine
  }

  // Kick off per-seat note-taking on the just-finished hand. Each AI seat still in the
  // session reflects on the PUBLIC record via its own model, editing its private notes in
  // place. Best-effort and cancellable (pause/stop aborts); the promise is awaited before
  // the next deal so the notes are current when play resumes.
  private startReflections(record: HandPublicRecord): void {
    this.reflectAbort?.abort();
    const ctrl = new AbortController();
    this.reflectAbort = ctrl;
    const jobs: Promise<void>[] = [];
    for (let seat = 0; seat < this.seats.length; seat++) {
      const spec = this.seats[seat];
      if (spec.kind !== 'ai' || this.stacks[seat] <= 0) continue;
      const subjects = this.otherLiveSeats(seat);
      if (!subjects.length) continue;
      jobs.push(this.memory.reflect({ model: spec.model, observer: seat, subjects, record, labelOf: (s) => this.labelOf(s), signal: ctrl.signal }));
    }
    this.reflecting = jobs.length ? Promise.all(jobs).then(() => undefined) : null;
  }

  // After a short hold to read the result, run the scene's gather + reshuffle interlude,
  // then deal the next hand. The interlude animates the finished hand's cards back into
  // the deck and shuffles it twice (cards never teleport); it resolves when squared. The
  // pending note-taking (started at hand end) is awaited before the next deal.
  private scheduleNext(): void {
    if (this.handTimer) clearTimeout(this.handTimer);
    this.handTimer = setTimeout(() => {
      this.handTimer = null;
      if (!this.running || this.paused) return;
      this.deps.scene
        .runInterlude()
        .then(async () => {
          if (this.reflecting) {
            try {
              await this.reflecting;
            } catch {
              /* best-effort */
            }
            this.reflecting = null;
          }
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
    this.reflectAbort?.abort(); // cancel any in-flight note-taking
    this.reflectAbort = null;
    this.reflecting = null;
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
    this.reflectAbort?.abort();
    this.reflectAbort = null;
    this.reflecting = null;
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
    this.memory.clearObserver(seat); // new model → fresh eyes (others keep their reads on this seat)
    this.computeLabels(); // the swapped-in model may change the label / de-dupe suffixes
    this.players[seat] = this.makePlayer(this.seats[seat], seat);
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
