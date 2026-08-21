import type { Camera } from '../camera.ts';
import type { RenderTarget } from '../framebuffer.ts';
import { SceneRenderer, type Scene } from '../scene.ts';
import { WebGpuSceneRenderer, type WebGpuDraw, type WebGpuFrameStats } from './scene-renderer.ts';

export type RenderBackendPreference = 'auto' | 'cpu' | 'gpu';
export type WebGpuBackendState = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface RenderBackendInfo {
  readonly preference: RenderBackendPreference;
  readonly active: 'cpu' | 'gpu';
  readonly state: WebGpuBackendState;
  readonly detail?: string;
  readonly stats?: WebGpuFrameStats;
}

let preference: RenderBackendPreference = 'cpu';
let state: WebGpuBackendState = 'idle';
let detail: string | undefined;
let renderer: WebGpuSceneRenderer | undefined;
let loading: Promise<void> | undefined;
let active: 'cpu' | 'gpu' = 'cpu';
const listeners = new Set<() => void>();
const draws: WebGpuDraw[] = [];

export function renderBackendPreference(): RenderBackendPreference {
  return preference;
}

export function setRenderBackendPreference(next: RenderBackendPreference): void {
  if (next !== preference) renderer?.resetFrames();
  preference = next;
  if (next === 'cpu') active = 'cpu';
  if (next !== 'cpu') void ensureWebGpuRenderer();
  notify();
}

export function cycleRenderBackendPreference(): RenderBackendPreference {
  const values: RenderBackendPreference[] = ['auto', 'cpu', 'gpu'];
  const next = values[(values.indexOf(preference) + 1) % values.length]!;
  setRenderBackendPreference(next);
  return next;
}

export function renderBackendInfo(): RenderBackendInfo {
  return {
    preference,
    active,
    state,
    detail,
    stats: renderer?.stats(),
  };
}

export function onRenderBackendChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Submit a retained scene to WebGPU and apply the newest completed frame when available.
 * False means the caller must render the frame with the CPU backend.
 */
export function tryRenderSceneWithWebGpu(
  target: RenderTarget,
  scene: Scene,
  camera: Camera,
  sceneRenderer: SceneRenderer,
): boolean {
  if (preference === 'cpu') {
    active = 'cpu';
    return false;
  }
  if (!renderer) {
    void ensureWebGpuRenderer();
    active = 'cpu';
    return false;
  }
  let drawCount = 0;
  let unsupported = false;
  sceneRenderer.forEachDraw(target, scene, camera, (draw) => {
    if (draw.geometry.indices.length === 0) return;
    const webgpu = draw.material.webgpu;
    if (!webgpu || draw.material.blend === 'alpha') {
      unsupported = true;
      return;
    }
    const prepared = draws[drawCount] ?? {
      geometry: draw.geometry,
      material: draw.material,
      uniforms: new Float32Array(64),
    };
    prepared.geometry = draw.geometry;
    prepared.material = draw.material;
    prepared.uniforms.fill(0);
    webgpu.writeUniforms(prepared.uniforms, draw.uniforms);
    draws[drawCount++] = prepared;
  });
  draws.length = drawCount;
  if (unsupported || !renderer.supports(draws)) {
    detail = 'scene contains a material without a WebGPU implementation';
    active = 'cpu';
    return false;
  }
  try {
    const rendered = renderer.render(target, draws, scene);
    active = rendered ? 'gpu' : 'cpu';
    return rendered;
  } catch (error) {
    state = 'unavailable';
    detail = errorMessage(error);
    active = 'cpu';
    notify();
    return false;
  }
}

export async function ensureWebGpuRenderer(): Promise<void> {
  if (renderer || loading || state === 'unavailable') return loading;
  state = 'loading';
  detail = undefined;
  notify();
  loading = (async () => {
    try {
      const { create } = await import('webgpu');
      const flags = process.env.ARCADE_WEBGPU_BACKEND ? [`backend=${process.env.ARCADE_WEBGPU_BACKEND}`] : [];
      const gpu = create(flags);
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('no WebGPU adapter was found');
      const device = await adapter.requestDevice({ label: 'arcade-webgpu' });
      renderer = new WebGpuSceneRenderer(device, gpu, notify);
      state = 'ready';
      detail = adapter.info?.description || adapter.info?.device || 'Dawn adapter ready';
      device.lost.then((lost) => {
        renderer = undefined;
        active = 'cpu';
        state = 'unavailable';
        detail = lost.message || `WebGPU device lost (${lost.reason})`;
        notify();
      });
    } catch (error) {
      state = 'unavailable';
      detail = errorMessage(error);
    } finally {
      loading = undefined;
      notify();
    }
  })();
  return loading;
}

export async function disposeWebGpuRenderer(): Promise<void> {
  await loading;
  const currentRenderer = renderer;
  renderer = undefined;
  if (currentRenderer) await currentRenderer.dispose();
  state = 'idle';
  active = 'cpu';
  detail = undefined;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
