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
  feltMaterial,
  lambertMaterial,
  type Mat4,
  mat4Multiply,
  mat4RotY,
  mat4Translate,
  MeshObject,
  normalize3,
  ObjectPool,
  OrbitCamera,
  type RenderTarget,
  Scene,
  SceneRenderer,
  smoothstep,
  type Texture,
  WorldMaterialInstance,
} from '../../../engine/index.ts';
import type { OrbitState } from '../../../engine/index.ts';
import { mulberry32 } from '../../scenes/wisp.ts';
import { type Card, fullDeck, shuffle } from '../../../rules/poker/cards.ts';
import { cardBackTexture } from './card-textures.ts';
import { CARD_SCALE, CARD_W, drawCard, flatDown } from './card-render.ts';
import { HandPeek } from './card-peek.ts';
import { chairMesh, chairModel, FELT_STIPPLE, feltMesh, frameMesh, TABLE_MODEL, TABLE_RADIUS } from './table.ts';

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

// Per-mode camera homes + how low the camera may drop (elevation floor). single is
// free (see under the card); hand/deck are pinned above the table. hand looks over
// the hero's shoulder toward the felt; deck frames the whole table + chairs.
const HOMES: Record<CardsMode, { home: OrbitState; elevMin: number; min: number; max: number }> = {
  single: { home: { azimuth: 0, elevation: 0.16, distance: 2.15, target: { x: 0, y: 0, z: 0 } }, elevMin: -1.4, min: 1.2, max: 8 },
  hand: { home: { azimuth: 0, elevation: 0.56, distance: 7, target: { x: 0, y: 0, z: 1.2 } }, elevMin: 0.14, min: 3, max: 14 },
  deck: { home: { azimuth: 0, elevation: 0.86, distance: 13, target: { x: 0, y: 0, z: 0 } }, elevMin: 0.14, min: 4, max: 28 },
};

// HAND mode's two hole cards (hover to peek, click to lift) live in the shared
// HandPeek — the same interaction the poker game reuses.

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
  private readonly authoredScene = new Scene();
  private readonly sceneRenderer = new SceneRenderer();
  private readonly chairGeometry = chairMesh();
  private readonly frameObject = new MeshObject(
    frameMesh(),
    new WorldMaterialInstance(lambertMaterial, {
      lightDir: TABLE_LIGHT,
      ambient: TABLE_AMBIENT,
    }),
  );
  private readonly feltObject = new MeshObject(
    feltMesh(),
    new WorldMaterialInstance(feltMaterial, {
      lightDir: TABLE_LIGHT,
      ambient: TABLE_AMBIENT,
      ...FELT_STIPPLE,
    }),
  );
  private readonly chairPool = new ObjectPool(() => new MeshObject(
    this.chairGeometry,
    new WorldMaterialInstance(lambertMaterial, {
      lightDir: TABLE_LIGHT,
      ambient: TABLE_AMBIENT,
    }),
  ));

  // single
  private single: Card = { rank: 0, suit: 0 };

  // hand
  private handPeek = new HandPeek(HAND_SEAT_Z);

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
    this.frameObject.setMatrix(TABLE_MODEL);
    this.feltObject.setMatrix(TABLE_MODEL);
    this.authoredScene.add(this.frameObject);
    this.authoredScene.add(this.feltObject);
    this.authoredScene.add(this.chairPool);
  }

  private resetHand(): void {
    const d = shuffle(fullDeck(), this.rng);
    this.handPeek.reset([
      { card: d[0], seatX: -0.62 },
      { card: d[1], seatX: 0.62 },
    ]);
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

  // ── hand interaction (delegated to the shared HandPeek) ──
  hover(ndcX: number, ndcY: number, aspect: number): void {
    if (this.curMode !== 'hand') return;
    if (this.handPeek.hover(this.cam, ndcX, ndcY, aspect)) this.dirty = true;
  }
  click(ndcX: number, ndcY: number, aspect: number): void {
    if (this.curMode !== 'hand') return;
    if (this.handPeek.click(this.cam, ndcX, ndcY, aspect)) this.dirty = true;
  }
  // Flip a hand card up/down by index — the keyboard (and headless) equivalent of
  // clicking it.
  flipCard(i: number): void {
    if (this.handPeek.flipCard(i)) this.dirty = true;
  }
  // Set the hovered hand card by index (−1 = none); the peek animation follows.
  setHovered(i: number): void {
    if (this.handPeek.setHovered(i)) this.dirty = true;
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
    return this.handPeek.animating();
  }
  needsRender(): boolean {
    return this.dirty || this.isAnimating();
  }

  // Camera + projection for the current frame.
  private viewProj(target: RenderTarget): { camera: Camera; vp: Mat4 } {
    const eye = this.cam.eye();
    const camera: Camera = { eye, target: this.cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 200 };
    return { camera, vp: cameraMatrices(camera, target.width / target.height).viewProjection };
  }

  // Draw a double-sided card at model matrix M (already scaled to the card quad),
  // via the shared card renderer (passing this scene's back texture).
  private drawCard(target: RenderTarget, vp: Mat4, M: Mat4, card: Card, bright = 1): void {
    drawCard(target, vp, M, card, this.back, bright);
  }

  // The poker table (felt green, wood brown), felt at y=0. `seats` chairs are
  // placed around the rail facing center — 1 (hero) for hand mode, N for deck.
  private drawTable(target: RenderTarget, camera: Camera, seats: number[]): void {
    this.chairPool.begin();
    for (const a of seats) {
      const model = chairModel(a);
      this.chairPool.acquire().setMatrix(model);
    }
    this.sceneRenderer.render(target, this.authoredScene, camera);
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
    const { camera, vp } = this.viewProj(target);
    this.drawTable(target, camera, [0]); // one chair: the hero seat at +z (front)
    // Advance the peek/lift springs, then draw both cards bent to their reveal.
    this.handPeek.step(dt);
    this.handPeek.draw(target, vp, this.cam.azimuth, this.back);
  }

  private renderDeck(target: RenderTarget, dt: number): void {
    target.clear(6, 10, 8);
    const { camera, vp } = this.viewProj(target);
    // One chair per player, evenly around the rail (seat 0 at +z, the front).
    const seats: number[] = [];
    for (let s = 0; s < this.numPlayers; s++) seats.push((s / this.numPlayers) * Math.PI * 2);
    this.drawTable(target, camera, seats);

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
      const p = smoothstep(this.dealT);
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
}
