// The Catan tile test bed: two modes, switched from the HUD.
//   • tile  — one 3D hex at the origin, switchable between terrains (dial in the tile look).
//   • board — the full 19-hex board laid out per the rules (correct terrain counts, robber on
//     the desert). "vary" regenerates it through the staged island-build animation.
// Orbit-controlled (no auto-rotate), like the chess turntable. Tile/piece/port modes render
// on demand; board mode also receives a low-rate dirty pulse for its subtle water current.

import {
  bounceOut,
  type Camera,
  cameraMatrices,
  FrameClock,
  hysteresisThreshold,
  lambertMaterial,
  type LambertUniforms,
  type Mat4,
  type Mesh,
  mat4Identity,
  mat4Multiply,
  mat4MulVec4,
  mat4RotX,
  mat4RotY,
  mat4RotZ,
  mat4Translate,
  MeshObject,
  mulberry32,
  normalize3,
  ObjectPool,
  OrbitCamera,
  projectPoint,
  projectedPolygonFootprint,
  projectedPointToViewport,
  Raycaster,
  rasterize,
  resolveStickyHover,
  type RenderTarget,
  Scene,
  SceneRenderer,
  smoothstep,
  type Vec3,
  waterMaterial,
  type WaterUniforms,
  WorldMaterialInstance,
} from '../../../engine/index.ts';
import { HEX_COORDS, NUM_HEXES } from '../../../rules/catan/board-topology.ts';
import { type BoardOccupancy, canPlaceRoad, canPlaceSettlement } from '../../../rules/catan/placement.ts';
import { type BoardSetup, generateBoard } from '../../../rules/catan/setup.ts';
import { type PlayerColor, RED_NUMBERS, type Resource, type Terrain, TOKEN_DOTS } from '../../../rules/catan/types.ts';
import { animatedTileMesh, boardOverlayMesh, coastMesh, dieMesh, harborPiersMesh, hoverColorFor, type OverlaySpec, piecesMesh, PORT_SAIL_CENTER, type PortKind, portMesh, robberMarkerMesh, surfMesh, swashMesh, tileBackMesh, tileMesh } from './mesh/index.ts';
import { catanPieceMaterial, type CatanPieceUniforms } from './mesh/piece-material.ts';
import { EDGE_ENDS, hexRing, hexWorld, NODE_XZ } from './scene/board-layout.ts';
import { DICE_BOX, DICE_EYE, DICE_FOVY, DICE_HOLD, DICE_LAND_TILT, DICE_POS, DICE_ROLL_DUR, DICE_STAGGER, DICE_TARGET, type Die, DIE_RIGHT, diceHeight, type DicePhase, diceViewport, faceAngles, freshDie, TAU } from './scene/dice.ts';
import { type BoardHarborPose, boardHarborPoses } from './scene/harbors.ts';
import { type BoardPickTarget, measureBoardTarget, pickBoardTarget } from './scene/placement-picking.ts';
import { rollPayouts, rollYield } from './scene/production.ts';
import { CATAN_WATER_RADIUS_X, CATAN_WATER_RADIUS_Z, catanWaterMesh } from './water.ts';

const FOVY = (44 * Math.PI) / 180;
// A warm key from the upper front-right so tops read bright and the raised content casts its
// form; a high ambient floor keeps side faces legible (especially in ASCII mode).
const LIGHT: Vec3 = normalize3({ x: 0.42, y: 0.86, z: 0.5 });
const AMBIENT = 0.52;
// Wrap the diffuse falloff toward half-Lambert so much more of each tile sits in the lit
// gradient instead of pinned at the flat ambient floor (≈24% lit at wrap 0 → ≈45% at 0.85).
const WRAP = 0.85;
// Player pieces need to remain color-readable even when they occupy only a few terminal
// cells. Use a broader, slightly lower key than the terrain so both the roof and an adjoining
// wall catch useful light, then lift the ambient floor enough that the opposite wall keeps its
// player hue instead of collapsing into a near-black face.
const PIECE_LIGHT: Vec3 = normalize3({ x: 0.5, y: 0.72, z: 0.48 });
const PIECE_AMBIENT = 0.62;
const PIECE_WRAP = 1;
// The boat's hull sides flare outward (their normals point out-and-down), so the tiles' near
// top-down key barely grazes them and they read too dark — especially in ASCII — while the
// up-facing deck stays bright. Port mode uses a lower, more raking key from the camera-front
// quarter so the visible hull walls catch angular light, plus a wider wrap so the shadow side
// lifts a touch. This is angle-dependent, not a flat lightening of the hull color.
const PORT_LIGHT: Vec3 = normalize3({ x: 0.62, y: 0.4, z: 0.52 });
const PORT_WRAP = 0.95;
const MODEL: Mat4 = mat4Identity();
const WATER_MESH = catanWaterMesh();
const COAST_MESH = coastMesh();
// Catan's sea frame is a clear cyan-blue rather than near-black ocean. Keep enough depth for
// the island to pop, but lift the palette into multiple ASCII luminance buckets so the ripple
// shape remains visible when a camera rotation moves the narrow sun reflection off-screen.
const WATER_DEEP: Vec3 = { x: 6, y: 40, z: 66 };
const WATER_SURFACE: Vec3 = { x: 20, y: 119, z: 157 };
const WATER_SKY: Vec3 = { x: 94, y: 152, z: 174 };
const WATER_HORIZON: Vec3 = { x: 205, y: 185, z: 146 };
const WATER_CURRENT: Vec3 = { x: 183, y: 229, z: 225 };
const WATER_FLOW_SPEED = 0.22;
const EMPTY_MESH: Mesh = { vertices: [], indices: [] };

// Board placement animation: hexes start stacked face-down off the board, then fly in one by
// one — arcing over, flipping face-up, and dropping onto their spot (center-out).
const PLACE_STEP = 0.12; // stagger between successive tiles launching (s)
const PLACE_FLY = 0.55; // time one tile spends in flight (s)
const PLACE_HOP = 1.1; // peak arc height
// The deck sits beyond the water hex's left point; even its nearest tile edge remains off the
// sea, so it reads as a separate source stack rather than a tower floating on the water.
// Keep the full-radius tile deck beyond the water's northwest edge, but close enough to the
// settled framing that its source is still visible without moving or zooming the camera.
const STACK_POS = { x: -5, z: 4.15 };
const STACK_THICK = 0.11; // vertical spacing of tiles in the deck
const STACK_BASE_Y = 0.1;
const TILE_PLACE_END = (NUM_HEXES - 1) * PLACE_STEP + PLACE_FLY;
const COAST_GROW_START = TILE_PLACE_END + 0.12;
const COAST_GROW_DUR = 0.72;
const COAST_GROW_END = COAST_GROW_START + COAST_GROW_DUR;
const HARBOR_ENTRY_START = COAST_GROW_END + 0.14;
const HARBOR_ENTRY_STEP = 0.09;
const HARBOR_ENTRY_DUR = 0.82;
const HARBOR_ENTRY_MAX_DISTANCE = 2.4;
const BOARD_BUILD_END = HARBOR_ENTRY_START + 8 * HARBOR_ENTRY_STEP + HARBOR_ENTRY_DUR;

// Number-token reveal after the tiles land: every chip spins through random numbers, then
// locks onto its real value ring-by-ring. Its final pips grow in only after the number settles,
// so changing pip counts never participate in the slot-machine flicker.
const REVEAL_FLICKER = 0.07; // seconds each spinning value shows
const REVEAL_BASE = 0.35; // when the centre hex locks
const REVEAL_STEP = 0.2; // extra delay per ring outward
const REVEAL_PIP_DELAY = 0.1; // brief hold on the final number before its first pip
const REVEAL_PIP_STEP = 0.08; // cadence for each centre-out pip layer
const REVEAL_END = REVEAL_BASE + 2 * REVEAL_STEP + REVEAL_PIP_DELAY + 3 * REVEAL_PIP_STEP; // outer ring plus a final hold

// Grow an odd pip row 1 → 3 → 5, and an even row 1 → 2 → 4. The HUD re-centres each
// intermediate row with its normal left-biased tie rule, so growth radiates from the middle.
function revealedPipCount(total: number, elapsed: number): number {
  if (elapsed <= 0 || total <= 0) return 0;
  const layer = Math.ceil(elapsed / REVEAL_PIP_STEP);
  if (total % 2 === 1) return Math.min(total, layer * 2 - 1);
  return Math.min(total, layer === 1 ? 1 : layer * 2 - 2);
}

// The number badge needs two terminal rows (number + probability pips). Decide detail from the
// projected hex footprint rather than camera distance or height alone: screen-space area accounts
// for terminal size and zoom, while its square root makes an oblique view only moderately less
// readable when the hexes remain wide. Separate thresholds prevent resize/orbit flicker.
const TOKEN_PIP_SHOW_MIN_FOOTPRINT = 9.1;
const TOKEN_PIP_HIDE_MIN_FOOTPRINT = 8.7;

// Build-drop: a newly built/upgraded piece appears elevated over its spot and drops onto the
// rim with a small settle (rather than popping in instantly).
// How long the matching chips stay gold after the dice land. Outlasts DICE_HOLD so the result
// survives the dice's own exit, then clears — a highlight that persisted until the next roll left
// an idle board looking mid-turn.
const DICE_HIGHLIGHT_HOLD = 3;
const BUILD_DROP_DUR = 0.45; // seconds for the drop
const BUILD_DROP_H = 1.2; // elevation above the rim the piece starts from (world units)

export type CatanMode = 'tile' | 'board' | 'boardCards' | 'pieces' | 'port';

function isBoardMode(mode: CatanMode): boolean {
  return mode === 'board' || mode === 'boardCards';
}

// A number token to draw over a hex: its screen cell, rolled number, currently revealed
// production pips, red/high-frequency state, zoom-detail state, and dice-roll highlight.
export interface BoardToken {
  col: number;
  row: number;
  num: number;
  pips: number;
  showPips: boolean;
  red: boolean;
  hot: boolean;
  blocked: boolean;
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

// model = Translate · RotX (the flip). Normals rotate with it (lambert uses the model's
// rotation), so the tile lights correctly as it tumbles face-up.
function poseMatrix(x: number, y: number, z: number, rotX: number): Mat4 {
  return mat4Multiply(mat4Translate(x, y, z), mat4RotX(rotX));
}

function harborEntryProgress(clock: number, index: number): number {
  return Math.max(0, Math.min(1, (clock - HARBOR_ENTRY_START - index * HARBOR_ENTRY_STEP) / HARBOR_ENTRY_DUR));
}

function projectedHexFootprint(vp: Mat4, x: number, z: number, cols: number, rows: number): number {
  const points: Vec3[] = [];
  for (let corner = 0; corner < 6; corner++) {
    const angle = (-Math.PI / 3) * corner;
    points.push({
      x: x + Math.cos(angle),
      y: 0.14,
      z: z + Math.sin(angle),
    });
  }
  // sqrt(area) expresses the polygon footprint as a linear terminal-cell scale, so the cutoff
  // remains intuitive across differently shaped projections of the same hex.
  return projectedPolygonFootprint(vp, points, cols, rows);
}

// Start each boat near the water edge behind its final pose, then sail it along the direction
// its bow actually points. A small vertical bob supplies water motion without introducing the
// sideways drift that made the old coast-normal entrance read like a sliding model.
function isInsideBoardWater(x: number, z: number): boolean {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  const xLimit = CATAN_WATER_RADIUS_X * Math.sqrt(3) / 2;
  const zLimit = CATAN_WATER_RADIUS_Z - (ax * CATAN_WATER_RADIUS_Z) / (Math.sqrt(3) * CATAN_WATER_RADIUS_X);
  return ax <= xLimit && az <= zLimit;
}

function safeHarborEntryDistance(harbor: BoardHarborPose, mesh: Mesh): number {
  let lo = 0;
  let hi = HARBOR_ENTRY_MAX_DISTANCE;
  // Find the furthest bow-first run-up for which the complete model (including its mast and
  // sail footprint) remains over the finite water hex. The water is convex, so every point
  // between this starting pose and the final harbor pose is safe as well.
  for (let pass = 0; pass < 14; pass++) {
    const distance = (lo + hi) * 0.5;
    const fits = mesh.vertices.every((vertex) => {
      const world = mat4MulVec4(harbor.model, { ...vertex.position, w: 1 });
      return isInsideBoardWater(
        world.x - harbor.forward.x * distance,
        world.z - harbor.forward.z * distance,
      );
    });
    if (fits) lo = distance;
    else hi = distance;
  }
  // Leave a little water between the stern and the exact sea boundary.
  return Math.max(0, lo - 0.09);
}

function harborEntryModel(harbor: BoardHarborPose, progress: number, index: number, entryDistance: number): Mat4 {
  const e = smoothstep(progress);
  const remaining = 1 - e;
  const bob = Math.sin(progress * Math.PI * 4 + index * 0.8) * 0.035 * remaining;
  return mat4Multiply(
    mat4Translate(
      -harbor.forward.x * entryDistance * remaining,
      bob,
      -harbor.forward.z * entryDistance * remaining,
    ),
    harbor.model,
  );
}

export class TileScene {
  private camTile: OrbitCamera;
  private camBoard: OrbitCamera;
  private camBoardCards: OrbitCamera;
  private camPieces: OrbitCamera;
  private camPort: OrbitCamera;
  private readonly raycaster = new Raycaster();
  private pieceColor: PlayerColor = 'red';
  private portKind: PortKind = 'generic';
  private terrain: Terrain = 'forest';
  private variant = 0; // per-tile seed: same style, different layout
  private robber = false; // show/hide the robber (tile mode)
  // Board mode: where the robber actually stands. Seeded from the board's desert and then moved
  // by a rolled 7, so production and the tile mesh both read this rather than board.robberHex.
  private robberHex = -1;
  // While moving the robber, the old piece remains baked into `robberHex`; hovering another
  // legal tile draws a brighter preview robber there. The destination is committed only on click.
  private robberGate: Set<number> | null = null;
  private hoverHex: number | null = null;
  private modeName: CatanMode = 'tile';
  private boardSeed = 1; // regenerated board arrangement
  private board: BoardSetup | null = null;
  private harbors: BoardHarborPose[] = [];
  private harborEntryDistances: number[] = [];
  private harborPiers: Mesh | null = null;
  private order: number[] = []; // hex ids in placement order (center-out)
  private placing = false; // a placement animation is in flight
  private readonly placementClock = new FrameClock();
  private revealing = false; // the number-token slot-settle is playing
  private readonly revealClock = new FrameClock();
  private tokensDirty = false; // force one composite when the tokens (re)appear after placing
  private dice: [Die, Die] = [freshDie(), freshDie()];
  private dicePhase: DicePhase = 'idle';
  private readonly rollClock = new FrameClock();
  private rolledSum: number | null = null; // the last landed roll (lights matching chips); null until first roll
  // Fired once per roll, the moment the dice come to rest and the sum is final. The controller
  // uses it to pay out production; the scene itself does not care who is collecting.
  onRollLanded: ((sum: number) => void) | null = null;
  // Board editor: placed pieces, the hovered vertex/edge, and the color new pieces get.
  // Set while a real game owns the board arrangement; null while the editor generates its own.
  private adoptedBoard: BoardSetup | null = null;
  // Set while a caller has narrowed placement to an explicit legal set (see setPlacementGate).
  private gate: { nodes: Set<number>; edges: Set<number> } | null = null;
  private buildings = new Map<number, { city: boolean; color: PlayerColor }>();
  private roads = new Map<number, PlayerColor>();
  private hoverNode: number | null = null;
  private hoverEdge: number | null = null;
  private readonly buildingAtNode = (node: number): { city: boolean } | undefined => this.buildings.get(node);
  private placeColor: PlayerColor = 'red';
  // The piece currently playing its build-drop (elevated → seated), or null.
  private dropping: { kind: 'building' | 'road'; id: number } | null = null;
  private readonly dropClock = new FrameClock();
  private lastAspect = 1.6; // target aspect from the last render, for hit-test projection
  private tokenPipDetailVisible: boolean | null = null;
  private dirty = true;
  private readonly authoredScene = new Scene();
  private readonly sceneRenderer = new SceneRenderer();
  private renderSequence = 0;
  private readonly waterPool = new ObjectPool(() => new MeshObject(
    EMPTY_MESH,
    new WorldMaterialInstance<WaterUniforms>(waterMaterial, {
      time: 0,
      cameraPos: { x: 0, y: 0, z: 0 },
      sunDirection: LIGHT,
      deepColor: WATER_DEEP,
      surfaceColor: WATER_SURFACE,
      skyColor: WATER_SKY,
      horizonColor: WATER_HORIZON,
      currentColor: WATER_CURRENT,
      flowSpeed: WATER_FLOW_SPEED,
    }),
  ));
  private readonly authoredPool = new ObjectPool(() => new MeshObject(
    EMPTY_MESH,
    new WorldMaterialInstance<LambertUniforms>(lambertMaterial, {
      lightDir: LIGHT,
      ambient: AMBIENT,
      wrap: WRAP,
    }),
  ));
  private readonly piecePool = new ObjectPool(() => new MeshObject(
    EMPTY_MESH,
    new WorldMaterialInstance<CatanPieceUniforms>(catanPieceMaterial, {
      lightDir: PIECE_LIGHT,
      ambient: PIECE_AMBIENT,
      wrap: PIECE_WRAP,
    }),
  ));

  constructor() {
    this.camTile = new OrbitCamera({ azimuth: 0.62, elevation: 0.62, distance: 2.7, target: { x: 0, y: 0.02, z: 0 } }, 1.6, 6);
    // The nine harbor boats extend beyond the old land-only framing. Pull back enough to keep
    // their sails and paired jetties inside the default viewport without making the island tiny.
    this.camBoard = new OrbitCamera({ azimuth: 0.62, elevation: 0.82, distance: 13.2, target: { x: 0.25, y: -0.48, z: 0 } }, 2, 26);
    // The card workbench leaves a public rail on the right and a hand along the bottom. Pull the
    // island back and bias it into the remaining upper-left stage instead of covering its ports.
    this.camBoardCards = new OrbitCamera({ azimuth: 0.62, elevation: 0.82, distance: 15.6, target: { x: 0.9, y: -0.9, z: 0 } }, 2, 30);
    this.camPieces = new OrbitCamera({ azimuth: 0.5, elevation: 0.4, distance: 3.7, target: { x: 0.1, y: 0.24, z: 0 } }, 1.5, 10);
    this.camPort = new OrbitCamera({ azimuth: 0.72, elevation: 0.36, distance: 3.5, target: { x: 0, y: 0.5, z: 0 } }, 1.5, 12);
    this.authoredScene.add(this.waterPool);
    this.authoredScene.add(this.authoredPool);
    this.authoredScene.add(this.piecePool);
  }
  private cam(): OrbitCamera {
    if (this.modeName === 'boardCards') return this.camBoardCards;
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

  // ── externally-owned board + legal-target gate ──
  // The board editor generates its own board from `boardSeed`. A real game's board belongs to
  // the rules engine instead, so it hands the arrangement over here and the scene renders that
  // rather than one of its own. Same `BoardSetup` type either way, so nothing downstream cares.
  adoptBoard(setup: BoardSetup, animate: boolean): void {
    this.adoptedBoard = setup;
    this.regenerate(animate);
  }

  // Restrict which vertices/edges may be hovered and clicked. Null (the default, and what the
  // catan-test editor keeps) means "anywhere the placement rules allow", so the editor stays
  // free-form. A gate means the caller — the game — has already decided the legal set from the
  // rules engine, and the scene stops applying geometry rules of its own.
  setPlacementGate(gate: { nodes?: Iterable<number>; edges?: Iterable<number> } | null): void {
    this.gate = gate ? { nodes: new Set(gate.nodes ?? []), edges: new Set(gate.edges ?? []) } : null;
    // A hover left over from the previous gate would keep drawing a ghost on a spot that is no
    // longer offered.
    if (this.gate && !this.gateAllows(this.hoveredTarget())) this.setHoveredTarget(null);
    this.dirty = true;
  }

  // Enter the tile-picking phase used by a rolled seven (and, in the real game, a knight).
  // Callers may provide the rules engine's legal destinations; the test bed defaults to every
  // tile except the robber's current one.
  beginRobberMove(hexes?: Iterable<number>): void {
    const candidates = hexes ?? Array.from({ length: NUM_HEXES }, (_, hex) => hex);
    this.robberGate = new Set(Array.from(candidates).filter((hex) => hex >= 0 && hex < NUM_HEXES && hex !== this.robberHex));
    this.hoverHex = null;
    this.setHoveredTarget(null);
    this.dirty = true;
  }
  cancelRobberMove(): void {
    if (this.robberGate === null && this.hoverHex === null) return;
    this.robberGate = null;
    this.hoverHex = null;
    this.dirty = true;
  }
  isMovingRobber(): boolean {
    return this.robberGate !== null;
  }
  currentRobberHex(): number {
    return this.robberHex;
  }
  terrainAtHex(hex: number): Terrain | null {
    return this.board?.hexes[hex]?.terrain ?? null;
  }
  numberAtHex(hex: number): number | null {
    return this.board?.hexes[hex]?.token ?? null;
  }
  // Direct preview is useful for keyboard focus and deterministic snapshots; pointer hover calls
  // the same gate after resolving its world-space tile.
  previewRobberHex(hex: number | null): void {
    const next = hex !== null && this.robberGate?.has(hex) ? hex : null;
    if (next === this.hoverHex) return;
    this.hoverHex = next;
    this.dirty = true;
  }
  moveRobberTo(hex: number): boolean {
    if (!this.robberGate?.has(hex) || hex === this.robberHex) return false;
    this.robberHex = hex;
    this.robberGate = null;
    this.hoverHex = null;
    this.tokensDirty = true;
    this.dirty = true;
    return true;
  }
  // Synchronize a move that the rules engine already validated (AI or replay path).
  syncRobberHex(hex: number): void {
    if (hex < 0 || hex >= NUM_HEXES || hex === this.robberHex) {
      this.cancelRobberMove();
      return;
    }
    this.robberHex = hex;
    this.robberGate = null;
    this.hoverHex = null;
    this.tokensDirty = true;
    this.dirty = true;
  }
  private gateAllows(target: BoardPickTarget | null): boolean {
    if (!target) return false;
    if (!this.gate) return true;
    return target.kind === 'node' ? this.gate.nodes.has(target.id) : this.gate.edges.has(target.id);
  }
  // Whether a target may receive a piece right now: inside the gate when one is set, otherwise
  // whatever the free-placement rules allow.
  private placeable(target: BoardPickTarget): boolean {
    if (this.gate) return this.gateAllows(target);
    return target.kind === 'node' ? canPlaceSettlement(target.id, this.occ()) : this.roadPlaceable(target.id);
  }

  // Put a piece down without a click — the path an AI seat's move takes. Plays the same drop
  // the editor's own placement does, so a model's move and yours look identical.
  placePiece(kind: 'building' | 'road', id: number, color: PlayerColor, city = false): void {
    if (kind === 'building') this.buildings.set(id, { city, color });
    else this.roads.set(id, color);
    this.startDrop(kind, id);
    this.dirty = true;
  }
  // Drop every placed piece (a new game on the same board).
  clearPieces(): void {
    this.buildings.clear();
    this.roads.clear();
    this.hoverNode = null;
    this.hoverEdge = null;
    this.cancelRobberMove();
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
  private boardRaycaster(ndcX: number, ndcY: number): Raycaster {
    const cam = this.cam();
    const camera = cam.toCamera({ fovy: FOVY, near: 0.05, far: 100 });
    return this.raycaster.setFromCamera(camera, ndcX, ndcY, this.lastAspect);
  }
  private robberHexAt(ndcX: number, ndcY: number): number | null {
    if (!this.board || !this.robberGate) return null;
    const hit = this.boardRaycaster(ndcX, ndcY).intersectPlane({ x: 0, y: 1, z: 0 }, 0.05);
    if (!hit) return null;
    const apothem = Math.sqrt(3) / 2;
    let best: { hex: number; d2: number } | null = null;
    for (const hex of this.robberGate) {
      const coord = HEX_COORDS[hex];
      const center = hexWorld(coord.q, coord.r);
      const dx = Math.abs(hit.x - center.x);
      const dz = Math.abs(hit.z - center.z);
      // Point-in-flat-top-hex, inset just enough that a shared rim does not flicker between two
      // destinations. The closest centre wins at the remaining exact boundaries.
      if (dx > 0.98 || dz > apothem * 0.98 || Math.sqrt(3) * dx + dz > Math.sqrt(3) * 0.98) continue;
      const d2 = dx * dx + dz * dz;
      if (!best || d2 < best.d2) best = { hex, d2 };
    }
    return best?.hex ?? null;
  }
  private hoveredTarget(): BoardPickTarget | null {
    if (this.hoverNode !== null) return { kind: 'node', id: this.hoverNode };
    if (this.hoverEdge !== null) return { kind: 'edge', id: this.hoverEdge };
    return null;
  }
  private setHoveredTarget(target: BoardPickTarget | null): void {
    const node = target?.kind === 'node' ? target.id : null;
    const edge = target?.kind === 'edge' ? target.id : null;
    if (node !== this.hoverNode || edge !== this.hoverEdge) {
      this.hoverNode = node;
      this.hoverEdge = edge;
      this.dirty = true;
    }
  }
  // Update the hovered vertex/edge from the cursor (board mode only; ignored mid-animation).
  // Sticky: the current hover is kept until the cursor leaves a wider radius, so the ghost
  // doesn't flicker between neighbours as the mouse moves.
  hoverBoard(ndcX: number, ndcY: number): void {
    if (!isBoardMode(this.modeName) || this.placing || this.revealing) return;
    if (this.robberGate) {
      this.previewRobberHex(this.robberHexAt(ndcX, ndcY));
      return;
    }
    const raycaster = this.boardRaycaster(ndcX, ndcY);
    const picked = pickBoardTarget(raycaster, this.buildingAtNode);
    // With a gate set, a target outside the legal set is not a hover candidate at all — the
    // cursor passes over it as if it were open water.
    const best = picked && (!this.gate || this.gateAllows(picked)) ? picked : null;
    const current = this.hoveredTarget();
    const currentHit = current ? measureBoardTarget(raycaster, current, this.buildingAtNode) : null;
    // Preserve the old 0.06 enter / 0.11 leave relationship, expressed relative to each
    // target's own semantic radius. A normalized switch bias keeps neighbouring targets from
    // flickering without comparing unrelated raw point distances.
    const KEEP_SCALE = 0.11 / 0.06;
    const SWITCH_BIAS = 0.02 / 0.06;
    this.setHoveredTarget(resolveStickyHover(currentHit, best, {
      leaveScore: KEEP_SCALE,
      switchBias: SWITCH_BIAS,
    }));
  }
  // Which vertex/edge a click at these coordinates resolves to, without touching the board.
  // A highlighted target owns the click while the pointer remains in click range. If sticky
  // hover is already outside that range, resolve to nothing rather than activating a different,
  // unhighlighted neighbour. Direct clicks without a prior hover still perform a fresh pick.
  // Gated callers (a real game) get only targets inside the legal set.
  pickBoardAt(ndcX: number, ndcY: number): BoardPickTarget | null {
    if (!isBoardMode(this.modeName) || this.placing || this.revealing || this.robberGate) return null;
    const raycaster = this.boardRaycaster(ndcX, ndcY);
    const current = this.hoveredTarget();
    const CLICK_SCALE = 0.07 / 0.06;
    const target = current
      ? (() => {
          const hit = measureBoardTarget(raycaster, current, this.buildingAtNode);
          return hit.score <= CLICK_SCALE ? hit : null;
        })()
      : pickBoardTarget(raycaster, this.buildingAtNode, CLICK_SCALE);
    if (!target) return null;
    return this.gate && !this.gateAllows(target) ? null : target;
  }

  pickRobberHexAt(ndcX: number, ndcY: number): number | null {
    if (!isBoardMode(this.modeName) || this.placing || this.revealing || !this.robberGate) return null;
    const hex = this.robberHexAt(ndcX, ndcY);
    return hex !== null && this.robberGate.has(hex) ? hex : null;
  }

  // A click on the board IN THE EDITOR: place a piece on an empty spot (per the free-placement
  // rules), or — if the spot is occupied — return a descriptor so the caller can open the edit
  // modal. A real game calls `pickBoardAt` instead and lets the rules engine own the move.
  clickBoard(ndcX: number, ndcY: number): { kind: 'building' | 'road'; id: number } | null {
    const target = this.pickBoardAt(ndcX, ndcY);
    if (!target) return null;
    if (target.kind === 'node') {
      const node = target.id;
      if (this.buildings.has(node)) return { kind: 'building', id: node };
      if (canPlaceSettlement(node, this.occ())) {
        this.buildings.set(node, { city: false, color: this.placeColor }); // distance rule enforced
        this.startDrop('building', node);
      }
      return null;
    }
    if (target.kind === 'edge') {
      const edge = target.id;
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
    this.dropClock.reset();
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
  // What one color collects for a roll against the board as it stands. The scene owns the board
  // and the buildings, so it answers the question rather than exposing both to do it outside.
  // Empty before the board exists, and on any roll no hex of that color pays out.
  yieldFor(color: PlayerColor, roll: number): Partial<Record<Resource, number>> {
    return this.board ? rollYield(this.board, this.buildings, color, roll, this.robberHex) : {};
  }

  // The same payout, split per hex and projected to the screen cell of that hex's chip — the
  // point a card should be thrown from. Uses the live camera, so it must be read at launch: the
  // cell is only right for the frame it was taken on.
  rollSources(color: PlayerColor, roll: number, cols: number, rows: number): { resource: Resource; count: number; col: number; row: number }[] {
    if (!this.board) return [];
    const camera = this.cam().toCamera({ fovy: FOVY, near: 0.05, far: 100 });
    const vp = cameraMatrices(camera, cols / (rows * 2)).viewProjection;
    const out: { resource: Resource; count: number; col: number; row: number }[] = [];
    for (const payout of rollPayouts(this.board, this.buildings, color, roll, this.robberHex)) {
      const { q, r } = HEX_COORDS[payout.hex];
      const { x, z } = hexWorld(q, r);
      const point = projectPoint(vp, { x, y: 0.14, z }); // the chip's height, so cards leave from the token
      if (point.behind) continue;
      out.push({
        resource: payout.resource,
        count: payout.count,
        col: Math.round((point.x * 0.5 + 0.5) * cols),
        row: Math.round((1 - (point.y * 0.5 + 0.5)) * rows),
      });
    }
    return out;
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
    this.roads.set(12, 'purple');
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
    if (!isBoardMode(m)) this.cancelRobberMove();
    if (isBoardMode(m) && !this.board) this.regenerate(true); // startup uses the full board-build sequence
    this.dirty = true;
  }
  currentMode(): CatanMode {
    return this.modeName;
  }

  // (Re)build the board arrangement and its center-out placement order. `animate` plays the
  // fly-in; false snaps straight to the finished board.
  private regenerate(animate: boolean): void {
    this.board = this.adoptedBoard ?? generateBoard(mulberry32(this.boardSeed || 1));
    this.robberHex = this.board.robberHex; // the desert, until a rolled 7 can move it
    this.harbors = boardHarborPoses(this.board.harbors);
    this.harborEntryDistances = this.harbors.map((harbor, index) =>
      safeHarborEntryDistance(harbor, portMesh(harbor.kind, this.boardSeed * 31 + index)));
    this.harborPiers = harborPiersMesh(this.harbors.map((harbor) => harbor.connector));
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
    this.placementClock.reset();
    this.revealing = false; // reset any in-progress token reveal for the new board
    this.rolledSum = null; // clear a stale dice highlight from the previous board
    this.robberGate = null;
    this.hoverHex = null;
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
  rollDice(values?: readonly [number, number]): void {
    if (!isBoardMode(this.modeName) || this.dicePhase !== 'idle' || this.robberGate) return;
    for (let index = 0; index < this.dice.length; index++) {
      const d = this.dice[index];
      d.val = values?.[index] ?? 1 + Math.floor(Math.random() * 6);
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
    this.rollClock.reset();
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
    if (isBoardMode(this.modeName)) {
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
    // `rolledSum` keeps frames coming after the dice leave, so the tick that expires the chip
    // highlight is guaranteed to run. It is self-limiting: that tick clears the flag.
    return this.dirty || this.placing || this.revealing || this.tokensDirty || this.dicePhase !== 'idle' || this.rolledSum !== null || this.dropping !== null;
  }

  // The dice are rendered after clearing depth, so finite depth now identifies exactly their
  // pixels. The shared compositor uses this to replay them as a sparse foreground scene layer
  // above projected number chips without putting ordinary HUD chrome underneath them.
  hasForegroundSceneLayer(): boolean {
    return this.dicePhase !== 'idle';
  }

  requestAnimationFrame(): void {
    if (isBoardMode(this.modeName) || (this.modeName === 'tile' && this.terrain !== 'mountains')) this.dirty = true;
  }

  // The number tokens to overlay right now: one per non-desert hex, projected to the screen
  // cell of its center with the current board camera (matches what renderScene draws). Empty
  // in tile mode or while tiles are still being placed.
  boardTokens(cols: number, rows: number): BoardToken[] {
    if (!isBoardMode(this.modeName) || this.placing || !this.board) return [];
    const cam = this.cam();
    const camera = cam.toCamera({ fovy: FOVY, near: 0.05, far: 100 });
    const vp = cameraMatrices(camera, cols / (rows * 2)).viewProjection; // aspect matches the render target
    const spinStep = Math.floor(this.revealClock.elapsed / REVEAL_FLICKER);
    const hexFootprints = HEX_COORDS.map(({ q, r }) => {
      const { x, z } = hexWorld(q, r);
      return projectedHexFootprint(vp, x, z, cols, rows);
    }).sort((a, b) => a - b);
    // A lower-quartile footprint represents the smaller, farther hexes without allowing one extreme
    // perspective corner to suppress detail across the complete board.
    const detailFootprint = hexFootprints[Math.floor(hexFootprints.length * 0.25)] ?? 0;
    this.tokenPipDetailVisible = hysteresisThreshold(
      detailFootprint,
      this.tokenPipDetailVisible,
      TOKEN_PIP_SHOW_MIN_FOOTPRINT,
      TOKEN_PIP_HIDE_MIN_FOOTPRINT,
    );
    const out: BoardToken[] = [];
    for (let h = 0; h < NUM_HEXES; h++) {
      const cell = this.board.hexes[h];
      if (cell.token === null) continue; // desert: no token
      const { q, r } = HEX_COORDS[h];
      const { x, z } = hexWorld(q, r);
      const point = projectPoint(vp, { x, y: 0.14, z });
      const viewport = projectedPointToViewport(point, cols, rows);
      if (!viewport) continue;
      // During the reveal each chip spins without pips until its ring's settle time. Once the
      // real value locks, its actual pips grow outward from one central dot in short layers.
      const settleAt = REVEAL_BASE + hexRing(q, r) * REVEAL_STEP;
      const settled = !this.revealing || this.revealClock.elapsed >= settleAt;
      const num = settled ? cell.token : 2 + ((spinStep * 7 + h * 5) % 11);
      const finalPips = TOKEN_DOTS[cell.token] ?? 0;
      const pipElapsed = this.revealClock.elapsed - settleAt - REVEAL_PIP_DELAY;
      const visiblePips = !this.revealing
        ? finalPips
        : revealedPipCount(finalPips, pipElapsed);
      out.push({
        col: Math.round(viewport.x),
        row: Math.round(viewport.y),
        num,
        pips: visiblePips,
        showPips: this.tokenPipDetailVisible && visiblePips > 0,
        red: settled && RED_NUMBERS.includes(num),
        hot: settled && this.rolledSum !== null && num === this.rolledSum && h !== this.robberHex,
        blocked: settled && this.rolledSum !== null && num === this.rolledSum && h === this.robberHex,
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
    const camera = cam.toCamera({ fovy: FOVY, near: 0.05, far: 100 });
    const vp = cameraMatrices(camera, cols / (rows * 2)).viewProjection;
    const point = projectPoint(vp, PORT_SAIL_CENTER);
    const viewport = projectedPointToViewport(point, cols, rows);
    if (!viewport) return null;
    const info = PORT_SAIL_INFO[this.portKind];
    // Return the sail's midpoint cell (col, row). Centering the chip on it is the HUD's job, since
    // only the HUD knows the chip's width.
    return {
      col: Math.round(viewport.x),
      row: Math.round(viewport.y),
      ratio: info.ratio,
      icon: info.icon,
    };
  }

  private queueLambert(mesh: Mesh, model: Mat4, lightDir = LIGHT, wrap = WRAP, ambient = AMBIENT): void {
    const object = this.authoredPool.acquire();
    object.geometry = mesh;
    object.renderOrder = this.renderSequence++;
    const material = object.material as WorldMaterialInstance<LambertUniforms>;
    material.values.lightDir = lightDir;
    material.values.ambient = ambient;
    material.values.wrap = wrap;
    object.setMatrix(model);
  }

  private queuePiece(mesh: Mesh, model: Mat4): void {
    const object = this.piecePool.acquire();
    object.geometry = mesh;
    object.renderOrder = this.renderSequence++;
    object.setMatrix(model);
  }

  private queueWater(mesh: Mesh, time: number, cameraPos: Vec3): void {
    const object = this.waterPool.acquire();
    object.geometry = mesh;
    object.renderOrder = this.renderSequence++;
    const material = object.material as WorldMaterialInstance<WaterUniforms>;
    material.values.time = time;
    material.values.cameraPos = cameraPos;
    object.setMatrix(MODEL);
  }

  // Board mode has nine independently transformed sails. Project each through the board camera
  // so its compact trade badge stays legible at terminal resolution. They appear only after the
  // island has landed; during the fly-in the ships themselves provide the frame context.
  boardPortLabels(cols: number, rows: number): SailLabel[] {
    if (!isBoardMode(this.modeName) || this.placing || !this.board) return [];
    const cam = this.cam();
    const camera = cam.toCamera({ fovy: FOVY, near: 0.05, far: 100 });
    const vp = cameraMatrices(camera, cols / (rows * 2)).viewProjection;
    const out: SailLabel[] = [];
    for (const harbor of this.harbors) {
      const point = projectPoint(vp, harbor.sailCenter);
      const viewport = projectedPointToViewport(point, cols, rows);
      if (!viewport) continue;
      const info = PORT_SAIL_INFO[harbor.kind];
      out.push({
        col: Math.round(viewport.x),
        row: Math.round(viewport.y),
        ratio: info.ratio,
        icon: info.icon,
      });
    }
    return out;
  }

  renderScene(target: RenderTarget, t = 0): void {
    this.tokensDirty = false; // consume the previous frame's one-shot
    this.lastAspect = target.width / target.height; // remember for hit-test projection
    target.clear(14, 16, 22);
    this.renderSequence = 0;
    this.waterPool.begin();
    this.authoredPool.begin();
    this.piecePool.begin();
    const cam = this.cam();
    // Board generation uses the settled board camera from its first frame to its last. Tiles
    // therefore land at their real on-screen size, and the fixed water hex never appears to
    // stretch while the coast emerges after them.
    const camera = cam.toCamera({ fovy: FOVY, near: 0.05, far: 100 });
    const eye = camera.eye;
    if (isBoardMode(this.modeName)) this.renderBoard(t, eye);
    else if (this.modeName === 'pieces') this.queuePiece(piecesMesh(this.pieceColor), MODEL);
    else if (this.modeName === 'port') this.queueLambert(portMesh(this.portKind), MODEL, PORT_LIGHT, PORT_WRAP);
    else {
      this.queueLambert(tileMesh(this.terrain, this.variant, this.robber), MODEL);
      const animated = animatedTileMesh(this.terrain, this.variant, t);
      if (animated) this.queueLambert(animated, MODEL);
    }
    this.sceneRenderer.render(target, this.authoredScene, camera);
    if (isBoardMode(this.modeName)) this.renderDice(target, t);
    this.dirty = false;
  }

  // The full 19-hex board. Each hex has a distinct per-tile seed for procedural variation and
  // the robber is baked onto the desert. While `placing`, each tile is posed along its fly-in
  // (stack → arc → drop) and shows its blank back until it flips past edge-on.
  private renderBoard(t: number, eye: Vec3): void {
    if (!this.board) this.regenerate(false);
    const board = this.board!;
    this.queueWater(WATER_MESH, t, eye);
    if (this.placing) {
      this.placementClock.tick(t);
      if (this.placementClock.elapsed > BOARD_BUILD_END) {
        this.placing = false;
        this.revealing = true; // hand off to the number-token slot-settle
        this.revealClock.reset();
      }
    }
    const coastProgress = this.placing
      ? Math.max(0, Math.min(1, (this.placementClock.elapsed - COAST_GROW_START) / COAST_GROW_DUR))
      : 1;
    if (coastProgress > 0) {
      const coast = coastProgress >= 1 ? COAST_MESH : coastMesh(coastProgress);
      this.queueLambert(coast, MODEL, LIGHT, 1, 0.72);
    }
    // Surf arrives only after the sand has fully grown. During the preceding tile deal the
    // island is deliberately bare water, without a premature foam outline revealing its shape.
    if (coastProgress >= 1) {
      this.queueWater(swashMesh(t), t, eye);
      this.queueLambert(surfMesh(t), MODEL, LIGHT, 1, 0.82);
    }
    if (this.revealing) {
      this.revealClock.tick(t);
      if (this.revealClock.elapsed >= REVEAL_END) this.revealing = false;
    }
    for (let oi = 0; oi < NUM_HEXES; oi++) {
      const hex = this.order[oi];
      const { q, r } = HEX_COORDS[hex];
      const dest = hexWorld(q, r);
      const p = this.placing ? Math.max(0, Math.min(1, (this.placementClock.elapsed - oi * PLACE_STEP) / PLACE_FLY)) : 1;
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
        const e = smoothstep(p);
        const x = STACK_POS.x + (dest.x - STACK_POS.x) * e;
        const z = STACK_POS.z + (dest.z - STACK_POS.z) * e;
        const y = slotY * (1 - e) + Math.sin(Math.PI * p) * PLACE_HOP;
        const flip = Math.PI * (1 - smoothstep(Math.min(1, p / 0.8))); // face-up by 80% of the flight
        model = poseMatrix(x, y, z, flip);
        faceUp = flip <= Math.PI / 2;
      }
      const terrain = board.hexes[hex].terrain;
      const seed = this.boardSeed * NUM_HEXES + hex;
      const mesh = faceUp ? tileMesh(terrain, seed, hex === this.robberHex) : tileBackMesh();
      this.queueLambert(mesh, model);
      if (faceUp) {
        const animated = animatedTileMesh(terrain, seed, t, dest);
        if (animated) this.queueLambert(animated, model);
      }
    }
    // Once the coast has emerged, the nine boats enter from the water perimeter in coastal
    // order. Their paired bridges extend only for the final part of the approach, meeting the
    // vessel exactly as it settles into its rules-derived harbor pose.
    if (!this.placing && this.harborPiers) {
      this.queueLambert(this.harborPiers, MODEL);
    }
    for (let i = 0; i < this.harbors.length; i++) {
      const harbor = this.harbors[i];
      const entry = this.placing ? harborEntryProgress(this.placementClock.elapsed, i) : 1;
      if (entry <= 0) continue;
      const bridgeProgress = smoothstep(Math.max(0, Math.min(1, (entry - 0.62) / 0.38)));
      if (this.placing && bridgeProgress > 0) {
        const piers = harborPiersMesh([harbor.connector], bridgeProgress);
        this.queueLambert(piers, MODEL);
      }
      const harborModel = this.placing
        ? harborEntryModel(harbor, entry, i, this.harborEntryDistances[i] ?? 0)
        : harbor.model;
      this.queueLambert(portMesh(harbor.kind, this.boardSeed * 31 + i), harborModel, LIGHT, 1, 0.62);
    }
    if (!this.placing) this.renderOverlay(t); // placed pieces + hover marker (once tiles are down)
  }

  // The board editor overlay: all placed pieces plus the hovered vertex/edge highlight.
  private renderOverlay(t: number): void {
    // Advance the build-drop: the just-built piece starts elevated and eases onto the rim.
    let dropLift = 0;
    if (this.dropping) {
      this.dropClock.tick(t);
      const p = Math.min(1, this.dropClock.elapsed / BUILD_DROP_DUR);
      dropLift = BUILD_DROP_H * (1 - bounceOut(p));
      if (p >= 1) this.dropping = null;
    }
    const dropB = this.dropping?.kind === 'building' ? this.dropping.id : -1;
    const dropR = this.dropping?.kind === 'road' ? this.dropping.id : -1;
    // Preview the destination as a second, brighter robber. Because the real robber is still
    // baked into `robberHex`, the board communicates both the current block and the pending move.
    if (this.hoverHex !== null && this.board) {
      const { q, r } = HEX_COORDS[this.hoverHex];
      const center = hexWorld(q, r);
      const terrain = this.board.hexes[this.hoverHex].terrain;
      const seed = this.boardSeed * NUM_HEXES + this.hoverHex;
      this.queueLambert(robberMarkerMesh(terrain, seed), mat4Translate(center.x, 0, center.z));
    }
    // Ghosts only preview a *legal* placement (distance rule for a settlement, connectivity for
    // a road), so hovering an illegal spot shows nothing.
    const hoverEmptyNode = this.hoverNode !== null && this.placeable({ kind: 'node', id: this.hoverNode });
    const hoverEmptyEdge = this.hoverEdge !== null && !this.roads.has(this.hoverEdge) && this.placeable({ kind: 'edge', id: this.hoverEdge });
    const spec: OverlaySpec = {
      buildings: [...this.buildings].map(([n, b]) => ({ x: NODE_XZ[n].x, z: NODE_XZ[n].z, city: b.city, color: b.color, hot: n === this.hoverNode, lift: n === dropB ? dropLift : 0 })),
      roads: [...this.roads].map(([e, c]) => ({ x0: EDGE_ENDS[e].x0, z0: EDGE_ENDS[e].z0, x1: EDGE_ENDS[e].x1, z1: EDGE_ENDS[e].z1, color: c, hot: e === this.hoverEdge, lift: e === dropR ? dropLift : 0 })),
      ghostSettlement: hoverEmptyNode ? NODE_XZ[this.hoverNode as number] : null,
      ghostRoad: hoverEmptyEdge ? EDGE_ENDS[this.hoverEdge as number] : null,
      hoverColor: hoverColorFor(this.placeColor),
    };
    if (!spec.buildings.length && !spec.roads.length && !spec.ghostSettlement && !spec.ghostRoad) return;
    this.queuePiece(boardOverlayMesh(spec), MODEL);
  }

  // Advance the roll sequence, then (unless idle) draw the BIG dice on top of the board. The
  // depth buffer is cleared first so the dice always sit over the scene, never occluded.
  private renderDice(target: RenderTarget, t: number): void {
    // The clock outlives the dice: the lit chips linger past their exit, and noticing that
    // deadline needs a tick. Hence the second condition — 'idle' alone would stop the clock
    // while a highlight is still up, and it would never clear.
    if (this.dicePhase !== 'idle' || this.rolledSum !== null) {
      this.rollClock.tick(t);
      // Both dice have come to rest once the later of the two (its own duration + stagger) lands.
      const allLanded = Math.max(DICE_ROLL_DUR * this.dice[0].dur, DICE_STAGGER + DICE_ROLL_DUR * this.dice[1].dur);
      if (this.dicePhase === 'rolling' && this.rollClock.elapsed >= allLanded) {
        this.dicePhase = 'hold';
        this.rolledSum = this.dice[0].val + this.dice[1].val;
        this.tokensDirty = true; // light the matching chips on the next composite
        this.onRollLanded?.(this.rolledSum); // the result is final here — pay out production
      }
      if (this.dicePhase === 'hold' && this.rollClock.elapsed >= allLanded + DICE_HOLD) {
        this.dicePhase = 'idle'; // dice vanish; the lit chips remain a moment longer
      }
      // The gold expires on its own rather than lasting until the next roll, so a board left
      // alone stops advertising a stale result.
      if (this.rolledSum !== null && this.rollClock.elapsed >= allLanded + DICE_HIGHLIGHT_HOLD) {
        this.rolledSum = null;
        this.tokensDirty = true; // drop the chips back to black on the next composite
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
      const pd = rolling ? Math.min(1, Math.max(0, (this.rollClock.elapsed - i * DICE_STAGGER) / (DICE_ROLL_DUR * d.dur))) : 1;
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
