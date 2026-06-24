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
  BLACK,
  type Color,
  FLAG_CAPTURE,
  FLAG_CASTLE_K,
  FLAG_CASTLE_Q,
  FLAG_EP,
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
// Single muted pastel-yellow used for the selected-square tint (light and dark
// squares alike) and the legal-move dots.
const HILITE_LIGHT: Vec3 = { x: 152, y: 144, z: 100 };
const HILITE_DARK: Vec3 = { x: 152, y: 144, z: 100 };
// Legal-move dots invert against their square for contrast (and so ASCII picks a
// fittingly low/high-brightness glyph): a darker-grey dot on light squares, a
// lighter-grey dot on dark squares. The two greys are kept fairly close in shade
// (but the dark one stays clearly below the light one to preserve the inversion).
const DOT_ON_LIGHT: Vec3 = { x: 98, y: 95, z: 88 };
const DOT_ON_DARK: Vec3 = { x: 126, y: 123, z: 116 };

const KEY_DIR = normalize3({ x: -0.4, y: 0.85, z: 0.5 });
const FILL_DIR = normalize3({ x: 0.6, y: 0.25, z: 0.35 });
const AMBIENT = 0.32;
const KEY_STRENGTH = 0.7;
const FILL_STRENGTH = 0.18;

const ANIM_FRAMES = 9; // ~0.3s at 30fps for a single animation phase
const DOT_LIFT = 0.012; // float the move dots just above the board surface
const HILITE_LIFT = 0.004; // selected-square tint sits just above the board, under the piece
const ARC_HEIGHT = 0.5; // peak lift of a parabolic arc (captures + knight hops), world units
const JAIL_GAP = 0.6; // x-gap between the board edge and the first jail column (× square)
const JAIL_STEP = 0.9; // jail slot spacing, a touch tighter than a board square (× square)

// How a piece travels between two world points: `slide` stays on the board
// plane; `arc` adds a low parabolic hop (captured pieces leaving the board, and
// knights, which "jump").
type Motion = 'slide' | 'arc';

// One animated piece moving from a world point to another during a given phase.
// `hideSq` is the board square it currently occupies, suppressed from the static
// board render for the whole animation so it isn't drawn twice.
interface AnimSeg {
  mesh: Mesh;
  color: Color;
  from: Vec3;
  to: Vec3;
  motion: Motion;
  phase: number; // 0-based phase index this segment animates in
  hideSq: number; // 0x88 board square to suppress while animating (-1 = none)
}

const ease = (t: number): number => t * t * (3 - 2 * t);

// Interpolate a world position along a segment at eased parameter `e`, adding a
// low parabolic lift (peaks at e=0.5) for arc motion.
function travel(a: Vec3, b: Vec3, e: number, motion: Motion): Vec3 {
  return {
    x: a.x + (b.x - a.x) * e,
    y: a.y + (b.y - a.y) * e + (motion === 'arc' ? ARC_HEIGHT * 4 * e * (1 - e) : 0),
    z: a.z + (b.z - a.z) * e,
  };
}

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
  private hiliteQuad: Mesh; // one-square quad for the selected-square tint
  private scale: number;
  private square: number;
  private cam: OrbitCamera;

  // Interaction state.
  private selectedSq = -1; // selected piece's square, or -1
  private targets = new Map<number, Move>(); // legal destination square → move
  // In-flight move: a list of phased segments played sequentially (e.g. a capture
  // is phase 0 = captured piece arcs to jail, phase 1 = capturer moves). `jail`,
  // if set, is the captured piece to file into the jail once the move completes.
  private anim: {
    segs: AnimSeg[];
    move: Move;
    phases: number;
    phase: number;
    t: number;
    jail?: { type: number; color: Color; captor: Color };
  } | null = null;
  // Captured pieces, in capture order, parked off-board in an implicit 2×8 grid.
  // `whiteJail` holds the black pieces White has captured (shown bottom-right by
  // White's h1); `blackJail` holds White pieces Black captured (top-left). Each
  // is keyed by its captor for jailSlot().
  private whiteJail: { type: number; color: Color }[] = [];
  private blackJail: { type: number; color: Color }[] = [];
  // Dirty-flag rendering: the scene is static between interactions (no camera
  // auto-orbit), so the orchestrator can skip re-rendering and re-writing an
  // unchanged frame. Set on any camera/selection change; stays set while a move
  // is animating; cleared once a still frame has been rendered.
  private dirty = true;

  // Whether the visible scene has changed since the last render. Starts true so
  // the first frame always paints.
  needsRender(): boolean {
    return this.dirty;
  }

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
    this.hiliteQuad = { vertices: [], indices: [] };
    quad(this.hiliteQuad, -this.square / 2, -this.square / 2, this.square / 2, this.square / 2, 0);

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

  // World position of a captured piece's parking slot, for the given captor's
  // jail. An implicit 2×8 grid off the board's right edge (from the captor's
  // POV): index 0 sits just past the h1 corner, the column fills back toward h8,
  // and the 9th piece (index 8) starts a second column further out. Black's jail
  // is the 180° mirror, putting it at the top-left from White's view.
  private jailSlot(captor: Color, index: number): Vec3 {
    const sq = this.square;
    const edge = 4 * sq; // right edge of the playing surface
    const col = Math.floor(index / 8); // 0 = nearer the board, 1 = further out
    const row = index % 8; // 0 = nearest the h1 corner, 7 = back by h8
    const x = edge + JAIL_GAP * sq + col * JAIL_STEP * sq;
    // Row 0 aligns just inside the front-right corner, a touch ahead of h1's
    // center; successive rows step back toward h8.
    const z = edge - (JAIL_STEP * sq) / 2 - row * JAIL_STEP * sq;
    return captor === WHITE ? { x, y: 0, z } : { x: -x, y: 0, z: -z };
  }

  // ── Camera passthrough ─────────────────────────────────────────────────────
  resetView(): void {
    this.cam.reset();
    this.dirty = true;
  }
  orbit(dx: number, dy: number): void {
    this.cam.orbit(dx, dy);
    this.dirty = true;
  }
  pan(dx: number, dy: number): void {
    this.cam.pan(dx, dy);
    this.dirty = true;
  }
  zoomBy(factor: number): void {
    this.cam.zoomBy(factor);
    this.dirty = true;
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
    this.dirty = true;
    this.targets.clear();
    for (const m of this.game.legalActions()) {
      if (m.from !== sq) continue;
      if (m.promotion && m.promotion !== QUEEN) continue; // auto-queen; one dot per square
      this.targets.set(m.to, m);
    }
  }

  private deselect(): void {
    if (this.selectedSq !== -1) this.dirty = true;
    this.selectedSq = -1;
    this.targets.clear();
  }

  private startMove(move: Move): void {
    const color = pieceColor(move.piece);
    const segs: AnimSeg[] = [];
    let jail: { type: number; color: Color; captor: Color } | undefined;

    // Capture: the captured piece arcs off to its jail slot at the same time the
    // capturer moves to the square — both in phase 0 — so the whole thing reads
    // as one smooth motion rather than a two-step take-then-move.
    if (move.flags & (FLAG_CAPTURE | FLAG_EP)) {
      // En passant takes the pawn behind the destination, not on it.
      const capturedSq = move.flags & FLAG_EP ? move.to + (color === WHITE ? -16 : 16) : move.to;
      const capType = pieceType(move.captured);
      const capColor = pieceColor(move.captured);
      const list = color === WHITE ? this.whiteJail : this.blackJail;
      segs.push({
        mesh: this.meshByType[capType],
        color: capColor,
        from: this.squareCenter(capturedSq),
        to: this.jailSlot(color, list.length),
        motion: 'arc',
        phase: 0,
        hideSq: capturedSq,
      });
      jail = { type: capType, color: capColor, captor: color };
    }

    // The mover travels in phase 0 too. Knights hop (arc); everyone else slides.
    const moverPhase = 0;
    segs.push({
      mesh: this.meshByType[pieceType(move.piece)],
      color,
      from: this.squareCenter(move.from),
      to: this.squareCenter(move.to),
      motion: pieceType(move.piece) === KNIGHT ? 'arc' : 'slide',
      phase: moverPhase,
      hideSq: move.from,
    });

    // Castling rook rides alongside the king (same phase, sliding; never a capture).
    const addRook = (fromFile: number, toFile: number): void => {
      const rank = color === WHITE ? 0 : 7;
      segs.push({
        mesh: this.meshByType[ROOK],
        color,
        from: this.squareCenter(square(fromFile, rank)),
        to: this.squareCenter(square(toFile, rank)),
        motion: 'slide',
        phase: moverPhase,
        hideSq: square(fromFile, rank),
      });
    };
    if (move.flags & FLAG_CASTLE_K) addRook(7, 5);
    if (move.flags & FLAG_CASTLE_Q) addRook(0, 3);

    this.anim = { segs, move, phases: 1, phase: 0, t: 0, jail };
    this.dirty = true;
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

    const draw = (mesh: Mesh, model: number[], tint: Vec3): void => {
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
      });
    };
    const orient = (color: Color): number[] => (color === WHITE ? scaleM : blackOrient);

    // Board.
    const identity = mat4Identity();
    draw(this.base, identity, FRAME);
    draw(this.darkSquares, identity, DARK_SQ);
    draw(this.lightSquares, identity, LIGHT_SQ);

    // Selected-square tint + legal-move dots (only while idle).
    if (this.selectedSq >= 0 && !this.anim) {
      const sc = this.squareCenter(this.selectedSq);
      const light = ((this.selectedSq & 7) + (this.selectedSq >> 4)) % 2 === 1;
      draw(this.hiliteQuad, mat4Translate(sc.x, HILITE_LIFT, sc.z), light ? HILITE_LIGHT : HILITE_DARK);
      for (const to of this.targets.keys()) {
        const c = this.squareCenter(to);
        const onLight = (((to & 7) + (to >> 4)) % 2) === 1;
        draw(this.disc, mat4Translate(c.x, DOT_LIFT, c.z), onLight ? DOT_ON_LIGHT : DOT_ON_DARK);
      }
    }

    // Draw a piece (board or jail) at a world position, oriented and tinted by color.
    const place = (mesh: Mesh, pos: Vec3, color: Color): void =>
      draw(mesh, mat4Multiply(mat4Translate(pos.x, pos.y, pos.z), orient(color)), color === WHITE ? IVORY : BROWN);

    // Pieces, read live from the board. Suppress any piece an animation is
    // currently moving (it's drawn by the animation block instead).
    const hidden = this.anim ? new Set(this.anim.segs.map((s) => s.hideSq)) : null;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const p = this.game.board.squares[sq];
      if (!p || hidden?.has(sq)) continue;
      const color = pieceColor(p);
      place(this.meshByType[pieceType(p)], this.squareCenter(sq), color);
    }

    // Captured pieces, parked in their implicit jail grids.
    for (let i = 0; i < this.whiteJail.length; i++) {
      const e = this.whiteJail[i];
      place(this.meshByType[e.type], this.jailSlot(WHITE, i), e.color);
    }
    for (let i = 0; i < this.blackJail.length; i++) {
      const e = this.blackJail[i];
      place(this.meshByType[e.type], this.jailSlot(BLACK, i), e.color);
    }

    // In-flight move: draw each segment at its position for the current phase
    // (done → at its target, pending → at its origin, active → interpolated),
    // advance the phase clock, and commit the move once all phases finish.
    if (this.anim) {
      const A = this.anim;
      for (const s of A.segs) {
        const pos =
          s.phase < A.phase ? s.to : s.phase > A.phase ? s.from : travel(s.from, s.to, ease(A.t), s.motion);
        place(s.mesh, pos, s.color);
      }
      A.t += 1 / ANIM_FRAMES;
      if (A.t >= 1) {
        A.t = 0;
        A.phase++;
        if (A.phase >= A.phases) {
          this.game.applyAction(A.move);
          if (A.jail) (A.jail.captor === WHITE ? this.whiteJail : this.blackJail).push({ type: A.jail.type, color: A.jail.color });
          this.anim = null;
        }
      }
    }

    // A still frame has now been painted; stay dirty only while a move is still
    // animating (each animation frame changes the image), otherwise go idle.
    this.dirty = this.anim !== null;
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
