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

// Triggered by the HUD "roll" button: BIG dice appear over the board, tumble, land, the
// matching chips light, then the dice vanish. Drawn on top of everything (depth cleared first)
// and large, so the pips are unmistakable even in ASCII.
type DicePhase = 'idle' | 'rolling' | 'hold';
const DICE_ROLL_DUR = 1.1; // tumble
const DICE_HOLD = 1.2; // linger on the landed result (while the chips light) before vanishing
const DICE_HOP = 0.7; // bounce during the roll
const DICE_EYE: Vec3 = { x: 0, y: 2.7, z: 4.7 };
const DICE_TARGET: Vec3 = { x: 0, y: 0.35, z: 0 };
const DICE_FOVY = (34 * Math.PI) / 180;
const DICE_POS: Vec3[] = [
  { x: -0.95, y: 0.5, z: 0 },
  { x: 0.95, y: 0.5, z: 0 },
];
// NDC box the dice render into — the right side, near the roll button (not centered).
const DICE_BOX = { sx: 0.32, sy: 0.4, tx: 0.62, ty: -0.12 };
const easeOut = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
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
  private tokensDirty = false; // force one composite when the tokens (re)appear after placing
  private dice: [Die, Die] = [{ val: 1, spinsX: 0, spinsZ: 0 }, { val: 1, spinsX: 0, spinsZ: 0 }];
  private dicePhase: DicePhase = 'idle';
  private rollClock = 0;
  private rollLastT = -1;
  private rolledSum: number | null = null; // the last landed roll (lights matching chips); null until first roll
  private dirty = true;

  constructor() {
    this.camTile = new OrbitCamera({ azimuth: 0.62, elevation: 0.62, distance: 2.7, target: { x: 0, y: 0.02, z: 0 } }, 1.6, 6);
    this.camBoard = new OrbitCamera({ azimuth: 0.62, elevation: 0.82, distance: 11.5, target: { x: 0, y: 0.1, z: -0.8 } }, 2, 24);
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
    return this.dirty || this.placing || this.tokensDirty || this.dicePhase !== 'idle';
  }

  // The number tokens to overlay right now: one per non-desert hex, projected to the screen
  // cell of its center with the current board camera (matches what renderScene draws). Empty
  // in tile mode or while tiles are still being placed.
  boardTokens(cols: number, rows: number): BoardToken[] {
    if (this.modeName !== 'board' || this.placing || !this.board) return [];
    const cam = this.camBoard;
    const camera: Camera = { eye: cam.eye(), target: cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 100 };
    const vp = cameraMatrices(camera, cols / (rows * 2)).viewProjection; // aspect matches the render target
    const out: BoardToken[] = [];
    for (let h = 0; h < NUM_HEXES; h++) {
      const cell = this.board.hexes[h];
      if (cell.token === null) continue; // desert: no token
      const { q, r } = HEX_COORDS[h];
      const { x, z } = hexWorld(q, r);
      const c = mat4MulVec4(vp, { x, y: 0.14, z, w: 1 });
      if (c.w <= 0) continue;
      out.push({
        col: Math.round(((c.x / c.w) * 0.5 + 0.5) * cols),
        row: Math.round((1 - ((c.y / c.w) * 0.5 + 0.5)) * rows),
        num: cell.token,
        red: RED_NUMBERS.includes(cell.token),
        hot: this.rolledSum !== null && cell.token === this.rolledSum,
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
        this.tokensDirty = true; // draw one more frame so the tokens appear
      }
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
      if (this.dicePhase === 'rolling' && this.rollClock >= DICE_ROLL_DUR) {
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
    const cam: Camera = { eye: DICE_EYE, target: DICE_TARGET, up: { x: 0, y: 1, z: 0 }, fovy: DICE_FOVY, near: 0.05, far: 100 };
    const aspect = (DICE_BOX.sx / DICE_BOX.sy) * (target.width / target.height); // keep the dice undistorted in the box
    const vp = mat4Multiply(diceViewport(), cameraMatrices(cam, aspect).viewProjection);
    const rolling = this.dicePhase === 'rolling';
    const e = rolling ? easeOut(this.rollClock / DICE_ROLL_DUR) : 1;
    const hop = rolling ? Math.sin(Math.PI * (this.rollClock / DICE_ROLL_DUR)) * DICE_HOP : 0;
    for (let i = 0; i < 2; i++) {
      const d = this.dice[i];
      const a = faceAngles(d.val);
      const ax = (a.ax + d.spinsX * 2 * Math.PI) * e;
      const az = (a.az + d.spinsZ * 2 * Math.PI) * e;
      const p = DICE_POS[i];
      const model = mat4Multiply(mat4Translate(p.x, p.y + hop, p.z), mat4Multiply(mat4RotZ(az), mat4RotX(ax)));
      rasterize(target, dieMesh(), lambertMaterial, { mvp: mat4Multiply(vp, model), model, lightDir: LIGHT, ambient: AMBIENT, wrap: WRAP });
    }
  }
}
