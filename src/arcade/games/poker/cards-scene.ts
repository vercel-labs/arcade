// The cards screen: a self-contained 3D card visual with three sub-modes, no game
// rules wired yet — a place to dial in the card look before poker exists.
//
//   single — one card floating at the origin; full orbit / zoom / pan, plus a
//            suit + rank picker (driven from the HUD) to preview any card.
//   hand   — two cards laid face-down on a felt table; the camera is table-limited
//            (you can't drop under it). Hover a card to peek (its near edge tips up
//            and the face corner shows); click to lift it fully face-on, Cover-Flow
//            style; click again to lay it back down.
//   deck   — a stacked deck you can shuffle, then deal to N players with a smooth
//            per-card flight around the table.
//
// Cards are textured billboards: a `quad` per side (face + red back) drawn with
// `coverMaterial`, offset a hair along the normal so the two faces don't z-fight —
// so a card reads as double-sided as it turns.

import {
  type Camera,
  cameraMatrices,
  lambertMaterial,
  type Mat4,
  mat4Multiply,
  mat4RotY,
  mat4Translate,
  normalize3,
  rasterize,
  type RenderTarget,
  type Texture,
  type Vec3,
} from '../../../engine/index.ts';
import { OrbitCamera, type OrbitState } from '../../orbit.ts';
import { mulberry32 } from '../../scenes/wisp.ts';
import { type Card, fullDeck, shuffle } from '../../../rules/poker/cards.ts';
import { cardBackTexture } from './card-textures.ts';
import { CARD_H, CARD_SCALE, CARD_W, drawCard, drawPeekCard, flatDown, type PeekPose, peekCardCenter } from './card-render.ts';
import { chairMesh, chairModel, TABLE_MODEL, TABLE_RADIUS, tableMesh } from './table.ts';

export type CardsMode = 'single' | 'hand' | 'deck';

const FOVY = (46 * Math.PI) / 180;

// Table/chair lighting (lambert): a soft key from above-front so the felt reads
// green and the brown wood keeps form.
const TABLE_LIGHT = normalize3({ x: 0.25, y: 0.9, z: 0.4 });
const TABLE_AMBIENT = 0.74; // high floor so the wood/felt stay bright (esp. in ASCII mode)

// HAND mode: the hero's two hole cards rest here (on the felt, in front of the
// hero seat at +z). DECK mode: the stock sits just back of center, and cards are
// dealt out to a ring of seats.
const HAND_SEAT_Z = 2.6;
const DECK_POS = { x: 0, z: -0.4 };

const smooth = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

// Per-mode camera homes + how low the camera may drop (elevation floor). single is
// free (see under the card); hand/deck are pinned above the table. hand looks over
// the hero's shoulder toward the felt; deck frames the whole table + chairs.
const HOMES: Record<CardsMode, { home: OrbitState; elevMin: number; min: number; max: number }> = {
  single: { home: { azimuth: 0, elevation: 0.16, distance: 2.15, target: { x: 0, y: 0, z: 0 } }, elevMin: -1.4, min: 1.2, max: 8 },
  hand: { home: { azimuth: 0, elevation: 0.56, distance: 7, target: { x: 0, y: 0, z: 1.2 } }, elevMin: 0.14, min: 3, max: 14 },
  deck: { home: { azimuth: 0, elevation: 0.86, distance: 13, target: { x: 0, y: 0, z: 0 } }, elevMin: 0.14, min: 4, max: 28 },
};

// One card the player holds in HAND mode: its resting seat + how far it's revealed
// (0 flat & face-down, PEEK tipped up, 1 lifted face-on) and whether it's committed
// up (clicked) so hover-out doesn't drop it.
const PEEK = 0.6;
interface HandCard {
  card: Card;
  seatX: number;
  reveal: number; // animated 0..1 (driven by a spring, so it can briefly overshoot)
  vel: number; // reveal velocity, for the spring settle
  up: boolean; // clicked fully up
}

// A card mid-deal: source (deck) → destination seat slot, animated by `t`.
interface DealCard {
  card: Card;
  toX: number;
  toZ: number;
  yaw: number; // seat facing
}

export class CardsScene {
  private cam: OrbitCamera;
  private curMode: CardsMode = 'single';
  private dirty = true;
  private lastT = 0;
  private back: Texture;

  // single
  private single: Card = { rank: 0, suit: 0 };

  // hand
  private hand: HandCard[] = [];
  private hovered = -1;

  // deck
  private deck: Card[] = [];
  private numPlayers = 4;
  private deals: DealCard[] = [];
  private dealDone = 0; // dealt cards at rest
  private dealT = 0; // 0..1 progress of the in-flight card
  private dealing = false;
  private shuffleT = 0;
  private shuffling = false;
  private rng = mulberry32(0x9b7d13);

  constructor() {
    this.back = cardBackTexture();
    this.deck = fullDeck();
    this.resetHand();
    const h = HOMES.single;
    this.cam = new OrbitCamera(h.home, h.min, h.max);
  }

  private resetHand(): void {
    const d = shuffle(fullDeck(), this.rng);
    this.hand = [
      { card: d[0], seatX: -0.62, reveal: 0, vel: 0, up: false },
      { card: d[1], seatX: 0.62, reveal: 0, vel: 0, up: false },
    ];
    this.hovered = -1;
  }

  mode(): CardsMode {
    return this.curMode;
  }

  setMode(m: CardsMode): void {
    this.curMode = m;
    const h = HOMES[m];
    // Re-home the camera for the new mode (fresh OrbitCamera so min/max distance
    // and the home pose match the mode).
    this.cam = new OrbitCamera(h.home, h.min, h.max);
    if (m === 'hand') this.resetHand();
    if (m === 'deck') this.resetDeck();
    this.dirty = true;
  }

  // ── single ──
  setCard(card: Card): void {
    this.single = card;
    this.dirty = true;
  }
  card(): Card {
    return this.single;
  }

  // ── deck ──
  players(): number {
    return this.numPlayers;
  }
  setPlayers(n: number): void {
    this.numPlayers = Math.max(2, Math.min(8, n | 0));
    this.resetDeck();
    this.dirty = true;
  }
  private resetDeck(): void {
    this.deals = [];
    this.dealDone = 0;
    this.dealT = 0;
    this.dealing = false;
    this.shuffling = false;
    this.deck = fullDeck();
  }
  shuffle(): void {
    if (this.dealing) return;
    shuffle(this.deck, this.rng);
    this.resetDeckDealState();
    this.shuffling = true;
    this.shuffleT = 0;
    this.dirty = true;
  }
  private resetDeckDealState(): void {
    this.deals = [];
    this.dealDone = 0;
    this.dealT = 0;
    this.dealing = false;
  }
  // Build the deal plan (2 hole cards per player, round-robin) and start it.
  deal(): void {
    if (this.dealing || this.shuffling) return;
    this.resetDeckDealState();
    const n = this.numPlayers;
    const R = TABLE_RADIUS * 0.6; // cards land on the felt in front of each seat (inside the rail)
    const plan: DealCard[] = [];
    let top = 0;
    for (let round = 0; round < 2; round++) {
      for (let s = 0; s < n; s++) {
        const a = (s / n) * Math.PI * 2; // seat 0 at +z (front / hero)
        const cx = Math.sin(a) * R;
        const cz = Math.cos(a) * R;
        // Two slots per seat, offset along the seat's tangent.
        const off = (round === 0 ? -0.38 : 0.38) * CARD_W;
        plan.push({ card: this.deck[top++] ?? this.deck[0], toX: cx + Math.cos(a) * off, toZ: cz - Math.sin(a) * off, yaw: a });
      }
    }
    this.deals = plan;
    this.dealing = true;
    this.dealT = 0;
    this.dealDone = 0;
    this.dirty = true;
  }

  // ── hand interaction ──
  hover(ndcX: number, ndcY: number, aspect: number): void {
    if (this.curMode !== 'hand') return;
    const h = this.pickHand(ndcX, ndcY, aspect);
    if (h !== this.hovered) {
      this.hovered = h;
      this.dirty = true;
    }
  }
  click(ndcX: number, ndcY: number, aspect: number): void {
    if (this.curMode !== 'hand') return;
    const h = this.pickHand(ndcX, ndcY, aspect);
    if (h < 0) return;
    this.hand[h].up = !this.hand[h].up;
    this.dirty = true;
  }
  // Flip a hand card up/down by index — the keyboard (and headless) equivalent of
  // clicking it.
  flipCard(i: number): void {
    const c = this.hand[i];
    if (!c) return;
    c.up = !c.up;
    this.dirty = true;
  }
  // Set the hovered hand card by index (−1 = none); the peek animation follows.
  setHovered(i: number): void {
    if (i === this.hovered) return;
    this.hovered = i;
    this.dirty = true;
  }

  // ── camera ──
  resetView(): void {
    this.cam.reset();
    this.dirty = true;
  }
  orbit(dx: number, dy: number): void {
    this.cam.orbit(dx, dy);
    this.cam.elevation = Math.max(HOMES[this.curMode].elevMin, this.cam.elevation);
    this.dirty = true;
  }
  pan(dx: number, dy: number): void {
    this.cam.pan(dx, dy);
    this.dirty = true;
  }
  zoomBy(f: number): void {
    this.cam.zoomBy(f);
    this.dirty = true;
  }

  isAnimating(): boolean {
    if (this.shuffling || this.dealing) return true;
    for (const c of this.hand) if (Math.abs(c.reveal - this.revealTarget(c)) > 0.001 || Math.abs(c.vel) > 0.001) return true;
    return false;
  }
  needsRender(): boolean {
    return this.dirty || this.isAnimating();
  }

  private revealTarget(c: HandCard): number {
    if (c.up) return 1;
    return this.hand[this.hovered] === c ? PEEK : 0;
  }

  // Camera + projection for the current frame.
  private viewProj(target: RenderTarget): { vp: Mat4; eye: Vec3 } {
    const eye = this.cam.eye();
    const camera: Camera = { eye, target: this.cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 200 };
    return { vp: cameraMatrices(camera, target.width / target.height).viewProjection, eye };
  }

  // Draw a double-sided card at model matrix M (already scaled to the card quad),
  // via the shared card renderer (passing this scene's back texture).
  private drawCard(target: RenderTarget, vp: Mat4, M: Mat4, card: Card, bright = 1): void {
    drawCard(target, vp, M, card, this.back, bright);
  }

  // The poker table (felt green, wood brown), felt at y=0. `seats` chairs are
  // placed around the rail facing center — 1 (hero) for hand mode, N for deck.
  private drawTable(target: RenderTarget, vp: Mat4, seats: number[]): void {
    rasterize(target, tableMesh(), lambertMaterial, {
      mvp: mat4Multiply(vp, TABLE_MODEL),
      model: TABLE_MODEL,
      lightDir: TABLE_LIGHT,
      ambient: TABLE_AMBIENT,
    });
    const chair = chairMesh();
    for (const a of seats) {
      const model = chairModel(a);
      rasterize(target, chair, lambertMaterial, { mvp: mat4Multiply(vp, model), model, lightDir: TABLE_LIGHT, ambient: TABLE_AMBIENT });
    }
  }

  renderScene(target: RenderTarget, t = 0): void {
    const dt = Math.min(0.05, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (this.curMode === 'single') this.renderSingle(target);
    else if (this.curMode === 'hand') this.renderHand(target, dt);
    else this.renderDeck(target, dt);
    this.dirty = false;
  }

  private renderSingle(target: RenderTarget): void {
    target.clear(12, 13, 17);
    const { vp } = this.viewProj(target);
    this.drawCard(target, vp, CARD_SCALE, this.single);
  }

  private renderHand(target: RenderTarget, dt: number): void {
    target.clear(6, 10, 8);
    const { vp } = this.viewProj(target);
    this.drawTable(target, vp, [0]); // one chair: the hero seat at +z (front)
    const az = this.cam.azimuth;
    // Advance each card toward its reveal target on a spring and draw it bent (later
    // cards drawn after earlier so a lifted card sits in front; depth resolves the
    // rest). The spring gives the peek a little flex — it springs up and settles with
    // a small overshoot rather than sliding in linearly.
    for (const c of this.hand) {
      this.stepReveal(c, this.revealTarget(c), dt);
      drawPeekCard(target, vp, this.peekPose(c, az), c.card, this.back);
    }
  }

  // A lightly-damped spring on `reveal`: stiffness pulls toward the target, damping
  // bleeds velocity. Semi-implicit Euler (velocity first) stays stable at the frame's
  // dt; the card can never curl below the felt, so reveal is clamped at 0.
  private stepReveal(c: HandCard, target: number, dt: number): void {
    const K = 190; // stiffness → ~0.4s settle
    const D = 19; // damping (ζ≈0.7: a subtle single bounce, no ringing)
    c.vel += (K * (target - c.reveal) - D * c.vel) * dt;
    c.reveal += c.vel * dt;
    if (c.reveal < 0) {
      c.reveal = 0;
      if (c.vel < 0) c.vel = 0;
    }
  }

  private peekPose(c: HandCard, az: number): PeekPose {
    return { seatX: c.seatX, seatZ: HAND_SEAT_Z, reveal: c.reveal, peek: PEEK, az };
  }

  private renderDeck(target: RenderTarget, dt: number): void {
    target.clear(6, 10, 8);
    const { vp } = this.viewProj(target);
    // One chair per player, evenly around the rail (seat 0 at +z, the front).
    const seats: number[] = [];
    for (let s = 0; s < this.numPlayers; s++) seats.push((s / this.numPlayers) * Math.PI * 2);
    this.drawTable(target, vp, seats);

    if (this.shuffling) {
      this.shuffleT += dt / 0.9;
      if (this.shuffleT >= 1) this.shuffling = false;
    }
    if (this.dealing) {
      this.dealT += dt / 0.22;
      if (this.dealT >= 1) {
        this.dealT = 0;
        this.dealDone++;
        if (this.dealDone >= this.deals.length) this.dealing = false;
      }
    }

    const dealtCount = this.dealDone + (this.dealing ? 1 : 0);
    const remaining = this.deck.length - dealtCount;
    const deckTopY = Math.max(0, remaining) * 0.006;

    // The stacked deck (backs up), minus cards already dealt/in-flight.
    for (let i = 0; i < remaining; i++) {
      const y = i * 0.006 + 0.003;
      let dx = 0;
      let dz = 0;
      if (this.shuffling) {
        // A quick riffle: split into two halves that bow apart and merge back.
        const side = i % 2 === 0 ? -1 : 1;
        const s = Math.sin(this.shuffleT * Math.PI); // 0→1→0
        dx = side * 0.5 * s;
        dz = -0.25 * s * Math.sin((i / remaining) * Math.PI);
      }
      this.drawCard(target, vp, mat4Multiply(mat4Translate(DECK_POS.x + dx, y, DECK_POS.z + dz), flatDown()), this.topBack(i));
    }

    // Cards at rest at their seats.
    for (let i = 0; i < this.dealDone; i++) this.drawDealt(target, vp, this.deals[i], 1);

    // The in-flight card arcs from the deck top to its slot.
    if (this.dealing && this.dealDone < this.deals.length) {
      const d = this.deals[this.dealDone];
      const p = smooth(this.dealT);
      const x = DECK_POS.x + (d.toX - DECK_POS.x) * p;
      const z = DECK_POS.z + (d.toZ - DECK_POS.z) * p;
      const y = deckTopY + Math.sin(p * Math.PI) * 0.9 + 0.02; // parabolic hop
      const yaw = d.yaw * p;
      this.drawCard(target, vp, mat4Multiply(mat4Translate(x, y, z), mat4Multiply(mat4RotY(yaw), flatDown())), d.card);
    }
  }

  // A stand-in back-facing card for the deck stack (order doesn't matter visually).
  private topBack(i: number): Card {
    return this.deck[i] ?? { rank: 0, suit: 0 };
  }

  private drawDealt(target: RenderTarget, vp: Mat4, d: DealCard, bright: number): void {
    const M = mat4Multiply(mat4Translate(d.toX, 0.02, d.toZ), mat4Multiply(mat4RotY(d.yaw), flatDown()));
    this.drawCard(target, vp, M, d.card, bright);
  }

  // Ray-pick a hand card: cast through the table (flat cards) or match the nearest
  // lifted card in screen space (raised cards leave the table plane).
  private pickHand(ndcX: number, ndcY: number, aspect: number): number {
    const eye = this.cam.eye();
    const { forward, right, up } = this.cam.basis();
    const tan = Math.tan(FOVY / 2);
    const dir = normalize3({
      x: forward.x + right.x * ndcX * tan * aspect + up.x * ndcY * tan,
      y: forward.y + right.y * ndcX * tan * aspect + up.y * ndcY * tan,
      z: forward.z + right.z * ndcX * tan * aspect + up.z * ndcY * tan,
    });
    // Table-plane hit (for flat / peeking cards).
    let hitX = Infinity;
    let hitZ = Infinity;
    if (Math.abs(dir.y) > 1e-4) {
      const tHit = -eye.y / dir.y;
      if (tHit > 0) {
        hitX = eye.x + dir.x * tHit;
        hitZ = eye.z + dir.z * tHit;
      }
    }
    // VP built with the pointer's aspect (equals the render aspect) so the raised
    // proximity test lands where the card is drawn.
    const camera: Camera = { eye, target: this.cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 200 };
    const vp = cameraMatrices(camera, aspect).viewProjection;
    let best = -1;
    for (let i = 0; i < this.hand.length; i++) {
      const c = this.hand[i];
      if (c.reveal < 0.5) {
        // Flat footprint around the seat (in front of the hero at HAND_SEAT_Z).
        if (Math.abs(hitX - c.seatX) <= CARD_W / 2 + 0.12 && Math.abs(hitZ - HAND_SEAT_Z) <= CARD_H / 2 + 0.12) best = i;
      } else {
        // Peeking / lifted: proximity to the projected (bent) card center.
        const p = mat4MulPoint(vp, peekCardCenter(this.peekPose(c, this.cam.azimuth)));
        if (p && Math.abs(p.x - ndcX) < 0.35 && Math.abs(p.y - ndcY) < 0.45) best = i;
      }
    }
    return best;
  }
}

// Project a point through an mvp to NDC (x,y in −1..1), or null if behind.
function mat4MulPoint(m: Mat4, p: Vec3): { x: number; y: number } | null {
  const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
  const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
  const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
  if (w <= 1e-4) return null;
  return { x: x / w, y: y / w };
}
