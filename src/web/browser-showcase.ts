import { cameraMatrices } from '../engine/camera.ts';
import type { RGB } from '../engine/color.ts';
import { RenderTarget } from '../engine/framebuffer.ts';
import { lambertMaterial } from '../engine/materials.ts';
import {
  mat4Multiply,
  mat4RotX,
  mat4RotY,
  mat4Scale,
  mat4Translate,
  normalize3,
  type Mat4,
} from '../engine/math.ts';
import {
  cube,
  flatShade,
  tetrahedron,
  type Mesh,
} from '../engine/mesh.ts';
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
import {
  Box,
  FilledButton,
  Screen,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  Text,
} from '../tui/index.ts';
import type { BrowserDisplayMode } from './browser-chess.ts';

const BLACK: RGB = [0, 0, 0];
const CYAN: RGB = [88, 212, 236];
const GOLD: RGB = [226, 183, 75];
const VIOLET: RGB = [184, 156, 255];
const MODES: BrowserDisplayMode[] = ['ascii', 'pixel', 'hybrid'];

export interface BrowserShowcaseFrame {
  surface: Surface;
  status: string;
  displayMode?: BrowserDisplayMode;
}

/** Small real-engine scene used by the public examples gallery. */
export class BrowserRenderShowcase {
  private readonly cubeMesh = tint(flatShade(cube(0.5)), CYAN);
  private readonly tetraMesh = tint(flatShade(tetrahedron()), VIOLET);
  private readonly floorMesh = tint(flatShade(cube(0.5)), [38, 42, 53]);
  private readonly camera = new OrbitCamera(
    { azimuth: 0.35, elevation: 0.42, distance: 6.7, target: { x: 0, y: 0.15, z: 0 } },
    0.05,
    20,
  );
  private displayMode: BrowserDisplayMode = 'ascii';

  frame(cols = 64, rows = 34, timeSeconds = 0): BrowserShowcaseFrame {
    cols = Math.max(40, cols);
    rows = Math.max(22, rows);
    // Shape matching needs a real sub-cell sample grid (3×6 samples per
    // terminal cell). A half-block frame is intentionally only 1×2. Keeping
    // those presenter-specific resolutions here makes the example exercise the
    // same quality/performance trade-off as Arcade instead of feeding the ASCII
    // matcher two sparse pixels and resolving every small mesh to a blank.
    const target = this.displayMode === 'pixel'
      ? new RenderTarget(cols, rows * 2)
      : new RenderTarget(cols * 3, rows * 6);
    target.clear();
    const camera = this.camera.toCamera({ fovy: (48 * Math.PI) / 180, near: 0.05, far: 100 });
    const { viewProjection } = cameraMatrices(camera, target.width / target.height);
    const lightDir = normalize3({ x: -0.45, y: 0.85, z: 0.38 });
    const draw = (mesh: Mesh, model: Mat4, ambient = 0.26) => rasterize(target, mesh, lambertMaterial, {
      mvp: mat4Multiply(viewProjection, model),
      model,
      lightDir,
      ambient,
      wrap: 0.22,
    });

    draw(this.floorMesh, mat4Multiply(mat4Translate(0, -0.82, 0), mat4Scale(5.6, 0.18, 4.2)), 0.44);
    const spin = mat4Multiply(mat4RotY(timeSeconds * 0.78), mat4RotX(timeSeconds * 0.31));
    draw(this.cubeMesh, mat4Multiply(mat4Translate(-0.82, 0.05, 0), spin), 0.3);
    draw(
      this.tetraMesh,
      mat4Multiply(
        mat4Translate(1.05, -0.02, 0.12),
        mat4Multiply(mat4RotY(-timeSeconds * 0.58), mat4Scale(0.72, 0.72, 0.72)),
      ),
      0.32,
    );

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
    surface.drawTextOver(2, 1, 'engine / mesh + material + camera', [238, 240, 246], STYLE_BOLD);
    surface.drawTextOver(cols - 15, 1, this.displayMode, CYAN, STYLE_BOLD);
    surface.drawTextOver(2, rows - 2, 'drag orbit · scroll zoom · switch presenter', [126, 132, 149], STYLE_DIM);
    return { surface, status: 'Live CPU-rendered scene', displayMode: this.displayMode };
  }

  cycleDisplayMode(): BrowserDisplayMode {
    this.displayMode = MODES[(MODES.indexOf(this.displayMode) + 1) % MODES.length];
    return this.displayMode;
  }

  orbit(dx: number, dy: number): void { this.camera.orbit(dx, dy); }
  zoom(delta: number): void { this.camera.zoomBy(Math.exp(delta * 0.0015)); }
  reset(): void {
    this.camera.reset();
  }
}

/** A framework-free retained-TUI specimen rendered through the same Surface host. */
export class BrowserTuiShowcase {
  private selected = 0;

  frame(cols = 64, rows = 34): BrowserShowcaseFrame {
    cols = Math.max(44, cols);
    rows = Math.max(24, rows);
    const screen = new Screen(cols, rows);
    const players = [
      ['red', 'grok-4.1-fast', '4'],
      ['blue', 'claude-haiku-4.5', '3'],
      ['orange', 'gemini-2.5-flash', '5'],
    ];
    const tableRows = [
      TableHeader(['color', 'model', 'vp'].map((cell) => TableCell(cell, { style: { color: 'textMuted' } }))),
      ...players.map((player, index) => TableRow(
        { style: { color: index === this.selected ? GOLD : 'textPrimary' } },
        [TableCell(player[0]), TableCell(player[1]), TableCell(player[2], { align: 'end' })],
      )),
    ];
    const root = Box({ width: cols, height: rows, padding: [2, 3], background: 'surfaceCanvas' }, [
      Box({ flexDirection: 'column', width: { pct: 1 }, gap: 1 }, [
        Text({ text: 'retained TUI / live component tree', style: { color: 'textStrong', bold: true } }),
        Text({ text: 'layout + theme + tables + buttons + Surface', style: { color: 'textMuted' } }),
        Box({ height: 1 }),
        Box({ flexDirection: 'row', gap: 2, flexGrow: 1 }, [
          Box({ flexDirection: 'column', width: Math.max(26, cols - 26), padding: [1, 2], border: 'square', borderColor: 'surfaceControl', gap: 1 }, [
            Text({ text: 'players', style: { color: 'textMuted', bold: true } }),
            Table({ columns: [{ width: 8 }, { flex: 1, min: 16 }, { width: 3, align: 'end' }], width: Math.max(22, cols - 32), rowGap: 1 }, tableRows),
          ]),
          Box({ flexDirection: 'column', flexGrow: 1, minWidth: 18, gap: 1 }, [
            Text({ text: 'actions', style: { color: 'textMuted', bold: true } }),
            FilledButton({ id: 'trade', label: '⚓ trade', style: { background: [53, 117, 132], color: 'textStrong' } }),
            FilledButton({ id: 'build', label: '⌂ build' }),
            FilledButton({ id: 'disabled', label: 'roll dice', disabled: true }),
          ]),
        ]),
        Text({ text: 'DOM controls mutate retained state; Arcade redraws cells.', style: { color: 'textMuted', dim: true } }),
      ]),
    ]);
    screen.setRoot(root, { x: 0, y: 0, w: cols, h: rows });
    return {
      surface: screen.snapshot((surface) => surface.fillRect(0, 0, cols, rows, BLACK)),
      status: `Selected ${players[this.selected][1]}`,
    };
  }

  nextPlayer(): void { this.selected = (this.selected + 1) % 3; }
  reset(): void { this.selected = 0; }
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
