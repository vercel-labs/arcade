// The playable poker table: a 3D felt table with N seats, dealt hole cards + the
// community board, per-AI-seat creator wisps, and a betting-driven match. The
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
import { loadCreatorWisp, mulberry32, type Wisp, WISP_SIZE } from '../../scenes/wisp.ts';
import type { RGB } from '../../../engine/index.ts';
import { type Card, RANK_LABELS } from '../../../rules/poker/cards.ts';
import type { HoldemState, PokerAction } from '../../../rules/poker/holdem.ts';
import { cardBackTexture } from './card-textures.ts';
import { CARD_H, CARD_SCALE, CARD_W, drawCard, flatDown, flatUp } from './card-render.ts';
import { HandPeek } from './card-peek.ts';
import { DeckShuffle } from './deck-shuffle.ts';
import { chairMesh, chairModel, FELT_STIPPLE, feltMesh, frameMesh, TABLE_MODEL, TABLE_RADIUS } from './table.ts';
import { type ChipColumn, chipPileHalfExtent, drawChipStack, playerColumns, potColumns } from './chips.ts';

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
// A "press any key to continue" gate (a board reveal or the end-of-hand winner banner)
// auto-advances after this many seconds if the user doesn't act, so an unattended /
// spectated match keeps flowing. A keypress still advances it immediately.
const CONTINUE_AUTO_S = 6;

// Community-deal cinematic: when a betting round closes and the flop/turn/river turns,
// the camera hard-cuts from wherever the user was to a fixed bird's-eye over the board,
// deals the card(s), holds so they read, then cuts back. Camera controls are frozen for
// its whole duration and the HUD hides everything but the top-right pills (see cine*).
const CINE_PRE = 0.25; // beat after the chips settle, before the cut (nothing deals yet)
// The fixed bird's-eye: near-straight-down onto the community cards. The distance is
// computed per street so EVERY card dealt so far is fully in frame while maximising the
// zoom — the flop's three, then all four on the turn, all five on the river — rather than
// tracking only the newest card. CINE_MARGIN leaves a little gap around the outermost cards.
const CINE_ELEVATION = 1.4;
const CINE_MARGIN = 1.18;

// The deck lives at the centre-back of the felt for the whole hand: the opening deal
// flies two cards out to each seat, and each community street (flop/turn/river) is
// dealt from it too. Purely cosmetic — the state already knows every card; this just
// animates them onto the felt, sandbox-deck-mode style.
const DECK_POS = { x: 0, z: -1.4 }; // centre-back; clear of the board row and the seats
const DECK_FULL = 34; // backs in a full stack (visual only); it shrinks as cards are dealt
const DECK_THICK = 0.02; // stacked back thickness
const DEAL_STEP = 0.3; // seconds each card takes to fly to its seat — an unhurried, dealt-by-hand pace
const COMMUNITY_STEP = 0.68; // a community card flies out slowly (it flips face-up mid-flight) so the bird's-eye reads
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

// ── Chips (see games/poker/chips.ts) ────────────────────────────────────────────
// A seat's carried stack sits beside its hole cards — at the card radius (HOLE_R) but
// pushed CHIP_SIDE along the seat tangent, so it never covers the seat's own cards nor the
// board/burn at the centre. Chips move in two staged beats, never teleporting: when a seat
// bets, the chips it pushes out fly from that stack to the bet spot in front of it at
// CHIP_BET_R over BET_PLACE_T; when the betting round closes, all the front bets then slide
// from CHIP_BET_R to the pot (opposite the muck across the deck) over CHIP_COLLECT_T. The
// deal cinematic waits for both to finish before it cuts to the bird's-eye, so the user sees
// their chips land in front and sweep to the pot on their own view first.
const CHIP_SIDE = 1.65; // baseline tangential offset of the carried stack from the seat's cards
// A tall carried stack piles into a wider cluster; left at the fixed CHIP_SIDE it creeps back
// over the seat's own hole cards (a $10k stack is much wider than a $1k one). So the offset is
// pushed out until the pile's near edge clears the far edge of the two cards by CHIP_CARD_GAP.
// Small stacks stay at CHIP_SIDE; only wide piles shift further out (never onto the cards).
const CARD_TAN_EDGE = HOLE_GAP + CARD_W / 2; // tangential half-span of a seat's two hole cards
const CHIP_CARD_GAP = 0.18; // clearance kept between the pile's near edge and the cards
// The felt is flat out to TABLE_RADIUS, where a raised rail lip begins; a chip whose base is
// past this radius rides up into / behind that lip and reads as sinking under the table. So a
// carried stack's whole footprint is kept inside this radius (pulled toward centre if a big
// pile would otherwise overhang the rail). The felt top is y=0, so chips rest at BASE_Y on it.
const FELT_USABLE_R = TABLE_RADIUS - 0.5;
const CHIP_BET_R = 2.4; // radius of the this-street bet, in front of the seat toward centre
const CHIP_POT_POS = { x: -1.7, z: -1.4 }; // mirror of MUCK_POS across the deck
const BET_PLACE_T = 0.3; // seconds chips take to fly from a seat's stack to its bet spot
const CHIP_COLLECT_T = 0.42; // seconds the front bets take to sweep into the pot

// Idle: with no session running the table isn't bare — it shows a ring of
// chairs and a centre deck that riffle-shuffles on a loop (see DeckShuffle).
const IDLE_SEATS = 4; // chairs shown around the empty table (when no setup preview is up)

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
  card: Card;
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
  card: Card;
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
// hero or an AI, its display label, and (AI) its model creator for the wisp.
export interface PokerSeatView {
  kind: 'human' | 'ai';
  label: string;
  creator?: string;
}

// One seat's row in the WSOP-style table HUD: its identity, the two hole cards (each
// null when hidden — face-down for opponents you can't see), the last action it took
// this street ("CHECK" / "RAISE TO 240" / null before it acts), live chip state, and
// the made-hand name once the board allows (revealed seats only).
export interface SeatCardView {
  seat: number;
  name: string;
  creator?: string;
  kind: 'human' | 'ai';
  cards: (Card | null)[]; // exactly 2; null = hidden (opponent, or a hero card not yet peeked)
  folded: boolean;
  allIn: boolean;
  stack: number;
  lastAction: string | null;
  toAct: boolean; // this seat is the one to act right now
  pos: '' | 'BTN' | 'SB' | 'BB'; // blind/button position this hand (BTN only shown 3+ handed)
  madeHand: string; // e.g. "Two Pair" (only for revealed, unfolded seats post-flop)
  award: number; // chips won this hand (>0 once the hand is decided)
  eliminated: boolean; // busted / sitting this hand out (no chips, dealt no cards)
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

// Chip amounts read as money everywhere in the HUD: a "$" prefix + thousands separators.
const money = (n: number): string => `$${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

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
      return `BET ${money(a.amount)}`;
    case 'raise':
      return `RAISE TO ${money(a.to)}`;
    case 'allin':
      return 'ALL IN';
  }
}

// A natural-language narration of an action for the chat thread, e.g. "Claude raises to
// 120" / "You go all-in". `second` (the human hero) uses second-person verbs so it reads
// "You call" rather than "You calls".
export function actionNarration(name: string, a: PokerAction, second: boolean): string {
  const s = second ? '' : 's'; // third-person verb suffix
  switch (a.type) {
    case 'fold':
      return `${name} fold${s}`;
    case 'check':
      return `${name} check${s}`;
    case 'call':
      return `${name} call${s}`;
    case 'bet':
      return `${name} bet${s} ${money(a.amount)}`;
    case 'raise':
      return `${name} raise${s} to ${money(a.to)}`;
    case 'allin':
      return second ? `${name} go all-in` : `${name} goes all-in`;
  }
}

export class PokerGameScene {
  private cam: OrbitCamera;
  private back: Texture;
  // The idle deck at the felt centre, shuffling on a loop while idle (no session).
  private idleDeck: DeckShuffle;
  private dirty = true;
  private lastT = -1;
  private lastAspect = 1.6; // width/height of the last render target — for the bird's-eye fit math

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

  // Bet placement (null when idle): the `pushed` chips a seat just moved out flying from its
  // stack to its bet spot as `t` runs 0→1 (the first staged beat — no teleport).
  private betPlace: { seat: number; pushed: number; t: number } | null = null;
  // Bet → pot chip collection (null when idle): `bets[seat]` is each seat's committed amount
  // at the moment the round closed, sliding from its bet spot to the pot as `t` runs 0→1.
  // `pendingCollect` holds those amounts while a placement is still landing — the sweep only
  // starts once betPlace finishes, so the two beats never overlap. Purely visual.
  private chipCollect: { bets: number[]; t: number } | null = null;
  private pendingCollect: number[] | null = null;

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
  // dt in renderScene). A street-turning action instead runs the community-deal cinematic
  // below, which resolves the same settle when it finishes.
  private beat = 0;
  private settleResolve: (() => void) | null = null;
  // The community-deal cinematic (null when idle). `pre` holds on the user's view a beat,
  // then a hard cut to the bird's-eye (`deal`) while the board flies out, then `wait` —
  // it sits on the bird's-eye showing a "press any key to continue" prompt until the user
  // presses a key (continueGesture), which cuts back to `saved`. Camera controls are frozen
  // during pre+deal (the mouse frees up in `wait`).
  private cine: { phase: 'pre' | 'deal' | 'wait'; clock: number; saved: OrbitCamera } | null = null;
  // End-of-hand winner gate: the banner text ("Claude wins $240" / "You win $240") shown at
  // top-centre over the still-visible final table, plus its "click to continue" prompt.
  // `resultResolve` is the driver's waiter, released by continueGesture (or cancelContinue).
  private resultText: string | null = null;
  private resultResolve: (() => void) | null = null;
  // Auto-advance countdown for whichever "press any key to continue" gate is up (board
  // reveal or winner banner): seconds remaining, or −1 when no gate / not counting. Ticked
  // in renderScene; fires continueGesture at zero. A keypress still advances immediately.
  private continueClock = -1;
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

  // The community-deal cinematic's fixed pose: a near-top-down bird's-eye framing EVERY
  // community card revealed by this street (slots 0..total-1) — the flop's 3, the turn's 4,
  // the river's 5 — centred on their midpoint and pulled back just far enough that they all
  // fit (so the turn zooms out a touch from the flop, the river a touch more). The distance
  // is the larger of the width fit (cards span horizontally, scaled by the terminal aspect)
  // and the height fit (a card's length fills the frame vertically).
  private makeBirdsEyeCamera(): OrbitCamera {
    const total = this.hand ? this.hand.boardCards().length : 5;
    const cx = total > 0 ? (this.boardSlotX(0) + this.boardSlotX(total - 1)) / 2 : 0;
    const spanX = (total > 0 ? this.boardSlotX(total - 1) - this.boardSlotX(0) : 0) + CARD_W; // outer edge to outer edge
    const tanV = Math.tan(FOVY / 2);
    const dWidth = (spanX * 0.5 * CINE_MARGIN) / (tanV * this.lastAspect);
    const dHeight = (CARD_H * 0.5 * CINE_MARGIN) / tanV;
    return new OrbitCamera({ azimuth: 0, elevation: CINE_ELEVATION, distance: Math.max(dWidth, dHeight), target: { x: cx, y: 0, z: BOARD_Z } }, CAM_MIN_DIST, CAM_MAX_DIST);
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
    this.wisps = seats.map((s, i) => (s.kind === 'ai' && s.creator ? this.loadSeatWisp(s.creator, i) : null));
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
    this.seats = []; // back to the default idle ring (no stale wisps over empty chairs)
    this.wisps = [];
    this.cancelContinue(); // drop any in-flight cinematic / winner gate, releasing waiters
    this.betPlace = null;
    this.chipCollect = null;
    this.pendingCollect = null;
    this.cam = this.makeIdleCamera(); // back to the idle framing on the shuffling deck
    this.dirty = true;
  }

  // ── Idle preview (the new-match settings panel) ─────────────────────────────────
  // While the setup panel is open (no session yet) the idle table previews the choices
  // live: the chair ring follows the player count and each AI seat's creator wisp
  // floats over its chair. null clears back to the bare idle ring. Ignored while a
  // session is active (beginSession owns the seats then). Opening pulls the camera
  // back from the deck close-up to the whole-table overview (so the ring + wisps
  // read); closing returns to the idle framing. Updates in between leave the camera
  // alone, so the user's own orbiting isn't reset by a dropdown change.
  setPreview(seats: PokerSeatView[] | null): void {
    if (this.active) return;
    const was = this.seats.length > 0;
    this.seats = seats ?? [];
    this.wisps = this.seats.map((s, i) => (s.kind === 'ai' && s.creator ? this.loadSeatWisp(s.creator, i) : null));
    if (!was && seats) this.cam = this.makeCamera();
    else if (was && !seats) this.cam = this.makeIdleCamera();
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
    this.betPlace = null;
    this.chipCollect = null; // fresh hand → pot resets with the new state
    this.pendingCollect = null;
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
        // Busted seats sit the hand out — the engine deals them no cards (holeOf empty),
        // so skip them here too; otherwise the animation flies cards to an empty seat that
        // then vanish once play starts (there are no resting cards to hold them).
        if (this.hand && this.hand.holeOf(s).length === 0) continue;
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
    this.dealing = plan.length > 0;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.dirty = true;
  }

  isActive(): boolean {
    return this.active;
  }

  private loadSeatWisp(creator: string, seat: number): Wisp {
    return loadCreatorWisp(creator, seat * 1.3, this.wispRng);
  }

  // Swap a seat's wisp to a new creator (in-session model change).
  setSeatCreator(seat: number, creator: string): void {
    if (seat < 0 || seat >= this.seats.length) return;
    this.seats[seat] = { ...this.seats[seat], creator };
    this.wisps[seat] = this.loadSeatWisp(creator, seat);
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
      // Snapshot each seat's this-street bet BEFORE the action; if the round closes (all
      // committed rolled into the pot → sum drops to 0), slide those bets into the pot.
      const betsBefore = this.seats.map((_, i) => this.hand!.committedOf(i));
      const sumBefore = betsBefore.reduce((a, b) => a + b, 0);
      const stackBefore = seat >= 0 ? this.hand!.stackOf(seat) : 0;
      this.hand!.applyAction(action);
      const sumAfter = this.seats.reduce((a, _, i) => a + this.hand!.committedOf(i), 0);
      // Chips the actor just pushed out (its stack shrank by exactly this) fly from its stack
      // to its bet spot — the first staged beat. On a street-closing action the committed
      // amounts have already rolled to 0, so defer the front→pot sweep (pendingCollect) until
      // this placement lands; the sweep's per-seat amounts include the closing chips.
      const pushed = seat >= 0 ? Math.max(0, stackBefore - this.hand!.stackOf(seat)) : 0;
      if (pushed > 0) this.betPlace = { seat, pushed, t: 0 };
      if (sumBefore > 0 && sumAfter === 0) {
        const collectBets = betsBefore.slice();
        if (seat >= 0) collectBets[seat] += pushed;
        if (this.betPlace) this.pendingCollect = collectBets;
        else this.chipCollect = { bets: collectBets, t: 0 };
      }
      // A new betting round clears every seat's shown action; then record this actor's.
      if (this.hand!.street() !== streetBefore) this.lastAction.fill(null);
      if (seat >= 0) this.lastAction[seat] = actionLabel(action);
      // Narrate the action into the chat thread (grey), before any street/result line it
      // triggers — so the log reads "Claude raises to 120" then "Flop …".
      if (seat >= 0 && this.events) this.events(actionNarration(this.seatName(seat), action, this.seats[seat]?.kind === 'human'));
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
      // A street-turning action (flop/turn/river, or a multi-street all-in runout) runs the
      // bird's-eye deal cinematic, which resolves the settle when it cuts back. Any other
      // action just lingers a short beat. Either way this gates runMatch (it awaits us).
      // linger long enough for an ordinary bet's chips to finish flying to the front.
      if (newCards > 0) this.startCine();
      else this.beat = pushed > 0 ? Math.max(ACTION_SETTLE, BET_PLACE_T + 0.12) : ACTION_SETTLE;
      this.dirty = true;
      this.settleResolve = resolve;
    });
  }

  // ── Community-deal cinematic ─────────────────────────────────────────────────────
  // Arm the bird's-eye deal: remember the user's current pose to restore, then let the
  // phase clock (advanceCine) drive pre → cut → deal → wait (for a click) → cut-back.
  // Re-arming while already running (a rare back-to-back street turn) keeps the saved pose.
  private startCine(): void {
    if (!this.cine) this.cine = { phase: 'pre', clock: 0, saved: this.cam };
    else {
      this.cine.phase = 'pre';
      this.cine.clock = 0;
    }
    this.beat = 0;
  }

  // Drive the cinematic clock. Called at the top of renderScene so a phase change that
  // hard-cuts the camera takes effect on the same frame the eye is read.
  private advanceCine(dt: number): void {
    const c = this.cine;
    if (!c) return;
    c.clock += dt;
    if (c.phase === 'pre') {
      // Hold the user's view until the closing bet has flown to the front AND swept into the
      // pot — only then (plus a short beat) cut to the bird's-eye. No cutting mid-motion.
      const chipsMoving = this.betPlace !== null || this.pendingCollect !== null || this.chipCollect !== null;
      if (c.clock >= CINE_PRE && !chipsMoving) {
        c.phase = 'deal';
        c.clock = 0;
        this.cam = this.makeBirdsEyeCamera(); // boom — cut to the bird's-eye
        this.dirty = true;
      }
      return;
    }
    if (c.phase === 'deal') {
      // The board deals in advanceDeals; once every turned card has landed, sit on the
      // bird's-eye and wait for the user's click (continueGesture) — no auto-timeout.
      const target = this.hand ? this.hand.boardCards().length : this.boardShown;
      if (this.boardShown >= target && this.boardT < 0) {
        c.phase = 'wait';
        c.clock = 0;
        this.dirty = true;
      }
    }
    // 'wait' → nothing ticks; continueGesture cuts back and releases the settle.
  }

  // Whether a community-deal cinematic has cut to the bird's-eye right now (deal/wait —
  // not the pre beat, which still shows the user's view). Drives the HUD hide + camera
  // freeze so only the top-right pills remain while the board deals.
  cineHidesHud(): boolean {
    return this.cine !== null && this.cine.phase !== 'pre';
  }

  // The top-centre banner for the community-deal cinematic: always labelled "Board", listing
  // EVERY community card on the felt so far (synced to the 3D deal — a cell appears as each
  // card lands). So the flop grows the row 0→3; the turn shows the flop pre-populated and the
  // fourth card appears as it lands; the river likewise adds the fifth. null when not in the
  // bird's-eye. The HUD renders these as mini-cards, mirroring the board strip.
  cineLabel(): { label: string; cards: Card[] } | null {
    if (!this.cine || this.cine.phase === 'pre' || !this.hand) return null;
    return { label: 'board', cards: this.hand.boardCards().slice(0, this.boardShown) };
  }

  // ── "Click anywhere to continue" gate (shared by both banners) ───────────────────
  // End-of-hand winner banner: show `text` at top-centre over the final table and block
  // until the user clicks/keys (continueGesture) or the gate is cancelled (pause/stop).
  beginResult(text: string): Promise<void> {
    this.resultText = text;
    this.dirty = true;
    return new Promise<void>((resolve) => {
      this.resultResolve = resolve;
    });
  }
  resultLabel(): string | null {
    return this.resultText;
  }

  // Whether a "click anywhere to continue" prompt is up right now (the bird's-eye deal has
  // finished dealing, or the end-of-hand winner banner is showing). Main shows the prompt
  // and routes the next click/keypress to continueGesture while this is true.
  awaitingContinue(): boolean {
    return (this.cine !== null && this.cine.phase === 'wait') || this.resultText !== null;
  }

  // Count down the auto-advance timer while a continue gate is up (paused matches don't
  // tick), firing continueGesture when it lapses. The clock re-arms each time a gate opens
  // (it resets to −1 the moment no gate is showing).
  private tickAutoContinue(dt: number): void {
    if (!this.awaitingContinue() || this.paused) {
      this.continueClock = -1;
      return;
    }
    if (this.continueClock < 0) this.continueClock = CONTINUE_AUTO_S;
    this.continueClock -= dt;
    if (this.continueClock <= 0) {
      this.continueClock = -1;
      this.continueGesture();
    }
  }

  // Whole seconds left before the current continue gate auto-advances, or null when no
  // gate is up. The HUD shows this in the prompt ("continuing in 3…").
  continueCountdown(): number | null {
    if (!this.awaitingContinue() || this.continueClock < 0) return null;
    return Math.max(1, Math.ceil(this.continueClock));
  }

  // The user clicked/pressed a key past a continue prompt: advance whichever gate is up —
  // the community-deal cinematic cuts its camera back and releases the move settle; the
  // winner banner clears and releases the driver's between-hands waiter.
  continueGesture(): void {
    if (this.cine !== null && this.cine.phase === 'wait') {
      this.cam = this.cine.saved;
      this.cine = null;
      this.dirty = true;
      const done = this.settleResolve;
      this.settleResolve = null;
      done?.();
      return;
    }
    if (this.resultText !== null) {
      this.resultText = null;
      this.dirty = true;
      const done = this.resultResolve;
      this.resultResolve = null;
      done?.();
    }
  }

  // Drop any pending continue gate (pause / stop), releasing its waiter so the driver
  // never hangs and restoring the camera if a cinematic was up.
  cancelContinue(): void {
    if (this.cine !== null) {
      this.cam = this.cine.saved;
      this.cine = null;
      const done = this.settleResolve;
      this.settleResolve = null;
      done?.();
    }
    if (this.resultResolve !== null) {
      this.resultText = null;
      const done = this.resultResolve;
      this.resultResolve = null;
      done();
    }
    this.dirty = true;
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
  // Card visibility: SPECTATE (no human at the table) reveals every hand; otherwise the
  // hero sees only their OWN cards, and only each one they've actually peeked (hover-to-
  // peek on the felt) — an unpeeked hero card reads as a face-down placeholder, same as
  // an opponent's — plus anyone forced open at a real showdown. `boardShown` tracks the
  // flop/turn/river landing on the felt so the board strip reveals in step with the table
  // animation. null when no session is running.
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
      const hole = hand ? hand.holeOf(i) : [];
      // Which of this seat's two hole cards the viewer sees. Spectate + showdown open a
      // whole hand at once; other seats stay hidden. The hero's OWN cards lie face-down
      // like a home game — each one only appears in the strip once the hero has peeked it
      // (hover-to-peek on the felt), so the readout mirrors what they've actually looked
      // at (HandPeek.seen latches a deliberate peek, not a cursor graze).
      const openAll = !!hand && (spectator || shown.has(i));
      const cards: (Card | null)[] = !hand
        ? [null, null]
        : openAll
          ? [hole[0] ?? null, hole[1] ?? null]
          : isSelf
            ? [0, 1].map((k) => (this.heroPeek.seen(k) ? hole[k] ?? null : null))
            : [null, null];
      // A made-hand name needs both hole cards visible to the viewer, so it reads only
      // once this seat is fully open (both peeked, or a real showdown).
      const fullyOpen = cards[0] !== null && cards[1] !== null;
      const folded = hand ? hand.isFolded(i) : false;
      // Position badge: BB / SB take priority (so heads-up, where the button IS the SB,
      // reads as SB + BB); the button only shows as BTN when it's neither blind (3+ handed).
      const pos: SeatCardView['pos'] = i === bb ? 'BB' : i === sb ? 'SB' : i === button ? 'BTN' : '';
      return {
        seat: i,
        name: s.label,
        creator: s.creator,
        kind: s.kind,
        cards,
        folded,
        allIn: hand ? hand.isAllIn(i) : false,
        stack: hand ? hand.stackOf(i) : 0,
        lastAction: this.lastAction[i] ?? null,
        toAct: i === toAct,
        pos,
        madeHand: fullyOpen && !folded && hand ? hand.handName(i) : '',
        award: awards.get(i) ?? 0,
        // Sitting out: the engine dealt this seat no cards (busted). holeOf empty ⟺ out.
        eliminated: !!hand && hand.holeOf(i).length === 0,
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
  // Camera control is frozen only while the cinematic is actively cutting/dealing (pre +
  // deal) — the animated bird's-eye is not the user's to move then. Once it's dealt and
  // waiting for a keypress ('wait'), the mouse is live again so the user can look around
  // the board; pressing a key (continueGesture) restores their pre-cinematic pose.
  private cameraLocked(): boolean {
    return this.cine !== null && this.cine.phase !== 'wait';
  }
  resetView(): void {
    if (this.cameraLocked()) return;
    this.cam.reset();
    this.dirty = true;
  }
  orbit(dx: number, dy: number): void {
    if (this.cameraLocked()) return;
    this.cam.orbit(dx, dy);
    this.cam.elevation = Math.max(0.16, this.cam.elevation); // don't drop under the table
    this.dirty = true;
  }
  pan(dx: number, dy: number): void {
    if (this.cameraLocked()) return;
    this.cam.pan(dx, dy);
    this.dirty = true;
  }
  zoomBy(f: number): void {
    if (this.cameraLocked()) return;
    this.cam.zoomBy(f); // zoom straight in on whatever we're looking at (centre by default)
    this.dirty = true;
  }

  needsRender(): boolean {
    return this.dirty || (this.active && !this.paused) || this.beat > 0 || this.dealHold > 0 || this.dealing || this.boardT >= 0 || this.cine !== null || this.betPlace !== null || this.chipCollect !== null || this.pendingCollect !== null || this.resultText !== null || this.heroPeek.animating() || this.interludeActive() || this.isIdle();
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
    this.lastAspect = target.height > 0 ? target.width / target.height : this.lastAspect; // for the bird's-eye fit
    this.advanceCine(dt); // may hard-cut this.cam before we read the eye below
    this.tickAutoContinue(dt); // may fire continueGesture (restoring the camera) before the eye read
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
      // Idle state: a ring of chairs around a centre deck shuffling on a loop. With
      // the setup preview up, the ring follows the chosen player count instead.
      this.idleDeck.step(dt);
      this.drawChairRing(target, vp, chair, this.seats.length || IDLE_SEATS);
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
      // Chips (stacks + bets + pot) render in every hand state, including the interlude.
      // Two staged beats: placement (stack→front) finishes, then any pending sweep (front→pot)
      // begins — they never overlap.
      if (this.betPlace) {
        this.betPlace.t += dt / BET_PLACE_T;
        if (this.betPlace.t >= 1) {
          this.betPlace = null;
          if (this.pendingCollect) {
            this.chipCollect = { bets: this.pendingCollect, t: 0 };
            this.pendingCollect = null;
          }
        }
      }
      if (this.chipCollect) {
        this.chipCollect.t += dt / CHIP_COLLECT_T;
        if (this.chipCollect.t >= 1) this.chipCollect = null;
      }
      this.drawChips(target, vp, hand);
    }

    // Wisps above each AI seat, pulsing the seat to act (idle when paused/over).
    // Drawn whenever seats carry wisps — a live session or the setup preview.
    if (this.wisps.length > 0) this.drawWisps(target, vp, t, dt);

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
    // Community: deal any board cards the state has turned but we haven't shown yet — but
    // hold them until the cinematic has cut to the bird's-eye (its `pre` beat plays on the
    // pre-deal view). Once cutting (deal phase) or when no cinematic is running, deal.
    const target = hand.boardCards().length;
    const boardGated = this.cine !== null && this.cine.phase === 'pre';
    if (!boardGated && this.boardT < 0 && this.boardShown < target) this.boardT = 0;
    if (this.boardT >= 0) {
      this.boardT += dt / COMMUNITY_STEP;
      if (this.boardT >= 1) {
        this.boardShown++;
        this.dealtFromDeck++;
        this.boardT = this.boardShown < target ? 0 : -1; // chain the next card, or stop
      }
    }
  }

  // The felt spot of seat s's carried stack, sized for the pile `cols` it will draw. Beside
  // the seat's cards — pushed along the tangent far enough to clear them (bigger piles push
  // further) — with the radius then pulled in as needed so the pile's whole footprint stays
  // inside the felt (never overhanging the raised rail). Also the origin of the seat's bet
  // flights, so the chips fly from where the stack is actually drawn.
  private stackCenter(s: number, cols: ChipColumn[]): { x: number; z: number } {
    const ext = chipPileHalfExtent(cols);
    const off = Math.max(CHIP_SIDE, CARD_TAN_EDGE + CHIP_CARD_GAP + ext.perp); // clear the cards tangentially
    const tang = off + ext.perp; // the pile's farthest reach along the tangent
    const rMax = Math.sqrt(Math.max(0, FELT_USABLE_R * FELT_USABLE_R - tang * tang)) - ext.axis;
    const r = Math.max(0, Math.min(HOLE_R, rMax)); // pull the radius in so the outer edge stays on felt
    const c = this.seatPos(s, r);
    const a = this.seatAngle(s);
    return { x: c.x + Math.cos(a) * off, z: c.z - Math.sin(a) * off };
  }

  // ── Chips: per-seat carried stacks + this-street bets + the pot pile ────────────
  private drawChips(target: RenderTarget, vp: Mat4, hand: HoldemState): void {
    const light = TABLE_LIGHT;
    const ambient = TABLE_AMBIENT;
    // A seat's tangent (columns spread sideways) and outward radial, matching the seat ring.
    const tangentOf = (s: number): { x: number; z: number } => {
      const a = this.seatAngle(s);
      return { x: Math.cos(a), z: -Math.sin(a) };
    };
    const radialOf = (s: number): { x: number; z: number } => {
      const a = this.seatAngle(s);
      return { x: Math.sin(a), z: Math.cos(a) };
    };
    // Each seat's carried stack, beside its cards. Columns pile into a rough square that
    // spreads radially → a slim varied cluster, never a fat tower. Busted seats draw nothing.
    for (let s = 0; s < this.seats.length; s++) {
      const stack = hand.stackOf(s);
      if (stack <= 0) continue;
      const cols = playerColumns(stack);
      drawChipStack(target, vp, this.stackCenter(s, cols), radialOf(s), cols, light, ambient, s);
    }
    // This-street bets in front of each seat, across the two staged beats. `pending`/`collect`
    // carry the captured per-seat amounts once the round has closed (committedOf is 0 by then).
    const collect = this.chipCollect;
    const place = this.betPlace;
    const pending = this.pendingCollect;
    if (collect) {
      // Sweep: the front bets slide from their bet spot into the pot.
      const p = smooth(collect.t);
      for (let s = 0; s < this.seats.length; s++) {
        if (collect.bets[s] <= 0) continue;
        const from = this.seatPos(s, CHIP_BET_R);
        const at = { x: from.x + (CHIP_POT_POS.x - from.x) * p, z: from.z + (CHIP_POT_POS.z - from.z) * p };
        drawChipStack(target, vp, at, tangentOf(s), potColumns(collect.bets[s]), light, ambient, s + 100);
      }
    } else {
      // Resting bets in front (the actor's just-pushed chips are in flight, drawn separately).
      for (let s = 0; s < this.seats.length; s++) {
        const source = pending ? pending[s] : hand.committedOf(s);
        const resting = source - (place && place.seat === s ? place.pushed : 0);
        if (resting > 0) drawChipStack(target, vp, this.seatPos(s, CHIP_BET_R), tangentOf(s), potColumns(resting), light, ambient, s + 100);
      }
      // Placement: the pushed chips fly from the actor's stack to its bet spot.
      if (place && place.pushed > 0) {
        const q = smooth(place.t);
        const from = this.stackCenter(place.seat, playerColumns(hand.stackOf(place.seat)));
        const to = this.seatPos(place.seat, CHIP_BET_R);
        const at = { x: from.x + (to.x - from.x) * q, z: from.z + (to.z - from.z) * q };
        drawChipStack(target, vp, at, tangentOf(place.seat), potColumns(place.pushed), light, ambient, place.seat + 200);
      }
    }
    // The pot pile: everything in the pot minus whatever is still in front (resting / in flight
    // / mid-sweep). The captured amounts win while a round is closing (committedOf is 0 then).
    const frontTotal = collect
      ? collect.bets.reduce((a, b) => a + b, 0)
      : pending
        ? pending.reduce((a, b) => a + b, 0)
        : this.seats.reduce((a, _, i) => a + hand.committedOf(i), 0);
    const pot = hand.potTotal() - frontTotal;
    if (pot > 0) drawChipStack(target, vp, CHIP_POT_POS, { x: 1, z: 0 }, potColumns(pot), light, ambient, 900);
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
    const hole = this.hand.holeOf(seat);
    const a = this.seatAngle(seat);
    const c = this.seatPos(seat, HOLE_R);
    const tx = Math.cos(a);
    const tz = -Math.sin(a);
    for (let k = 0; k < hole.length; k++) {
      const off = k === 0 ? -HOLE_GAP : HOLE_GAP;
      const idx = this.muck.length;
      this.muck.push({
        card: hole[k],
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
    const push = (card: Card, fromX: number, fromZ: number, fromYaw: number, faceUp: boolean): void => {
      g.push({ card, fromX, fromZ, fromYaw, faceUp, delay: g.length * GATHER_STAGGER });
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
      const hole = hand.holeOf(s);
      for (let k = 0; k < hole.length; k++) {
        const off = k === 0 ? -HOLE_GAP : HOLE_GAP;
        push(hole[k], c.x + tx * off, c.z + tz * off, a, faceUp);
      }
    }
    // The community board (face-up), then the muck (face-down).
    const board = hand.boardCards();
    for (let i = 0; i < this.boardShown && i < board.length; i++) push(board[i], this.boardSlotX(i), BOARD_Z, 0, true);
    for (const m of this.muck) push(m.card, m.toX, m.toZ, m.yaw, false);
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
        drawCard(target, vp, M, gc.card, this.back);
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
