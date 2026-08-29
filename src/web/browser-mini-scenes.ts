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
import { animatedTileMesh, tileMesh } from '../game-visuals/catan/index.ts';
import {
  CHESS_PIECE_ASSET_URLS,
  fetchChessPieceMeshes,
  fetchChessPieceMeshesFromUrls,
} from '../game-visuals/chess/index.ts';
import { BrowserArcade, type BrowserDisplayMode } from './browser-chess.ts';
import type { BrowserMiniScene, BrowserMiniSceneFrame, BrowserMiniSceneId, BrowserMiniSceneOptions } from './mini-scene.ts';

const BLACK: RGB = [0, 0, 0];
const CYAN: RGB = [88, 212, 236];
const MUTED: RGB = [126, 132, 149];
const MODES: BrowserDisplayMode[] = ['ascii', 'pixel', 'hybrid'];

/** Board-only adapter around Arcade's browser-safe Chess rules and renderer. */
export class BrowserChessBoardShowcase implements BrowserMiniScene {
  private readonly arcade = new BrowserArcade();
  private readonly loadPieceMeshes: () => Promise<void>;
  private preparation: Promise<void> | null = null;

  constructor(options: BrowserMiniSceneOptions = {}) {
    this.arcade.openChess();
    this.loadPieceMeshes = async () => {
      const meshes = options.chessPieceAssetBaseUrl
        ? await fetchChessPieceMeshes(options.chessPieceAssetBaseUrl, options.chessPieceFetchText)
        : await fetchChessPieceMeshesFromUrls(
          options.chessPieceAssetUrls ?? CHESS_PIECE_ASSET_URLS,
          options.chessPieceFetchText,
        );
      this.arcade.setPieceMeshes(meshes);
    };
  }

  prepare(): Promise<void> {
    this.preparation ??= this.loadPieceMeshes();
    return this.preparation;
  }

  frame(cols: number, rows: number): BrowserMiniSceneFrame {
    const frame = this.arcade.frame(cols, rows);
    return {
      surface: frame.surface,
      status: frame.status,
      displayMode: frame.displayMode,
    };
  }

  cycleDisplayMode(): BrowserDisplayMode { return this.arcade.cycleDisplayMode(); }
  orbit(dx: number, dy: number): void { this.arcade.orbit(dx, dy); }
  zoom(delta: number): void { this.arcade.zoom(delta); }
  reset(): void { this.arcade.reset(); }
}

/** One production Catan terrain tile rendered independently from the full board. */
export class BrowserCatanTileShowcase implements BrowserMiniScene {
  private readonly camera = new OrbitCamera(
    { azimuth: 0.42, elevation: 0.62, distance: 3.45, target: { x: 0, y: 0.06, z: 0 } },
    1.8,
    8,
  );
  private displayMode: BrowserDisplayMode = 'ascii';

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
    draw(tileMesh('fields', 2), 0.32);
    const animated = animatedTileMesh('fields', 2, timeSeconds, { x: 0, z: 0 });
    if (animated) draw(animated, 0.38);

    const surface = new Surface(cols, rows);
    surface.fillRect(0, 0, cols, rows, BLACK);
    if (this.displayMode === 'pixel') halfBlockToSurface(surface, target);
    else shapeGlyphToSurface(surface, target, cols, rows, {
      color: true,
      contrast: 2,
      hybrid: this.displayMode === 'hybrid',
      coloredBackground: this.displayMode === 'hybrid',
      blankOutsideDepthBounds: true,
    });
    surface.drawTextOver(2, 1, 'catan / fields tile', [238, 240, 246], STYLE_BOLD);
    surface.drawTextOver(Math.max(2, cols - 10), 1, this.displayMode, CYAN, STYLE_BOLD);
    surface.drawTextOver(2, rows - 2, 'production procedural mesh · drag · scroll', MUTED, STYLE_DIM);
    return { surface, status: 'Animated Catan fields tile', displayMode: this.displayMode };
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
  return new BrowserCatanTileShowcase();
}
