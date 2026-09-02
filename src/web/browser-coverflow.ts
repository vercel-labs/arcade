import { CoverFlowRenderer, coverFlowCinematicState, coverFlowIndex } from '../cinematic/scenes/cover-flow.ts';
import { ARCADE_CATALOGUE } from '../cinematic/catalogue.ts';
import { RenderTarget } from '../engine/framebuffer.ts';
import { shapeGlyphToSurface } from '../engine/present-cells.ts';
import { STYLE_BOLD, Surface } from '../engine/surface.ts';
import type { Texture } from '../engine/texture-data.ts';

const ITEMS = ARCADE_CATALOGUE;

// Static URLs let browser bundlers emit distinct assets for the shared catalogue.
const URLS: Record<typeof ITEMS[number]['id'], string> = {
  chess: new URL('../../assets/games/chess.png', import.meta.url).toString(),
  poker: new URL('../../assets/games/poker.png', import.meta.url).toString(),
  islanders: new URL('../../assets/games/islanders.png', import.meta.url).toString(),
  mahjong: new URL('../../assets/games/mahjong.png', import.meta.url).toString(),
  leaderboard: new URL('../../assets/games/leaderboard.png', import.meta.url).toString(),
  achievements: new URL('../../assets/games/achievements.png', import.meta.url).toString(),
  website: new URL('../../assets/games/website.png', import.meta.url).toString(),
};

/** Browser image adapter around Arcade's shared production Cover Flow. */
export class BrowserCoverFlow {
  private readonly target = new RenderTarget(1, 1);
  private readonly textures = new Map<string, Texture>(ITEMS.map(({ id }, index) => [id, fallbackCover(index)]));
  private readonly renderer = new CoverFlowRenderer(ITEMS, (id) => this.textures.get(id) ?? null);

  prepare(): Promise<void> {
    const runtime = globalThis as unknown as { createImageBitmap?: unknown };
    if (!runtime.createImageBitmap) return Promise.resolve();
    return Promise.all(ITEMS.map(async ({ id }) => this.textures.set(id, await loadTexture(URLS[id])))).then(() => undefined);
  }

  frame(cols: number, rows: number, progress: number, cameraDistanceScale = 1): Surface {
    const target = this.target;
    target.resize(cols * 3, rows * 6);
    target.clear();
    const { pos, launch } = coverFlowCinematicState(progress, ITEMS.length);
    const launchSlot = ITEMS.length;
    this.renderer.renderCinematic(target, pos, launchSlot, launch, cameraDistanceScale);

    const surface = new Surface(cols, rows);
    surface.fillRect(0, 0, cols, rows, [0, 0, 0]);
    shapeGlyphToSurface(surface, target, cols, rows, { color: true, contrast: 2, hybrid: false, coloredBackground: false });
    const selected = ITEMS[coverFlowIndex(pos, ITEMS.length)];
    const displayTitle = selected.title;
    const label = `${displayTitle}${selected.enabled ? '' : '   coming soon'}`;
    const labelX = Math.max(0, Math.floor((cols - label.length) / 2));
    surface.drawTextOver(labelX, rows - 4, displayTitle, [240, 244, 255], STYLE_BOLD);
    if (!selected.enabled) surface.drawTextOver(labelX + displayTitle.length, rows - 4, '   coming soon', [150, 156, 174]);
    return surface;
  }
}

function fallbackCover(index: number): Texture {
  const side = 64;
  const palette = [[128, 112, 88], [30, 92, 58], [48, 91, 118]] as const;
  const color = palette[index % palette.length];
  const data = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const i = (y * side + x) * 4;
    const edge = x < 3 || y < 3 || x >= side - 3 || y >= side - 3;
    data[i] = edge ? 220 : color[0]; data[i + 1] = edge ? 220 : color[1]; data[i + 2] = edge ? 220 : color[2]; data[i + 3] = 255;
  }
  return { width: side, height: side, data };
}

async function loadTexture(url: string): Promise<Texture> {
  const runtime = globalThis as unknown as BrowserImages;
  const bitmap = await runtime.createImageBitmap(await (await runtime.fetch(url)).blob());
  const canvas = runtime.OffscreenCanvas ? new runtime.OffscreenCanvas(bitmap.width, bitmap.height) : Object.assign(runtime.document!.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to decode game cover');
  context.drawImage(bitmap, 0, 0);
  return { width: bitmap.width, height: bitmap.height, data: new Uint8Array(context.getImageData(0, 0, bitmap.width, bitmap.height).data) };
}

interface BrowserImages { fetch(url: string): Promise<{ blob(): Promise<unknown> }>; createImageBitmap(blob: unknown): Promise<{ width: number; height: number }>; OffscreenCanvas?: new(width: number, height: number) => CanvasImage; document?: { createElement(tag: 'canvas'): CanvasImage }; }
interface CanvasImage { width: number; height: number; getContext(id: '2d'): null | { drawImage(image: unknown, x: number, y: number): void; getImageData(x: number, y: number, width: number, height: number): { data: ArrayLike<number> } }; }
