// Stress camera poses through real Dawn readback and fail when scene geometry floods the
// background corners instead of preserving the scene's declared clear color.

import { mkdirSync, writeFileSync } from 'node:fs';
import { PokerGameScene, type PokerSeatView } from '../arcade/games/poker/poker-scene.ts';
import { TileScene } from '../arcade/games/catan/tile-scene.ts';
import {
  disposeWebGpuRenderer,
  ensureWebGpuRenderer,
  mulberry32,
  onRenderBackendChange,
  RenderTarget,
  renderBackendInfo,
  resetWebGpuStream,
  setRenderBackendPreference,
} from '../engine/index.ts';
import { HoldemState } from '../rules/poker/holdem.ts';

interface CameraScene {
  resetView(): void;
  orbit(dx: number, dy: number): void;
  zoomBy(factor: number): void;
  renderScene(target: RenderTarget, time: number): void;
}

interface StressCase {
  name: string;
  clear: readonly [number, number, number];
  create(): CameraScene;
}

const width = 360;
const height = 240;
const target = new RenderTarget(width, height);

try {
  setRenderBackendPreference('gpu');
  await ensureWebGpuRenderer();
  const initialized = renderBackendInfo();
  if (initialized.state !== 'ready') throw new Error(`WebGPU unavailable: ${initialized.detail ?? initialized.state}`);

  for (const stress of cases()) {
    const chained = stress.create();
    try {
      // First put opaque scene geometry over the top-left pixel, then restore the normal view.
      // The next frame must still clear from the scene's declared background, not from that prior
      // readback pixel.
      for (let step = 0; step < 6; step++) chained.zoomBy(0.72);
      chained.orbit(18, 0);
      await completedFrame(chained, target, 0);
      chained.resetView();
      await completedFrame(chained, target, 1 / 30);
      const chainedCorners = cornerAverages(target);
      const chainedBrown = chainedCorners.filter(isBrownFlood).length;
      if (chainedBrown >= 3) {
        const path = `.snapshots/gpu-background-${stress.name}-chained.ppm`;
        writePpm(target, path);
        throw new Error(
          `${stress.name} chained camera reset: ${chainedBrown}/4 corners flooded brown; ` +
          `${chainedCorners.map((corner) => `[${corner.map((value) => value.toFixed(1)).join(',')}]`).join(' ')}; ` +
          `preview ${path}`,
        );
      }
    } finally {
      resetWebGpuStream(chained);
    }

    for (let pose = 0; pose < 160; pose++) {
      const scene = stress.create();
      try {
        const turns = pose % 32;
        const elevationBand = Math.floor(pose / 32) - 2;
        scene.orbit(turns * 16, elevationBand * 12);
        const zoomSteps = Math.floor(pose / 16) % 5;
        for (let step = 0; step < zoomSteps; step++) scene.zoomBy(pose % 2 === 0 ? 0.72 : 1.38);
        await completedFrame(scene, target, pose / 30);
        const corners = cornerAverages(target);
        const brownCorners = corners.filter(isBrownFlood).length;
        if (brownCorners >= 3) {
          const path = `.snapshots/gpu-background-${stress.name}-${pose}.ppm`;
          writePpm(target, path);
          throw new Error(
            `${stress.name} pose ${pose}: ${brownCorners}/4 corners flooded brown; ` +
            `${corners.map((corner) => `[${corner.map((value) => value.toFixed(1)).join(',')}]`).join(' ')} ` +
            `expected ${stress.clear.join(',')}; preview ${path}`,
          );
        }
      } finally {
        resetWebGpuStream(scene);
      }
    }
    console.log(`${stress.name}: 160 camera poses preserved the clear background`);
  }
} finally {
  await disposeWebGpuRenderer();
}

function cases(): StressCase[] {
  return [
    {
      name: 'poker',
      clear: [6, 10, 8],
      create() {
        const scene = new PokerGameScene();
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
        return scene;
      },
    },
    {
      name: 'catan',
      clear: [14, 16, 22],
      create() {
        const scene = new TileScene();
        scene.setMode('board');
        scene.seedDemo();
        scene.settle();
        return scene;
      },
    },
  ];
}

async function completedFrame(scene: CameraScene, renderTarget: RenderTarget, time: number): Promise<void> {
  const pending = nextBackendFrame();
  scene.renderScene(renderTarget, time);
  await pending;
  // The completion render copies the ready pixels into the CPU target. An unchanged scene no
  // longer submits another frame, so there is intentionally no second callback to await.
  scene.renderScene(renderTarget, time);
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

function cornerAverages(renderTarget: RenderTarget): [number, number, number][] {
  const size = 12;
  const averages: [number, number, number][] = [];
  for (const y0 of [0, renderTarget.height - size]) {
    for (const x0 of [0, renderTarget.width - size]) {
      const sums: [number, number, number] = [0, 0, 0];
      let count = 0;
      for (let y = y0; y < y0 + size; y++) {
        for (let x = x0; x < x0 + size; x++) {
          const offset = (y * renderTarget.width + x) * 3;
          sums[0] += renderTarget.color[offset] ?? 0;
          sums[1] += renderTarget.color[offset + 1] ?? 0;
          sums[2] += renderTarget.color[offset + 2] ?? 0;
          count++;
        }
      }
      averages.push([sums[0] / count, sums[1] / count, sums[2] / count]);
    }
  }
  return averages;
}

function isBrownFlood(color: readonly number[]): boolean {
  const [r = 0, g = 0, b = 0] = color;
  return r > 35 && r > g * 1.25 && g > b * 1.2;
}

function writePpm(renderTarget: RenderTarget, path: string): void {
  mkdirSync('.snapshots', { recursive: true });
  const body = Buffer.alloc(renderTarget.width * renderTarget.height * 3);
  for (let index = 0; index < body.length; index++) {
    body[index] = Math.max(0, Math.min(255, Math.round(renderTarget.color[index] ?? 0)));
  }
  writeFileSync(path, Buffer.concat([Buffer.from(`P6\n${renderTarget.width} ${renderTarget.height}\n255\n`, 'ascii'), body]));
}
