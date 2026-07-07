// The playable poker table: a 3D felt table with N seats, dealt hole cards + the
// community board, per-AI-seat provider wisps, and a betting-driven match. The
// analog of ChessGameScene — it implements MatchScene<PokerAction> so the generic
// runMatch loop drives one hand, and exposes a HumanPlayer seam (requestHumanMove)
// for the hero. Session concerns (rotating button, carried stacks, new hands) live
// in the driver (match/poker-driver.ts); this scene renders whatever HoldemState it
// is handed and animates the moves played into it.
//
// Numbers (stacks, pot, bets) are drawn as a projected 2D overlay (drawOverlay) over
// the composited frame — the same approach as the audio scene — rather than baked
// into 3D, so the felt stays clean and the labels stay legible.

import {
  type Camera,
  cameraMatrices,
  lambertMaterial,
  type Mat4,
  mat4Multiply,
  mat4MulVec4,
  mat4RotX,
  mat4RotY,
  mat4Translate,
  normalize3,
  rasterize,
  type RenderTarget,
  STYLE_BOLD,
  STYLE_DIM,
  type Surface,
  type Texture,
  type Vec3,
} from '../../../engine/index.ts';
import { OrbitCamera } from '../../orbit.ts';
import { loadWisp, mulberry32, providerTint, type Wisp, WISP_SIZE } from '../../scenes/wisp.ts';
import type { RGB } from '../../../engine/index.ts';
import type { Card } from '../../../rules/poker/cards.ts';
import type { HoldemState, PokerAction } from '../../../rules/poker/holdem.ts';
import { cardBackTexture } from './card-textures.ts';
import { CARD_SCALE, CARD_W, drawCard, flatDown, flatUp } from './card-render.ts';
import { HandPeek } from './card-peek.ts';
import { chairMesh, chairModel, TABLE_MODEL, TABLE_RADIUS, tableMesh } from './table.ts';

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
const HERO_TARGET: Vec3 = { x: 0, y: 0.35, z: HOLE_R - 0.2 }; // over the hero's own cards ("my hand" view)
const HERO_VIEW_DIST = 6; // how close the "my hand" view sits

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

// A seat's session-level identity (persists across hands): whether it's the human
// hero or an AI, its display label, and (AI) its provider for the wisp.
export interface PokerSeatView {
  kind: 'human' | 'ai';
  label: string;
  provider?: string;
}

// The hero info-panel view (top-right HUD): the two hole cards, each with a `seen` flag
// (peeked/lifted at least once, or forced open at showdown), the community cards, and
// how many of them have landed on the felt so far. null when no hand is in play.
export interface HeroPanelView {
  hand: { card: Card; seen: boolean }[];
  board: readonly Card[];
  boardShown: number;
}

// Text tints for the overlay.
const FG: RGB = [232, 236, 246];
const MUTED: RGB = [150, 156, 174];
const GOLD: RGB = [240, 214, 130];
const WIN: RGB = [150, 226, 150];
const CHIP_BG: RGB = [12, 16, 20];

export class PokerGameScene {
  private cam: OrbitCamera;
  private back: Texture;
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

  // A played action lingers so it's watchable; `beat` is a seconds countdown (ticked by
  // dt in renderScene), long enough to cover a street's community deal when one turns.
  private beat = 0;
  private settleResolve: (() => void) | null = null;
  // The hero's pending move request (the HumanPlayer seam), or null.
  private humanReq: { resolve: (a: PokerAction) => void; reject: (e: Error) => void } | null = null;

  constructor() {
    this.back = cardBackTexture();
    this.cam = this.makeCamera();
  }

  private makeCamera(): OrbitCamera {
    // Over the hero's shoulder (hero seat is at +z, front), tilted down onto the felt.
    // Min distance matches the cards sandbox's hand mode so you can zoom right in to
    // peek at your own hole cards; the look-at leans toward them as you zoom (zoomBy).
    return new OrbitCamera({ azimuth: 0, elevation: 0.7, distance: CAM_HOME_DIST, target: { ...OVERVIEW_TARGET } }, CAM_MIN_DIST, CAM_MAX_DIST);
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
    this.hand = null;
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
      this.hand!.applyAction(action);
      const newCards = this.hand!.boardCards().length - boardBefore;
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

  // The data behind the top-right hand/board panel. A hole card reads as "seen" once the
  // hero has peeked/lifted it (latched by HandPeek), or at showdown; `boardShown` is the
  // count already dealt onto the felt, so the panel reveals the flop/turn/river in step
  // with the table animation. Only a human seat 0 ever reveals its own hole cards here.
  heroPanel(): HeroPanelView | null {
    if (!this.active || !this.hand) return null;
    const isHuman = this.seats[0]?.kind === 'human';
    const shown = new Set(this.hand.showdownSeats());
    const hole = this.hand.holeOf(0);
    const hand = hole.map((card, i) => ({ card, seen: isHuman && (this.heroPeek.seen(i) || shown.has(0)) }));
    return { hand, board: this.hand.boardCards(), boardShown: this.boardShown };
  }

  // ── Camera passthrough ─────────────────────────────────────────────────────────
  // Reset to the whole-table overview, orbiting/zooming about the table centre.
  resetView(): void {
    this.cam.reset();
    this.dirty = true;
  }
  // Jump to a close over-the-shoulder pose on the hero's own cards ("my hand" button).
  focusHero(): void {
    this.cam.azimuth = 0;
    this.cam.elevation = 0.6;
    this.cam.distance = HERO_VIEW_DIST;
    this.cam.target = { ...HERO_TARGET };
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
    return this.dirty || (this.active && !this.paused) || this.beat > 0 || this.dealing || this.boardT >= 0 || this.heroPeek.animating();
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

    // Table + a chair per seat.
    rasterize(target, tableMesh(), lambertMaterial, { mvp: mat4Multiply(vp, TABLE_MODEL), model: TABLE_MODEL, lightDir: TABLE_LIGHT, ambient: TABLE_AMBIENT });
    const chair = chairMesh();
    for (let s = 0; s < this.seats.length; s++) {
      const model = chairModel(this.seatAngle(s));
      rasterize(target, chair, lambertMaterial, { mvp: mat4Multiply(vp, model), model, lightDir: TABLE_LIGHT, ambient: TABLE_AMBIENT });
    }

    const hand = this.hand;
    if (hand) {
      this.advanceDeals(dt, hand);
      if (this.heroPeekable()) this.heroPeek.step(dt); // settle the hero's peek/lift spring
      this.drawDeck(target, vp); // the stock stays on the felt all hand
      this.drawCommunity(target, vp, hand); // board cards that have landed + the one flipping out
      // While the opening deal plays, hole cards fly from the deck to each seat; once
      // they've all landed the hand renders at rest (hero peekable).
      if (this.dealing) this.drawOpeningFlights(target, vp);
      else this.drawHoleCards(target, vp, hand);
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

  // The persistent stock at the centre-back of the felt (shrinks as cards are dealt).
  private drawDeck(target: RenderTarget, vp: Mat4): void {
    const rem = this.deckRemaining();
    for (let i = 0; i < rem; i++) {
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
    const reveal = new Set(hand.showdownSeats());
    // The human hero peeks its own cards (shared HandPeek) during play; at showdown they
    // flip up flat like everyone else's. An AI seat 0 stays hidden until showdown.
    const heroPeek = this.seats[0]?.kind === 'human';
    for (let s = 0; s < this.seats.length; s++) {
      if (hand.isFolded(s)) continue;
      const hole = hand.holeOf(s);
      if (s === 0 && heroPeek && !reveal.has(0)) {
        this.heroPeek.draw(target, vp, this.cam.azimuth, this.back);
        continue;
      }
      const faceUp = reveal.has(s); // every other seat (and the hero at showdown) reveals here
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

  // ── 2D overlay: pot + per-seat stack/bet/status labels (projected) ─────────────
  drawOverlay(surf: Surface, cols: number, rows: number): void {
    const hand = this.hand;
    if (!hand) return;
    const eye = this.cam.eye();
    const camera: Camera = { eye, target: this.cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 200 };
    // A cell is two stacked half-block pixels → aspect halves the row count.
    const { viewProjection: vp } = cameraMatrices(camera, cols / (2 * rows));

    // Pot, centered above the board.
    const potCell = this.project(vp, { x: 0, y: 0.1, z: -1.4 }, cols, rows);
    if (potCell) this.centerLabel(surf, potCell.x, potCell.y, `pot ${hand.potTotal()}`, GOLD, cols);

    const toAct = hand.toActSeat();
    const awardBy = new Map<number, number>();
    if (hand.isTerminal()) for (const a of hand.awards()) awardBy.set(a.seat, (awardBy.get(a.seat) ?? 0) + a.amount);

    for (let s = 0; s < this.seats.length; s++) {
      const seat = this.seats[s];
      // Label sits just behind the seat's cards, toward its chair.
      const p = this.seatPos(s, TABLE_RADIUS + 0.5);
      const cell = this.project(vp, { x: p.x, y: 0.5, z: p.z }, cols, rows);
      if (!cell) continue;
      const name = seat.kind === 'human' ? 'You' : seat.label;
      const status = hand.isFolded(s) ? 'folded' : hand.isAllIn(s) ? 'all-in' : '';
      const bet = hand.committedOf(s);
      const won = awardBy.get(s) ?? 0;
      let line = `${name}  ${hand.stackOf(s)}`;
      if (status) line += `  (${status})`;
      else if (bet > 0) line += `  bet ${bet}`;
      const isTurn = s === toAct && !this.paused;
      const tint = won > 0 ? WIN : hand.isFolded(s) ? MUTED : isTurn ? GOLD : FG;
      this.centerLabel(surf, cell.x, cell.y, `${isTurn ? '▸ ' : ''}${line}${s === hand.button ? '  •BTN' : ''}`, tint, cols);
      if (won > 0) this.centerLabel(surf, cell.x, cell.y + 1, `+${won}`, WIN, cols);
    }
  }

  private centerLabel(surf: Surface, cx: number, cy: number, text: string, fg: RGB, cols: number): void {
    const x = Math.max(0, Math.min(cols - text.length, Math.round(cx - text.length / 2)));
    const y = Math.round(cy);
    surf.drawText(x, y, text, fg, CHIP_BG, fg === MUTED ? STYLE_DIM : STYLE_BOLD);
  }

  private project(vp: Mat4, p: Vec3, cols: number, rows: number): { x: number; y: number } | null {
    const c = mat4MulVec4(vp, { x: p.x, y: p.y, z: p.z, w: 1 });
    if (c.w <= 1e-4) return null;
    return { x: ((c.x / c.w) * 0.5 + 0.5) * cols, y: (1 - ((c.y / c.w) * 0.5 + 0.5)) * rows };
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
