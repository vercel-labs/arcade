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
  coverMaterial,
  lambertMaterial,
  type Mat4,
  mat4Multiply,
  mat4RotX,
  mat4RotY,
  mat4Scale,
  mat4Translate,
  type Mesh,
  normalize3,
  quad,
  rasterize,
  type RenderTarget,
  type Texture,
  type Vec3,
} from '../../../engine/index.ts';
import { OrbitCamera, type OrbitState } from '../../orbit.ts';
import { mulberry32 } from '../../scenes/wisp.ts';
import { type Card, fullDeck, shuffle, type Suit } from '../../../rules/poker/cards.ts';
import { cardBackTexture, cardFaceTexture } from './card-textures.ts';

export type CardsMode = 'single' | 'hand' | 'deck';

const FOVY = (46 * Math.PI) / 180;
const CARD_MESH = quad(0.5);
const CARD_W = 1.0;
const CARD_H = 1.4;
const CARD_SCALE = mat4Scale(CARD_W, CARD_H, 1);
const CARD_EPS = 0.007; // half-thickness: face at +eps, back at −eps (no z-fight)
const LIGHT = normalize3({ x: 0.12, y: 0.5, z: 1 });
const WHITE: Vec3 = { x: 250, y: 249, z: 245 };
const BACK_FIELD: Vec3 = { x: 156, y: 22, z: 30 };
const FELT: Vec3 = { x: 20, y: 68, z: 46 };

// A large flat felt quad for the table (hand/deck). quad() is white-vertexed, so a
// recolored copy gives lambert a green to shade.
function feltMesh(): Mesh {
  const m = quad(0.5);
  for (const v of m.vertices) v.color = { ...FELT };
  return m;
}
const TABLE_MESH = feltMesh();
const TABLE_MODEL = mat4Multiply(mat4Translate(0, -0.002, 0), mat4Multiply(mat4RotX(-Math.PI / 2), mat4Scale(26, 26, 1)));

const smooth = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

// Per-mode camera homes + how low the camera may drop (elevation floor). single is
// free (see under the card); hand/deck are pinned above the table.
const HOMES: Record<CardsMode, { home: OrbitState; elevMin: number; min: number; max: number }> = {
  single: { home: { azimuth: 0, elevation: 0.16, distance: 2.15, target: { x: 0, y: 0, z: 0 } }, elevMin: -1.4, min: 1.2, max: 8 },
  hand: { home: { azimuth: 0, elevation: 0.72, distance: 3.4, target: { x: 0, y: 0, z: 0.3 } }, elevMin: 0.12, min: 1.8, max: 9 },
  deck: { home: { azimuth: 0, elevation: 0.9, distance: 6.2, target: { x: 0, y: 0, z: 0 } }, elevMin: 0.12, min: 2.5, max: 16 },
};

// One card the player holds in HAND mode: its resting seat + how far it's revealed
// (0 flat & face-down, PEEK tipped up, 1 lifted face-on) and whether it's committed
// up (clicked) so hover-out doesn't drop it.
const PEEK = 0.6;
interface HandCard {
  card: Card;
  seatX: number;
  reveal: number; // animated 0..1
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
      { card: d[0], seatX: -0.62, reveal: 0, up: false },
      { card: d[1], seatX: 0.62, reveal: 0, up: false },
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
    const R = 1.5 + n * 0.16; // seat ring radius grows with the table
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
    for (const c of this.hand) if (Math.abs(c.reveal - this.revealTarget(c)) > 0.001) return true;
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

  // Draw a double-sided card at model matrix M (already scaled to the card quad).
  private drawCard(target: RenderTarget, vp: Mat4, M: Mat4, card: Card, bright = 1): void {
    const faceModel = mat4Multiply(M, mat4Translate(0, 0, CARD_EPS));
    rasterize(target, CARD_MESH, coverMaterial, {
      mvp: mat4Multiply(vp, faceModel),
      model: faceModel,
      tex: cardFaceTexture(card),
      paper: WHITE,
      lightDir: LIGHT,
      ambient: 0.62,
      brightness: bright,
      // Thin margin (the face is white anyway) so the corner index can tuck right
      // into the corner without the pad/bezel clipping it.
      frameWidth: 0.012,
      frameColor: WHITE,
      pad: 0.012,
      fade: 0,
      fadeY0: 0,
      fadeY1: 0,
    });
    const backModel = mat4Multiply(M, mat4Multiply(mat4Translate(0, 0, -CARD_EPS), mat4RotY(Math.PI)));
    rasterize(target, CARD_MESH, coverMaterial, {
      mvp: mat4Multiply(vp, backModel),
      model: backModel,
      tex: this.back,
      paper: BACK_FIELD,
      lightDir: LIGHT,
      ambient: 0.62,
      brightness: bright,
      frameWidth: 0.03,
      frameColor: WHITE,
      pad: 0.02,
      fade: 0,
      fadeY0: 0,
      fadeY1: 0,
    });
  }

  private drawTable(target: RenderTarget, vp: Mat4): void {
    rasterize(target, TABLE_MESH, lambertMaterial, {
      mvp: mat4Multiply(vp, TABLE_MODEL),
      model: TABLE_MODEL,
      lightDir: { x: 0, y: 1, z: 0 },
      ambient: 0.7,
    });
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
    target.clear(7, 12, 10);
    const { vp } = this.viewProj(target);
    this.drawTable(target, vp);
    const az = this.cam.azimuth;
    // Advance each card toward its reveal target and draw it (later cards drawn
    // after earlier so a lifted card sits in front; depth resolves the rest).
    for (const c of this.hand) {
      const targetR = this.revealTarget(c);
      if (c.reveal < targetR) c.reveal = Math.min(targetR, c.reveal + dt * 5);
      else if (c.reveal > targetR) c.reveal = Math.max(targetR, c.reveal - dt * 5);
      this.drawCard(target, vp, this.handModel(c, az), c.card);
    }
  }

  // A hand card's model: laid flat & face-down at reveal 0, tipped up at PEEK,
  // lifted upright and yawed to face the camera at reveal 1.
  private handModel(c: HandCard, az: number): Mat4 {
    const e = smooth(c.reveal);
    const rx = (Math.PI / 2) * (1 - e); // 90° flat (face down) → 0° upright
    // Lift ramps in with a linear term too, so a peeking (tilted) card rises off
    // the felt rather than pivoting its far edge down through it.
    const y = 0.02 + 0.3 * e + 0.42 * e * e;
    const z = 0.3 + 0.5 * e; // pull toward the hero (camera) as it rises → centers in view
    const yaw = az * e; // face the camera when up
    return mat4Multiply(
      mat4Translate(c.seatX, y, z),
      mat4Multiply(mat4RotY(yaw), mat4Multiply(mat4RotX(rx), CARD_SCALE)),
    );
  }

  private renderDeck(target: RenderTarget, dt: number): void {
    target.clear(7, 12, 10);
    const { vp } = this.viewProj(target);
    this.drawTable(target, vp);

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
      this.drawCard(target, vp, mat4Multiply(mat4Translate(dx, y, -0.15 + dz), flatDown()), this.topBack(i));
    }

    // Cards at rest at their seats.
    for (let i = 0; i < this.dealDone; i++) this.drawDealt(target, vp, this.deals[i], 1);

    // The in-flight card arcs from the deck top to its slot.
    if (this.dealing && this.dealDone < this.deals.length) {
      const d = this.deals[this.dealDone];
      const p = smooth(this.dealT);
      const x = 0 + (d.toX - 0) * p;
      const z = -0.15 + (d.toZ - -0.15) * p;
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
        // Flat footprint around the seat (centered at z≈0.3).
        if (Math.abs(hitX - c.seatX) <= CARD_W / 2 + 0.12 && Math.abs(hitZ - 0.3) <= CARD_H / 2 + 0.12) best = i;
      } else {
        // Lifted: proximity to the projected card center.
        const p = mat4MulPoint(mat4Multiply(vp, this.handModel(c, this.cam.azimuth)), { x: 0, y: 0, z: 0 });
        if (p && Math.abs(p.x - ndcX) < 0.35 && Math.abs(p.y - ndcY) < 0.45) best = i;
      }
    }
    return best;
  }
}

// A card lying flat on the table, face DOWN (back up): rotate the upright quad
// +90° about X so its face (+z) points down and its back points up.
function flatDown(): Mat4 {
  return mat4Multiply(mat4RotX(Math.PI / 2), CARD_SCALE);
}

// Project a point through an mvp to NDC (x,y in −1..1), or null if behind.
function mat4MulPoint(m: Mat4, p: Vec3): { x: number; y: number } | null {
  const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
  const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
  const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
  if (w <= 1e-4) return null;
  return { x: x / w, y: y / w };
}
