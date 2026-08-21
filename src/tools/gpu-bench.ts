// Compare the same settled Catan scene through the canonical CPU rasterizer and the optional
// Dawn/WebGPU backend. GPU totals include asynchronous readback; submit/readback are also shown
// separately so a fast queue submission is not mistaken for a complete terminal-ready frame.

import { mkdirSync, writeFileSync } from 'node:fs';
import {
  disposeWebGpuRenderer,
  ensureWebGpuRenderer,
  onRenderBackendChange,
  RenderTarget,
  renderBackendInfo,
  setRenderBackendPreference,
} from '../engine/index.ts';
import { TileScene } from '../arcade/games/catan/tile-scene.ts';

const cols = positiveInt(process.argv[2], 140);
const rows = positiveInt(process.argv[3], 50);
const frames = positiveInt(process.argv[4], 30);
const width = cols;
const height = rows * 2;

try {
  const cpu = benchmarkCpu();
  const gpu = await benchmarkGpu();
  console.log(`Catan renderer comparison @ ${cols}x${rows} (${width}x${height} pixels), ${frames} frames`);
  console.log(`cpu total       ${format(cpu)}`);
  console.log(`gpu total       ${format(gpu.total)}`);
  console.log(`gpu submit      ${format(gpu.submit)}`);
  console.log(`gpu readback    ${format(gpu.readback)}`);
  console.log(`gpu scene       ${gpu.draws} draws, ${gpu.triangles} triangles`);
  console.log(`gpu adapter     ${gpu.detail}`);
  console.log(`preview         .snapshots/catan-gpu.ppm`);
} finally {
  await disposeWebGpuRenderer();
}

function benchmarkCpu(): number[] {
  setRenderBackendPreference('cpu');
  const scene = settledScene();
  const target = new RenderTarget(width, height);
  for (let index = 0; index < 5; index++) scene.renderScene(target, index / 30);
  const samples: number[] = [];
  for (let index = 0; index < frames; index++) {
    scene.requestAnimationFrame();
    const started = performance.now();
    scene.renderScene(target, (index + 5) / 30);
    samples.push(performance.now() - started);
  }
  writePpm(target, '.snapshots/catan-cpu.ppm');
  return samples;
}

async function benchmarkGpu(): Promise<{
  total: number[];
  submit: number[];
  readback: number[];
  draws: number;
  triangles: number;
  detail: string;
}> {
  setRenderBackendPreference('gpu');
  await ensureWebGpuRenderer();
  const initialized = renderBackendInfo();
  if (initialized.state !== 'ready') throw new Error(`WebGPU unavailable: ${initialized.detail ?? initialized.state}`);

  const scene = settledScene();
  const target = new RenderTarget(width, height);
  let pending = nextBackendFrame();
  scene.renderScene(target, 0);
  await pending;

  const total: number[] = [];
  const submit: number[] = [];
  const readback: number[] = [];
  for (let index = 0; index < frames; index++) {
    scene.requestAnimationFrame();
    pending = nextBackendFrame();
    const started = performance.now();
    scene.renderScene(target, (index + 1) / 30);
    await pending;
    total.push(performance.now() - started);
    const stats = renderBackendInfo().stats;
    if (stats) {
      submit.push(stats.submitMs);
      readback.push(stats.readbackMs);
    }
  }
  // Consume the last completed readback into the CPU RenderTarget used by the preview.
  scene.renderScene(target, (frames + 1) / 30);
  writePpm(target, '.snapshots/catan-gpu.ppm');
  const info = renderBackendInfo();
  return {
    total,
    submit,
    readback,
    draws: info.stats?.draws ?? 0,
    triangles: info.stats?.triangles ?? 0,
    detail: info.detail ?? 'unknown',
  };
}

function settledScene(): TileScene {
  const scene = new TileScene();
  scene.setMode('board');
  scene.seedDemo();
  scene.settle();
  return scene;
}

function nextBackendFrame(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('timed out waiting for a WebGPU readback'));
    }, 5_000);
    const unsubscribe = onRenderBackendChange(() => {
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
}

function writePpm(target: RenderTarget, path: string): void {
  mkdirSync('.snapshots', { recursive: true });
  const body = Buffer.alloc(target.width * target.height * 3);
  for (let index = 0; index < body.length; index++) {
    body[index] = Math.max(0, Math.min(255, Math.round(target.color[index] ?? 0)));
  }
  writeFileSync(path, Buffer.concat([Buffer.from(`P6\n${target.width} ${target.height}\n255\n`, 'ascii'), body]));
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function format(samples: number[]): string {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  return `${median.toFixed(2)}ms med  ${p95.toFixed(2)}ms p95`;
}
