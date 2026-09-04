import { cameraMatrices } from '../engine/camera.ts';
import type { RGB } from '../engine/color.ts';
import { RenderTarget } from '../engine/framebuffer.ts';
import { lambertMaterial } from '../engine/materials.ts';
import {
  mat4Multiply,
  mat4RotY,
  mat4Scale,
  normalize3,
} from '../engine/math.ts';
import type { Mesh } from '../engine/mesh.ts';
import { OrbitCamera } from '../engine/orbit.ts';
import {
  halfBlockToSurface,
  shapeGlyphToSurface,
} from '../engine/present-cells.ts';
import { rasterize } from '../engine/raster.ts';
import {
  STYLE_BOLD,
  STYLE_DIM,
  Surface,
} from '../engine/surface.ts';
import { AnimatedTileMeshCache, animatedTileMesh, tileMesh } from '../game-visuals/islanders/index.ts';
import {
  CHESS_PIECE_ASSET_URLS,
  fetchChessPieceMeshes,
  fetchChessPieceMeshesFromUrls,
  measureChessPieceMeshes,
  type ChessPieceMeshes,
} from '../game-visuals/chess/index.ts';
import { drawChipStack, playerColumns } from '../game-visuals/poker/index.ts';
import { TERRAINS, type Terrain } from '../rules/islanders/types.ts';
import { BrowserArcade, type BrowserDisplayMode } from './browser-chess.ts';
import type { BrowserMiniScene, BrowserMiniSceneFrame, BrowserMiniSceneId, BrowserMiniSceneOptions } from './mini-scene.ts';
import type { ChessCinematicPose } from '../cinematic/camera.ts';

const BLACK: RGB = [0, 0, 0];
const CYAN: RGB = [88, 212, 236];
const MUTED: RGB = [126, 132, 149];
const MODES: BrowserDisplayMode[] = ['ascii', 'pixel', 'hybrid'];

function present(target: RenderTarget, cols: number, rows: number, mode: BrowserDisplayMode): Surface {
  const surface = new Surface(cols, rows);
  surface.fillRect(0, 0, cols, rows, BLACK);
  if (mode === 'pixel') halfBlockToSurface(surface, target);
  else shapeGlyphToSurface(surface, target, cols, rows, {
    color: true,
    contrast: 2,
    hybrid: mode === 'hybrid',
    coloredBackground: mode === 'hybrid',
    blankOutsideDepthBounds: true,
  });
  return surface;
}

function loadChessMeshes(options: BrowserMiniSceneOptions): Promise<ChessPieceMeshes> {
  return options.chessPieceAssetBaseUrl
    ? fetchChessPieceMeshes(options.chessPieceAssetBaseUrl, options.chessPieceFetchText)
    : fetchChessPieceMeshesFromUrls(
      options.chessPieceAssetUrls ?? CHESS_PIECE_ASSET_URLS,
      options.chessPieceFetchText,
    );
}

/** Board-only adapter around Arcade's browser-safe Chess rules and renderer. */
export class BrowserChessBoardShowcase implements BrowserMiniScene {
  private readonly arcade: BrowserArcade;
  private readonly loadPieceMeshes: () => Promise<void>;
  private preparation: Promise<void> | null = null;

  constructor(options: BrowserMiniSceneOptions = {}, exactDimensions = false) {
    this.arcade = new BrowserArcade(options.wispTextures, options.rasterScale, {
      shadowGlyphs: options.shadowGlyphs,
      productionLighting: options.productionLighting,
    }, options.wispRenderer, exactDimensions);
    this.arcade.openChess();
    this.loadPieceMeshes = async () => this.arcade.setPieceMeshes(await loadChessMeshes(options));
  }

  setChromeVisible(visible: boolean): void { this.arcade.setChromeVisible(visible); }

  prepare(): Promise<void> {
    this.preparation ??= Promise.all([this.loadPieceMeshes(), this.arcade.prepareWisps()]).then(() => undefined);
    return this.preparation;
  }

  frame(cols: number, rows: number, timeSeconds = 0): BrowserMiniSceneFrame {
    const frame = this.arcade.frame(cols, rows, timeSeconds);
    return {
      surface: frame.surface,
      status: frame.status,
      displayMode: frame.displayMode,
    };
  }

  setCinematicProgress(progress: number): void { this.arcade.setCinematicProgress(progress); }
  setCinematicState(cameraProgress: number, gameplayPhase: number, cameraDistanceScale = 1): void { this.arcade.setCinematicState(cameraProgress, gameplayPhase, cameraDistanceScale); }
  setCinematicScript(pose: ChessCinematicPose, moves: readonly string[], elapsed: number, moveSeconds: number): void { this.arcade.setCinematicScript(pose, moves, elapsed, moveSeconds); }

  cycleDisplayMode(): BrowserDisplayMode { return this.arcade.cycleDisplayMode(); }
  orbit(dx: number, dy: number): void { this.arcade.orbit(dx, dy); }
  zoom(delta: number): void { this.arcade.zoom(delta); }
  reset(): void { this.arcade.reset(); }
}

/** One production Islanders terrain tile rendered independently from the full board. */
export class BrowserIslandersTileShowcase implements BrowserMiniScene {
  private readonly animatedTileCache = new AnimatedTileMeshCache();
  private readonly camera = new OrbitCamera(
    { azimuth: 0.42, elevation: 0.62, distance: 3.45, target: { x: 0, y: 0.06, z: 0 } },
    1.8,
    8,
  );
  private displayMode: BrowserDisplayMode = 'ascii';

  constructor(private readonly terrain: Terrain = 'fields') {}

  frame(cols = 56, rows = 32, timeSeconds = 0): BrowserMiniSceneFrame {
    cols = Math.max(36, cols);
    rows = Math.max(22, rows);
    const target = this.displayMode === 'pixel'
      ? new RenderTarget(cols, rows * 2)
      : new RenderTarget(cols * 3, rows * 6);
    target.clear();
    const camera = this.camera.toCamera({ fovy: (43 * Math.PI) / 180, near: 0.05, far: 40 });
    const { viewProjection } = cameraMatrices(camera, target.width / target.height);
    const lightDir = normalize3({ x: -0.48, y: 0.9, z: 0.34 });
    const model = mat4Multiply(mat4RotY(-0.2), mat4Scale(1.35, 1.35, 1.35));
    const draw = (mesh: Mesh, ambient: number) => rasterize(target, mesh, lambertMaterial, {
      mvp: mat4Multiply(viewProjection, model),
      model,
      lightDir,
      ambient,
      wrap: 0.22,
    });
    draw(tileMesh(this.terrain, 2), 0.32);
    const animated = animatedTileMesh(this.terrain, 2, timeSeconds, { x: 0, z: 0 }, this.animatedTileCache);
    if (animated) draw(animated, 0.38);

    const surface = present(target, cols, rows, this.displayMode);
    surface.drawTextOver(2, 1, `islanders / ${this.terrain}`, [238, 240, 246], STYLE_BOLD);
    surface.drawTextOver(Math.max(2, cols - 10), 1, this.displayMode, CYAN, STYLE_BOLD);
    surface.drawTextOver(2, rows - 2, 'production procedural mesh · drag · scroll', MUTED, STYLE_DIM);
    return { surface, status: `Islanders ${this.terrain} tile`, displayMode: this.displayMode };
  }

  cycleDisplayMode(): BrowserDisplayMode {
    this.displayMode = MODES[(MODES.indexOf(this.displayMode) + 1) % MODES.length];
    return this.displayMode;
  }

  orbit(dx: number, dy: number): void { this.camera.orbit(dx, dy); }
  zoom(delta: number): void { this.camera.zoomBy(Math.exp(delta * 0.0015)); }
  reset(): void { this.camera.reset(); }
}


/** One imported production Chess asset, isolated from the complete board. */
export class BrowserChessPieceShowcase implements BrowserMiniScene {
  private readonly camera = new OrbitCamera(
    { azimuth: 0.5, elevation: 0.24, distance: 4.2, target: { x: 0, y: 0.7, z: 0 } },
    2.4,
    8,
  );
  private displayMode: BrowserDisplayMode = 'ascii';
  private mesh: Mesh | null = null;
  private preparation: Promise<void> | null = null;

  constructor(private readonly options: BrowserMiniSceneOptions = {}) {}

  prepare(): Promise<void> {
    this.preparation ??= loadChessMeshes(this.options).then((meshes) => {
      const { scale } = measureChessPieceMeshes(meshes, 2.15);
      this.mesh = {
        indices: meshes.knight.indices,
        vertices: meshes.knight.vertices.map((vertex) => ({
          ...vertex,
          position: { ...vertex.position },
          normal: { ...vertex.normal },
          uv: [...vertex.uv] as [number, number],
          color: { x: 225, y: 226, z: 230 },
        })),
      };
      this.pieceScale = scale;
    });
    return this.preparation;
  }

  private pieceScale = 1;

  frame(cols = 56, rows = 32, timeSeconds = 0): BrowserMiniSceneFrame {
    cols = Math.max(36, cols);
    rows = Math.max(22, rows);
    const target = this.displayMode === 'pixel' ? new RenderTarget(cols, rows * 2) : new RenderTarget(cols * 3, rows * 6);
    target.clear();
    const camera = this.camera.toCamera({ fovy: (42 * Math.PI) / 180, near: 0.05, far: 30 });
    const { viewProjection } = cameraMatrices(camera, target.width / target.height);
    if (this.mesh) {
      const model = mat4Multiply(mat4RotY(timeSeconds * 0.32), mat4Scale(this.pieceScale, this.pieceScale, this.pieceScale));
      rasterize(target, this.mesh, lambertMaterial, {
        mvp: mat4Multiply(viewProjection, model),
        model,
        lightDir: normalize3({ x: -0.5, y: 0.88, z: 0.3 }),
        ambient: 0.28,
        wrap: 0.18,
      });
    }
    const surface = present(target, cols, rows, this.displayMode);
    surface.drawTextOver(2, 1, 'chess / knight.obj', [238, 240, 246], STYLE_BOLD);
    surface.drawTextOver(Math.max(2, cols - 10), 1, this.displayMode, CYAN, STYLE_BOLD);
    surface.drawTextOver(2, rows - 2, this.mesh ? 'production asset · drag · scroll' : 'loading production asset…', MUTED, STYLE_DIM);
    return { surface, status: this.mesh ? 'Imported Chess knight' : 'Loading Chess knight', displayMode: this.displayMode };
  }

  cycleDisplayMode(): BrowserDisplayMode {
    this.displayMode = MODES[(MODES.indexOf(this.displayMode) + 1) % MODES.length];
    return this.displayMode;
  }
  orbit(dx: number, dy: number): void { this.camera.orbit(dx, dy); }
  zoom(delta: number): void { this.camera.zoomBy(Math.exp(delta * 0.0015)); }
  reset(): void { this.camera.reset(); }
}

/** Production Poker chips rendered without the app-level table or match controller. */
export class BrowserPokerChipsShowcase implements BrowserMiniScene {
  private readonly camera = new OrbitCamera(
    { azimuth: 0.65, elevation: 0.48, distance: 5.3, target: { x: 0, y: 0.25, z: 0 } },
    2.8,
    9,
  );
  private displayMode: BrowserDisplayMode = 'ascii';

  frame(cols = 56, rows = 32): BrowserMiniSceneFrame {
    cols = Math.max(36, cols);
    rows = Math.max(22, rows);
    const target = this.displayMode === 'pixel' ? new RenderTarget(cols, rows * 2) : new RenderTarget(cols * 3, rows * 6);
    target.clear();
    const camera = this.camera.toCamera({ fovy: (42 * Math.PI) / 180, near: 0.05, far: 30 });
    const { viewProjection } = cameraMatrices(camera, target.width / target.height);
    drawChipStack(
      target,
      viewProjection,
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      playerColumns(1000),
      normalize3({ x: -0.45, y: 0.9, z: 0.3 }),
      0.28,
      3,
    );
    const surface = present(target, cols, rows, this.displayMode);
    surface.drawTextOver(2, 1, 'poker / 1,000 chips', [238, 240, 246], STYLE_BOLD);
    surface.drawTextOver(Math.max(2, cols - 10), 1, this.displayMode, CYAN, STYLE_BOLD);
    surface.drawTextOver(2, rows - 2, 'production denomination stack · drag · scroll', MUTED, STYLE_DIM);
    return { surface, status: 'Poker starting stack', displayMode: this.displayMode };
  }

  cycleDisplayMode(): BrowserDisplayMode {
    this.displayMode = MODES[(MODES.indexOf(this.displayMode) + 1) % MODES.length];
    return this.displayMode;
  }
  orbit(dx: number, dy: number): void { this.camera.orbit(dx, dy); }
  zoom(delta: number): void { this.camera.zoomBy(Math.exp(delta * 0.0015)); }
  reset(): void { this.camera.reset(); }
}

export function createBrowserMiniScene(id: BrowserMiniSceneId, options: BrowserMiniSceneOptions = {}): BrowserMiniScene {
  if (id === 'chess-board') return new BrowserChessBoardShowcase(options);
  if (id === 'chess-knight') return new BrowserChessPieceShowcase(options);
  if (id === 'poker-chips') return new BrowserPokerChipsShowcase();
  const terrain = id.slice('islanders-'.length) as Terrain;
  if (id.startsWith('islanders-') && TERRAINS.includes(terrain)) return new BrowserIslandersTileShowcase(terrain);
  throw new Error(`Unknown browser mini scene: ${id}`);
}
