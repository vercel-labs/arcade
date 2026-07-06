// No-limit Texas Hold'em as a harness state. One `HoldemState` = ONE hand: deal
// → preflop/flop/turn/river betting → showdown → terminal. The session (rotating
// button, carried stacks, new hands until bust) lives in the arcade driver, exactly
// as `ChessState` is one game and the match layer is elsewhere.
//
// Imperfect information: dealing happens INTERNALLY (constructor + between streets),
// so no chance node is ever surfaced — `isChanceNode()` is always false and
// `currentPlayer()` returns the seat to act or TERMINAL, which is what the generic
// `runMatch` loop (ai/match.ts) requires (it can't resolve chance nodes). Each AI is
// prompted with `informationStateString(player)` — its own hole cards + the public
// state — so another seat's cards never leak.
//
// Players are seat indices 0..n-1. `returns()` is the per-seat net chip delta for
// the hand (won − contributed), which sums to zero.

import { type Game, type GameState, type ImperfectInfoState, TERMINAL } from '../game.ts';
import { registerGame } from '../registry.ts';
import { type Card, cardLabel, fullDeck, shuffle } from './cards.ts';
import { CATEGORY_NAMES, evaluate, type HandValue } from './hand-eval.ts';

// Streets.
export const PREFLOP = 0;
export const FLOP = 1;
export const TURN = 2;
export const RIVER = 3;
export const SHOWDOWN = 4;
const STREET_NAMES = ['preflop', 'flop', 'turn', 'river', 'showdown'] as const;

// A player's action. `raise`/`bet` carry a TOTAL street commitment ("raise to N");
// `call`/`check`/`fold`/`allin` are derived from state, so they can't disagree with
// it. `applyAction` validates and clamps every action (human or AI), so an arbitrary
// human slider amount or a loosely-parsed model answer is always made legal.
export type PokerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: number } // first wager on a street (facing no bet)
  | { type: 'raise'; to: number } // raise the current bet TO this total
  | { type: 'allin' };

export interface HoldemOpts {
  stacks: number[]; // chips behind each seat at the start of the hand
  button: number; // dealer button seat
  smallBlind: number;
  bigBlind: number;
  rng?: () => number; // injected for reproducible deals (defaults to Math.random)
}

export class HoldemState implements ImperfectInfoState<PokerAction> {
  readonly n: number;
  private sb: number;
  private bb: number;
  readonly button: number;

  private deck: Card[];
  private deckPos = 0;
  private hole: Card[][]; // [seat][2]
  private community: Card[] = [];

  private stacks: number[]; // chips behind
  private committedRound: number[]; // chips in on the CURRENT street
  private committedHand: number[]; // chips in over the whole hand
  private startStacks: number[]; // snapshot, for returns()
  private folded: boolean[];
  private allIn: boolean[];
  private acted: boolean[]; // acted since the last aggressive action THIS street

  private streetNo = PREFLOP;
  private currentBet = 0; // highest committedRound this street (amount to match)
  private minRaise: number; // minimum raise INCREMENT for the next full raise
  private toAct = 0; // seat to act, or -1 when the hand is over

  private log: string[] = []; // public action history, street-tagged
  private loggedStreet = -1; // last street a log entry was tagged with
  private finished = false;
  private payoffs: number[] | null = null; // per-seat net delta, cached at finish
  private awardLog: { seat: number; amount: number }[] = []; // pot awards (for the HUD)

  constructor(opts: HoldemOpts) {
    this.n = opts.stacks.length;
    this.sb = opts.smallBlind;
    this.bb = opts.bigBlind;
    this.button = opts.button;
    this.minRaise = opts.bigBlind;

    this.deck = shuffle(fullDeck(), opts.rng ?? Math.random);
    this.stacks = opts.stacks.slice();
    this.startStacks = opts.stacks.slice();
    this.committedRound = new Array(this.n).fill(0);
    this.committedHand = new Array(this.n).fill(0);
    this.folded = new Array(this.n).fill(false);
    this.allIn = new Array(this.n).fill(false);
    this.acted = new Array(this.n).fill(false);

    // Seats with no chips sit this hand out — folded from the start, dealt no cards,
    // posting no blind (a busted player in a continuing multi-way session). The
    // driver keeps the button on a seat that has chips.
    this.hole = [];
    for (let s = 0; s < this.n; s++) {
      if (this.stacks[s] <= 0) {
        this.folded[s] = true;
        this.hole.push([]);
      } else {
        this.hole.push([this.draw(), this.draw()]);
      }
    }

    this.postBlinds();
  }

  // ── Setup ──────────────────────────────────────────────────────────────────
  private draw(): Card {
    return this.deck[this.deckPos++];
  }

  private postBlinds(): void {
    // Blind seats are found among the seats that are IN this hand (chips > 0), so a
    // sitting-out (busted) seat is skipped. Heads-up (two players in): the button IS
    // the small blind and acts first preflop; the button is guaranteed to be an in
    // seat. 3+: SB is the next in seat left of the button, BB the one after.
    const inCount = this.playersAbleToAct();
    let sbSeat: number;
    let bbSeat: number;
    let first: number;
    if (inCount === 2) {
      sbSeat = this.button;
      bbSeat = this.nextActive((this.button + 1) % this.n);
      first = this.button;
    } else {
      sbSeat = this.nextActive((this.button + 1) % this.n);
      bbSeat = this.nextActive((sbSeat + 1) % this.n);
      first = this.nextActive((bbSeat + 1) % this.n);
    }
    this.commit(sbSeat, this.sb);
    this.commit(bbSeat, this.bb);
    this.currentBet = Math.max(this.committedRound[sbSeat], this.committedRound[bbSeat]);
    this.minRaise = this.bb;
    this.beginBetting(first);
  }

  // Move `amount` (capped at the stack) from a seat into the pot for this street.
  private commit(seat: number, amount: number): void {
    const pay = Math.min(amount, this.stacks[seat]);
    this.stacks[seat] -= pay;
    this.committedRound[seat] += pay;
    this.committedHand[seat] += pay;
    if (this.stacks[seat] === 0) this.allIn[seat] = true;
  }

  // Start a betting round from `first`. If fewer than two players can voluntarily
  // act (everyone else folded / all-in), there's no betting — run the board out.
  private beginBetting(first: number): void {
    if (this.playersAbleToAct() < 2) {
      // Preflop with the blinds already all-in, or an all-in situation: no action.
      this.toAct = -1;
      this.runOutAndFinish();
      return;
    }
    const seat = this.folded[first] || this.allIn[first] ? this.nextActor(first) : first;
    this.toAct = seat;
  }

  // ── Harness contract ─────────────────────────────────────────────────────────
  currentPlayer(): number {
    return this.finished ? TERMINAL : this.toAct;
  }

  isChanceNode(): boolean {
    return false; // dealing is internal — no chance node is ever surfaced
  }
  chanceOutcomes(): { action: PokerAction; prob: number }[] {
    return [];
  }

  isTerminal(): boolean {
    return this.finished;
  }

  returns(): number[] {
    if (this.payoffs) return this.payoffs;
    return new Array(this.n).fill(0);
  }

  clone(): HoldemState {
    const s = Object.create(HoldemState.prototype) as HoldemState;
    (s as { n: number }).n = this.n;
    (s as { button: number }).button = this.button;
    s.sb = this.sb; // same-class access reaches private fields
    s.bb = this.bb;
    s.deck = this.deck.slice();
    s.deckPos = this.deckPos;
    s.hole = this.hole.map((h) => h.slice());
    s.community = this.community.slice();
    s.stacks = this.stacks.slice();
    s.committedRound = this.committedRound.slice();
    s.committedHand = this.committedHand.slice();
    s.startStacks = this.startStacks.slice();
    s.folded = this.folded.slice();
    s.allIn = this.allIn.slice();
    s.acted = this.acted.slice();
    s.streetNo = this.streetNo;
    s.currentBet = this.currentBet;
    s.minRaise = this.minRaise;
    s.toAct = this.toAct;
    s.log = this.log.slice();
    s.loggedStreet = this.loggedStreet;
    s.finished = this.finished;
    s.payoffs = this.payoffs ? this.payoffs.slice() : null;
    s.awardLog = this.awardLog.map((a) => ({ ...a }));
    return s;
  }

  // ── Legal actions (the AI/harness menu) ───────────────────────────────────────
  // A FINITE, distinct set: fold, check XOR call, and a few clamped raise sizes
  // (min-raise, pot-sized, all-in). A human bypasses this and commits an arbitrary
  // slider amount; `applyAction` clamps either way.
  legalActions(): PokerAction[] {
    if (this.finished || this.toAct < 0) return [];
    const seat = this.toAct;
    const toCall = this.currentBet - this.committedRound[seat];
    const out: PokerAction[] = [{ type: 'fold' }];
    if (toCall <= 0) out.push({ type: 'check' });
    else out.push({ type: 'call' });

    const maxTo = this.committedRound[seat] + this.stacks[seat]; // all-in total
    if (maxTo > this.currentBet) {
      const minTo = Math.min(maxTo, this.currentBet === 0 ? this.bb : this.currentBet + this.minRaise);
      const potAfterCall = this.potTotal() + Math.max(0, toCall);
      const potTo = Math.min(maxTo, this.currentBet + potAfterCall);
      const seen = new Set<number>();
      for (const to of [minTo, potTo, maxTo]) {
        const t = Math.round(to);
        if (t <= this.currentBet || t > maxTo || t < minTo || seen.has(t)) continue;
        seen.add(t);
        out.push(this.currentBet === 0 ? { type: 'bet', amount: t } : { type: 'raise', to: t });
      }
      // Ensure all-in is always offered even if it collided with min/pot rounding.
      if (!seen.has(maxTo)) out.push({ type: 'allin' });
    }
    return out;
  }

  // ── Apply ─────────────────────────────────────────────────────────────────────
  applyAction(a: PokerAction): void {
    if (this.finished || this.toAct < 0) return;
    const seat = this.toAct;
    const toCall = this.currentBet - this.committedRound[seat];

    // Normalize the passive/aggressive tags against the actual state, so a mislabeled
    // action (a model "checks" facing a bet, or "bets" when it can only raise) does
    // the sensible legal thing instead of an illegal one.
    let act = a;
    if (act.type === 'check' && toCall > 0) act = { type: 'call' };
    else if (act.type === 'call' && toCall <= 0) act = { type: 'check' };
    else if (act.type === 'bet' && this.currentBet > 0) act = { type: 'raise', to: act.amount };
    else if (act.type === 'raise' && this.currentBet === 0) act = { type: 'bet', amount: act.to };

    switch (act.type) {
      case 'fold':
        this.folded[seat] = true;
        this.acted[seat] = true;
        this.record(seat, 'folds');
        break;
      case 'check':
        this.acted[seat] = true;
        this.record(seat, 'checks');
        break;
      case 'call': {
        this.commit(seat, toCall);
        this.acted[seat] = true;
        this.record(seat, this.allIn[seat] ? 'calls all-in' : 'calls');
        break;
      }
      case 'allin':
        this.raiseTo(seat, this.committedRound[seat] + this.stacks[seat]);
        break;
      case 'bet':
        this.raiseTo(seat, act.amount);
        break;
      case 'raise':
        this.raiseTo(seat, act.to);
        break;
    }
    this.afterAction();
  }

  // Commit up to a target TOTAL for this street (bet / raise / all-in share this).
  // Clamps to the all-in ceiling and up to the legal minimum. A full raise (≥ the
  // min-raise increment) reopens the action and bumps the min-raise; a short all-in
  // does not raise the min-raise. Reopening lets already-acted players respond.
  private raiseTo(seat: number, target: number): void {
    const maxTo = this.committedRound[seat] + this.stacks[seat];
    let to = Math.min(target, maxTo);
    // Enforce the legal minimum unless the player is going all-in for less.
    const minTo = this.currentBet === 0 ? this.bb : this.currentBet + this.minRaise;
    if (to < minTo && to < maxTo) to = Math.min(minTo, maxTo);

    const wasBet = this.currentBet === 0;
    this.commit(seat, to - this.committedRound[seat]);
    if (to > this.currentBet) {
      const raiseSize = to - this.currentBet;
      if (raiseSize >= this.minRaise) this.minRaise = raiseSize; // full raise → new floor
      this.currentBet = to;
      // Reopen the action: everyone still in owes a decision again.
      for (let s = 0; s < this.n; s++) if (s !== seat && !this.folded[s] && !this.allIn[s]) this.acted[s] = false;
      this.record(seat, `${wasBet ? 'bets' : 'raises to'} ${to}${this.allIn[seat] ? ' (all-in)' : ''}`);
    } else {
      // An all-in that doesn't reach the current bet is just a (short) call.
      this.record(seat, 'calls all-in');
    }
    this.acted[seat] = true;
  }

  // After an action: end the hand if one player remains, else continue the round or
  // advance the street.
  private afterAction(): void {
    if (this.activeCount() === 1) {
      this.finish(); // everyone else folded — uncontested
      return;
    }
    if (!this.roundClosed()) {
      this.toAct = this.nextActor(this.toAct);
      return;
    }
    this.advanceStreet();
  }

  private advanceStreet(): void {
    if (this.streetNo >= RIVER) {
      this.finish(); // river betting done → showdown
      return;
    }
    // Deal the next street and open a fresh betting round.
    this.dealStreet(this.streetNo + 1);
    this.streetNo++;
    this.currentBet = 0;
    this.minRaise = this.bb;
    for (let s = 0; s < this.n; s++) {
      this.committedRound[s] = 0;
      this.acted[s] = false;
    }
    // Postflop, first active seat left of the button acts first (heads-up: the BB).
    this.beginBetting((this.button + 1) % this.n);
  }

  private dealStreet(street: number): void {
    if (street === FLOP) this.community.push(this.draw(), this.draw(), this.draw());
    else if (street === TURN || street === RIVER) this.community.push(this.draw());
  }

  // No more betting is possible: deal the rest of the board (no action) and finish.
  private runOutAndFinish(): void {
    while (this.streetNo < RIVER) {
      this.dealStreet(this.streetNo + 1);
      this.streetNo++;
    }
    this.finish();
  }

  // The betting round is over when no seat still owes an action (matched the bet and
  // acted since the last raise). All-in and folded seats never owe an action.
  private roundClosed(): boolean {
    for (let s = 0; s < this.n; s++) if (this.needsToAct(s)) return false;
    return true;
  }
  private needsToAct(seat: number): boolean {
    return !this.folded[seat] && !this.allIn[seat] && !this.acted[seat];
  }

  // Next seat (clockwise) that still owes an action, or -1.
  private nextActor(from: number): number {
    for (let i = 1; i <= this.n; i++) {
      const s = (from + i) % this.n;
      if (this.needsToAct(s)) return s;
    }
    return -1;
  }
  // First seat (clockwise from `start`, inclusive) that can still act, or -1.
  private nextActive(start: number): number {
    for (let i = 0; i < this.n; i++) {
      const s = (start + i) % this.n;
      if (!this.folded[s] && !this.allIn[s]) return s;
    }
    return -1;
  }
  private activeCount(): number {
    let n = 0;
    for (let s = 0; s < this.n; s++) if (!this.folded[s]) n++;
    return n;
  }
  private playersAbleToAct(): number {
    let n = 0;
    for (let s = 0; s < this.n; s++) if (!this.folded[s] && !this.allIn[s]) n++;
    return n;
  }

  // ── Showdown / payouts ─────────────────────────────────────────────────────────
  private finish(): void {
    this.finished = true;
    this.toAct = -1;
    const awarded = new Array(this.n).fill(0);
    const contenders: number[] = [];
    for (let s = 0; s < this.n; s++) if (!this.folded[s]) contenders.push(s);

    if (contenders.length === 1) {
      // Uncontested: the lone player takes the whole pot; no showdown.
      const winner = contenders[0];
      awarded[winner] = this.committedHand.reduce((a, b) => a + b, 0);
      this.awardLog.push({ seat: winner, amount: awarded[winner] });
    } else {
      // Side pots by contribution layer, each awarded to the best eligible hand.
      const values = new Array<HandValue | null>(this.n).fill(null);
      for (const s of contenders) values[s] = evaluate([...this.hole[s], ...this.community]);
      for (const pot of this.buildPots()) {
        // A layer whose contributors all folded is uncalled dead money — refund it
        // equally to the players who put it in (keeps the payout zero-sum).
        if (pot.eligible.length === 0) {
          const share = Math.floor(pot.amount / pot.contributors.length);
          let rem = pot.amount - share * pot.contributors.length;
          for (const c of pot.contributors.slice().sort((a, b) => this.seatOrder(a) - this.seatOrder(b))) {
            awarded[c] += share + (rem-- > 0 ? 1 : 0);
          }
          continue;
        }
        let best = -1;
        const winners: number[] = [];
        for (const s of pot.eligible) {
          const v = values[s];
          if (!v) continue;
          if (v.value > best) {
            best = v.value;
            winners.length = 0;
            winners.push(s);
          } else if (v.value === best) {
            winners.push(s);
          }
        }
        // Split, odd chip to the earliest eligible seat clockwise from the button.
        const share = Math.floor(pot.amount / winners.length);
        let remainder = pot.amount - share * winners.length;
        const ordered = winners.slice().sort((a, b) => this.seatOrder(a) - this.seatOrder(b));
        for (const w of ordered) {
          let amt = share;
          if (remainder > 0) {
            amt++;
            remainder--;
          }
          awarded[w] += amt;
          this.awardLog.push({ seat: w, amount: amt });
        }
      }
    }
    this.payoffs = awarded.map((won, s) => won - this.committedHand[s]);
  }

  // Contribution-layer side pots. Folded players' chips stay in (dead money) but
  // they're never eligible to win; `contributors` records who put each layer in (so
  // an all-folded layer — uncalled money — can be refunded). Returns pots low → high.
  private buildPots(): { amount: number; eligible: number[]; contributors: number[] }[] {
    const contrib = this.committedHand.slice();
    const pots: { amount: number; eligible: number[]; contributors: number[] }[] = [];
    for (;;) {
      let layer = Infinity;
      for (let s = 0; s < this.n; s++) if (contrib[s] > 0) layer = Math.min(layer, contrib[s]);
      if (!isFinite(layer)) break;
      let amount = 0;
      const eligible: number[] = [];
      const contributors: number[] = [];
      for (let s = 0; s < this.n; s++) {
        if (contrib[s] <= 0) continue;
        amount += layer;
        contrib[s] -= layer;
        contributors.push(s);
        if (!this.folded[s]) eligible.push(s);
      }
      // Merge a same-eligibility layer into the previous pot for tidiness.
      const prev = pots[pots.length - 1];
      if (prev && sameSet(prev.eligible, eligible) && sameSet(prev.contributors, contributors)) prev.amount += amount;
      else pots.push({ amount, eligible, contributors });
    }
    return pots;
  }

  // Distance clockwise from the button (button-relative order for odd-chip ties).
  private seatOrder(seat: number): number {
    return (seat - this.button + this.n) % this.n;
  }

  // ── Notation ───────────────────────────────────────────────────────────────────
  actionToString(a: PokerAction): string {
    switch (a.type) {
      case 'fold':
        return 'fold';
      case 'check':
        return 'check';
      case 'call':
        return 'call';
      case 'bet':
        return `bet ${a.amount}`;
      case 'raise':
        return `raise ${a.to}`;
      case 'allin':
        return 'allin';
    }
  }

  // Lenient parse of a model/human answer. Amounts are validated + clamped in
  // applyAction, so any number here is safe; unparseable input returns null (the
  // model is then re-prompted).
  actionFromString(s: string): PokerAction | null {
    const t = s.trim().toLowerCase();
    if (/^fold/.test(t)) return { type: 'fold' };
    if (/^check/.test(t)) return { type: 'check' };
    if (/^(all[\s-]?in|shove|jam)/.test(t)) return { type: 'allin' };
    if (/^call/.test(t)) return { type: 'call' };
    const num = t.match(/(\d+)/);
    if (/^bet/.test(t)) return { type: 'bet', amount: num ? Number(num[1]) : this.bb };
    if (/^raise/.test(t)) return { type: 'raise', to: num ? Number(num[1]) : this.currentBet + this.minRaise };
    return null;
  }

  // The full-table view (debugging / spectator). Includes every hole card, so it is
  // NOT what an AI is prompted with — that's informationStateString.
  toString(): string {
    const lines: string[] = [];
    lines.push(`Board: ${this.community.map(cardLabel).join(' ') || '(none)'}  |  pot ${this.potTotal()}  |  ${STREET_NAMES[this.streetNo]}`);
    for (let s = 0; s < this.n; s++) {
      const tags = [s === this.button ? 'BTN' : '', this.folded[s] ? 'folded' : '', this.allIn[s] ? 'all-in' : '', s === this.toAct ? '<' : '']
        .filter(Boolean)
        .join(' ');
      lines.push(`P${s}: ${this.hole[s].map(cardLabel).join(' ')}  stack ${this.stacks[s]}  bet ${this.committedRound[s]}  ${tags}`);
    }
    return lines.join('\n');
  }

  // Seat `player`'s private view: its own hole cards + all public info, never another
  // seat's cards. This is the observation `ModelPlayer` prompts on.
  informationStateString(player: number): string {
    const toCall = Math.max(0, this.currentBet - this.committedRound[player]);
    const lines: string[] = [];
    lines.push(`No-Limit Texas Hold'em, ${this.n} players. You are seat ${player}${player === this.button ? ' (dealer button)' : ''}.`);
    lines.push(`Your hole cards: ${this.hole[player].map(cardLabel).join(' ')}`);
    lines.push(`Community: ${this.community.map(cardLabel).join(' ') || '(none yet)'}  —  ${STREET_NAMES[this.streetNo]}`);
    lines.push(`Pot: ${this.potTotal()}. Your stack: ${this.stacks[player]}. To call: ${toCall}. Min raise to: ${Math.min(this.committedRound[player] + this.stacks[player], this.currentBet === 0 ? this.bb : this.currentBet + this.minRaise)}. All-in to: ${this.committedRound[player] + this.stacks[player]}.`);
    const seats = [];
    for (let s = 0; s < this.n; s++) {
      const st = this.folded[s] ? 'folded' : this.allIn[s] ? 'all-in' : `${this.stacks[s]} behind`;
      seats.push(`P${s}${s === player ? '(you)' : ''}${s === this.button ? '[BTN]' : ''}: ${st}, in ${this.committedRound[s]}`);
    }
    lines.push(`Seats: ${seats.join('; ')}`);
    lines.push(`Action: ${this.log.join('; ') || '(none yet)'}`);
    return lines.join('\n');
  }

  observationString(player: number): string {
    return this.informationStateString(player);
  }

  // ── Public read accessors for the presentation layer ───────────────────────────
  street(): number {
    return this.streetNo;
  }
  streetName(): string {
    return STREET_NAMES[this.streetNo];
  }
  boardCards(): readonly Card[] {
    return this.community;
  }
  holeOf(seat: number): readonly Card[] {
    return this.hole[seat];
  }
  stackOf(seat: number): number {
    return this.stacks[seat];
  }
  committedOf(seat: number): number {
    return this.committedRound[seat];
  }
  isFolded(seat: number): boolean {
    return this.folded[seat];
  }
  isAllIn(seat: number): boolean {
    return this.allIn[seat];
  }
  toActSeat(): number {
    return this.toAct;
  }
  currentBetAmount(): number {
    return this.currentBet;
  }
  toCall(seat: number): number {
    return Math.max(0, this.currentBet - this.committedRound[seat]);
  }
  minRaiseTo(seat: number): number {
    return Math.min(this.committedRound[seat] + this.stacks[seat], this.currentBet === 0 ? this.bb : this.currentBet + this.minRaise);
  }
  maxRaiseTo(seat: number): number {
    return this.committedRound[seat] + this.stacks[seat];
  }
  potTotal(): number {
    return this.committedHand.reduce((a, b) => a + b, 0);
  }
  history(): readonly string[] {
    return this.log;
  }
  awards(): readonly { seat: number; amount: number }[] {
    return this.awardLog;
  }
  // Seats to reveal at showdown (a real showdown with ≥2 contenders); [] if the hand
  // ended uncontested (no cards shown).
  showdownSeats(): number[] {
    if (!this.finished) return [];
    const contenders: number[] = [];
    for (let s = 0; s < this.n; s++) if (!this.folded[s]) contenders.push(s);
    return contenders.length >= 2 ? contenders : [];
  }
  handName(seat: number): string {
    if (this.folded[seat] || this.community.length < 3) return '';
    return CATEGORY_NAMES[evaluate([...this.hole[seat], ...this.community]).category];
  }

  private record(seat: number, what: string): void {
    // Prefix the first entry of each street with its name (e.g. "[flop] P0 checks").
    const prefix = this.streetNo !== this.loggedStreet ? `[${STREET_NAMES[this.streetNo]}] ` : '';
    this.loggedStreet = this.streetNo;
    this.log.push(`${prefix}P${seat} ${what}`);
  }
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

// The harness Game wrapper. A default 2-player, 1000-chip, 10/20 blinds hand — the
// arcade driver constructs states directly with the live session stacks/button.
export const holdemGame: Game<HoldemState, PokerAction> = {
  type: { shortName: 'holdem', longName: "Texas Hold'em", numPlayers: 2 },
  newInitialState: () => new HoldemState({ stacks: [1000, 1000], button: 0, smallBlind: 10, bigBlind: 20 }),
};

registerGame('holdem', () => holdemGame as unknown as Game<GameState<unknown>, unknown>);
