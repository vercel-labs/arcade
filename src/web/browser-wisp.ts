import type { Camera } from '../engine/camera.ts';
import type { RenderTarget } from '../engine/framebuffer.ts';
import { bakeMarkAlpha } from '../engine/logo-mark.ts';
import { cross3, mat4MulVec4, normalize3, sub3, type Mat4, type Vec3 } from '../engine/math.ts';
import { wispMaterial } from '../engine/materials.ts';
import { quad, type Mesh } from '../engine/mesh.ts';
import { rasterize } from '../engine/raster.ts';
import type { Texture } from '../engine/texture-data.ts';
import { drawWispFlame } from '../game-visuals/wisp.ts';

export type CinematicCreator = 'openai' | 'anthropic' | 'google' | 'deepseek';

export const CINEMATIC_CREATOR_TINT: Record<CinematicCreator, Vec3> = {
  openai: { x: 16, y: 163, z: 127 },
  anthropic: { x: 217, y: 119, z: 87 },
  google: { x: 66, y: 133, z: 244 },
  deepseek: { x: 77, y: 112, z: 229 },
};

// Anthropic wisps intentionally use Claude's recognizable sunburst, matching
// the terminal Arcade's production override.
const LOGO_URLS: Record<CinematicCreator, string> = {
  openai: new URL('../../assets/logos/openai.png', import.meta.url).toString(),
  anthropic: new URL('../../assets/logos/claude.png', import.meta.url).toString(),
  google: new URL('../../assets/logos/google.png', import.meta.url).toString(),
  deepseek: new URL('../../assets/logos/deepseek.png', import.meta.url).toString(),
};

/** Browser counterpart to Arcade's creator Wisp: production flame + masked logo. */
export class BrowserCreatorWisps {
  private readonly textures = new Map<CinematicCreator, Texture>();
  private preparation: Promise<void> | null = null;
  private readonly mark: Mesh = quad(1);

  prepare(creators: readonly CinematicCreator[]): Promise<void> {
    const runtime = globalThis as unknown as Partial<BrowserImageRuntime>;
    // Node-side renderer tests have no browser bitmap decoder. Frames still
    // retain the production flame body; browser hosts load the marks eagerly.
    if (!runtime.createImageBitmap) return Promise.resolve();
    this.preparation ??= Promise.all([...new Set(creators)].map(async (creator) => {
      this.textures.set(creator, bakeMarkAlpha(await loadTexture(LOGO_URLS[creator])));
    })).then(() => undefined);
    return this.preparation;
  }

  draw(target: RenderTarget, vp: Mat4, camera: Camera, creator: CinematicCreator, anchor: Vec3, time: number, phase: number, scale = 1): void {
    const tint = CINEMATIC_CREATOR_TINT[creator];
    const center = project(vp, anchor, target.width, target.height);
    const edge = project(vp, { x: anchor.x + camera.up.x * scale, y: anchor.y + camera.up.y * scale, z: anchor.z + camera.up.z * scale }, target.width, target.height);
    const radius = Math.max(7, Math.hypot(edge.x - center.x, edge.y - center.y));
    drawWispFlame(target, center.x, center.y, radius, tint, time, phase, { glow: 0.9, energy: 0.72, emphasis: 0.2 });

    const texture = this.textures.get(creator);
    if (!texture) return;
    const forward = normalize3(sub3(camera.target, camera.eye));
    const right = normalize3(cross3(forward, camera.up));
    const up = cross3(right, forward);
    billboard(this.mark, anchor, right, up, scale);
    rasterize(target, this.mark, wispMaterial, {
      mvp: vp, logo: texture, tint, gain: 1.9,
      flicker: 1.05 + Math.sin(time * 5 + phase) * 0.12,
    });
  }
}

function project(vp: Mat4, p: Vec3, width: number, height: number): { x: number; y: number } {
  const c = mat4MulVec4(vp, { ...p, w: 1 });
  const w = c.w || 1e-4;
  return { x: ((c.x / w) * 0.5 + 0.5) * width, y: (1 - ((c.y / w) * 0.5 + 0.5)) * height };
}

function billboard(mesh: Mesh, center: Vec3, right: Vec3, up: Vec3, halfSize: number): void {
  const sx = [-halfSize, halfSize, halfSize, -halfSize];
  const sy = [-halfSize, -halfSize, halfSize, halfSize];
  for (let i = 0; i < 4; i++) mesh.vertices[i].position = {
    x: center.x + right.x * sx[i] + up.x * sy[i],
    y: center.y + right.y * sx[i] + up.y * sy[i],
    z: center.z + right.z * sx[i] + up.z * sy[i],
  };
}

async function loadTexture(url: string): Promise<Texture> {
  const runtime = globalThis as unknown as BrowserImageRuntime;
  const response = await runtime.fetch(url);
  const bitmap = await runtime.createImageBitmap(await response.blob());
  const canvas = runtime.OffscreenCanvas
    ? new runtime.OffscreenCanvas(bitmap.width, bitmap.height)
    : Object.assign(runtime.document!.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to decode cinematic creator logo');
  context.drawImage(bitmap, 0, 0);
  return { width: bitmap.width, height: bitmap.height, data: new Uint8Array(context.getImageData(0, 0, bitmap.width, bitmap.height).data) };
}

interface BrowserImageRuntime {
  fetch(input: string): Promise<{ blob(): Promise<unknown> }>;
  createImageBitmap(blob: unknown): Promise<{ width: number; height: number }>;
  OffscreenCanvas?: new (width: number, height: number) => Canvas2dLike;
  document?: { createElement(tag: 'canvas'): Canvas2dLike };
}

interface Canvas2dLike {
  width: number;
  height: number;
  getContext(id: '2d'): null | {
    drawImage(image: unknown, x: number, y: number): void;
    getImageData(x: number, y: number, width: number, height: number): { data: ArrayLike<number> };
  };
}
