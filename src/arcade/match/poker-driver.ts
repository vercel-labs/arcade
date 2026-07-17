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
import { disambiguateLabels } from './labels.ts';
import { PokerMemory } from './poker-memory.ts';
import { PokerVoice, pokerVoiceCapable } from './poker-voice.ts';
import { normalizerModel } from './models.ts';

// One seat in the session: the human hero or an AI model (a Gateway slug).
export type PokerSeatSpec =
  | { kind: 'human' }
  | { kind: 'ai'; model: string; runtime: 'text' }
  | { kind: 'ai'; model: string; runtime: 'realtime' };

const STARTING_STACK = 1000;
const SMALL_BLIND = 10;
// Exported so the setup slider snaps the starting stack to a whole big blind (one source
// of truth for the blind size).
export const BIG_BLIND = 20;
// Chip amounts read as money in the winner banner: a "$" prefix + thousands separators.
const money = (n: number): string => `$${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

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
  'Everything you say out loud is heard by everyone, so bluff and mislead freely but never ' +
  'honestly reveal the cards you are holding.';

const creatorOf = (slug: string): string => slug.split('/')[0] ?? slug;

export interface PokerMatchDeps {
  scene: PokerGameScene;
  syncLive(): void;
  requestRender(): void;
  onCommentary(text: string, model: string, label: string): void;
  onHandOver(): void; // refresh the HUD / show the result between hands
  // A spoken line for the chat rail (voice heads-up): `event` lines render grey/nameless.
  onChat?(text: string, speaker: string, event: boolean, label?: string): void;
  // A human action parsed from speech is staged awaiting confirm (null clears it).
  onVoiceStage?(label: string | null): void;
}

export class PokerMatch {
  private seats: PokerSeatSpec[] = [];
  private stacks: number[] = [];
  private button = 0;
  private players: Player<PokerAction>[] = [];
  private abort: AbortController | null = null;
  private paused = false;
  private running = false;
  // Session-scoped opponent notes (the "home game" memory) + the display labels the
  // models refer to players by ("the human" / a model's short name, seat-qualified when a
  // model repeats). Each AI seat reflects on the finished hand while the winner banner waits.
  private readonly memory = new PokerMemory();
  private labels: string[] = [];
  private reflecting: Promise<void> | null = null;
  private reflectAbort: AbortController | null = null;
  // Realtime voice opponent, created only when a heads-up seat explicitly uses the
  // realtime runtime and duplex audio is available. Null for standard text seats.
  private voice: PokerVoice | null = null;

  constructor(private readonly deps: PokerMatchDeps) {}

  // Whether this session is running heads-up voice against the AI.
  hasVoice(): boolean {
    return this.voice !== null;
  }
  // Confirm / cancel a human action staged from speech (main binds these to keys).
  confirmVoiceAction(): void {
    this.voice?.confirmStaged();
  }
  cancelVoiceAction(): void {
    this.voice?.cancelStaged();
  }

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
  // The AI seats that keep notes (the observers the picker switches between), with
  // their labels + creator (for the picker's brand tint).
  noteObservers(): { seat: number; label: string; creator: string }[] {
    const out: { seat: number; label: string; creator: string }[] = [];
    for (let s = 0; s < this.seats.length; s++) {
      const spec = this.seats[s];
      if (spec.kind === 'ai') out.push({ seat: s, label: this.labelOf(s), creator: creatorOf(spec.model) });
    }
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
  // A realtime seat explicitly identifies the voice runtime and actual model.
  // `opts.stack` sets the per-player starting chips (from the setup slider); defaults to STARTING_STACK.
  start(seats: PokerSeatSpec[], opts?: { stack?: number }): void {
    this.stop();
    this.seats = seats.slice();
    this.stacks = seats.map(() => opts?.stack ?? STARTING_STACK);
    this.button = 0;
    this.memory.reset();
    this.computeLabels();
    const views: PokerSeatView[] = seats.map((s, seat) =>
      s.kind === 'human' ? { kind: 'human', label: 'You' } : { kind: 'ai', label: this.labelOf(seat), creator: creatorOf(s.model) },
    );
    this.deps.scene.beginSession(views);
    this.setupVoice(); // may set this.voice for a 2-seat human-vs-AI match — before makePlayer
    this.players = seats.map((s, i) => this.makePlayer(s, i));
    this.running = true;
    this.paused = false;
    this.deps.syncLive();
    if (this.voice) void this.voice.start(); // open the realtime session for the whole match
    this.dealHand();
  }

  // Set up the heads-up voice opponent from the realtime seat itself. Invalid or
  // unavailable realtime configurations fail instead of silently running another model.
  private setupVoice(): void {
    this.voice = null;
    const realtimeSeats = this.seats.flatMap((seat, index) =>
      seat.kind === 'ai' && seat.runtime === 'realtime' ? [index] : [],
    );
    if (realtimeSeats.length === 0) return;
    if (this.seats.length !== 2 || realtimeSeats.length !== 1) {
      throw new Error('Realtime voice requires one human and one realtime AI seat.');
    }
    const humanSeat = this.seats.findIndex((s) => s.kind === 'human');
    const botSeat = realtimeSeats[0];
    const botSpec = this.seats[botSeat];
    if (humanSeat < 0 || botSpec?.kind !== 'ai' || botSpec.runtime !== 'realtime') {
      throw new Error('Realtime voice requires one human and one realtime AI seat.');
    }
    if (!pokerVoiceCapable()) throw new Error('Realtime voice is unavailable in this terminal.');
    this.voice = new PokerVoice({
      scene: this.deps.scene,
      botSeat,
      humanSeat,
      botModel: botSpec.model, // full slug → chat name colored by the seat's wisp/provider tint
      botLabel: this.labelOf(botSeat),
      onChat: (text, speaker, opts) =>
        this.deps.onChat?.(
          text,
          speaker,
          !!opts?.event,
          speaker === botSpec.model ? this.labelOf(botSeat) : undefined,
        ),
      onStage: (action, label) => this.deps.onVoiceStage?.(action ? label : null),
      requestRender: () => this.deps.requestRender(),
    });
  }

  private makePlayer(seat: PokerSeatSpec, index: number): Player<PokerAction> {
    if (seat.kind === 'human') {
      return new HumanPlayer<PokerAction>({ name: 'you', awaitMove: (_s, ctx) => this.deps.scene.requestHumanMove(ctx?.signal) });
    }
    if (seat.runtime === 'realtime') {
      if (!this.voice) throw new Error('Realtime poker seat started without a voice session.');
      return this.voice.player();
    }
    return new ModelPlayer<PokerAction>({
      model: seat.model,
      gameName: "no-limit Texas Hold'em poker",
      moveNotation: POKER_NOTATION,
      // Identity + card-secrecy rule (system prompt).
      persona: POKER_PERSONA,
      // Split the output so move analysis goes to a private "thinking" field and only the
      // public "say" line reaches the chat. This is what stops a model from leaking its
      // hand while justifying a move (a bare "rationale" field invites "8-4 is junk"). The
      // guide steers `say` toward lively social talk so the chat has character, not a flat
      // announcement of the action.
      speech:
        'a line or two of live table talk in your own voice: banter, needle, read the board, rattle an opponent. Talk to the table, do not just announce your move. Bluff and lie about your hand freely, but never honestly reveal the cards you are holding.',
      // Per-turn context: chip standings + this seat's private opponent notes, read live.
      contextProvider: () => this.moveContext(index),
      // Fallback normalization rung (AIG-183). Safe under poker's private-info boundary:
      // in split (speech) mode ModelPlayer only ever surfaces the public `say` line, so a
      // normalized action never leaks the private "thinking"/hole cards.
      normalizer: normalizerModel(),
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

  // Player display labels: "the human" for prompts, a model's short name otherwise,
  // parenthesized when the exact Gateway slug repeats. Recomputed on start and model swap.
  private computeLabels(): void {
    this.labels = disambiguateLabels(
      this.seats.map((seat, index) =>
        seat.kind === 'human'
          ? { key: `human:${index}`, label: 'the human' }
          : { key: seat.model, label: shortModel(seat.model) },
      ),
    );
    this.deps.scene.setSeatLabels(
      this.seats.map((seat, index) => (seat.kind === 'human' ? 'You' : this.labels[index])),
    );
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
    // Pass the display labels ("the human" / model short-names) so the model observation
    // names seats instead of "P0/P1" — models then refer to each other by name.
    const state = new HoldemState({
      stacks: this.stacks.slice(),
      button: this.button,
      smallBlind: SMALL_BLIND,
      bigBlind: BIG_BLIND,
      seatNames: this.labels.length ? this.labels.slice() : undefined,
    });
    this.deps.scene.beginHand(state);
    this.voice?.beginHand(state); // seed the bot with its own hole cards for this hand
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
      onCommentary: (text, player) => {
        const seat = this.players.indexOf(player);
        this.deps.onCommentary(text, player.name, seat >= 0 ? this.labelOf(seat) : shortModel(player.name));
      },
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
        // winner banner + interlude (proceedAfterHand awaits it before dealing the next hand).
        this.startReflections(state.publicRecord());
        if (this.running && !this.paused) this.proceedAfterHand(state);
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
      if (spec.kind !== 'ai' || spec.runtime === 'realtime' || this.stacks[seat] <= 0) continue;
      const subjects = this.otherLiveSeats(seat);
      if (!subjects.length) continue;
      jobs.push(this.memory.reflect({ model: spec.model, observer: seat, subjects, record, labelOf: (s) => this.labelOf(s), signal: ctrl.signal }));
    }
    this.reflecting = jobs.length ? Promise.all(jobs).then(() => undefined) : null;
  }

  // The end-of-hand winner announcement + "click to continue", then the gather/reshuffle
  // interlude, then the next hand. The winner banner (scene.beginResult) shows over the
  // revealed final table and BLOCKS until the user clicks/keys — so the hand lingers as
  // long as they like, not a fixed timer. On continue: run the interlude (cards fly back
  // into the deck and it shuffles twice — never teleporting), await the pending note-taking
  // (started at hand end, so it overlaps the wait), then deal the next hand.
  private proceedAfterHand(state: HoldemState): void {
    this.deps.scene
      .beginResult(this.winnerText(state))
      .then(async () => {
        if (!this.running || this.paused) return;
        await this.deps.scene.runInterlude();
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
  }

  // The winner banner text: "You win $240" / "claude-haiku-4.5 wins $240" (a model's short
  // display name), or a split-pot "A and B split $240". Amounts are the pot each seat took.
  private winnerText(state: HoldemState): string {
    const by = new Map<number, number>();
    for (const a of state.awards()) by.set(a.seat, (by.get(a.seat) ?? 0) + a.amount);
    const winners = [...by.entries()].filter(([, amt]) => amt > 0);
    const disp = (seat: number): string => (this.seats[seat]?.kind === 'human' ? 'You' : this.labelOf(seat));
    if (winners.length === 0) return 'Hand over';
    if (winners.length === 1) {
      const [seat, amt] = winners[0];
      const verb = this.seats[seat]?.kind === 'human' ? 'win' : 'wins';
      return `${disp(seat)} ${verb} ${money(amt)}`;
    }
    const total = winners.reduce((s, [, amt]) => s + amt, 0);
    return `${winners.map(([s]) => disp(s)).join(' and ')} split ${money(total)}`;
  }

  // Pause on whoever's turn it is: cancel any in-flight thinking / human wait, any pending
  // continue gate (cinematic / winner banner), and freeze the wisps. The hand stays alive
  // for resume.
  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.deps.scene.setPaused(true);
    this.abort?.abort();
    this.abort = null;
    this.reflectAbort?.abort(); // cancel any in-flight note-taking
    this.reflectAbort = null;
    this.reflecting = null;
    this.deps.scene.cancelInterlude(); // drop any in-flight gather/reshuffle
    this.deps.scene.cancelDeal(); // and any pending post-deal wait
    this.deps.scene.cancelContinue(); // and any bird's-eye deal / winner "click to continue"
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
    this.running = false;
    this.paused = false;
    this.voice?.close(); // tear down the realtime session + free the mic
    this.voice = null;
    this.deps.scene.cancelInterlude();
    this.deps.scene.cancelDeal();
    this.deps.scene.endSession(); // also cancels any pending continue gate
  }

  // Swap one seat's model mid-session (the wisp-swap popup): rebuild that seat's
  // ModelPlayer + wisp. Takes effect on its next turn.
  setSeatModel(seat: number, model: string): void {
    if (seat < 0 || seat >= this.players.length) return;
    if (this.seats[seat]?.kind !== 'ai') return;
    this.seats[seat] = { kind: 'ai', model, runtime: this.seats[seat].runtime };
    this.memory.clearObserver(seat); // new model → fresh eyes (others keep their reads on this seat)
    this.computeLabels(); // the swapped-in model may change the label / de-dupe suffixes
    this.players[seat] = this.makePlayer(this.seats[seat], seat);
    this.deps.scene.setSeatCreator(seat, creatorOf(model));
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
