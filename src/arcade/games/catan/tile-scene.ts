// The Catan tile test bed: two modes, switched from the HUD.
//   • tile  — one 3D hex at the origin, switchable between terrains (dial in the tile look).
//   • board — the full 19-hex board laid out per the rules (correct terrain counts, robber on
//     the desert). "vary" regenerates the arrangement instantly.
// Static and orbit-controlled (no auto-rotate), like the chess turntable: renders only when
// the camera moves or the scene changes.

import {
  type Camera,
  cameraMatrices,
  lambertMaterial,
  type Mat4,
  mat4Identity,
  mat4Multiply,
  mat4MulVec4,
  mat4RotX,
  mat4RotZ,
  mat4Translate,
  normalize3,
  rasterize,
  type RenderTarget,
  type Vec3,
} from '../../../engine/index.ts';
import { OrbitCamera } from '../../orbit.ts';
import { HEX_COORDS, NUM_HEXES } from '../../../rules/catan/board-topology.ts';
import { type BoardSetup, generateBoard } from '../../../rules/catan/setup.ts';
import { RED_NUMBERS, type Terrain } from '../../../rules/catan/types.ts';
import { mulberry32 } from '../../scenes/wisp.ts';
import { dieMesh, tileBackMesh, tileMesh } from './tile-mesh.ts';

const FOVY = (44 * Math.PI) / 180;
// A warm key from the upper front-right so tops read bright and the raised content casts its
// form; a high ambient floor keeps side faces legible (especially in ASCII mode).
const LIGHT: Vec3 = normalize3({ x: 0.42, y: 0.86, z: 0.5 });
const AMBIENT = 0.52;
// Wrap the diffuse falloff toward half-Lambert so much more of each tile sits in the lit
// gradient instead of pinned at the flat ambient floor (≈24% lit at wrap 0 → ≈45% at 0.85).
const WRAP = 0.85;
const MODEL: Mat4 = mat4Identity();
const SQRT3 = Math.sqrt(3);

// Board placement animation: hexes start stacked face-down off the board, then fly in one by
// one — arcing over, flipping face-up, and dropping onto their spot (center-out).
const PLACE_STEP = 0.12; // stagger between successive tiles launching (s)
const PLACE_FLY = 0.55; // time one tile spends in flight (s)
const PLACE_HOP = 1.1; // peak arc height
const STACK_POS = { x: -0.5, z: -5.0 }; // the face-down deck, behind the board (off the board area)
const STACK_THICK = 0.11; // vertical spacing of tiles in the deck
const STACK_BASE_Y = 0.1;

// Number-token reveal after the tiles land: every chip spins through random numbers, then
// locks onto its real value ring-by-ring from the centre out (a slot-machine settle).
const REVEAL_FLICKER = 0.07; // seconds each spinning value shows
const REVEAL_BASE = 0.35; // when the centre hex locks
const REVEAL_STEP = 0.2; // extra delay per ring outward
const REVEAL_END = REVEAL_BASE + 2 * REVEAL_STEP + 0.05; // all settled (outer ring is 2)

// Triggered by the HUD "roll" button: BIG dice appear over the board, tumble, land, the
// matching chips light, then the dice vanish. Drawn on top of everything (depth cleared first)
// and large, so the pips are unmistakable even in ASCII.
type DicePhase = 'idle' | 'rolling' | 'hold';
const DICE_ROLL_DUR = 1.5; // fall + spin, spread out for a natural roll
const DICE_HOLD = 1.7; // linger on the landed result (while the chips light) before vanishing
const FALL_H = 5.5; // drop distance (screen-space units) — large enough to start fully above the window
const DICE_STAGGER = 0.1; // the second die drops a beat after the first
// A raised, ~45°-elevation eye: the result (top) face tilts toward the viewer (readable, not a
// flat top-down plane) while the front faces keep the 3D form. The x is computed per-frame in
// renderDice so the right die's edge lands near the box's right edge at any aspect (DIE_RIGHT).
const DICE_EYE: Vec3 = { x: 0, y: 3.0, z: 2.5 };
const DICE_TARGET: Vec3 = { x: 0, y: 1.0, z: 0 }; // aimed above the landing so the drop is visible, landing near the frame bottom
const DIE_RIGHT = 0.65 + 0.5; // the right die's outer x (DICE_POS[1].x + half-size)
const DICE_FOVY = (34 * Math.PI) / 180;
const DICE_POS: Vec3[] = [
  { x: -0.65, y: 0.5, z: 0 },
  { x: 0.65, y: 0.5, z: 0 },
];
// NDC box the dice render into — right-aligned with (and directly above) the roll button in
// the bottom-right. Tall enough for the more front-on framing without squashing the pair.
const DICE_BOX = { sx: 0.26, sy: 0.34, tx: 0.72, ty: -0.52 };
const easeOut = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
// Standard bounce-out (0→1 with settling bounces) — drives the dice's drop + landing bounce.
function bounceOut(x: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}
// (ax, az) that, applied as rotZ(az)·rotX(ax), bring each face value to the top.
function faceAngles(val: number): { ax: number; az: number } {
  switch (val) {
    case 2:
      return { ax: -Math.PI / 2, az: 0 };
    case 3:
      return { ax: 0, az: Math.PI / 2 };
    case 4:
      return { ax: 0, az: -Math.PI / 2 };
    case 5:
      return { ax: Math.PI / 2, az: 0 };
    case 6:
      return { ax: Math.PI, az: 0 };
    default:
      return { ax: 0, az: 0 }; // 1
  }
}
// Clip-space remap that squeezes the dice's full-frame render into the right-side NDC box.
function diceViewport(): Mat4 {
  const s = mat4Identity();
  s[0] = DICE_BOX.sx;
  s[5] = DICE_BOX.sy;
  s[12] = DICE_BOX.tx;
  s[13] = DICE_BOX.ty;
  return s;
}
interface Die {
  val: number;
  spinsX: number;
  spinsZ: number;
}

export type CatanMode = 'tile' | 'board';

// A number token to draw over a hex: its screen cell, the rolled number, whether it's a red
// high-frequency number (6/8), and whether it's currently lit (matches the last dice roll).
export interface BoardToken {
  col: number;
  row: number;
  num: number;
  red: boolean;
  hot: boolean;
}

const smooth = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

// Flat-top axial (q,r) → world (x,z). Size = the tile's outer radius (R_OUT = 1), so
// neighbours meet edge-to-edge. See board-topology.ts for the hex coordinate system.
function hexWorld(q: number, r: number): { x: number; z: number } {
  return { x: 1.5 * q, z: SQRT3 * (q / 2 + r) };
}
// Hex ring index (distance from the center hex) — the primary key for center-out ordering.
function hexRing(q: number, r: number): number {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}
// model = Translate · RotX (the flip). Normals rotate with it (lambert uses the model's
// rotation), so the tile lights correctly as it tumbles face-up.
function poseMatrix(x: number, y: number, z: number, rotX: number): Mat4 {
  return mat4Multiply(mat4Translate(x, y, z), mat4RotX(rotX));
}

export class TileScene {
  private camTile: OrbitCamera;
  private camBoard: OrbitCamera;
  private terrain: Terrain = 'forest';
  private variant = 0; // per-tile seed: same style, different layout
  private robber = false; // show/hide the robber (tile mode)
  private modeName: CatanMode = 'tile';
  private boardSeed = 1; // regenerated board arrangement
  private board: BoardSetup | null = null;
  private order: number[] = []; // hex ids in placement order (center-out)
  private placing = false; // a placement animation is in flight
  private placeClock = 0; // seconds since the animation began
  private lastT = -1; // previous frame time, for dt
  private revealing = false; // the number-token slot-settle is playing
  private revealClock = 0;
  private revealLastT = -1;
  private tokensDirty = false; // force one composite when the tokens (re)appear after placing
  private dice: [Die, Die] = [{ val: 1, spinsX: 0, spinsZ: 0 }, { val: 1, spinsX: 0, spinsZ: 0 }];
  private dicePhase: DicePhase = 'idle';
  private rollClock = 0;
  private rollLastT = -1;
  private rolledSum: number | null = null; // the last landed roll (lights matching chips); null until first roll
  private dirty = true;

  constructor() {
    this.camTile = new OrbitCamera({ azimuth: 0.62, elevation: 0.62, distance: 2.7, target: { x: 0, y: 0.02, z: 0 } }, 1.6, 6);
    this.camBoard = new OrbitCamera({ azimuth: 0.62, elevation: 0.82, distance: 11.5, target: { x: 0.42, y: -0.58, z: -0.2 } }, 2, 24);
  }
  private cam(): OrbitCamera {
    return this.modeName === 'board' ? this.camBoard : this.camTile;
  }

  setMode(m: CatanMode): void {
    this.modeName = m;
    if (m === 'board' && !this.board) this.regenerate(false); // first entry: no animation
    this.dirty = true;
  }
  currentMode(): CatanMode {
    return this.modeName;
  }

  // (Re)build the board arrangement and its center-out placement order. `animate` plays the
  // fly-in; false snaps straight to the finished board.
  private regenerate(animate: boolean): void {
    this.board = generateBoard(mulberry32(this.boardSeed || 1));
    const ids = Array.from({ length: NUM_HEXES }, (_, i) => i);
    ids.sort((a, b) => {
      const A = HEX_COORDS[a];
      const B = HEX_COORDS[b];
      const ra = hexRing(A.q, A.r);
      const rb = hexRing(B.q, B.r);
      if (ra !== rb) return ra - rb;
      const wa = hexWorld(A.q, A.r);
      const wb = hexWorld(B.q, B.r);
      return Math.atan2(wa.z, wa.x) - Math.atan2(wb.z, wb.x);
    });
    this.order = ids;
    this.placing = animate;
    this.placeClock = 0;
    this.lastT = -1;
    this.revealing = false; // reset any in-progress token reveal for the new board
    this.rolledSum = null; // clear a stale dice highlight from the previous board
    this.dirty = true;
  }
  // Snap any in-progress placement to done (used for static snapshots).
  settle(): void {
    this.placing = false;
    this.dirty = true;
  }

  // Roll the pair of dice (board mode): big dice appear, tumble, land, light the matching
  // chips, then vanish. Picks results + tumble spins and starts the sequence.
  rollDice(): void {
    if (this.modeName !== 'board') return;
    for (const d of this.dice) {
      d.val = 1 + Math.floor(Math.random() * 6);
      d.spinsX = 2 + Math.floor(Math.random() * 3);
      d.spinsZ = 1 + Math.floor(Math.random() * 2);
    }
    this.dicePhase = 'rolling';
    this.rollClock = 0;
    this.rollLastT = -1;
    this.rolledSum = null; // clear the previous highlight while the new roll tumbles
    this.dirty = true;
  }

  setTerrain(t: Terrain): void {
    this.terrain = t;
    this.dirty = true;
  }
  currentTerrain(): Terrain {
    return this.terrain;
  }
  // In board mode "vary" regenerates the whole arrangement; in tile mode it advances the
  // current tile to its next procedural variant. Both are instant.
  reroll(): void {
    if (this.modeName === 'board') {
      this.boardSeed++;
      this.regenerate(true); // regenerate WITH the placement animation
    } else {
      this.variant++;
      this.dirty = true;
    }
  }
  setRobber(on: boolean): void {
    this.robber = on;
    this.dirty = true;
  }

  // ── camera ──
  resetView(): void {
    this.cam().reset();
    this.dirty = true;
  }
  orbit(dx: number, dy: number): void {
    const c = this.cam();
    c.orbit(dx, dy);
    c.elevation = Math.max(-0.2, c.elevation); // don't drop under the board
    this.dirty = true;
  }
  pan(dx: number, dy: number): void {
    this.cam().pan(dx, dy);
    this.dirty = true;
  }
  zoomBy(f: number): void {
    this.cam().zoomBy(f);
    this.dirty = true;
  }

  // On-demand: re-render after a camera/scene change, every frame while placing, and once more
  // when the animation ends so the tokens get composited.
  needsRender(): boolean {
    return this.dirty || this.placing || this.revealing || this.tokensDirty || this.dicePhase !== 'idle';
  }

  // The number tokens to overlay right now: one per non-desert hex, projected to the screen
  // cell of its center with the current board camera (matches what renderScene draws). Empty
  // in tile mode or while tiles are still being placed.
  boardTokens(cols: number, rows: number): BoardToken[] {
    if (this.modeName !== 'board' || this.placing || !this.board) return [];
    const cam = this.camBoard;
    const camera: Camera = { eye: cam.eye(), target: cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 100 };
    const vp = cameraMatrices(camera, cols / (rows * 2)).viewProjection; // aspect matches the render target
    const spinStep = Math.floor(this.revealClock / REVEAL_FLICKER);
    const out: BoardToken[] = [];
    for (let h = 0; h < NUM_HEXES; h++) {
      const cell = this.board.hexes[h];
      if (cell.token === null) continue; // desert: no token
      const { q, r } = HEX_COORDS[h];
      const { x, z } = hexWorld(q, r);
      const c = mat4MulVec4(vp, { x, y: 0.14, z, w: 1 });
      if (c.w <= 0) continue;
      // During the reveal each chip spins until its ring's settle time, then shows the real
      // value (centre ring settles first).
      const settled = !this.revealing || this.revealClock >= REVEAL_BASE + hexRing(q, r) * REVEAL_STEP;
      const num = settled ? cell.token : 2 + ((spinStep * 7 + h * 5) % 11);
      out.push({
        col: Math.round(((c.x / c.w) * 0.5 + 0.5) * cols),
        row: Math.round((1 - ((c.y / c.w) * 0.5 + 0.5)) * rows),
        num,
        red: settled && RED_NUMBERS.includes(num),
        hot: settled && this.rolledSum !== null && num === this.rolledSum,
      });
    }
    return out;
  }

  renderScene(target: RenderTarget, t = 0): void {
    this.tokensDirty = false; // consume the previous frame's one-shot
    target.clear(14, 16, 22);
    const cam = this.cam();
    const eye = cam.eye();
    const camera: Camera = { eye, target: cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 100 };
    const vp = cameraMatrices(camera, target.width / target.height).viewProjection;
    if (this.modeName === 'board') this.renderBoard(target, vp, t);
    else rasterize(target, tileMesh(this.terrain, this.variant, this.robber), lambertMaterial, { mvp: mat4Multiply(vp, MODEL), model: MODEL, lightDir: LIGHT, ambient: AMBIENT, wrap: WRAP });
    this.dirty = false;
  }

  // The full 19-hex board. Each hex has a distinct per-tile seed for procedural variation and
  // the robber is baked onto the desert. While `placing`, each tile is posed along its fly-in
  // (stack → arc → drop) and shows its blank back until it flips past edge-on.
  private renderBoard(target: RenderTarget, vp: Mat4, t: number): void {
    if (!this.board) this.regenerate(false);
    const board = this.board!;
    if (this.placing) {
      if (this.lastT < 0) this.lastT = t;
      this.placeClock += Math.max(0, t - this.lastT);
      this.lastT = t;
      if (this.placeClock > (NUM_HEXES - 1) * PLACE_STEP + PLACE_FLY) {
        this.placing = false;
        this.revealing = true; // hand off to the number-token slot-settle
        this.revealClock = 0;
        this.revealLastT = -1;
      }
    }
    if (this.revealing) {
      if (this.revealLastT < 0) this.revealLastT = t;
      this.revealClock += Math.max(0, t - this.revealLastT);
      this.revealLastT = t;
      if (this.revealClock >= REVEAL_END) this.revealing = false;
    }
    for (let oi = 0; oi < NUM_HEXES; oi++) {
      const hex = this.order[oi];
      const { q, r } = HEX_COORDS[hex];
      const dest = hexWorld(q, r);
      const p = this.placing ? Math.max(0, Math.min(1, (this.placeClock - oi * PLACE_STEP) / PLACE_FLY)) : 1;
      const slotY = STACK_BASE_Y + (NUM_HEXES - 1 - oi) * STACK_THICK;
      let model: Mat4;
      let faceUp: boolean;
      if (p <= 0) {
        model = poseMatrix(STACK_POS.x, slotY, STACK_POS.z, Math.PI); // face-down in the deck
        faceUp = false;
      } else if (p >= 1) {
        model = mat4Translate(dest.x, 0, dest.z); // landed
        faceUp = true;
      } else {
        const e = smooth(p);
        const x = STACK_POS.x + (dest.x - STACK_POS.x) * e;
        const z = STACK_POS.z + (dest.z - STACK_POS.z) * e;
        const y = slotY * (1 - e) + Math.sin(Math.PI * p) * PLACE_HOP;
        const flip = Math.PI * (1 - smooth(Math.min(1, p / 0.8))); // face-up by 80% of the flight
        model = poseMatrix(x, y, z, flip);
        faceUp = flip <= Math.PI / 2;
      }
      const mesh = faceUp ? tileMesh(board.hexes[hex].terrain, this.boardSeed * NUM_HEXES + hex, hex === board.robberHex) : tileBackMesh();
      rasterize(target, mesh, lambertMaterial, { mvp: mat4Multiply(vp, model), model, lightDir: LIGHT, ambient: AMBIENT, wrap: WRAP });
    }
    this.renderDice(target, t);
  }

  // Advance the roll sequence, then (unless idle) draw the BIG dice on top of the board. The
  // depth buffer is cleared first so the dice always sit over the scene, never occluded.
  private renderDice(target: RenderTarget, t: number): void {
    if (this.dicePhase !== 'idle') {
      if (this.rollLastT < 0) this.rollLastT = t;
      this.rollClock += Math.max(0, t - this.rollLastT);
      this.rollLastT = t;
      if (this.dicePhase === 'rolling' && this.rollClock >= DICE_ROLL_DUR + DICE_STAGGER) {
        this.dicePhase = 'hold';
        this.rolledSum = this.dice[0].val + this.dice[1].val;
        this.tokensDirty = true; // light the matching chips on the next composite
      }
      if (this.dicePhase === 'hold' && this.rollClock >= DICE_ROLL_DUR + DICE_HOLD) {
        this.dicePhase = 'idle'; // dice vanish; the lit chips remain
      }
    }
    if (this.dicePhase === 'idle') return;

    target.depth.fill(Infinity); // draw the dice over everything already rendered
    const aspect = (DICE_BOX.sx / DICE_BOX.sy) * (target.width / target.height); // keep the dice undistorted in the box
    // Shift the eye left so the right die's outer edge maps to the box's right edge (~flush) —
    // computed from the frame's half-width at the dice plane, so it holds at any aspect.
    const dist = Math.hypot(DICE_EYE.y - DICE_TARGET.y, DICE_EYE.z - DICE_TARGET.z);
    const halfW = dist * Math.tan(DICE_FOVY / 2) * aspect;
    const camX = DIE_RIGHT - halfW * 0.82; // <1 leaves right-edge margin so the tumbling corners never clip
    const cam: Camera = { eye: { x: camX, y: DICE_EYE.y, z: DICE_EYE.z }, target: { x: camX, y: DICE_TARGET.y, z: DICE_TARGET.z }, up: { x: 0, y: 1, z: 0 }, fovy: DICE_FOVY, near: 0.05, far: 100 };
    const vp = mat4Multiply(diceViewport(), cameraMatrices(cam, aspect).viewProjection);
    const rolling = this.dicePhase === 'rolling';
    // The camera's screen-vertical axis in world space (perpendicular to the view direction) —
    // dropping the dice ALONG this keeps their depth, and therefore their SIZE, constant as they
    // fall (rather than growing/shrinking like a straight world-Y drop under a tilted camera).
    const fY = DICE_TARGET.y - DICE_EYE.y;
    const fZ = DICE_TARGET.z - DICE_EYE.z;
    const fMag = Math.hypot(fY, fZ) || 1;
    const upY = -fZ / fMag;
    const upZ = fY / fMag;
    for (let i = 0; i < 2; i++) {
      const d = this.dice[i];
      // Per-die drop: its own (staggered) progress, a bounce-out fall from FALL_H, and a spin
      // that settles onto the result face by the time it lands.
      const pd = rolling ? Math.min(1, Math.max(0, (this.rollClock - i * DICE_STAGGER) / DICE_ROLL_DUR)) : 1;
      const spinE = easeOut(Math.min(1, pd / 0.55));
      const drop = rolling ? FALL_H * (1 - bounceOut(pd)) : 0;
      const a = faceAngles(d.val);
      const ax = (a.ax + d.spinsX * 2 * Math.PI) * spinE;
      const az = (a.az + d.spinsZ * 2 * Math.PI) * spinE;
      const p = DICE_POS[i];
      const model = mat4Multiply(mat4Translate(p.x, p.y + upY * drop, p.z + upZ * drop), mat4Multiply(mat4RotZ(az), mat4RotX(ax)));
      rasterize(target, dieMesh(), lambertMaterial, { mvp: mat4Multiply(vp, model), model, lightDir: LIGHT, ambient: AMBIENT, wrap: WRAP });
    }
  }
}
