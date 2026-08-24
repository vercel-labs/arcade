// Cross-scene CPU/WebGPU benchmark for the terminal renderer. Unlike gpu-bench.ts,
// this exercises both settled frames and continuously changing cameras at the same
// supersampled pixel resolutions used by the interactive app.

import { mkdirSync, writeFileSync } from 'node:fs';
import { CardsScene } from '../arcade/games/poker/cards-scene.ts';
import { PokerGameScene, type PokerSeatView } from '../arcade/games/poker/poker-scene.ts';
import { TileScene } from '../arcade/games/catan/tile-scene.ts';
import { ChessGameScene } from '../arcade/games/chess/scene.ts';
import { LogosScene } from '../arcade/scenes/logos-scene.ts';
import { CoverFlowScene } from '../arcade/shell/coverflow.ts';
import { supersampleForViewport } from '../arcade/render-quality.ts';
import type { RenderMode } from '../arcade/shell/bars.ts';
import {
  disposeWebGpuRenderer,
  CellDiffer,
  ensureWebGpuRenderer,
  mulberry32,
  onRenderBackendChange,
  RenderTarget,
  shapeGlyphToSurface,
  Surface,
  renderBackendInfo,
  renderBackendPreference,
  setRenderBackendPreference,
  tryRenderDrawListWithWebGpu,
} from '../engine/index.ts';
import { PrismScene } from '../prism/prism.ts';
import { HoldemState } from '../rules/poker/holdem.ts';

type Backend = 'cpu' | 'gpu';

interface Driver {
  render(target: RenderTarget, time: number, frame: number): void;
}

interface Scenario {
  name: string;
  create(): Driver;
}

interface Summary {
  median: number;
  p95: number;
  min: number;
  max: number;
}

interface Result {
  viewport: string;
  pixels: string;
  scenario: string;
  backend: Backend;
  total: Summary;
  presentation?: Summary;
  ansiBytes?: Summary;
  submit?: Summary;
  readback?: Summary;
  draws?: number;
  triangles?: number;
}

const frames = positiveInt(process.argv[2], 8);
const renderMode = parseRenderMode(process.argv[3]);
const viewports = [
  { cols: 100, rows: 32 },
  { cols: 160, rows: 55 },
  { cols: 240, rows: 80 },
  { cols: 320, rows: 100 },
];

const results: Result[] = [];

try {
  setRenderBackendPreference('gpu');
  await ensureWebGpuRenderer();
  const initialized = renderBackendInfo();
  if (initialized.state !== 'ready') throw new Error(`WebGPU unavailable: ${initialized.detail ?? initialized.state}`);
  console.log(`adapter: ${initialized.detail ?? 'unknown'}`);
  console.log(`display mode: ${renderMode}`);
  console.log(`samples: ${frames} measured frames per backend after 2 warmups`);

  for (const viewport of viewports) {
    const ss = supersampleForViewport(renderMode, viewport.cols, viewport.rows);
    const width = viewport.cols * ss;
    const height = viewport.rows * 2 * ss;
    console.log(`\n${viewport.cols}x${viewport.rows} terminal, SS${ss}, ${width}x${height} render target`);
    for (const scenario of scenarios()) {
      const cpu = await benchmark('cpu', scenario, width, height);
      const gpu = await benchmark('gpu', scenario, width, height);
      results.push(
        toResult(viewport, width, height, scenario.name, 'cpu', cpu),
        toResult(viewport, width, height, scenario.name, 'gpu', gpu),
      );
      const ratio = cpu.total.median / gpu.total.median;
      console.log(
        `${scenario.name.padEnd(18)} cpu ${format(cpu.total)}  gpu ${format(gpu.total)}  ${ratio.toFixed(2)}x` +
          (gpu.presentation ? `  cells ${gpu.presentation.median.toFixed(1)}ms / ${formatBytes(gpu.ansiBytes?.median ?? 0)}` : ''),
      );
    }
  }

  mkdirSync('.snapshots', { recursive: true });
  const outputPath = `.snapshots/gpu-suite-bench-${renderMode}.json`;
  writeFileSync(outputPath, `${JSON.stringify({ frames, renderMode, adapter: renderBackendInfo().detail, results }, null, 2)}\n`);
  console.log(`\nraw results: ${outputPath}`);
} finally {
  await disposeWebGpuRenderer();
}

function scenarios(): Scenario[] {
  return [
    catanScenario('catan-static', false),
    catanScenario('catan-motion', true),
    chessScenario('chess-static', false),
    chessScenario('chess-motion', true),
    cardsScenario('cards-static', false),
    cardsScenario('cards-motion', true),
    pokerScenario('poker-idle', false, false),
    pokerScenario('poker-idle-move', false, true),
    pokerScenario('poker-hand', true, false),
    pokerScenario('poker-hand-move', true, true),
    logosScenario(),
    coverFlowScenario(),
    prismScenario(),
  ];
}

function catanScenario(name: string, moving: boolean): Scenario {
  return {
    name,
    create() {
      const scene = new TileScene();
      scene.setMode('board');
      scene.seedDemo();
      scene.settle();
      return {
        render(target, time, frame) {
          if (moving) moveCamera(scene, frame);
          scene.requestAnimationFrame();
          scene.renderScene(target, time);
        },
      };
    },
  };
}

function chessScenario(name: string, moving: boolean): Scenario {
  return {
    name,
    create() {
      const scene = new ChessGameScene();
      return {
        render(target, time, frame) {
          if (moving) moveCamera(scene, frame);
          scene.renderScene(target, time);
        },
      };
    },
  };
}

function cardsScenario(name: string, moving: boolean): Scenario {
  return {
    name,
    create() {
      const scene = new CardsScene();
      scene.setMode('hand');
      scene.setHovered(0);
      return {
        render(target, time, frame) {
          if (moving) moveCamera(scene, frame);
          scene.renderScene(target, time);
        },
      };
    },
  };
}

function pokerScenario(name: string, hand: boolean, moving: boolean): Scenario {
  return {
    name,
    create() {
      const scene = new PokerGameScene();
      if (hand) {
        const seats: PokerSeatView[] = [
          { kind: 'human', label: 'You' },
          { kind: 'ai', label: 'GPU' },
          { kind: 'ai', label: 'CPU' },
        ];
        scene.beginSession(seats);
        scene.beginHand(new HoldemState({
          stacks: seats.map(() => 1_000),
          button: 0,
          smallBlind: 10,
          bigBlind: 20,
          rng: mulberry32(0x90ce7),
        }));
      }
      return {
        render(target, time, frame) {
          if (moving) moveCamera(scene, frame);
          scene.renderScene(target, time);
        },
      };
    },
  };
}

function logosScenario(): Scenario {
  return {
    name: 'logos-animated',
    create() {
      const scene = new LogosScene();
      return { render: (target, time, frame) => {
        moveCamera(scene, frame);
        scene.renderScene(target, time);
      } };
    },
  };
}

function coverFlowScenario(): Scenario {
  return {
    name: 'coverflow-move',
    create() {
      const scene = new CoverFlowScene();
      return { render: (target, time) => scene.renderScene(target, 1.2 + Math.sin(time * 2.5) * 0.55, 1) };
    },
  };
}

function prismScenario(): Scenario {
  return {
    name: 'prism-animated',
    create() {
      const gpu = { enabled: () => renderBackendPreference() !== 'cpu', render: tryRenderDrawListWithWebGpu };
      const scene = new PrismScene(gpu);
      return { render: (target, time) => scene.renderScene(target, 0.8 + time) };
    },
  };
}

function moveCamera(scene: { orbit(dx: number, dy: number): void; zoomBy(factor: number): void }, frame: number): void {
  scene.orbit(0.026, frame % 2 === 0 ? 0.004 : -0.003);
  scene.zoomBy(frame % 4 < 2 ? 0.994 : 1.006);
}

async function benchmark(backend: Backend, scenario: Scenario, width: number, height: number): Promise<{
  total: Summary;
  presentation?: Summary;
  ansiBytes?: Summary;
  submit?: Summary;
  readback?: Summary;
  draws?: number;
  triangles?: number;
}> {
  setRenderBackendPreference(backend);
  const driver = scenario.create();
  const target = new RenderTarget(width, height);
  const termCols = renderMode === 'ascii' || renderMode === 'hybrid' ? Math.round(width / 3) : 0;
  const termRows = renderMode === 'ascii' || renderMode === 'hybrid' ? Math.round(height / 6) : 0;
  const surface = termCols > 0 && termRows > 0 ? new Surface(termCols, termRows) : null;
  const differ = surface ? new CellDiffer() : null;
  let time = 0;
  for (let frame = 0; frame < 2; frame++) {
    if (backend === 'gpu') {
      await renderAndAwaitSubmission(() => driver.render(target, time, frame));
    } else driver.render(target, time, frame);
    time += 1 / 30;
  }

  const totals: number[] = [];
  const presentations: number[] = [];
  const ansiBytes: number[] = [];
  const submits: number[] = [];
  const readbacks: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const started = performance.now();
    const pending = backend === 'gpu'
      ? renderAndAwaitSubmission(() => driver.render(target, time, frame + 2))
      : null;
    if (!pending) driver.render(target, time, frame + 2);
    if (surface && differ) {
      const presentStarted = performance.now();
      surface.clear();
      shapeGlyphToSurface(surface, target, termCols, termRows, {
        color: true,
        hybrid: renderMode === 'hybrid',
        coloredBackground: renderMode === 'hybrid',
      });
      const ansi = differ.diff(surface);
      presentations.push(performance.now() - presentStarted);
      ansiBytes.push(Buffer.byteLength(ansi));
    }
    if (pending) await pending;
    totals.push(performance.now() - started);
    const stats = renderBackendInfo().stats;
    if (backend === 'gpu' && stats) {
      submits.push(stats.submitMs);
      readbacks.push(stats.readbackMs);
    }
    time += 1 / 30;
  }
  const stats = renderBackendInfo().stats;
  return {
    total: summarize(totals),
    presentation: presentations.length ? summarize(presentations) : undefined,
    ansiBytes: ansiBytes.length ? summarize(ansiBytes) : undefined,
    submit: submits.length ? summarize(submits) : undefined,
    readback: readbacks.length ? summarize(readbacks) : undefined,
    draws: backend === 'gpu' ? stats?.draws : undefined,
    triangles: backend === 'gpu' ? stats?.triangles : undefined,
  };
}

function nextBackendFrame(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('timed out waiting for a WebGPU readback'));
    }, 10_000);
    const unsubscribe = onRenderBackendChange(() => {
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
}

async function renderAndAwaitSubmission(render: () => void): Promise<void> {
  const before = renderBackendInfo().stats?.submissions ?? 0;
  let unsubscribe = () => {};
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const completed = new Promise<void>((resolve, reject) => {
    timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('timed out waiting for a WebGPU readback'));
    }, 10_000);
    unsubscribe = onRenderBackendChange(() => {
      if (timeout) clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
  render();
  const after = renderBackendInfo().stats?.submissions ?? 0;
  if (after === before) {
    if (timeout) clearTimeout(timeout);
    unsubscribe();
    return;
  }
  await completed;
}

function summarize(values: number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
  };
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? 0;
}

function format(summary: Summary): string {
  return `${summary.median.toFixed(1)}ms med / ${summary.p95.toFixed(1)} p95`;
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MiB` : `${Math.round(bytes / 1024)}KiB`;
}

function toResult(
  viewport: { cols: number; rows: number },
  width: number,
  height: number,
  scenario: string,
  backend: Backend,
  result: Awaited<ReturnType<typeof benchmark>>,
): Result {
  return {
    viewport: `${viewport.cols}x${viewport.rows}`,
    pixels: `${width}x${height}`,
    scenario,
    backend,
    ...result,
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRenderMode(value: string | undefined): RenderMode {
  return value === 'pixels' || value === 'hybrid' ? value : 'ascii';
}
