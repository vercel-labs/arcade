import {
  cameraMatrices,
  cube,
  flatShade,
  halfBlockToSurface,
  lambertMaterial,
  mat4Multiply,
  mat4Scale,
  mat4Translate,
  normalize3,
  OrbitCamera,
  rasterize,
  Raycaster,
  RenderTarget,
  shapeGlyphToSurface,
  STYLE_BOLD,
  STYLE_DIM,
  Surface,
  type Mat4,
  type Mesh,
  type RGB,
  type Vec3,
} from '../engine/index.ts';
import { ChessState } from '../rules/chess/chess.ts';
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
const LIGHT: RGB = [144, 139, 128];
const DARK: RGB = [70, 67, 63];
const FRAME: RGB = [35, 38, 48];
const GOLD: RGB = [217, 178, 77];
const CYAN: RGB = [76, 191, 212];
const DISPLAY_MODES: BrowserDisplayMode[] = ['ascii', 'pixel', 'hybrid'];
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
  private game = new ChessState();
  private readonly raycaster = new Raycaster();
  private readonly boardMesh = tint(flatShade(cube(0.5)), [255, 255, 255]);
  private readonly pieceMesh = tint(flatShade(cube(0.5)), [255, 255, 255]);
  private readonly tintedMeshes = new Map<string, Mesh>();
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

  frame(cols = this.cols, rows = this.rows): BrowserArcadeFrame {
    this.cols = Math.max(48, cols);
    this.rows = Math.max(26, rows);
    return this.screen === 'launcher' ? this.launcherFrame() : this.chessFrame();
  }

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
    this.selected = -1;
    this.targets.clear();
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
      });
    }
    surface.drawTextOver(2, 1, 'arcade / chess', [236, 238, 245], STYLE_BOLD);
    surface.drawTextOver(this.cols - 19, 1, `[ ${this.displayMode} ]`, CYAN, STYLE_BOLD);
    const turn = this.game.board.turn === WHITE ? 'white' : 'black';
    const result = this.game.result();
    const status = result ? `${result.winner === null ? 'draw' : result.winner === WHITE ? 'white wins' : 'black wins'} · ${result.reason}` : `${turn} to move`;
    surface.drawTextOver(2, this.rows - 3, status, result ? GOLD : [225, 227, 235], STYLE_BOLD);
    const moves = this.moveLog.slice(-5).join('  ');
    if (moves) surface.drawTextOver(2, this.rows - 2, moves.slice(0, this.cols - 4), MUTED);
    surface.drawTextOver(2, this.rows - 1, 'drag orbit · scroll zoom · d display · r reset · esc launcher', MUTED, STYLE_DIM);
    return { surface, screen: this.screen, displayMode: this.displayMode, status };
  }

  private renderTarget(): RenderTarget {
    const target = this.displayMode === 'pixel'
      ? new RenderTarget(this.cols, this.rows * 2)
      : new RenderTarget(this.cols * 3, this.rows * 6);
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
        const type = pieceType(encoded) as PieceType;
        const scale = PIECE_SCALE[type];
        draw(
          this.pieceMesh,
          mat4Multiply(mat4Translate(x, scale.y * 0.48 + 0.08, z), mat4Scale(scale.x, scale.y, scale.z)),
          pieceColor(encoded) === WHITE ? WHITE_RGB : BROWN,
          0.36,
        );
      }
    }
    return target;
  }

  private tintedMesh(mesh: Mesh, color: RGB): Mesh {
    const source = mesh === this.boardMesh ? 'board' : 'piece';
    const key = `${source}:${color.join(',')}`;
    const cached = this.tintedMeshes.get(key);
    if (cached) return cached;
    const colored = tint(mesh, color);
    this.tintedMeshes.set(key, colored);
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
