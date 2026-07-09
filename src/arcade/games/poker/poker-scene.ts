// The playable poker table: a 3D felt table with N seats, dealt hole cards + the
// community board, per-AI-seat provider wisps, and a betting-driven match. The
// analog of ChessGameScene — it implements MatchScene<PokerAction> so the generic
// runMatch loop drives one hand, and exposes a HumanPlayer seam (requestHumanMove)
// for the hero. Session concerns (rotating button, carried stacks, new hands) live
// in the driver (match/poker-driver.ts); this scene renders whatever HoldemState it
// is handed and animates the moves played into it.
//
// The table state (pot, per-seat stacks / actions / hands) is presented entirely by the
// 2D HUD overlay (games/poker/poker-hud.ts) — a WSOP-style broadcast layout — so the
// felt itself stays clean, with no projected labels baked over the 3D.

import {
  type Camera,
  cameraMatrices,
  feltMaterial,
  lambertMaterial,
  type Mat4,
  mat4Multiply,
  mat4MulVec4,
  mat4RotX,
  mat4RotY,
  mat4Translate,
  type Mesh,
  normalize3,
  rasterize,
  type RenderTarget,
  type Texture,
  type Vec3,
} from '../../../engine/index.ts';
import { OrbitCamera } from '../../orbit.ts';
import { loadWisp, mulberry32, providerTint, type Wisp, WISP_SIZE } from '../../scenes/wisp.ts';
import type { RGB } from '../../../engine/index.ts';
import { type Card, RANK_LABELS } from '../../../rules/poker/cards.ts';
import type { HoldemState, PokerAction } from '../../../rules/poker/holdem.ts';
import { cardBackTexture } from './card-textures.ts';
import { CARD_SCALE, CARD_W, drawCard, flatDown, flatUp } from './card-render.ts';
import { HandPeek } from './card-peek.ts';
import { DeckShuffle } from './deck-shuffle.ts';
import { chairMesh, chairModel, FELT_STIPPLE, feltMesh, frameMesh, TABLE_MODEL, TABLE_RADIUS } from './table.ts';

const FOVY = (46 * Math.PI) / 180;
const TABLE_LIGHT = normalize3({ x: 0.25, y: 0.9, z: 0.4 });
const TABLE_AMBIENT = 0.74;

const HOLE_R = TABLE_RADIUS * 0.72; // radius at which a seat's hole cards rest (out toward the rail)
const HOLE_GAP = 0.62 * CARD_W; // tangential half-gap between a seat's two cards (> ½ card wide → no overlap)

// Camera framing. The overview orbits/zooms about the table-top centre (0,0,0);
// the "my hand" button jumps to a close over-the-shoulder pose on the hero's seat.
const CAM_HOME_DIST = 13;
const CAM_MIN_DIST = 3;
const CAM_MAX_DIST = 24;
const OVERVIEW_TARGET: Vec3 = { x: 0, y: 0, z: 0 }; // the table-top center — orbit pivots here

const BOARD_SPACING = CARD_W * 1.12; // gap between community cards
const BOARD_Z = 0.5; // community row sits a touch toward the hero, clear of the centre deck
const CARD_LIFT = 0.08; // rest cards clear of the felt — enough that far seats' cards, seen at a
// grazing angle across the larger table, don't z-fight the felt and drop out
const WISP_FLOAT = 2.2; // world height a seat's wisp floats above the felt
const WISP_SCALE = 1.0; // orb ~0.85 world radius; centred at WISP_FLOAT so its base (~y1.35) still clears the raised backrests
// How long (seconds) a settled action or street-change lingers before the loop asks for
// the next decision. ACTION_SETTLE is the short beat after an ordinary bet/call/fold;
// STREET_HOLD is an extra pause tacked onto the community-deal time when the flop/turn/
// river turns, so the new board lands and reads before play resumes (see playMove).
const ACTION_SETTLE = 0.28;
const STREET_HOLD = 0.55;

// The deck lives at the centre-back of the felt for the whole hand: the opening deal
// flies two cards out to each seat, and each community street (flop/turn/river) is
// dealt from it too. Purely cosmetic — the state already knows every card; this just
// animates them onto the felt, sandbox-deck-mode style.
const DECK_POS = { x: 0, z: -1.4 }; // centre-back; clear of the board row and the seats
const DECK_FULL = 34; // backs in a full stack (visual only); it shrinks as cards are dealt
const DECK_THICK = 0.02; // stacked back thickness
const DEAL_STEP = 0.3; // seconds each card takes to fly to its seat — an unhurried, dealt-by-hand pace
const COMMUNITY_STEP = 0.34; // a community card takes a touch longer (it flips face-up mid-flight)
const DEAL_HOP = 0.85; // height of a dealt card's arc
const DEAL_CARD: Card = { rank: 0, suit: 0 }; // dealt face-down, so identity is irrelevant
// After the opening deal lands, hold this long before the first action is requested, so
// every seat's cards are clearly on the felt (and the hero can peek) before play begins.
const DEAL_HOLD = 2.0;

// ── Object permanence: fold → muck, and the between-hands gather + reshuffle ─────
// Cards never teleport. A fold slides its two cards into a loose burn pile beside the
// deck; the end of a hand gathers every card on the felt back into the deck, which then
// riffle-shuffles twice before the next deal (see runInterlude).
const MUCK_POS = { x: 1.7, z: DECK_POS.z }; // burn pile, beside the deck (clear of the board row + seat cards)
const MUCK_STEP = 0.42; // seconds a folded card takes to slide into the muck
const MUCK_HOP = 0.28; // small arc height as a card slides to the muck
const MUCK_JITTER_POS = 0.16; // world jitter of a mucked card off the pile centre
const MUCK_JITTER_YAW = 0.34; // radians of random rotation per mucked card (a messy pile)
const MUCK_STACK = 0.014; // y increment per mucked card so later folds sit on top
const GATHER_STEP = 0.5; // seconds one gathered card takes to reach the deck
const GATHER_STAGGER = 0.05; // per-card start delay, so cards sweep in rather than all at once
const SHUFFLE_CYCLES = 2; // riffle+bridge passes between hands (the user asked for two)
const SHUFFLE_SPEED = 1.5; // interlude shuffle playback speed (mild speed-up so it reads without dragging)

// Idle: with no session running the table isn't bare — it shows a ring of
// chairs and a centre deck that riffle-shuffles on a loop (see DeckShuffle).
const IDLE_SEATS = 4; // chairs shown around the empty table

const smooth = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

// One card in flight during the opening deal: its destination slot + seat facing.
interface DealCard {
  toX: number;
  toZ: number;
  yaw: number;
}

// A folded card sliding into (then resting in) the muck pile. `from*` is its seat rest
// pose; `to*`/`yaw` its jittered spot on the pile; `t` the 0..1 slide progress.
interface MuckCard {
  fromX: number;
  fromZ: number;
  fromYaw: number;
  toX: number;
  toZ: number;
  yaw: number;
  lift: number; // resting y (stacked so later folds sit on top)
  t: number;
}

// One card being gathered back into the deck at the end of a hand. It flies from its
// felt rest pose (`from*`, face-up or face-down) to the deck, flattening face-down and
// squaring to the deck's orientation; `delay` staggers the sweep.
interface GatherCard {
  fromX: number;
  fromZ: number;
  fromYaw: number;
  faceUp: boolean;
  delay: number;
}

// Shortest signed angle into (−π, π] — so a card yawing to a new facing spins the short
// way rather than unwinding a full turn.
const wrapPi = (a: number): number => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

// A seat's session-level identity (persists across hands): whether it's the human
// hero or an AI, its display label, and (AI) its provider for the wisp.
export interface PokerSeatView {
  kind: 'human' | 'ai';
  label: string;
  provider?: string;
}

// One seat's row in the WSOP-style table HUD: its identity, the two hole cards (each
// null when hidden — face-down for opponents you can't see), the last action it took
// this street ("CHECK" / "RAISE TO 240" / null before it acts), live chip state, and
// the made-hand name once the board allows (revealed seats only).
export interface SeatCardView {
  seat: number;
  name: string;
  provider?: string;
  kind: 'human' | 'ai';
  cards: (Card | null)[]; // exactly 2; null = hidden / not shown to the viewer
  folded: boolean;
  allIn: boolean;
  stack: number;
  lastAction: string | null;
  toAct: boolean; // this seat is the one to act right now
  pos: '' | 'BTN' | 'SB' | 'BB'; // blind/button position this hand (BTN only shown 3+ handed)
  madeHand: string; // e.g. "Two Pair" (only for revealed, unfolded seats post-flop)
  award: number; // chips won this hand (>0 once the hand is decided)
}

// The whole-table HUD view: every seat's row plus the shared pot / board. Card
// visibility is decided in the scene (spectator → all hands; you-playing → only your
// own seat, plus anyone at showdown). null when no session is running.
export interface TableView {
  seats: SeatCardView[];
  pot: number;
  board: readonly Card[];
  boardShown: number;
  street: string;
  ended: boolean; // the hand is over (show made-hands instead of actions)
}

// Card → compact text for the event log, e.g. "Q♥" / "10♦".
const SUIT_GLYPH = ['♠', '♥', '♦', '♣'] as const; // indexed by Suit
const fmtCard = (c: Card): string => `${RANK_LABELS[c.rank]}${SUIT_GLYPH[c.suit]}`;
const fmtCards = (cards: readonly Card[]): string => cards.map(fmtCard).join(' ');

// A played action → its short WSOP-style label for the seat's HUD row. Amounts are
// totals (raise TO, bet amount), matching how HoldemState reads the action.
function actionLabel(a: PokerAction): string {
  switch (a.type) {
    case 'fold':
      return 'FOLD';
    case 'check':
      return 'CHECK';
    case 'call':
      return 'CALL';
    case 'bet':
      return `BET ${a.amount}`;
    case 'raise':
      return `RAISE TO ${a.to}`;
    case 'allin':
      return 'ALL IN';
  }
}

export class PokerGameScene {
  private cam: OrbitCamera;
  private back: Texture;
  // The idle deck at the felt centre, shuffling on a loop while idle (no session).
  private idleDeck: DeckShuffle;
  private dirty = true;
  private lastT = -1;

  private hand: HoldemState | null = null;
  private seats: PokerSeatView[] = [];
  private wisps: (Wisp | null)[] = [];
  private wispRng = mulberry32(0x50fa7);
  private active = false; // a session is running (drives live rendering + wisps)
  private paused = false;

  // The hero's own hole cards are face-down (home-game style); hovering peeks one and
  // clicking lifts it — the exact interaction from the cards sandbox's hand mode, reused
  // verbatim via HandPeek so it behaves identically.
  private heroPeek = new HandPeek(HOLE_R);

  // Opening-deal animation state (see startDeal).
  private deals: DealCard[] = [];
  private dealDone = 0; // cards landed at their seats
  private dealT = 0; // 0..1 flight progress of the in-flight card
  private dealing = false;

  // Community deal: how many board cards have landed, and the flight progress of the
  // one currently coming out of the deck (−1 = none in flight).
  private boardShown = 0;
  private boardT = -1;
  // Cards removed from the deck so far this hand (hole + community) — drives the
  // shrinking centre stack.
  private dealtFromDeck = 0;

  // Each seat's last action this street ("CHECK" / "RAISE TO 240" / null), shown on its
  // HUD row. Reset every hand; cleared for all seats when a new street begins.
  private lastAction: (string | null)[] = [];

  // Folded cards resting in / sliding to the burn pile (object permanence — a fold
  // mucks its cards rather than vanishing them). Swept into the deck by the gather.
  private muck: MuckCard[] = [];
  private muckRng = mulberry32(0x1053e); // stable per-card jitter (positions baked at push time)

  // The between-hands interlude: gather every felt card into the deck, then shuffle it
  // twice, before the next deal. `gather` is the in-flight sweep (null when not gathering);
  // `shuffleClock` ≥ 0 means the bounded riffle/bridge is playing (see runInterlude).
  private handDeck: DeckShuffle;
  private gather: GatherCard[] | null = null;
  private gatherT = 0;
  private shuffleClock = -1;
  private shuffleCyclesLeft = 0;
  private interludeResolve: (() => void) | null = null;

  // Sink for neutral game-event notices (new hand, flop/turn/river, who won) → the chat
  // panel as grey lines. Betting actions are NOT sent here (they live on the seat strips).
  private events: ((text: string) => void) | null = null;

  // A played action lingers so it's watchable; `beat` is a seconds countdown (ticked by
  // dt in renderScene), long enough to cover a street's community deal when one turns.
  private beat = 0;
  private settleResolve: (() => void) | null = null;
  // The post-deal pause before play: set to DEAL_HOLD when the opening deal lands, ticked
  // down in renderScene; awaitDeal() resolves when it lapses so the driver holds the first
  // action until every card is dealt and the pause has passed. −1 = not counting.
  private dealHold = -1;
  private dealResolve: (() => void) | null = null;
  // The hero's pending move request (the HumanPlayer seam), or null.
  private humanReq: { resolve: (a: PokerAction) => void; reject: (e: Error) => void } | null = null;

  constructor() {
    this.back = cardBackTexture();
    this.idleDeck = new DeckShuffle(this.back, { x: 0, z: 0 }); // dead centre of the felt
    this.handDeck = new DeckShuffle(this.back, DECK_POS); // the between-hands shuffle, at the game deck
    this.cam = this.makeIdleCamera(); // the scene opens idle → frame the shuffling deck
  }

  private makeCamera(): OrbitCamera {
    // Over the hero's shoulder (hero seat is at +z, front), tilted down onto the felt.
    // Min distance matches the cards sandbox's hand mode so you can zoom right in to
    // peek at your own hole cards; the look-at leans toward them as you zoom (zoomBy).
    return new OrbitCamera({ azimuth: 0, elevation: 0.7, distance: CAM_HOME_DIST, target: { ...OVERVIEW_TARGET } }, CAM_MIN_DIST, CAM_MAX_DIST);
  }

  // The idle framing: close in on the centre deck at a low, side-on tilt so the
  // riffle bow and bridge arch read as real card flex (the overview is too far/flat to
  // see the bend). The user can still orbit/zoom from here.
  private makeIdleCamera(): OrbitCamera {
    return new OrbitCamera({ azimuth: 0, elevation: 0.62, distance: 9.5, target: { x: 0, y: 0.1, z: 0 } }, CAM_MIN_DIST, CAM_MAX_DIST);
  }

  // Wire the game-event sink (main pushes these into the chat as grey lines).
  setEventSink(fn: (text: string) => void): void {
    this.events = fn;
  }
  private seatName(seat: number): string {
    return this.seats[seat]?.label ?? `Seat ${seat + 1}`;
  }
  // The end-of-hand notice: who won, how much, and (at a real showdown) with what hand.
  private handResult(hand: HoldemState): string {
    const by = new Map<number, number>();
    for (const a of hand.awards()) by.set(a.seat, (by.get(a.seat) ?? 0) + a.amount);
    const winners = [...by.entries()].filter(([, amt]) => amt > 0);
    if (winners.length === 0) return 'Hand over';
    const shown = new Set(hand.showdownSeats());
    if (winners.length === 1) {
      const [seat, amt] = winners[0];
      const hn = shown.has(seat) ? hand.handName(seat) : '';
      return `${this.seatName(seat)} wins ${amt}${hn ? ` with ${hn.toLowerCase()}` : ''}`;
    }
    const total = winners.reduce((s, [, amt]) => s + amt, 0);
    return `${winners.map(([seat]) => this.seatName(seat)).join(' and ')} split ${total}`;
  }

  // ── Session / hand lifecycle ─────────────────────────────────────────────────
  beginSession(seats: PokerSeatView[]): void {
    this.seats = seats;
    this.wisps = seats.map((s, i) => (s.kind === 'ai' && s.provider ? this.loadSeatWisp(s.provider, i) : null));
    this.active = true;
    this.paused = false;
    this.cam = this.makeCamera();
    this.dirty = true;
  }

  endSession(): void {
    this.active = false;
    this.paused = false;
    this.rejectHuman();
    this.cancelInterlude(); // resolve any pending interlude so the driver never hangs
    this.cancelDeal();
    this.muck = [];
    this.hand = null;
    this.cam = this.makeIdleCamera(); // back to the idle framing on the shuffling deck
    this.dirty = true;
  }

  // Set the state for the hand about to be played (the driver builds it with the
  // live session stacks + button).
  beginHand(state: HoldemState): void {
    this.hand = state;
    this.beat = 0;
    // Fresh hole cards → seat the hero's own face-down, hidden until it peeks. Two
    // cards, tucked at ±HOLE_GAP along the hero seat's tangent (seat 0 is at +z).
    const hole = state.holeOf(0);
    this.heroPeek.reset([
      { card: hole[0], seatX: -HOLE_GAP },
      { card: hole[1], seatX: HOLE_GAP },
    ]);
    this.boardShown = 0;
    this.boardT = -1;
    this.dealtFromDeck = 0;
    this.dealHold = -1; // (re)armed when this hand's opening deal lands
    this.lastAction = new Array(state.n).fill(null);
    this.muck = []; // the gather already emptied it; clear defensively for the fresh hand
    this.clearInterlude();
    this.events?.(`New hand · ${this.seatName(state.button)} on the button`);
    this.startDeal();
    this.dirty = true;
  }

  // Build the opening-deal plan: two rounds round-robin over the seats (card 0 to
  // everyone, then card 1), each card flying to that seat's hole-card slot.
  private startDeal(): void {
    const plan: DealCard[] = [];
    const n = this.seats.length;
    for (let round = 0; round < 2; round++) {
      for (let s = 0; s < n; s++) {
        const a = this.seatAngle(s);
        const c = this.seatPos(s, HOLE_R);
        const tx = Math.cos(a);
        const tz = -Math.sin(a);
        const off = round === 0 ? -HOLE_GAP : HOLE_GAP;
        plan.push({ toX: c.x + tx * off, toZ: c.z + tz * off, yaw: a });
      }
    }
    this.deals = plan;
    this.dealDone = 0;
    this.dealT = 0;
    this.dealing = n > 0;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.dirty = true;
  }

  isActive(): boolean {
    return this.active;
  }

  private loadSeatWisp(provider: string, seat: number): Wisp | null {
    try {
      return loadWisp(`public/assets/logos/${provider}.png`, providerTint(provider), seat * 1.3, this.wispRng);
    } catch {
      return null;
    }
  }

  // Swap a seat's wisp to a new provider (in-session model change).
  setSeatProvider(seat: number, provider: string): void {
    if (seat < 0 || seat >= this.seats.length) return;
    this.seats[seat] = { ...this.seats[seat], provider };
    this.wisps[seat] = this.loadSeatWisp(provider, seat);
    this.dirty = true;
  }

  // ── MatchScene<PokerAction> ────────────────────────────────────────────────────
  state(): HoldemState {
    if (!this.hand) throw new Error('poker: no active hand');
    return this.hand;
  }

  // Animate + apply an AI/committed action, resolving once it has settled (a short
  // watchable beat). Card deals happen inside applyAction (the state deals its own
  // streets), so the new board simply renders next frame.
  playMove(action: PokerAction): Promise<void> {
    if (!this.hand) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const boardBefore = this.hand!.boardCards().length;
      const seat = this.hand!.toActSeat();
      const streetBefore = this.hand!.street();
      const wasTerminal = this.hand!.isTerminal();
      this.hand!.applyAction(action);
      // A new betting round clears every seat's shown action; then record this actor's.
      if (this.hand!.street() !== streetBefore) this.lastAction.fill(null);
      if (seat >= 0) this.lastAction[seat] = actionLabel(action);
      // A fold mucks its cards to the burn pile (object permanence — they slide off, not vanish).
      if (action.type === 'fold' && seat >= 0) this.muckSeat(seat);
      const board = this.hand!.boardCards();
      const newCards = board.length - boardBefore;
      // Announce any streets this action turned (flop/turn/river, including a multi-street
      // all-in runout that reveals several at once) and, if the hand just ended, who won.
      if (this.events && newCards > 0) {
        if (boardBefore < 3 && board.length >= 3) this.events(`Flop  ${fmtCards(board.slice(0, 3))}`);
        if (boardBefore < 4 && board.length >= 4) this.events(`Turn  ${fmtCards(board.slice(3, 4))}`);
        if (boardBefore < 5 && board.length >= 5) this.events(`River  ${fmtCards(board.slice(4, 5))}`);
      }
      if (this.events && !wasTerminal && this.hand!.isTerminal()) this.events(this.handResult(this.hand!));
      // If this action turned a street (flop/turn/river, or a multi-street all-in runout),
      // hold long enough for the new board card(s) to deal out of the deck — COMMUNITY_STEP
      // each — plus STREET_HOLD to take them in, before the loop asks for the next move.
      // Otherwise just the short per-action settle. This gates runMatch (it awaits us).
      this.beat = newCards > 0 ? newCards * COMMUNITY_STEP + STREET_HOLD : ACTION_SETTLE;
      this.dirty = true;
      this.settleResolve = resolve;
    });
  }

  // The hero's move seam (HumanPlayer.awaitMove). Resolves when the hero commits via
  // the HUD (commitHumanAction); rejects if the turn is aborted (pause / stop).
  requestHumanMove(signal?: AbortSignal): Promise<PokerAction> {
    return new Promise<PokerAction>((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('aborted'));
      const onAbort = (): void => {
        this.humanReq = null;
        this.dirty = true;
        reject(new Error('aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.humanReq = {
        resolve: (a) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(a);
        },
        reject: (e) => {
          signal?.removeEventListener('abort', onAbort);
          reject(e);
        },
      };
      this.dirty = true;
    });
  }

  // Is the scene awaiting the hero's action right now? (Drives the HUD's enablement.)
  heroToAct(): boolean {
    return this.humanReq !== null;
  }

  // Commit the hero's chosen action (fold / check / call / bet / raise / allin). The
  // driver animates it via playMove next, so this just hands it to the match loop.
  commitHumanAction(a: PokerAction): void {
    const req = this.humanReq;
    if (!req) return;
    this.humanReq = null;
    req.resolve(a);
  }

  private rejectHuman(): void {
    const req = this.humanReq;
    this.humanReq = null;
    req?.reject(new Error('aborted'));
  }

  // The data behind the WSOP-style table HUD (per-seat rows + the shared pot/board).
  // Card visibility: SPECTATE (no human at the table) reveals every hand; otherwise only
  // the human's own seat is shown, plus anyone forced open at a real showdown. `boardShown`
  // tracks the flop/turn/river landing on the felt so the board strip reveals in step with
  // the table animation. null when no session is running.
  tableView(): TableView | null {
    if (!this.active) return null;
    const hand = this.hand;
    const spectator = !this.seats.some((s) => s.kind === 'human');
    const shown = hand ? new Set(hand.showdownSeats()) : new Set<number>();
    const button = hand?.button ?? -1;
    const sb = hand?.smallBlindSeat() ?? -1;
    const bb = hand?.bigBlindSeat() ?? -1;
    const toAct = hand ? hand.toActSeat() : -1;
    const awards = new Map<number, number>();
    if (hand) for (const a of hand.awards()) awards.set(a.seat, (awards.get(a.seat) ?? 0) + a.amount);

    const seats: SeatCardView[] = this.seats.map((s, i) => {
      const isSelf = s.kind === 'human';
      const revealed = !!hand && (spectator || isSelf || shown.has(i));
      const hole = hand ? hand.holeOf(i) : [];
      const cards: (Card | null)[] = revealed ? [hole[0] ?? null, hole[1] ?? null] : [null, null];
      const folded = hand ? hand.isFolded(i) : false;
      // Position badge: BB / SB take priority (so heads-up, where the button IS the SB,
      // reads as SB + BB); the button only shows as BTN when it's neither blind (3+ handed).
      const pos: SeatCardView['pos'] = i === bb ? 'BB' : i === sb ? 'SB' : i === button ? 'BTN' : '';
      return {
        seat: i,
        name: s.label,
        provider: s.provider,
        kind: s.kind,
        cards,
        folded,
        allIn: hand ? hand.isAllIn(i) : false,
        stack: hand ? hand.stackOf(i) : 0,
        lastAction: this.lastAction[i] ?? null,
        toAct: i === toAct,
        pos,
        madeHand: revealed && !folded && hand ? hand.handName(i) : '',
        award: awards.get(i) ?? 0,
      };
    });
    return {
      seats,
      pot: hand ? hand.potTotal() : 0,
      board: hand ? hand.boardCards() : [],
      boardShown: this.boardShown,
      street: hand ? hand.streetName() : '',
      ended: hand ? hand.isTerminal() : false,
    };
  }

  // ── Camera passthrough ─────────────────────────────────────────────────────────
  // Reset to the whole-table overview, orbiting/zooming about the table centre.
  resetView(): void {
    this.cam.reset();
    this.dirty = true;
  }
  orbit(dx: number, dy: number): void {
    this.cam.orbit(dx, dy);
    this.cam.elevation = Math.max(0.16, this.cam.elevation); // don't drop under the table
    this.dirty = true;
  }
  pan(dx: number, dy: number): void {
    this.cam.pan(dx, dy);
    this.dirty = true;
  }
  zoomBy(f: number): void {
    this.cam.zoomBy(f); // zoom straight in on whatever we're looking at (centre by default)
    this.dirty = true;
  }

  needsRender(): boolean {
    return this.dirty || (this.active && !this.paused) || this.beat > 0 || this.dealHold > 0 || this.dealing || this.boardT >= 0 || this.heroPeek.animating() || this.interludeActive() || this.isIdle();
  }

  // ── Hero hole-card peek / lift ─────────────────────────────────────────────────
  // The hero's own cards lie face-down like a real home game; the hero peeks them by
  // hovering (a natural bend, shared with the cards sandbox) and clicks to lift one
  // fully face-on. Only wired when seat 0 is the human hero.
  // The hero can peek its own cards once they're dealt (a human seat 0, not folded, and
  // the opening deal has finished).
  private heroPeekable(): boolean {
    return !this.dealing && this.hand !== null && this.seats[0]?.kind === 'human' && !this.hand.isFolded(0);
  }

  // Pointer-move / click, delegated to the shared HandPeek (identical to the sandbox).
  hoverCard(ndcX: number, ndcY: number, aspect: number): void {
    if (!this.heroPeekable()) return;
    if (this.heroPeek.hover(this.cam, ndcX, ndcY, aspect)) this.dirty = true;
  }
  clickCard(ndcX: number, ndcY: number, aspect: number): void {
    if (!this.heroPeekable()) return;
    if (this.heroPeek.click(this.cam, ndcX, ndcY, aspect)) this.dirty = true;
  }

  // ── Geometry ───────────────────────────────────────────────────────────────────
  // No session running (before the first match, and between sessions) → show the
  // idle table (chair ring + shuffling deck) rather than a bare felt.
  private isIdle(): boolean {
    return !this.active && this.hand === null;
  }
  private seatAngle(seat: number): number {
    const n = this.seats.length || 1;
    return (seat / n) * Math.PI * 2; // seat 0 at +z (front / hero)
  }
  private seatPos(seat: number, radius: number): Vec3 {
    const a = this.seatAngle(seat);
    return { x: Math.sin(a) * radius, y: 0, z: Math.cos(a) * radius };
  }

  // ── Rendering ────────────────────────────────────────────────────────────────
  renderScene(target: RenderTarget, t = 0): void {
    const dt = this.lastT < 0 ? 1 / 30 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    target.clear(6, 10, 8);
    const eye = this.cam.eye();
    const camera: Camera = { eye, target: this.cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 200 };
    const { viewProjection: vp } = cameraMatrices(camera, target.width / target.height);

    // Table + chairs: one per seat during a session, else a default idle ring.
    // Frame (rail/apron/legs) is plain matte; the felt gets the stipple material.
    const tableMvp = mat4Multiply(vp, TABLE_MODEL);
    rasterize(target, frameMesh(), lambertMaterial, { mvp: tableMvp, model: TABLE_MODEL, lightDir: TABLE_LIGHT, ambient: TABLE_AMBIENT });
    rasterize(target, feltMesh(), feltMaterial, { mvp: tableMvp, model: TABLE_MODEL, lightDir: TABLE_LIGHT, ambient: TABLE_AMBIENT, ...FELT_STIPPLE });
    const chair = chairMesh();
    if (this.isIdle()) {
      // Idle state: a ring of chairs around a centre deck shuffling on a loop.
      this.idleDeck.step(dt);
      this.drawChairRing(target, vp, chair, IDLE_SEATS);
      this.idleDeck.draw(target, vp);
    } else {
      this.drawChairRing(target, vp, chair, this.seats.length);
    }

    const hand = this.hand;
    if (hand) {
      if (this.interludeActive()) {
        // Between hands: the felt's cards gather into the deck and it shuffles twice.
        // The normal deck/community/hole draws are suppressed (those cards are in flight).
        this.advanceInterlude(dt);
        this.drawInterlude(target, vp);
      } else {
        this.advanceDeals(dt, hand);
        if (this.heroPeekable()) this.heroPeek.step(dt); // settle the hero's peek/lift spring
        this.drawDeck(target, vp); // the stock stays on the felt all hand
        this.drawCommunity(target, vp, hand); // board cards that have landed + the one flipping out
        // While the opening deal plays, hole cards fly from the deck to each seat; once
        // they've all landed the hand renders at rest (hero peekable).
        if (this.dealing) this.drawOpeningFlights(target, vp);
        else this.drawHoleCards(target, vp, hand);
        this.advanceMuck(dt);
        if (this.muck.length) this.drawMuck(target, vp); // folded cards resting in the burn pile
      }
    }

    // Wisps above each AI seat, pulsing the seat to act (idle when paused/over).
    if (this.active) this.drawWisps(target, vp, t, dt);

    // Tick the played-action beat (seconds); when it lapses, wake playMove's awaiter.
    if (this.beat > 0) {
      this.beat -= dt;
      if (this.beat <= 0) {
        this.beat = 0;
        const done = this.settleResolve;
        this.settleResolve = null;
        done?.();
      }
    }
    // Tick the post-deal pause; when it lapses, release awaitDeal so play can begin.
    if (this.dealHold > 0) {
      this.dealHold -= dt;
      if (this.dealHold <= 0) {
        this.dealHold = -1;
        const done = this.dealResolve;
        this.dealResolve = null;
        done?.();
      }
    }
    this.dirty = false;
  }

  // Advance the deal animations: the opening hole-card deal first, then (once it's
  // done) the community cards, one at a time, as the hand's board grows.
  private advanceDeals(dt: number, hand: HoldemState): void {
    if (this.dealing) {
      this.dealT += dt / DEAL_STEP;
      while (this.dealT >= 1 && this.dealDone < this.deals.length) {
        this.dealT -= 1;
        this.dealDone++;
        this.dealtFromDeck++;
      }
      if (this.dealDone >= this.deals.length) {
        this.dealing = false;
        this.dealT = 0;
        this.dealHold = DEAL_HOLD; // all cards down → start the pre-play pause
      }
      return;
    }
    // Community: deal any board cards the state has turned but we haven't shown yet.
    const target = hand.boardCards().length;
    if (this.boardT < 0 && this.boardShown < target) this.boardT = 0;
    if (this.boardT >= 0) {
      this.boardT += dt / COMMUNITY_STEP;
      if (this.boardT >= 1) {
        this.boardShown++;
        this.dealtFromDeck++;
        this.boardT = this.boardShown < target ? 0 : -1; // chain the next card, or stop
      }
    }
  }

  // Backs left in the deck (a card in flight is already off the top).
  private deckRemaining(): number {
    const inFlight = (this.dealing ? 1 : 0) + (this.boardT >= 0 ? 1 : 0);
    return Math.max(1, DECK_FULL - this.dealtFromDeck - inFlight);
  }
  private deckTopY(): number {
    return this.deckRemaining() * DECK_THICK + CARD_LIFT;
  }

  // Draw `n` chairs evenly around the rail (chair k at angle (k/n)·2π; seat 0 at +z),
  // reusing one chair mesh. Shared by the live seat ring and the idle ring.
  private drawChairRing(target: RenderTarget, vp: Mat4, chair: Mesh, n: number): void {
    for (let k = 0; k < n; k++) {
      const model = chairModel((k / n) * Math.PI * 2);
      rasterize(target, chair, lambertMaterial, { mvp: mat4Multiply(vp, model), model, lightDir: TABLE_LIGHT, ambient: TABLE_AMBIENT });
    }
  }

  // The persistent stock at the centre-back of the felt (shrinks as cards are dealt).
  // Drawn top-down (nearest card first) so the rasterizer's early-Z rejects the
  // occluded interior of the lower backs instead of shading them — the stock is a tall
  // stack of near-coincident quads, almost all overdraw. Opaque + depth-tested, so the
  // draw order doesn't change the final image (nearest wins regardless).
  private drawDeck(target: RenderTarget, vp: Mat4): void {
    const rem = this.deckRemaining();
    for (let i = rem - 1; i >= 0; i--) {
      const M = mat4Multiply(mat4Translate(DECK_POS.x, i * DECK_THICK + CARD_LIFT, DECK_POS.z), flatDown());
      drawCard(target, vp, M, DEAL_CARD, this.back);
    }
  }

  // Fixed 5-slot community row, centred; the flop fills the left three, turn + river
  // extend rightward — so cards never shift as the board grows.
  private boardSlotX(i: number): number {
    return (i - 2) * BOARD_SPACING;
  }

  // Community cards that have landed (face-up) plus the one currently flying out of the
  // deck and flipping face-up as it goes.
  private drawCommunity(target: RenderTarget, vp: Mat4, hand: HoldemState): void {
    const board = hand.boardCards();
    for (let i = 0; i < this.boardShown && i < board.length; i++) {
      const M = mat4Multiply(mat4Translate(this.boardSlotX(i), CARD_LIFT, BOARD_Z), flatUp());
      drawCard(target, vp, M, board[i], this.back);
    }
    if (this.boardT >= 0 && this.boardShown < board.length) {
      const i = this.boardShown;
      const p = smooth(this.boardT);
      const sx = this.boardSlotX(i);
      const x = DECK_POS.x + (sx - DECK_POS.x) * p;
      const z = DECK_POS.z + (BOARD_Z - DECK_POS.z) * p;
      const y = this.deckTopY() + Math.sin(p * Math.PI) * DEAL_HOP + CARD_LIFT;
      const rx = Math.PI / 2 - Math.PI * p; // face-down off the deck → face-up as it lands
      const M = mat4Multiply(mat4Translate(x, y, z), mat4Multiply(mat4RotX(rx), CARD_SCALE));
      drawCard(target, vp, M, board[i], this.back);
    }
  }

  // The opening hole-card deal: cards already at rest at their seats (face-down) plus
  // the one currently arcing out of the deck.
  private drawOpeningFlights(target: RenderTarget, vp: Mat4): void {
    for (let i = 0; i < this.dealDone; i++) {
      const d = this.deals[i];
      const M = mat4Multiply(mat4Translate(d.toX, CARD_LIFT, d.toZ), mat4Multiply(mat4RotY(d.yaw), flatDown()));
      drawCard(target, vp, M, DEAL_CARD, this.back);
    }
    if (this.dealing && this.dealDone < this.deals.length) {
      const d = this.deals[this.dealDone];
      const p = smooth(this.dealT);
      const x = DECK_POS.x + (d.toX - DECK_POS.x) * p;
      const z = DECK_POS.z + (d.toZ - DECK_POS.z) * p;
      const y = this.deckTopY() + Math.sin(p * Math.PI) * DEAL_HOP + CARD_LIFT;
      const M = mat4Multiply(mat4Translate(x, y, z), mat4Multiply(mat4RotY(d.yaw * p), flatDown()));
      drawCard(target, vp, M, DEAL_CARD, this.back);
    }
  }

  private drawHoleCards(target: RenderTarget, vp: Mat4, hand: HoldemState): void {
    const reveal = hand.showdownSeats(); // small array (≤ seats) — membership via includes, no per-frame Set
    // The human hero peeks its own cards (shared HandPeek) during play; at showdown they
    // flip up flat like everyone else's. An AI seat 0 stays hidden until showdown.
    const heroPeek = this.seats[0]?.kind === 'human';
    for (let s = 0; s < this.seats.length; s++) {
      if (hand.isFolded(s)) continue;
      const hole = hand.holeOf(s);
      if (s === 0 && heroPeek && !reveal.includes(0)) {
        this.heroPeek.draw(target, vp, this.cam.azimuth, this.back);
        continue;
      }
      const faceUp = reveal.includes(s); // every other seat (and the hero at showdown) reveals here
      const a = this.seatAngle(s);
      const c = this.seatPos(s, HOLE_R);
      // Two cards, offset along the seat's tangent (perpendicular to the radial).
      const tx = Math.cos(a);
      const tz = -Math.sin(a);
      for (let k = 0; k < hole.length; k++) {
        const off = (k === 0 ? -HOLE_GAP : HOLE_GAP);
        const M = mat4Multiply(mat4Translate(c.x + tx * off, CARD_LIFT, c.z + tz * off), mat4Multiply(mat4RotY(a), faceUp ? flatUp() : flatDown()));
        drawCard(target, vp, M, hole[k] as Card, this.back);
      }
    }
  }

  // ── Fold → muck pile (object permanence) ───────────────────────────────────────
  // Push a folded seat's two cards onto the burn pile: they slide from their seat rest
  // pose to a jittered, rotated spot beside the deck (a loose pile, not a neat stack).
  private muckSeat(seat: number): void {
    if (!this.hand) return;
    const a = this.seatAngle(seat);
    const c = this.seatPos(seat, HOLE_R);
    const tx = Math.cos(a);
    const tz = -Math.sin(a);
    for (let k = 0; k < 2; k++) {
      const off = k === 0 ? -HOLE_GAP : HOLE_GAP;
      const idx = this.muck.length;
      this.muck.push({
        fromX: c.x + tx * off,
        fromZ: c.z + tz * off,
        fromYaw: a,
        toX: MUCK_POS.x + (this.muckRng() * 2 - 1) * MUCK_JITTER_POS,
        toZ: MUCK_POS.z + (this.muckRng() * 2 - 1) * MUCK_JITTER_POS,
        yaw: (this.muckRng() * 2 - 1) * MUCK_JITTER_YAW,
        lift: CARD_LIFT + idx * MUCK_STACK,
        t: 0,
      });
    }
    this.dirty = true;
  }

  private advanceMuck(dt: number): void {
    for (const m of this.muck) if (m.t < 1) m.t = Math.min(1, m.t + dt / MUCK_STEP);
  }

  // Draw the burn pile: each card slides (with a small hop) from its seat pose to its
  // jittered resting spot, face-down the whole way.
  private drawMuck(target: RenderTarget, vp: Mat4): void {
    for (const m of this.muck) {
      const p = smooth(m.t);
      const x = m.fromX + (m.toX - m.fromX) * p;
      const z = m.fromZ + (m.toZ - m.fromZ) * p;
      const y = m.lift + Math.sin(p * Math.PI) * MUCK_HOP;
      const yaw = m.fromYaw + wrapPi(m.yaw - m.fromYaw) * p;
      const M = mat4Multiply(mat4Translate(x, y, z), mat4Multiply(mat4RotY(yaw), flatDown()));
      drawCard(target, vp, M, DEAL_CARD, this.back);
    }
  }

  // ── Opening-deal gate ──────────────────────────────────────────────────────────
  // Resolve once the opening deal has fully landed AND the post-deal pause has elapsed.
  // The driver awaits this before starting the turn loop, so no seat acts until every
  // card is on the felt and the table has settled for a beat.
  awaitDeal(): Promise<void> {
    if (!this.dealing && this.dealHold <= 0) return Promise.resolve(); // already settled
    return new Promise<void>((resolve) => {
      this.dealResolve = resolve;
    });
  }

  // Drop a pending deal-gate wait (pause / stop) so the driver's await never hangs.
  cancelDeal(): void {
    this.dealHold = -1;
    const done = this.dealResolve;
    this.dealResolve = null;
    done?.();
  }

  // ── Between-hands interlude: gather → shuffle ×2 → (driver deals next) ───────────
  // Snapshot every card on the felt (live hole cards, the community board, and the muck)
  // as a gather sweep into the deck, then hand off to the bounded shuffle. Resolves once
  // the deck is squared, so the driver can deal the next hand. Called on the terminal
  // hand, whose HoldemState is still `this.hand` (the HUD keeps showing the result).
  runInterlude(): Promise<void> {
    const hand = this.hand;
    if (!hand) return Promise.resolve();
    const g: GatherCard[] = [];
    const push = (fromX: number, fromZ: number, fromYaw: number, faceUp: boolean): void => {
      g.push({ fromX, fromZ, fromYaw, faceUp, delay: g.length * GATHER_STAGGER });
    };
    // Live seats' hole cards (folded seats are already in the muck), face-up if shown.
    const reveal = hand.showdownSeats();
    for (let s = 0; s < this.seats.length; s++) {
      if (hand.isFolded(s)) continue;
      const a = this.seatAngle(s);
      const c = this.seatPos(s, HOLE_R);
      const tx = Math.cos(a);
      const tz = -Math.sin(a);
      const faceUp = reveal.includes(s);
      for (let k = 0; k < 2; k++) {
        const off = k === 0 ? -HOLE_GAP : HOLE_GAP;
        push(c.x + tx * off, c.z + tz * off, a, faceUp);
      }
    }
    // The community board (face-up), then the muck (face-down).
    for (let i = 0; i < this.boardShown; i++) push(this.boardSlotX(i), BOARD_Z, 0, true);
    for (const m of this.muck) push(m.toX, m.toZ, m.yaw, false);
    this.muck = [];
    this.gather = g;
    this.gatherT = 0;
    this.shuffleClock = -1;
    this.shuffleCyclesLeft = SHUFFLE_CYCLES;
    this.dirty = true;
    return new Promise<void>((resolve) => {
      this.interludeResolve = resolve;
    });
  }

  // Abort the interlude (pause / stop): drop the animation and resolve any waiter so the
  // driver's `await` never hangs.
  cancelInterlude(): void {
    const done = this.interludeResolve;
    this.clearInterlude();
    done?.();
    this.dirty = true;
  }

  private clearInterlude(): void {
    this.gather = null;
    this.gatherT = 0;
    this.shuffleClock = -1;
    this.shuffleCyclesLeft = 0;
    this.interludeResolve = null;
  }

  private interludeActive(): boolean {
    return this.gather !== null || this.shuffleClock >= 0;
  }

  // Advance the interlude clock: run the gather to completion, then the bounded shuffle;
  // when the last shuffle cycle squares up, resolve the waiter.
  private advanceInterlude(dt: number): void {
    if (this.gather !== null) {
      this.gatherT += dt;
      const last = (this.gather.length ? (this.gather.length - 1) * GATHER_STAGGER : 0) + GATHER_STEP;
      if (this.gatherT >= last) {
        this.gather = null;
        this.shuffleClock = 0; // squared deck → begin the riffle/bridge
      }
      return;
    }
    if (this.shuffleClock < 0) return;
    this.shuffleClock += dt * SHUFFLE_SPEED;
    const loop = this.handDeck.loop;
    while (this.shuffleClock >= loop && this.shuffleCyclesLeft > 0) {
      this.shuffleClock -= loop;
      this.shuffleCyclesLeft--;
    }
    if (this.shuffleCyclesLeft <= 0) {
      const done = this.interludeResolve;
      this.clearInterlude();
      done?.(); // the deck is squared — let the driver deal the next hand
    }
  }

  // Draw the interlude: the gather sweep (cards flying into a growing deck), then the
  // bounded shuffle at the deck position.
  private drawInterlude(target: RenderTarget, vp: Mat4): void {
    if (this.gather !== null) {
      this.drawDeck(target, vp); // the leftover stock is the base the cards land on
      const baseTopY = this.deckTopY();
      for (let i = 0; i < this.gather.length; i++) {
        const gc = this.gather[i];
        const p = smooth((this.gatherT - gc.delay) / GATHER_STEP);
        const landY = baseTopY + i * DECK_THICK;
        const x = gc.fromX + (DECK_POS.x - gc.fromX) * p;
        const z = gc.fromZ + (DECK_POS.z - gc.fromZ) * p;
        const y = CARD_LIFT + (landY - CARD_LIFT) * p + Math.sin(p * Math.PI) * DEAL_HOP * 0.6;
        const yaw = gc.fromYaw + wrapPi(0 - gc.fromYaw) * p;
        const rx0 = gc.faceUp ? -Math.PI / 2 : Math.PI / 2; // flatUp vs flatDown tilt
        const rx = rx0 + (Math.PI / 2 - rx0) * p; // flatten to face-down
        const M = mat4Multiply(mat4Translate(x, y, z), mat4Multiply(mat4RotY(yaw), mat4Multiply(mat4RotX(rx), CARD_SCALE)));
        drawCard(target, vp, M, DEAL_CARD, this.back);
      }
      return;
    }
    this.handDeck.setClock(Math.max(0, this.shuffleClock));
    this.handDeck.draw(target, vp);
  }

  private drawWisps(target: RenderTarget, vp: Mat4, t: number, dt: number): void {
    const hand = this.hand;
    const turn = this.paused || !hand ? -1 : hand.toActSeat();
    const { right, up } = this.cam.basis();
    const W = target.width;
    const H = target.height;
    for (let s = 0; s < this.wisps.length; s++) {
      const wisp = this.wisps[s];
      if (!wisp) continue;
      const c = this.seatPos(s, TABLE_RADIUS + 0.4);
      wisp.setSpeaking(turn === s);
      wisp.renderWorld(target, vp, right, up, { x: c.x, y: WISP_FLOAT, z: c.z }, W, H, t, dt, WISP_SCALE);
    }
  }

  // ── Wisp picking (click an AI seat's wisp to swap its model) ───────────────────
  wispAt(ndcX: number, ndcY: number, aspect: number): number | null {
    if (!this.active) return null;
    const eye = this.cam.eye();
    const camera: Camera = { eye, target: this.cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 200 };
    const { viewProjection: vp } = cameraMatrices(camera, aspect);
    const { up } = this.cam.basis();
    const size = WISP_SIZE * WISP_SCALE;
    let best: number | null = null;
    let bestD = Infinity;
    for (let s = 0; s < this.wisps.length; s++) {
      if (!this.wisps[s]) continue;
      const c = this.seatPos(s, TABLE_RADIUS + 0.4);
      const P = { x: c.x, y: WISP_FLOAT, z: c.z };
      const center = mat4MulVec4(vp, { x: P.x, y: P.y, z: P.z, w: 1 });
      const cw = center.w || 1e-4;
      const cx = center.x / cw;
      const cy = center.y / cw;
      const e = mat4MulVec4(vp, { x: P.x + up.x * size, y: P.y + up.y * size, z: P.z + up.z * size, w: 1 });
      const ew = e.w || 1e-4;
      const radius = Math.hypot(e.x / ew - cx, e.y / ew - cy);
      const d = Math.hypot(ndcX - cx, ndcY - cy);
      if (d < radius * 1.6 && d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }
}
