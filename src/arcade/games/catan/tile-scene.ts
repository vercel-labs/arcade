// The Catan tile test bed: two modes, switched from the HUD.
//   • tile  — one 3D hex at the origin, switchable between terrains (dial in the tile look).
//   • board — the full 19-hex board laid out per the rules (correct terrain counts, robber on
//     the desert). "vary" regenerates the arrangement instantly.
// Orbit-controlled (no auto-rotate), like the chess turntable. Tile/piece/port modes render
// on demand; board mode also receives a low-rate dirty pulse for its subtle water current.

import {
  type Camera,
  cameraMatrices,
  lambertMaterial,
  type Mat4,
  mat4Identity,
  mat4Multiply,
  mat4MulVec4,
  mat4RotX,
  mat4RotY,
  mat4RotZ,
  mat4Translate,
  normalize3,
  rasterize,
  type RenderTarget,
  type Vec3,
  waterMaterial,
} from '../../../engine/index.ts';
import { OrbitCamera } from '../../orbit.ts';
import { edgeNodes, HEX_COORDS, hexNodes, NUM_EDGES, NUM_HEXES, NUM_NODES } from '../../../rules/catan/board-topology.ts';
import { type BoardOccupancy, canPlaceRoad, canPlaceSettlement } from '../../../rules/catan/placement.ts';
import { type BoardSetup, generateBoard } from '../../../rules/catan/setup.ts';
import { type PlayerColor, RED_NUMBERS, type Terrain } from '../../../rules/catan/types.ts';
import { mulberry32 } from '../../scenes/wisp.ts';
import { animatedTileMesh, boardOverlayMesh, dieMesh, hoverColorFor, type OverlaySpec, piecesMesh, PORT_SAIL_CENTER, type PortKind, portMesh, tileBackMesh, tileMesh } from './tile-mesh.ts';
import { catanWaterMesh } from './water.ts';

const FOVY = (44 * Math.PI) / 180;
// A warm key from the upper front-right so tops read bright and the raised content casts its
// form; a high ambient floor keeps side faces legible (especially in ASCII mode).
const LIGHT: Vec3 = normalize3({ x: 0.42, y: 0.86, z: 0.5 });
const AMBIENT = 0.52;
// Wrap the diffuse falloff toward half-Lambert so much more of each tile sits in the lit
// gradient instead of pinned at the flat ambient floor (≈24% lit at wrap 0 → ≈45% at 0.85).
const WRAP = 0.85;
// The boat's hull sides flare outward (their normals point out-and-down), so the tiles' near
// top-down key barely grazes them and they read too dark — especially in ASCII — while the
// up-facing deck stays bright. Port mode uses a lower, more raking key from the camera-front
// quarter so the visible hull walls catch angular light, plus a wider wrap so the shadow side
// lifts a touch. This is angle-dependent, not a flat lightening of the hull color.
const PORT_LIGHT: Vec3 = normalize3({ x: 0.62, y: 0.4, z: 0.52 });
const PORT_WRAP = 0.95;
const MODEL: Mat4 = mat4Identity();
const SQRT3 = Math.sqrt(3);
const WATER_MESH = catanWaterMesh();
// Catan's sea frame is a clear cyan-blue rather than near-black ocean. Keep enough depth for
// the island to pop, but lift the palette into multiple ASCII luminance buckets so the ripple
// shape remains visible when a camera rotation moves the narrow sun reflection off-screen.
const WATER_DEEP: Vec3 = { x: 6, y: 40, z: 66 };
const WATER_SURFACE: Vec3 = { x: 20, y: 119, z: 157 };
const WATER_SKY: Vec3 = { x: 94, y: 152, z: 174 };
const WATER_HORIZON: Vec3 = { x: 205, y: 185, z: 146 };
const WATER_CURRENT: Vec3 = { x: 183, y: 229, z: 225 };
const WATER_FLOW_SPEED = 0.22;

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

// Build-drop: a newly built/upgraded piece appears elevated over its spot and drops onto the
// rim with a small settle (rather than popping in instantly).
const BUILD_DROP_DUR = 0.45; // seconds for the drop
const BUILD_DROP_H = 1.2; // elevation above the rim the piece starts from (world units)

// Triggered by the HUD "roll" button: BIG dice appear over the board, tumble, land, the
// matching chips light, then the dice vanish. Drawn on top of everything (depth cleared first)
// and large, so the pips are unmistakable even in ASCII.
type DicePhase = 'idle' | 'rolling' | 'hold';
const DICE_ROLL_DUR = 1.8; // fall + tumble, spread out for a natural roll
const DICE_HOLD = 1.7; // linger on the landed result (while the chips light) before vanishing
const DICE_STAGGER = 0.12; // the second die drops a beat after the first
// Vertical profile: an accelerating free-fall from well above the window, then a few decaying
// on-screen bounces before rest. The entry height and the bounce height are decoupled so the
// dice can enter from above the terminal without the bounces flinging back off-screen.
const DICE_FALL_H = 6.5; // entry height along the camera-up axis (starts above the window)
const DICE_BOUNCE_H = 1.3; // peak of the first post-contact bounce (world units)
const DICE_FALL_FRAC = 0.42; // fraction of the roll spent in the entry fall before bouncing
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
// As a die settles, tip its top (the result) toward the camera so that face reads bigger and
// more legibly than the one pointing into the screen. Eases in with the spin settle.
const DICE_LAND_TILT = 0.34; // radians (~19°)
// NDC box the dice render into — right-aligned with (and directly above) the roll button in
// the bottom-right. Tall enough for the more front-on framing without squashing the pair.
const DICE_BOX = { sx: 0.26, sy: 0.34, tx: 0.72, ty: -0.52 };
// Standard bounce-out (0→1 with settling bounces) — drives the build-drop's landing bounce.
function bounceOut(x: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}
const TAU = Math.PI * 2;
// Post-contact bounce profile: three decaying parabolic arcs (each 0→peak→0), so a die that
// has hit the surface hops a few times with shrinking height before coming to rest.
function bounceArcs(b: number): number {
  const arc = (x: number): number => 4 * x * (1 - x); // a 0→1→0 hump
  if (b < 0.5) return arc(b / 0.5);
  if (b < 0.8) return 0.32 * arc((b - 0.5) / 0.3);
  return 0.1 * arc((b - 0.8) / 0.2);
}
// A die's height above its resting spot at roll progress `pd`: an accelerating free-fall from
// DICE_FALL_H for the first DICE_FALL_FRAC of the roll (so it visibly drops in from above the
// window), then the decaying bounces.
function diceHeight(pd: number): number {
  if (pd >= 1) return 0;
  if (pd < DICE_FALL_FRAC) {
    const f = pd / DICE_FALL_FRAC;
    return DICE_FALL_H * (1 - f * f);
  }
  return DICE_BOUNCE_H * bounceArcs((pd - DICE_FALL_FRAC) / (1 - DICE_FALL_FRAC));
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
  spinX: number; // gross tumble turns about its X axis
  spinZ: number; // gross tumble turns about its Z axis
  yaw: number; // resting yaw about vertical (variety; the result stays on top regardless)
  yawSpin: number; // gross yaw turns during the tumble
  jx: number; // lateral landing offset (entropy in the spacing)
  jz: number; // depth landing offset
  wob: number; // amplitude of the settle-rock as it comes to rest
  dur: number; // per-die duration scale (desyncs the two dice)
}
const freshDie = (): Die => ({ val: 1, spinX: 0, spinZ: 0, yaw: 0, yawSpin: 0, jx: 0, jz: 0, wob: 0, dur: 1 });

export type CatanMode = 'tile' | 'board' | 'pieces' | 'port';

// A number token to draw over a hex: its screen cell, the rolled number, whether it's a red
// high-frequency number (6/8), and whether it's currently lit (matches the last dice roll).
export interface BoardToken {
  col: number;
  row: number;
  num: number;
  red: boolean;
  hot: boolean;
}

// A 2D chip overlaid on a port's sail (projected to a screen cell, like the hex number
// tokens): the trade ratio as text, with a resource emoji naming what it trades. The chip
// itself is drawn black by the HUD (like the number tokens) — the resource is carried by the
// emoji, not a fill color. Emoji render in the terminal but are blank in snapshot PNGs (the
// snapshot's 8×8 ASCII bitmap font has no emoji glyphs).
export interface SailLabel {
  col: number;
  row: number;
  ratio: string; // '2:1' or '3:1'
  icon: string; // the traded resource's emoji, or '?' for the generic any-resource port
}
// Each port's ratio + resource emoji. The generic port trades anything, so it gets a question mark
// instead of a resource.
const PORT_SAIL_INFO: Record<PortKind, { ratio: string; icon: string }> = {
  generic: { ratio: '3:1', icon: '?' },
  brick: { ratio: '2:1', icon: '🧱' },
  grain: { ratio: '2:1', icon: '🌾' },
  lumber: { ratio: '2:1', icon: '🌲' },
  ore: { ratio: '2:1', icon: '🪨' },
  wool: { ratio: '2:1', icon: '🐑' },
};

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

// World (x,z) of every settlement/road node (a shared hex corner) and edge, derived once from
// the topology + flat-top layout. Corner k of a hex sits at angle −60°·k, radius R_OUT (=1).
const NODE_XZ: { x: number; z: number }[] = (() => {
  const out: { x: number; z: number }[] = new Array(NUM_NODES);
  HEX_COORDS.forEach((coord, h) => {
    const w = hexWorld(coord.q, coord.r);
    for (let k = 0; k < 6; k++) {
      const nid = hexNodes[h][k];
      if (out[nid]) continue;
      const a = (-Math.PI / 3) * k;
      out[nid] = { x: w.x + Math.cos(a), z: w.z + Math.sin(a) };
    }
  });
  return out;
})();
const EDGE_ENDS = edgeNodes.map(([a, b]) => ({ x0: NODE_XZ[a].x, z0: NODE_XZ[a].z, x1: NODE_XZ[b].x, z1: NODE_XZ[b].z }));
const EDGE_MID = EDGE_ENDS.map((e) => ({ x: (e.x0 + e.x1) / 2, z: (e.z0 + e.z1) / 2 }));
const PROBE_Y = 0.05; // height at which nodes/edges are projected for hit-testing
// Project a board (x,z) point to NDC with the given view-projection; null if behind the camera.
function projXZ(vp: Mat4, x: number, z: number): { x: number; y: number } | null {
  const c = mat4MulVec4(vp, { x, y: PROBE_Y, z, w: 1 });
  if (c.w <= 0.0001) return null;
  return { x: c.x / c.w, y: c.y / c.w };
}
// model = Translate · RotX (the flip). Normals rotate with it (lambert uses the model's
// rotation), so the tile lights correctly as it tumbles face-up.
function poseMatrix(x: number, y: number, z: number, rotX: number): Mat4 {
  return mat4Multiply(mat4Translate(x, y, z), mat4RotX(rotX));
}

export class TileScene {
  private camTile: OrbitCamera;
  private camBoard: OrbitCamera;
  private camPieces: OrbitCamera;
  private camPort: OrbitCamera;
  private pieceColor: PlayerColor = 'red';
  private portKind: PortKind = 'generic';
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
  private dice: [Die, Die] = [freshDie(), freshDie()];
  private dicePhase: DicePhase = 'idle';
  private rollClock = 0;
  private rollLastT = -1;
  private rolledSum: number | null = null; // the last landed roll (lights matching chips); null until first roll
  // Board editor: placed pieces, the hovered vertex/edge, and the color new pieces get.
  private buildings = new Map<number, { city: boolean; color: PlayerColor }>();
  private roads = new Map<number, PlayerColor>();
  private hoverNode: number | null = null;
  private hoverEdge: number | null = null;
  private placeColor: PlayerColor = 'red';
  // The piece currently playing its build-drop (elevated → seated), or null.
  private dropping: { kind: 'building' | 'road'; id: number } | null = null;
  private dropClock = 0;
  private dropLastT = -1;
  private lastAspect = 1.6; // target aspect from the last render, for hit-test projection
  private dirty = true;

  constructor() {
    this.camTile = new OrbitCamera({ azimuth: 0.62, elevation: 0.62, distance: 2.7, target: { x: 0, y: 0.02, z: 0 } }, 1.6, 6);
    this.camBoard = new OrbitCamera({ azimuth: 0.62, elevation: 0.82, distance: 11.5, target: { x: 0.42, y: -0.58, z: -0.2 } }, 2, 24);
    this.camPieces = new OrbitCamera({ azimuth: 0.5, elevation: 0.4, distance: 3.7, target: { x: 0.1, y: 0.24, z: 0 } }, 1.5, 10);
    this.camPort = new OrbitCamera({ azimuth: 0.72, elevation: 0.36, distance: 3.5, target: { x: 0, y: 0.5, z: 0 } }, 1.5, 12);
  }
  private cam(): OrbitCamera {
    if (this.modeName === 'board') return this.camBoard;
    if (this.modeName === 'pieces') return this.camPieces;
    if (this.modeName === 'port') return this.camPort;
    return this.camTile;
  }
  setPortKind(k: PortKind): void {
    this.portKind = k;
    this.dirty = true;
  }
  // The active player color: the default for pieces mode and for buildings/roads placed (and
  // ghost-previewed) in the board editor. Set from the HUD color dropdown.
  setActiveColor(c: PlayerColor): void {
    this.pieceColor = c;
    this.placeColor = c;
    this.dirty = true;
  }

  // ── board editor: hover / place / edit ──
  // A read-only occupancy view over the editor's placed pieces, for the shared placement rules.
  private occ(): BoardOccupancy<PlayerColor> {
    return {
      building: (n) => {
        const b = this.buildings.get(n);
        return b ? { owner: b.color, city: b.city } : undefined;
      },
      road: (e) => this.roads.get(e),
    };
  }
  private boardVp(): Mat4 {
    const cam = this.camBoard;
    const camera: Camera = { eye: cam.eye(), target: cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 100 };
    return cameraMatrices(camera, this.lastAspect).viewProjection;
  }
  // Nearest node and nearest edge to the cursor (NDC), with their screen distances (x weighted
  // by aspect so it's a true on-screen distance).
  private nearest(ndcX: number, ndcY: number): { node: number; nodeD: number; edge: number; edgeD: number } {
    const vp = this.boardVp();
    const asp = this.lastAspect;
    let node = -1;
    let nodeD = Infinity;
    let edge = -1;
    let edgeD = Infinity;
    for (let n = 0; n < NUM_NODES; n++) {
      const p = projXZ(vp, NODE_XZ[n].x, NODE_XZ[n].z);
      if (!p) continue;
      const d = Math.hypot((p.x - ndcX) * asp, p.y - ndcY);
      if (d < nodeD) {
        nodeD = d;
        node = n;
      }
    }
    for (let e = 0; e < NUM_EDGES; e++) {
      const p = projXZ(vp, EDGE_MID[e].x, EDGE_MID[e].z);
      if (!p) continue;
      const d = Math.hypot((p.x - ndcX) * asp, p.y - ndcY);
      if (d < edgeD) {
        edgeD = d;
        edge = e;
      }
    }
    return { node, nodeD, edge, edgeD };
  }
  // Update the hovered vertex/edge from the cursor (board mode only; ignored mid-animation).
  // Sticky: the current hover is kept until the cursor leaves a wider radius, so the ghost
  // doesn't flicker between neighbours as the mouse moves.
  hoverBoard(ndcX: number, ndcY: number): void {
    if (this.modeName !== 'board' || this.placing || this.revealing) return;
    const vp = this.boardVp();
    const asp = this.lastAspect;
    const dist = (p: { x: number; z: number }): number => {
      const s = projXZ(vp, p.x, p.z);
      return s ? Math.hypot((s.x - ndcX) * asp, s.y - ndcY) : Infinity;
    };
    let node = -1;
    let nodeD = Infinity;
    for (let n = 0; n < NUM_NODES; n++) {
      const d = dist(NODE_XZ[n]);
      if (d < nodeD) {
        nodeD = d;
        node = n;
      }
    }
    let edge = -1;
    let edgeD = Infinity;
    for (let e = 0; e < NUM_EDGES; e++) {
      const d = dist(EDGE_MID[e]);
      if (d < edgeD) {
        edgeD = d;
        edge = e;
      }
    }
    const bestNode = nodeD <= edgeD;
    const bestId = bestNode ? node : edge;
    const bestD = bestNode ? nodeD : edgeD;
    const curD = this.hoverNode !== null ? dist(NODE_XZ[this.hoverNode]) : this.hoverEdge !== null ? dist(EDGE_MID[this.hoverEdge]) : Infinity;
    const ENTER = 0.06;
    const KEEP = 0.11;
    let hn: number | null = null;
    let he: number | null = null;
    if ((this.hoverNode !== null || this.hoverEdge !== null) && curD <= KEEP && curD <= bestD + 0.02) {
      hn = this.hoverNode; // sticky: keep the current hover
      he = this.hoverEdge;
    } else if (bestD <= ENTER) {
      if (bestNode) hn = bestId;
      else he = bestId;
    }
    if (hn !== this.hoverNode || he !== this.hoverEdge) {
      this.hoverNode = hn;
      this.hoverEdge = he;
      this.dirty = true;
    }
  }
  // A click on the board: place a piece on an empty spot (per the rules), or — if the spot is
  // occupied — return a descriptor so the caller can open the edit modal.
  clickBoard(ndcX: number, ndcY: number): { kind: 'building' | 'road'; id: number } | null {
    if (this.modeName !== 'board' || this.placing || this.revealing) return null;
    const { node, nodeD, edge, edgeD } = this.nearest(ndcX, ndcY);
    const TH = 0.07;
    if (nodeD <= edgeD && nodeD < TH) {
      if (this.buildings.has(node)) return { kind: 'building', id: node };
      if (canPlaceSettlement(node, this.occ())) {
        this.buildings.set(node, { city: false, color: this.placeColor }); // distance rule enforced
        this.startDrop('building', node);
      }
      return null;
    }
    if (edgeD < TH) {
      if (this.roads.has(edge)) return { kind: 'road', id: edge };
      if (this.roadPlaceable(edge)) {
        this.roads.set(edge, this.placeColor);
        this.startDrop('road', edge);
      }
      return null;
    }
    return null;
  }
  // Begin the build-drop for a just-placed/upgraded piece: it renders elevated, then eases down.
  private startDrop(kind: 'building' | 'road', id: number): void {
    this.dropping = { kind, id };
    this.dropClock = 0;
    this.dropLastT = -1;
    this.dirty = true;
  }
  // A road is placeable for the active color per the Catan connectivity rules: it must extend a
  // same-color road or settlement/city and can't route through an opponent's building.
  private roadPlaceable(e: number): boolean {
    return canPlaceRoad(e, this.placeColor, this.occ());
  }
  buildingInfo(node: number): { city: boolean; color: PlayerColor } | undefined {
    return this.buildings.get(node);
  }
  roadInfo(edge: number): PlayerColor | undefined {
    return this.roads.get(edge);
  }
  upgradeBuilding(node: number): void {
    const b = this.buildings.get(node);
    if (b && !b.city) {
      b.city = true;
      this.startDrop('building', node); // the city drops in like a fresh build
    }
  }
  removeBuilding(node: number): void {
    if (this.buildings.delete(node)) this.dirty = true;
  }
  removeRoad(edge: number): void {
    if (this.roads.delete(edge)) this.dirty = true;
  }
  setBuildingColor(node: number, c: PlayerColor): void {
    const b = this.buildings.get(node);
    if (b) {
      b.color = c;
      this.placeColor = c;
      this.dirty = true;
    }
  }
  setRoadColor(edge: number, c: PlayerColor): void {
    if (this.roads.has(edge)) {
      this.roads.set(edge, c);
      this.placeColor = c;
      this.dirty = true;
    }
  }
  // Seed a few sample pieces + a hover marker — used by the snapshot tool to preview the editor.
  seedDemo(): void {
    this.buildings.set(0, { city: false, color: 'red' });
    this.buildings.set(20, { city: true, color: 'blue' });
    this.roads.set(0, 'orange');
    this.roads.set(12, 'white');
    this.hoverNode = 30;
    this.dirty = true;
  }

  // Snapshot-only: place a settlement and start its build-drop, so the drop animation can be
  // previewed by stepping frames (see the `build<secs>` snapshot arg).
  demoDrop(): void {
    this.setMode('board');
    if (!this.board) this.regenerate(false);
    this.settle();
    const node = 10;
    this.buildings.set(node, { city: false, color: this.placeColor });
    this.startDrop('building', node);
  }

  setMode(m: CatanMode): void {
    this.modeName = m;
    this.hoverNode = null; // hover is board-only
    this.hoverEdge = null;
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
    this.buildings.clear(); // a fresh board has no pieces
    this.roads.clear();
    this.hoverNode = null;
    this.hoverEdge = null;
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
      // Fractional turn counts (not whole) so the tumble looks free rather than clocked; each
      // die gets its own spin, yaw, landing offset, wobble, and duration for variety. Kept
      // modest so the descent reads as a clean accelerating drop, not a frantic tumble.
      d.spinX = 1.2 + Math.random() * 1.2; // 1.2–2.4 turns
      d.spinZ = 0.8 + Math.random() * 1.0; // 0.8–1.8 turns
      d.yaw = (Math.random() - 0.5) * 1.4; // resting yaw ±0.7 rad
      d.yawSpin = 0.4 + Math.random() * 0.9; // 0.4–1.3 yaw turns
      d.jx = (Math.random() - 0.5) * 0.14; // ±0.07 lateral (varies the gap)
      d.jz = (Math.random() - 0.5) * 0.3; // ±0.15 depth
      d.wob = 0.12 + Math.random() * 0.1; // settle-rock 0.12–0.22 rad
      d.dur = 0.92 + Math.random() * 0.22; // 0.92–1.14× duration
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

  // On-demand: re-render after a camera/scene change, while an animation runs, and once more
  // when the tokens change. The controller marks board mode, plus animated single-tile terrain,
  // dirty at a low fixed rate so subtle environmental motion does not force a 60 fps loop.
  needsRender(): boolean {
    return this.dirty || this.placing || this.revealing || this.tokensDirty || this.dicePhase !== 'idle' || this.dropping !== null;
  }

  requestAnimationFrame(): void {
    if (this.modeName === 'board' || (this.modeName === 'tile' && (this.terrain === 'fields' || this.terrain === 'pasture'))) this.dirty = true;
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

  // The trade-info chip to overlay on the sail (port mode only): the resource icon + ratio,
  // projected to the sail's screen cell with the port camera — the same 2D-overlay approach as
  // the hex number tokens, so it stays legible where painting on the 3D sail wouldn't.
  portSailLabel(cols: number, rows: number): SailLabel | null {
    if (this.modeName !== 'port') return null;
    const cam = this.camPort;
    const camera: Camera = { eye: cam.eye(), target: cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 100 };
    const vp = cameraMatrices(camera, cols / (rows * 2)).viewProjection;
    const c = mat4MulVec4(vp, { x: PORT_SAIL_CENTER.x, y: PORT_SAIL_CENTER.y, z: PORT_SAIL_CENTER.z, w: 1 });
    if (c.w <= 0) return null;
    const info = PORT_SAIL_INFO[this.portKind];
    // Return the sail's midpoint cell (col, row). Centering the chip on it is the HUD's job, since
    // only the HUD knows the chip's width.
    return {
      col: Math.round(((c.x / c.w) * 0.5 + 0.5) * cols),
      row: Math.round((1 - ((c.y / c.w) * 0.5 + 0.5)) * rows),
      ratio: info.ratio,
      icon: info.icon,
    };
  }

  renderScene(target: RenderTarget, t = 0): void {
    this.tokensDirty = false; // consume the previous frame's one-shot
    this.lastAspect = target.width / target.height; // remember for hit-test projection
    target.clear(14, 16, 22);
    const cam = this.cam();
    const eye = cam.eye();
    const camera: Camera = { eye, target: cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 100 };
    const vp = cameraMatrices(camera, target.width / target.height).viewProjection;
    if (this.modeName === 'board') this.renderBoard(target, vp, eye, t);
    else if (this.modeName === 'pieces') rasterize(target, piecesMesh(this.pieceColor), lambertMaterial, { mvp: mat4Multiply(vp, MODEL), model: MODEL, lightDir: LIGHT, ambient: AMBIENT, wrap: WRAP });
    else if (this.modeName === 'port') rasterize(target, portMesh(this.portKind), lambertMaterial, { mvp: mat4Multiply(vp, MODEL), model: MODEL, lightDir: PORT_LIGHT, ambient: AMBIENT, wrap: PORT_WRAP });
    else {
      rasterize(target, tileMesh(this.terrain, this.variant, this.robber), lambertMaterial, { mvp: mat4Multiply(vp, MODEL), model: MODEL, lightDir: LIGHT, ambient: AMBIENT, wrap: WRAP });
      const animated = animatedTileMesh(this.terrain, this.variant, t);
      if (animated) rasterize(target, animated, lambertMaterial, { mvp: mat4Multiply(vp, MODEL), model: MODEL, lightDir: LIGHT, ambient: AMBIENT, wrap: WRAP });
    }
    this.dirty = false;
  }

  // The full 19-hex board. Each hex has a distinct per-tile seed for procedural variation and
  // the robber is baked onto the desert. While `placing`, each tile is posed along its fly-in
  // (stack → arc → drop) and shows its blank back until it flips past edge-on.
  private renderBoard(target: RenderTarget, vp: Mat4, eye: Vec3, t: number): void {
    if (!this.board) this.regenerate(false);
    const board = this.board!;
    rasterize(target, WATER_MESH, waterMaterial, {
      mvp: mat4Multiply(vp, MODEL),
      model: MODEL,
      time: t,
      cameraPos: eye,
      sunDirection: LIGHT,
      deepColor: WATER_DEEP,
      surfaceColor: WATER_SURFACE,
      skyColor: WATER_SKY,
      horizonColor: WATER_HORIZON,
      currentColor: WATER_CURRENT,
      flowSpeed: WATER_FLOW_SPEED,
    });
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
      const terrain = board.hexes[hex].terrain;
      const seed = this.boardSeed * NUM_HEXES + hex;
      const mesh = faceUp ? tileMesh(terrain, seed, hex === board.robberHex) : tileBackMesh();
      rasterize(target, mesh, lambertMaterial, { mvp: mat4Multiply(vp, model), model, lightDir: LIGHT, ambient: AMBIENT, wrap: WRAP });
      if (faceUp) {
        const animated = animatedTileMesh(terrain, seed, t);
        if (animated) rasterize(target, animated, lambertMaterial, { mvp: mat4Multiply(vp, model), model, lightDir: LIGHT, ambient: AMBIENT, wrap: WRAP });
      }
    }
    if (!this.placing) this.renderOverlay(target, vp, t); // placed pieces + hover marker (once tiles are down)
    this.renderDice(target, t);
  }

  // The board editor overlay: all placed pieces plus the hovered vertex/edge highlight.
  private renderOverlay(target: RenderTarget, vp: Mat4, t: number): void {
    // Advance the build-drop: the just-built piece starts elevated and eases onto the rim.
    let dropLift = 0;
    if (this.dropping) {
      if (this.dropLastT < 0) this.dropLastT = t;
      this.dropClock += Math.max(0, t - this.dropLastT);
      this.dropLastT = t;
      const p = Math.min(1, this.dropClock / BUILD_DROP_DUR);
      dropLift = BUILD_DROP_H * (1 - bounceOut(p));
      if (p >= 1) this.dropping = null;
    }
    const dropB = this.dropping?.kind === 'building' ? this.dropping.id : -1;
    const dropR = this.dropping?.kind === 'road' ? this.dropping.id : -1;
    // Ghosts only preview a *legal* placement (distance rule for a settlement, connectivity for
    // a road), so hovering an illegal spot shows nothing.
    const hoverEmptyNode = this.hoverNode !== null && canPlaceSettlement(this.hoverNode, this.occ());
    const hoverEmptyEdge = this.hoverEdge !== null && !this.roads.has(this.hoverEdge) && this.roadPlaceable(this.hoverEdge);
    const spec: OverlaySpec = {
      buildings: [...this.buildings].map(([n, b]) => ({ x: NODE_XZ[n].x, z: NODE_XZ[n].z, city: b.city, color: b.color, hot: n === this.hoverNode, lift: n === dropB ? dropLift : 0 })),
      roads: [...this.roads].map(([e, c]) => ({ x0: EDGE_ENDS[e].x0, z0: EDGE_ENDS[e].z0, x1: EDGE_ENDS[e].x1, z1: EDGE_ENDS[e].z1, color: c, hot: e === this.hoverEdge, lift: e === dropR ? dropLift : 0 })),
      ghostSettlement: hoverEmptyNode ? NODE_XZ[this.hoverNode as number] : null,
      ghostRoad: hoverEmptyEdge ? EDGE_ENDS[this.hoverEdge as number] : null,
      hoverColor: hoverColorFor(this.placeColor),
    };
    if (!spec.buildings.length && !spec.roads.length && !spec.ghostSettlement && !spec.ghostRoad) return;
    rasterize(target, boardOverlayMesh(spec), lambertMaterial, { mvp: mat4Multiply(vp, MODEL), model: MODEL, lightDir: LIGHT, ambient: AMBIENT, wrap: WRAP });
  }

  // Advance the roll sequence, then (unless idle) draw the BIG dice on top of the board. The
  // depth buffer is cleared first so the dice always sit over the scene, never occluded.
  private renderDice(target: RenderTarget, t: number): void {
    if (this.dicePhase !== 'idle') {
      if (this.rollLastT < 0) this.rollLastT = t;
      this.rollClock += Math.max(0, t - this.rollLastT);
      this.rollLastT = t;
      // Both dice have come to rest once the later of the two (its own duration + stagger) lands.
      const allLanded = Math.max(DICE_ROLL_DUR * this.dice[0].dur, DICE_STAGGER + DICE_ROLL_DUR * this.dice[1].dur);
      if (this.dicePhase === 'rolling' && this.rollClock >= allLanded) {
        this.dicePhase = 'hold';
        this.rolledSum = this.dice[0].val + this.dice[1].val;
        this.tokensDirty = true; // light the matching chips on the next composite
      }
      if (this.dicePhase === 'hold' && this.rollClock >= allLanded + DICE_HOLD) {
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
      // Per-die (staggered, duration-scaled) progress. It tumbles fast then slows — keeping the
      // spin alive through the bounces and rocking onto its face at the end — so it never snaps
      // flat onto the result early.
      const pd = rolling ? Math.min(1, Math.max(0, (this.rollClock - i * DICE_STAGGER) / (DICE_ROLL_DUR * d.dur))) : 1;
      const drop = rolling ? diceHeight(pd) : 0;
      const decay = (1 - pd) * (1 - pd); // gross-tumble energy bleeding off (fast → slow)
      const settle = 1 - decay; // 0→1 lock-in; drives the camera-lean tilt
      // Damped rock over the last third: the die rocks onto its face rather than freezing flat.
      const w = Math.min(1, Math.max(0, (pd - 0.68) / 0.32));
      const rock = rolling ? d.wob * Math.sin(w * Math.PI * 3) * (1 - w) : 0;
      const rockZ = rolling ? d.wob * 0.6 * Math.cos(w * Math.PI * 2) * (1 - w) : 0;
      const a = faceAngles(d.val);
      const ax = a.ax + d.spinX * TAU * decay + rock;
      const az = a.az + d.spinZ * TAU * decay + rockZ;
      const yaw = d.yaw + d.yawSpin * TAU * decay;
      const px = DICE_POS[i].x + d.jx;
      const pz = DICE_POS[i].z + d.jz;
      // Outer world-X tilt leans the settled top face toward the viewer; a world-Y yaw (over the
      // value orientation) keeps the result on top while varying which side faces show.
      const tilt = DICE_LAND_TILT * settle;
      const model = mat4Multiply(
        mat4Translate(px, DICE_POS[i].y + upY * drop, pz + upZ * drop),
        mat4Multiply(mat4RotX(tilt), mat4Multiply(mat4RotY(yaw), mat4Multiply(mat4RotZ(az), mat4RotX(ax)))),
      );
      rasterize(target, dieMesh(), lambertMaterial, { mvp: mat4Multiply(vp, model), model, lightDir: LIGHT, ambient: AMBIENT, wrap: WRAP });
    }
  }
}
