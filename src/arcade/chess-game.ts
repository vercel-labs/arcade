import { readFileSync } from 'node:fs';
import {
  add3,
  type Camera,
  cameraMatrices,
  flatShade,
  mat4Identity,
  mat4Multiply,
  mat4RotY,
  mat4Scale,
  mat4Translate,
  meshBounds,
  type Mesh,
  normalize3,
  parseObj,
  pieceMaterial,
  rasterize,
  type RenderTarget,
  scale3,
  type Vec3,
  type VertexIn,
} from '../engine/index.ts';
import { ChessState } from '../games/chess/chess.ts';
import {
  BISHOP,
  type Color,
  FLAG_CASTLE_K,
  FLAG_CASTLE_Q,
  KING,
  KNIGHT,
  type Move,
  PAWN,
  pieceColor,
  pieceType,
  QUEEN,
  ROOK,
  square,
  WHITE,
} from '../games/chess/types.ts';
import { OrbitCamera } from './orbit.ts';

const PIECE_NAMES = ['pawn', 'queen', 'bishop', 'rook', 'king', 'knight'];

const FOVY = (50 * Math.PI) / 180;
const TALLEST = 1.7; // world height of the tallest piece (king)

const IVORY: Vec3 = { x: 232, y: 228, z: 216 }; // white set
const BROWN: Vec3 = { x: 150, y: 96, z: 52 }; // dark set
const LIGHT_SQ: Vec3 = { x: 142, y: 138, z: 130 };
const DARK_SQ: Vec3 = { x: 78, y: 74, z: 70 };
const FRAME: Vec3 = { x: 46, y: 43, z: 40 };
const DISC_TINT: Vec3 = { x: 120, y: 122, z: 132 }; // legal-move indicator dot
const HOVER_GLOW: Vec3 = { x: 244, y: 230, z: 138 }; // pastel yellow — lit color blends toward this on hover/select

const KEY_DIR = normalize3({ x: -0.4, y: 0.85, z: 0.5 });
const FILL_DIR = normalize3({ x: 0.6, y: 0.25, z: 0.35 });
const AMBIENT = 0.32;
const KEY_STRENGTH = 0.7;
const FILL_STRENGTH = 0.18;

const ANIM_FRAMES = 9; // ~0.3s at 30fps for a piece to slide to its destination
const DISC_LIFT = 0.012; // float the indicator just above the board surface

// One piece sliding from `from` to `to` (a normal move is one segment; castling
// is two — the king and the rook).
interface AnimSegment {
  mesh: Mesh;
  color: Color;
  from: number; // 0x88
  to: number; // 0x88
}

const ease = (t: number): number => t * t * (3 - 2 * t);

// A playable chess board: a procedural 8×8 board driven by a live ChessState.
// Hover a piece for a pastel-yellow glow; click it to reveal legal-move dots;
// click a dot to slide the piece there (rules enforced by the harness). Orbit /
// pan / zoom are inherited from the shared turntable camera.
export class ChessGameScene {
  private game = new ChessState();
  private meshByType: Mesh[] = []; // indexed by PieceType (1..6)
  private lightSquares: Mesh;
  private darkSquares: Mesh;
  private base: Mesh;
  private disc: Mesh;
  private scale: number;
  private square: number;
  private cam: OrbitCamera;

  // Interaction state.
  private hoverSq = -1; // 0x88 square under the cursor, or -1
  private selectedSq = -1; // selected piece's square, or -1
  private targets = new Map<number, Move>(); // legal destination square → move
  private anim: { segments: AnimSegment[]; move: Move; t: number } | null = null;

  constructor(dir = 'public/assets/chess_blender') {
    const meshes: Record<string, Mesh> = {};
    let maxH = 0;
    let maxFootprint = 0;
    for (const name of PIECE_NAMES) {
      const mesh = flatShade(parseObj(readFileSync(`${dir}/${name}.obj`, 'utf8')));
      meshes[name] = mesh;
      const b = meshBounds(mesh);
      maxH = Math.max(maxH, b.max.y - b.min.y);
      maxFootprint = Math.max(maxFootprint, b.max.x - b.min.x, b.max.z - b.min.z);
    }
    this.scale = TALLEST / (maxH || 1);
    this.square = maxFootprint * this.scale * 1.25;
    this.meshByType[PAWN] = meshes.pawn;
    this.meshByType[KNIGHT] = meshes.knight;
    this.meshByType[BISHOP] = meshes.bishop;
    this.meshByType[ROOK] = meshes.rook;
    this.meshByType[QUEEN] = meshes.queen;
    this.meshByType[KING] = meshes.king;

    const board = this.buildBoard();
    this.lightSquares = board.light;
    this.darkSquares = board.dark;
    this.base = board.base;
    this.disc = buildDisc(this.square / 6, 24); // diameter ≈ 1/3 of a square

    const boardWidth = 8 * this.square;
    const dist = boardWidth / (2 * Math.tan(FOVY / 2)) + 2;
    this.cam = new OrbitCamera(
      { azimuth: 0, elevation: 0.62, distance: dist, target: { x: 0, y: 0.4, z: 0 } },
      this.square,
      boardWidth * 3,
    );
  }

  // World center of a square. White's bottom-right (h1) is +X,+Z; ranks increase
  // away from white (toward −Z).
  private squareCenter(sq: number): Vec3 {
    const file = sq & 7;
    const rank = sq >> 4;
    return { x: (file - 3.5) * this.square, y: 0, z: (3.5 - rank) * this.square };
  }

  // ── Camera passthrough ─────────────────────────────────────────────────────
  resetView(): void {
    this.cam.reset();
  }
  orbit(dx: number, dy: number): void {
    this.cam.orbit(dx, dy);
  }
  pan(dx: number, dy: number): void {
    this.cam.pan(dx, dy);
  }
  zoomBy(factor: number): void {
    this.cam.zoomBy(factor);
  }

  // ── Picking & interaction ───────────────────────────────────────────────────
  // Map a normalized device coordinate (−1..1, +y up) to the 0x88 board square
  // under it, by casting a ray from the eye through the cursor onto the y=0 plane.
  private squareAt(ndcX: number, ndcY: number, aspect: number): number {
    const { forward, right, up } = this.cam.basis();
    const tanHalf = Math.tan(FOVY / 2);
    const dir = normalize3(add3(forward, add3(scale3(right, ndcX * tanHalf * aspect), scale3(up, ndcY * tanHalf))));
    const eye = this.cam.eye();
    if (Math.abs(dir.y) < 1e-6) return -1;
    const t = -eye.y / dir.y;
    if (t <= 0) return -1;
    const file = Math.floor((eye.x + dir.x * t) / this.square + 4);
    const rank = Math.floor(4 - (eye.z + dir.z * t) / this.square);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return -1;
    return rank * 16 + file;
  }

  setHover(ndcX: number, ndcY: number, aspect: number): void {
    this.hoverSq = this.squareAt(ndcX, ndcY, aspect);
  }

  clearHover(): void {
    this.hoverSq = -1;
  }

  click(ndcX: number, ndcY: number, aspect: number): void {
    if (this.anim) return; // ignore input mid-move
    const sq = this.squareAt(ndcX, ndcY, aspect);
    if (sq < 0) return this.deselect();
    // Clicking a highlighted destination plays that move.
    if (this.selectedSq >= 0) {
      const move = this.targets.get(sq);
      if (move) {
        this.startMove(move);
        return;
      }
    }
    // Otherwise (re)select one of the side-to-move's pieces, or clear.
    const p = this.game.board.squares[sq];
    if (p && pieceColor(p) === this.game.board.turn) this.select(sq);
    else this.deselect();
  }

  private select(sq: number): void {
    this.selectedSq = sq;
    this.targets.clear();
    for (const m of this.game.legalActions()) {
      if (m.from !== sq) continue;
      if (m.promotion && m.promotion !== QUEEN) continue; // auto-queen; one dot per square
      this.targets.set(m.to, m);
    }
  }

  private deselect(): void {
    this.selectedSq = -1;
    this.targets.clear();
  }

  private startMove(move: Move): void {
    const color = pieceColor(move.piece);
    const segments: AnimSegment[] = [{ mesh: this.meshByType[pieceType(move.piece)], color, from: move.from, to: move.to }];
    if (move.flags & FLAG_CASTLE_K) {
      const rank = color === WHITE ? 0 : 7;
      segments.push({ mesh: this.meshByType[ROOK], color, from: square(7, rank), to: square(5, rank) });
    }
    if (move.flags & FLAG_CASTLE_Q) {
      const rank = color === WHITE ? 0 : 7;
      segments.push({ mesh: this.meshByType[ROOK], color, from: square(0, rank), to: square(3, rank) });
    }
    this.anim = { segments, move, t: 0 };
    this.deselect();
  }

  // ── Rendering ───────────────────────────────────────────────────────────────
  renderScene(target: RenderTarget): void {
    target.clear(10, 11, 14);
    const eye = this.cam.eye();
    const camera: Camera = { eye, target: this.cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 400 };
    const { viewProjection } = cameraMatrices(camera, target.width / target.height);
    const scaleM = mat4Scale(this.scale, this.scale, this.scale);
    const blackOrient = mat4Multiply(mat4RotY(Math.PI), scaleM);

    const draw = (mesh: Mesh, model: number[], tint: Vec3, glow?: Vec3): void => {
      rasterize(target, mesh, pieceMaterial, {
        mvp: mat4Multiply(viewProjection, model),
        model,
        cameraPos: eye,
        keyDir: KEY_DIR,
        fillDir: FILL_DIR,
        keyStrength: KEY_STRENGTH,
        fillStrength: FILL_STRENGTH,
        ambient: AMBIENT,
        tint,
        glow,
      });
    };
    const orient = (color: Color): number[] => (color === WHITE ? scaleM : blackOrient);

    // Board.
    const identity = mat4Identity();
    draw(this.base, identity, FRAME);
    draw(this.darkSquares, identity, DARK_SQ);
    draw(this.lightSquares, identity, LIGHT_SQ);

    // Legal-move indicator dots (only while a piece is selected and idle).
    if (this.selectedSq >= 0 && !this.anim) {
      for (const to of this.targets.keys()) {
        const c = this.squareCenter(to);
        draw(this.disc, mat4Translate(c.x, DISC_LIFT, c.z), DISC_TINT);
      }
    }

    // Pieces, read live from the board. Skip any piece currently sliding.
    const sliding = this.anim ? new Set(this.anim.segments.map((s) => s.from)) : null;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const p = this.game.board.squares[sq];
      if (!p || sliding?.has(sq)) continue;
      const c = this.squareCenter(sq);
      const color = pieceColor(p);
      const glow = sq === this.selectedSq || sq === this.hoverSq ? HOVER_GLOW : undefined;
      draw(this.meshByType[pieceType(p)], mat4Multiply(mat4Translate(c.x, 0, c.z), orient(color)), color === WHITE ? IVORY : BROWN, glow);
    }

    // In-flight move: draw sliding pieces, advance, and commit on arrival.
    if (this.anim) {
      const e = ease(this.anim.t);
      for (const seg of this.anim.segments) {
        const a = this.squareCenter(seg.from);
        const b = this.squareCenter(seg.to);
        const model = mat4Multiply(mat4Translate(a.x + (b.x - a.x) * e, 0, a.z + (b.z - a.z) * e), orient(seg.color));
        draw(seg.mesh, model, seg.color === WHITE ? IVORY : BROWN);
      }
      this.anim.t += 1 / ANIM_FRAMES;
      if (this.anim.t >= 1) {
        this.game.applyAction(this.anim.move);
        this.anim = null;
      }
    }
  }

  private buildBoard(): { light: Mesh; dark: Mesh; base: Mesh } {
    const light: Mesh = { vertices: [], indices: [] };
    const dark: Mesh = { vertices: [], indices: [] };
    const half = this.square / 2;
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const c = this.squareCenter(r * 16 + f);
        const mesh = (f + r) % 2 === 1 ? light : dark; // a1 (f0,r0) is dark
        quad(mesh, c.x - half, c.z - half, c.x + half, c.z + half, 0);
      }
    }
    const base: Mesh = { vertices: [], indices: [] };
    const ext = 4 * this.square + this.square * 0.35;
    quad(base, -ext, -ext, ext, ext, -0.02);
    return { light, dark, base };
  }
}

// Append a flat axis-aligned quad (two triangles, +Y normal) at height y.
function quad(mesh: Mesh, x0: number, z0: number, x1: number, z1: number, y: number): void {
  const base = mesh.vertices.length;
  const normal: Vec3 = { x: 0, y: 1, z: 0 };
  const white: Vec3 = { x: 255, y: 255, z: 255 }; // unused by pieceMaterial (it tints by uniform)
  const corners: [number, number][] = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  const uvs: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  corners.forEach(([x, z], i) => mesh.vertices.push({ position: { x, y, z }, normal, uv: uvs[i], color: white }));
  mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// A flat horizontal disc (triangle fan) of the given radius, centered at origin.
function buildDisc(radius: number, segments: number): Mesh {
  const normal: Vec3 = { x: 0, y: 1, z: 0 };
  const white: Vec3 = { x: 255, y: 255, z: 255 };
  const vertices: VertexIn[] = [{ position: { x: 0, y: 0, z: 0 }, normal, uv: [0.5, 0.5], color: white }];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    vertices.push({ position: { x: Math.cos(a) * radius, y: 0, z: Math.sin(a) * radius }, normal, uv: [0, 0], color: white });
    if (i > 0) indices.push(0, i, i + 1);
  }
  return { vertices, indices };
}
