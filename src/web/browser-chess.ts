import { cameraMatrices } from '../engine/camera.ts';
import { chessCinematicPose } from '../cinematic/camera.ts';
import { CHESS_LOOP_SECONDS, CHESS_MOVE_SECONDS, EVERGREEN_GAME_MOVES } from '../cinematic/scripted-games.ts';
import type { RGB } from '../engine/color.ts';
import { RenderTarget } from '../engine/framebuffer.ts';
import { lambertMaterial, pieceMaterial } from '../engine/materials.ts';
import {
  mat4Multiply,
  mat4MulVec4,
  mat4RotY,
  mat4Scale,
  mat4Translate,
  normalize3,
  type Mat4,
  type Vec3,
} from '../engine/math.ts';
import {
  cube,
  flatShade,
  type Mesh,
} from '../engine/mesh.ts';
import { OrbitCamera } from '../engine/orbit.ts';
import { Raycaster } from '../engine/picking.ts';
import {
  halfBlockToSurface,
  shapeGlyphToSurface,
  ShapeGlyphSurfaceCache,
} from '../engine/present-cells.ts';
import { rasterize } from '../engine/raster.ts';
import {
  STYLE_BOLD,
  STYLE_DIM,
  Surface,
} from '../engine/surface.ts';
import {
  measureChessPieceMeshes,
  chessMovePosition,
  chessJailPosition,
  chessSquarePosition,
  movingKingPosition,
  planChessMove,
  type ChessMovePlan,
  type ChessPieceMeshes,
  type ChessPieceName,
} from '../game-visuals/chess/index.ts';
import { ChessState } from '../rules/chess/chess.ts';
import { BrowserCreatorWisps } from './browser-wisp.ts';
import {
  BLACK,
  BISHOP,
  KING,
  KNIGHT,
  PAWN,
  pieceColor,
  pieceType,
  QUEEN,
  ROOK,
  square,
  WHITE,
  type Move,
  type PieceType,
} from '../rules/chess/types.ts';

export type BrowserDisplayMode = 'ascii' | 'pixel' | 'hybrid';
export type BrowserArcadeScreen = 'launcher' | 'chess';

export interface BrowserArcadeFrame {
  surface: Surface;
  screen: BrowserArcadeScreen;
  displayMode: BrowserDisplayMode;
  status: string;
}

const BLACK_RGB: RGB = [0, 0, 0];
const MUTED: RGB = [137, 143, 164];
const WHITE_RGB: RGB = [232, 228, 216];
const BROWN: RGB = [158, 98, 53];
const LIGHT: RGB = [142, 138, 130];
const DARK: RGB = [78, 74, 70];
const FRAME: RGB = [46, 43, 40];
const GOLD: RGB = [217, 178, 77];
const CYAN: RGB = [76, 191, 212];
const DISPLAY_MODES: BrowserDisplayMode[] = ['ascii', 'pixel', 'hybrid'];
const PIECE_NAME: Record<PieceType, ChessPieceName> = {
  [PAWN]: 'pawn',
  [KNIGHT]: 'knight',
  [BISHOP]: 'bishop',
  [ROOK]: 'rook',
  [QUEEN]: 'queen',
  [KING]: 'king',
};
const PIECE_SCALE: Record<PieceType, Vec3> = {
  [PAWN]: { x: 0.34, y: 0.72, z: 0.34 },
  [KNIGHT]: { x: 0.42, y: 1.05, z: 0.56 },
  [BISHOP]: { x: 0.38, y: 1.15, z: 0.38 },
  [ROOK]: { x: 0.48, y: 0.9, z: 0.48 },
  [QUEEN]: { x: 0.46, y: 1.35, z: 0.46 },
  [KING]: { x: 0.5, y: 1.52, z: 0.5 },
};

/** A browser-safe, complete local Chess slice built from Arcade's real primitives. */
export class BrowserArcade {
  private readonly asciiTarget = new RenderTarget(1, 1);
  private readonly pixelTarget = new RenderTarget(1, 1);
  private readonly glyphCache = new ShapeGlyphSurfaceCache();
  private game = new ChessState();
  private readonly raycaster = new Raycaster();
  private readonly boardMesh = tint(flatShade(cube(0.5)), [255, 255, 255]);
  private readonly pieceMesh = tint(flatShade(cube(0.5)), [255, 255, 255]);
  private readonly tintedMeshes = new WeakMap<Mesh, Map<string, Mesh>>();
  private readonly camera = new OrbitCamera(
    { azimuth: 0, elevation: 0.67, distance: 12.4, target: { x: 0, y: 0.3, z: 0 } },
    0.05,
    30,
  );
  private screen: BrowserArcadeScreen = 'launcher';
  private displayMode: BrowserDisplayMode = 'ascii';
  private selected = -1;
  private targets = new Map<number, Move>();
  private moveLog: string[] = [];
  private cols = 92;
  private rows = 52;
  private pieceMeshes: ChessPieceMeshes | null = null;
  private importedPieceScale = 1;
  private cinematic: { move: Move; progress: number; plan: ChessMovePlan } | null = null;
  private whiteJail: Array<{ type: PieceType; color: number }> = [];
  private blackJail: Array<{ type: PieceType; color: number }> = [];
  private cinematicTime = 0;
  private hideChrome = false;
  private readonly wisps = new BrowserCreatorWisps();

  prepareWisps(): Promise<void> { return this.wisps.prepare(['anthropic', 'openai']); }

  frame(cols = this.cols, rows = this.rows, timeSeconds = 0): BrowserArcadeFrame {
    this.cols = Math.max(48, cols);
    this.rows = Math.max(26, rows);
    this.cinematicTime = timeSeconds;
    return this.screen === 'launcher' ? this.launcherFrame() : this.chessFrame();
  }

  /** Scroll authors the camera; an independent active-scene clock authors play. */
  setCinematicState(cameraProgress: number, gameplayPhase: number, cameraDistanceScale = 1): void {
    const moves = EVERGREEN_GAME_MOVES;
    const p = Math.max(0, Math.min(1, cameraProgress));
    const elapsed = Math.max(0, Math.min(0.999999, gameplayPhase)) * CHESS_LOOP_SECONDS;
    const scaled = Math.min(moves.length, elapsed / CHESS_MOVE_SECONDS);
    const completed = Math.min(moves.length, Math.floor(scaled));
    this.game = new ChessState();
    this.moveLog = [];
    this.whiteJail = [];
    this.blackJail = [];
    this.cinematic = null;
    for (let i = 0; i < completed; i++) {
      const move = this.game.actionFromStringLoose(moves[i]);
      if (move) {
        this.moveLog.push(this.game.actionToString(move));
        const plan = this.planMove(move);
        if (plan.captured) (plan.captured.captor === WHITE ? this.whiteJail : this.blackJail).push({ type: plan.captured.type, color: plan.captured.color });
        this.game.applyAction(move);
      }
    }
    if (completed < moves.length) {
      const active = this.game.actionFromStringLoose(moves[completed]);
      if (active) this.cinematic = { move: active, progress: smoothstep(scaled - completed), plan: this.planMove(active) };
    }
    const pose = chessCinematicPose(p);
    this.camera.azimuth = pose.azimuth;
    this.camera.elevation = pose.elevation;
    this.camera.distance = pose.distance * cameraDistanceScale;
    this.camera.target = pose.target;
    this.openChess();
  }

  setChromeVisible(visible: boolean): void { this.hideChrome = !visible; }

  /** Backward-compatible scroll-scrubbed behavior for standalone embeds. */
  setCinematicProgress(progress: number): void { this.setCinematicState(progress, progress); }

  openChess(): void {
    this.screen = 'chess';
  }

  back(): void {
    this.screen = 'launcher';
    this.selected = -1;
    this.targets.clear();
  }

  reset(): void {
    this.game = new ChessState();
    this.moveLog = [];
    this.whiteJail = [];
    this.blackJail = [];
    this.cinematic = null;
    this.selected = -1;
    this.targets.clear();
  }

  /** Swap the temporary procedural markers for Arcade's production Chess OBJ set. */
  setPieceMeshes(meshes: ChessPieceMeshes): void {
    this.pieceMeshes = meshes;
    this.importedPieceScale = measureChessPieceMeshes(meshes, 1.55).scale;
  }

  cycleDisplayMode(): BrowserDisplayMode {
    const next = (DISPLAY_MODES.indexOf(this.displayMode) + 1) % DISPLAY_MODES.length;
    this.displayMode = DISPLAY_MODES[next];
    return this.displayMode;
  }

  orbit(dx: number, dy: number): void {
    if (this.screen === 'chess') this.camera.orbit(dx, dy);
  }

  zoom(delta: number): void {
    if (this.screen === 'chess') this.camera.zoomBy(Math.exp(delta * 0.0015));
  }

  click(ndcX: number, ndcY: number): void {
    if (this.screen === 'launcher') {
      this.openChess();
      return;
    }
    if (this.game.isTerminal()) return;
    const sq = this.squareAt(ndcX, ndcY);
    if (sq < 0) {
      this.selected = -1;
      this.targets.clear();
      return;
    }
    const move = this.targets.get(sq);
    if (move) {
      this.moveLog.push(this.game.actionToString(move));
      this.game.applyAction(move);
      this.selected = -1;
      this.targets.clear();
      return;
    }
    const piece = this.game.board.squares[sq];
    if (!piece || pieceColor(piece) !== this.game.board.turn) {
      this.selected = -1;
      this.targets.clear();
      return;
    }
    this.selected = sq;
    this.targets = new Map(
      this.game
        .legalActions()
        .filter((candidate) => candidate.from === sq && (!candidate.promotion || candidate.promotion === QUEEN))
        .map((candidate) => [candidate.to, candidate]),
    );
  }

  /** Apply a legal SAN or coordinate move without coupling callers to Chess internals. */
  play(action: string): boolean {
    if (this.screen === 'launcher') this.openChess();
    if (this.game.isTerminal()) return false;
    const move = this.game.actionFromStringLoose(action);
    if (!move) return false;
    this.moveLog.push(this.game.actionToString(move));
    this.game.applyAction(move);
    this.selected = -1;
    this.targets.clear();
    return true;
  }

  private launcherFrame(): BrowserArcadeFrame {
    const surface = new Surface(this.cols, this.rows);
    surface.fillRect(0, 0, this.cols, this.rows, BLACK_RGB);
    const center = Math.floor(this.cols / 2);
    drawCentered(surface, 4, 'ARCADE', [242, 244, 250], STYLE_BOLD);
    const cardW = Math.min(34, this.cols - 8);
    const cardH = Math.min(14, this.rows - 16);
    const x = center - Math.floor(cardW / 2);
    const y = Math.max(10, Math.floor((this.rows - cardH) / 2));
    surface.fillRect(x, y, cardW, cardH, [14, 17, 24]);
    surface.fillRect(x, y, cardW, 1, [73, 81, 105]);
    surface.fillRect(x, y + cardH - 1, cardW, 1, [40, 45, 60]);
    drawCentered(surface, y + 4, 'CHESS', [235, 223, 198], STYLE_BOLD);
    drawCentered(surface, y + 7, 'two-player preview', MUTED);
    drawCentered(surface, y + cardH - 3, '[ press enter ]', CYAN, STYLE_BOLD);
    drawCentered(surface, this.rows - 4, 'enter select · d display · r reset', MUTED, STYLE_DIM);
    return { surface, screen: this.screen, displayMode: this.displayMode, status: 'Choose Chess' };
  }

  private chessFrame(): BrowserArcadeFrame {
    const target = this.renderTarget();
    const surface = new Surface(this.cols, this.rows);
    surface.fillRect(0, 0, this.cols, this.rows, BLACK_RGB);
    if (this.displayMode === 'pixel') {
      halfBlockToSurface(surface, target);
    } else {
      shapeGlyphToSurface(surface, target, this.cols, this.rows, {
        color: true,
        contrast: 2,
        hybrid: this.displayMode === 'hybrid',
        coloredBackground: this.displayMode === 'hybrid',
      }, 0, 0, this.glyphCache);
    }
    const turn = this.game.board.turn === WHITE ? 'white' : 'black';
    const result = this.game.result();
    const status = result ? `${result.winner === null ? 'draw' : result.winner === WHITE ? 'white wins' : 'black wins'} · ${result.reason}` : `${turn} to move`;
    if (!this.hideChrome) {
      surface.drawTextOver(2, 1, 'arcade / chess', [236, 238, 245], STYLE_BOLD);
      surface.drawTextOver(this.cols - 19, 1, `[ ${this.displayMode} ]`, CYAN, STYLE_BOLD);
      surface.drawTextOver(2, this.rows - 3, status, result ? GOLD : [225, 227, 235], STYLE_BOLD);
      const moves = this.moveLog.slice(-5).join('  ');
      if (moves) surface.drawTextOver(2, this.rows - 2, moves.slice(0, this.cols - 4), MUTED);
      surface.drawTextOver(2, this.rows - 1, 'drag orbit · scroll zoom · d display · r reset · esc launcher', MUTED, STYLE_DIM);
    }
    return { surface, screen: this.screen, displayMode: this.displayMode, status };
  }

  private renderTarget(): RenderTarget {
    const target = this.displayMode === 'pixel' ? this.pixelTarget : this.asciiTarget;
    target.resize(this.displayMode === 'pixel' ? this.cols : this.cols * 3, this.displayMode === 'pixel' ? this.rows * 2 : this.rows * 6);
    target.clear(0, 0, 0);
    const camera = this.camera.toCamera({ fovy: (48 * Math.PI) / 180, near: 0.05, far: 100 });
    const { viewProjection } = cameraMatrices(camera, target.width / target.height);
    const lightDir = normalize3({ x: -0.4, y: 0.9, z: 0.5 });
    const draw = (mesh: Mesh, model: Mat4, color: RGB, ambient = 0.28) => {
      const tinted = this.tintedMesh(mesh, color);
      rasterize(target, tinted, lambertMaterial, {
        mvp: mat4Multiply(viewProjection, model),
        model,
        lightDir,
        ambient,
        wrap: 0.22,
      });
    };
    draw(this.boardMesh, mat4Multiply(mat4Translate(0, -0.28, 0), mat4Scale(9.3, 0.35, 9.3)), FRAME, 0.42);
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const sq = square(file, rank);
        const x = (file - 3.5) * 1.05;
        const z = (3.5 - rank) * 1.05;
        const selected = this.selected === sq;
        const targetMove = this.targets.has(sq);
        draw(
          this.boardMesh,
          mat4Multiply(mat4Translate(x, 0, z), mat4Scale(1, targetMove ? 0.16 : 0.1, 1)),
          selected ? GOLD : targetMove ? [110, 160, 128] : (file + rank) % 2 ? LIGHT : DARK,
          0.5,
        );
        const encoded = this.game.board.squares[sq];
        if (!encoded) continue;
        if (this.cinematic?.plan.segments.some((segment) => segment.hideSq === sq)) continue;
        const type = pieceType(encoded) as PieceType;
        const color = pieceColor(encoded);
        this.drawPiece(target, viewProjection, camera.eye, type, color, x, 0.08, z);
      }
    }
    for (let index = 0; index < this.whiteJail.length; index++) { const entry = this.whiteJail[index]; const p = this.jailPosition(WHITE, index); this.drawPiece(target, viewProjection, camera.eye, entry.type, entry.color, p.x, 0.08, p.z); }
    for (let index = 0; index < this.blackJail.length; index++) { const entry = this.blackJail[index]; const p = this.jailPosition(BLACK, index); this.drawPiece(target, viewProjection, camera.eye, entry.type, entry.color, p.x, 0.08, p.z); }
    if (this.cinematic) for (const segment of this.cinematic.plan.segments) {
      const position = chessMovePosition(segment, this.cinematic.progress);
      this.drawPiece(target, viewProjection, camera.eye, segment.type, segment.color, position.x, position.y + 0.08, position.z);
    }
    const whiteKing = movingKingPosition(this.cinematic?.plan ?? null, WHITE, this.cinematic?.progress ?? 0) ?? this.kingPosition(WHITE);
    const blackKing = movingKingPosition(this.cinematic?.plan ?? null, BLACK, this.cinematic?.progress ?? 0) ?? this.kingPosition(BLACK);
    if (whiteKing) this.wisps.draw(target, viewProjection, camera, 'anthropic', { ...whiteKing, y: 2.7 }, this.cinematicTime, 0, 0.58);
    if (blackKing) this.wisps.draw(target, viewProjection, camera, 'openai', { ...blackKing, y: 2.7 }, this.cinematicTime, 1.7, 0.58);
    return target;
  }

  private drawPiece(target: RenderTarget, vp: Mat4, cameraPos: Vec3, type: PieceType, color: number, x: number, y: number, z: number): void {
    const draw = (mesh: Mesh, model: Mat4, rgb: RGB) => rasterize(target, mesh, pieceMaterial, {
      mvp: mat4Multiply(vp, model), model, cameraPos,
      keyDir: normalize3({ x: -0.4, y: 0.85, z: 0.5 }), fillDir: normalize3({ x: 0.6, y: 0.25, z: 0.35 }),
      keyStrength: 0.7, fillStrength: 0.18, ambient: 0.32,
      tint: { x: rgb[0], y: rgb[1], z: rgb[2] },
    });
    if (this.pieceMeshes) {
      const scale = mat4Scale(this.importedPieceScale, this.importedPieceScale, this.importedPieceScale);
      draw(this.pieceMeshes[PIECE_NAME[type]], mat4Multiply(mat4Translate(x, y, z), color === WHITE ? scale : mat4Multiply(mat4RotY(Math.PI), scale)), color === WHITE ? [232, 228, 216] : [150, 96, 52]);
    } else {
      const scale = PIECE_SCALE[type];
      draw(this.pieceMesh, mat4Multiply(mat4Translate(x, y + scale.y * 0.48, z), mat4Scale(scale.x, scale.y, scale.z)), color === WHITE ? WHITE_RGB : BROWN);
    }
  }

  private kingPosition(color: number): { x: number; z: number } | null {
    for (let rank = 0; rank < 8; rank++) for (let file = 0; file < 8; file++) {
      const sq = square(file, rank);
      const piece = this.game.board.squares[sq];
      if (piece && pieceType(piece) === KING && pieceColor(piece) === color) return squarePosition(sq);
    }
    return null;
  }

  private planMove(move: Move): ChessMovePlan { return planChessMove(move, { square: 1.05, whiteJailCount: this.whiteJail.length, blackJailCount: this.blackJail.length }); }
  private jailPosition(color: number, index: number): { x: number; z: number } { return chessJailPosition(color as 0 | 1, index, 1.05); }

  private tintedMesh(mesh: Mesh, color: RGB): Mesh {
    const key = color.join(',');
    let variants = this.tintedMeshes.get(mesh);
    if (!variants) {
      variants = new Map();
      this.tintedMeshes.set(mesh, variants);
    }
    const cached = variants.get(key);
    if (cached) return cached;
    const colored = tint(mesh, color);
    variants.set(key, colored);
    return colored;
  }

  private squareAt(ndcX: number, ndcY: number): number {
    const pixelHeight = this.rows * 2;
    const camera = this.camera.toCamera({ fovy: (48 * Math.PI) / 180, near: 0.05, far: 100 });
    const hit = this.raycaster
      .setFromCamera(camera, ndcX, ndcY, this.cols / pixelHeight)
      .intersectPlane({ x: 0, y: 1, z: 0 });
    if (!hit) return -1;
    const file = Math.floor(hit.x / 1.05 + 4);
    const rank = Math.floor(4 - hit.z / 1.05);
    return file < 0 || file > 7 || rank < 0 || rank > 7 ? -1 : square(file, rank);
  }
}

function tint(mesh: Mesh, color: RGB): Mesh {
  return {
    indices: mesh.indices,
    vertices: mesh.vertices.map((vertex) => ({
      ...vertex,
      color: { x: color[0], y: color[1], z: color[2] },
    })),
  };
}

function drawCentered(surface: Surface, y: number, text: string, color: RGB, style = 0): void {
  surface.drawText(Math.max(0, Math.floor((surface.cols - text.length) / 2)), y, text, color, BLACK_RGB, style);
}

function squarePosition(sq: number): { x: number; z: number } {
  return chessSquarePosition(sq, 1.05);
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}
