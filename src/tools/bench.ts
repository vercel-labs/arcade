// Headless benchmark for the real Arcade render -> Surface -> diff pipeline.
// It intentionally avoids a TTY, making mode/scene comparisons reproducible:
//
//   pnpm bench [scene|all] [cols] [rows] [frames] [mode|all]
//
// Examples:
//   pnpm bench all 140 50 60 all
//   pnpm bench catan 200 60 100 pixels
//   pnpm bench catan-dice 700 210 35 pixels

import {
  applyTerminalColorMode,
  CellDiffer,
  downsample,
  halfBlockLayerToSurface,
  halfBlockToSurface,
  mulberry32,
  RenderTarget,
  shapeGlyphToSurface,
  shapeGlyphLayerToSurface,
  ShapeGlyphSurfaceCache,
  Surface,
} from '../engine/index.ts';
import { PrismScene } from '../prism/index.ts';
import { ChessGameScene } from '../arcade/games/chess/scene.ts';
import { PokerGameScene, type PokerSeatView } from '../arcade/games/poker/poker-scene.ts';
import { TileScene } from '../arcade/games/catan/tile-scene.ts';
import { LogosScene } from '../arcade/scenes/logos-scene.ts';
import { supersampleForViewport } from '../arcade/render-quality.ts';
import { HoldemState } from '../rules/poker/holdem.ts';

type BenchMode = 'ascii' | 'pixels' | 'hybrid';
type BenchScene = 'prism' | 'logos' | 'chess' | 'poker-idle' | 'poker-hand' | 'catan' | 'catan-dice';

interface SceneDriver {
  render(target: RenderTarget, t: number): void;
  hasForeground?(): boolean;
}

interface Stat {
  samples: number[];
}

const ALL_SCENES: BenchScene[] = ['prism', 'logos', 'chess', 'poker-idle', 'poker-hand', 'catan'];
const BENCH_SCENES: BenchScene[] = [...ALL_SCENES, 'catan-dice'];
const ALL_MODES: BenchMode[] = ['ascii', 'pixels', 'hybrid'];
const sceneArg = process.argv[2] ?? 'all';
const cols = positiveInt(process.argv[3], 140);
const rows = positiveInt(process.argv[4], 50);
const frames = positiveInt(process.argv[5], 60);
const modeArg = process.argv[6] ?? 'all';

const scenes = sceneArg === 'all' ? ALL_SCENES : [parseChoice(sceneArg, BENCH_SCENES, 'scene')];
const modes = modeArg === 'all' ? ALL_MODES : [parseChoice(modeArg, ALL_MODES, 'mode')];

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseChoice<T extends string>(value: string, choices: readonly T[], label: string): T {
  if ((choices as readonly string[]).includes(value)) return value as T;
  throw new Error(`unknown ${label} "${value}"; expected ${choices.join(', ')}, or all`);
}

function stat(): Stat {
  return { samples: [] };
}

function timed<T>(s: Stat, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  s.samples.push(performance.now() - start);
  return result;
}

function percentile(s: Stat, p: number): number {
  const sorted = [...s.samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

function median(s: Stat): number {
  return percentile(s, 0.5);
}

function formatStat(label: string, s: Stat): string {
  const mean = s.samples.reduce((sum, sample) => sum + sample, 0) / Math.max(1, s.samples.length);
  return `${label.padEnd(12)} ${median(s).toFixed(2)}ms med  ${mean.toFixed(2)}ms mean  ${percentile(s, 0.95).toFixed(2)}ms p95`;
}

function pokerSeats(): PokerSeatView[] {
  return [
    { kind: 'human', label: 'You' },
    { kind: 'ai', label: 'AI 2' },
    { kind: 'ai', label: 'AI 3' },
    { kind: 'ai', label: 'AI 4' },
  ];
}

function createScene(name: BenchScene): SceneDriver {
  if (name === 'prism') {
    const scene = new PrismScene();
    return { render: (target, t) => scene.renderScene(target, t) };
  }
  if (name === 'logos') {
    const scene = new LogosScene();
    return { render: (target, t) => scene.renderScene(target, t) };
  }
  if (name === 'chess') {
    const scene = new ChessGameScene();
    return { render: (target, t) => scene.renderScene(target, t) };
  }
  if (name === 'poker-idle') {
    const scene = new PokerGameScene();
    return { render: (target, t) => scene.renderScene(target, t) };
  }
  if (name === 'poker-hand') {
    const scene = new PokerGameScene();
    const seats = pokerSeats();
    scene.beginSession(seats);
    scene.beginHand(new HoldemState({
      stacks: seats.map(() => 1_000),
      button: 0,
      smallBlind: 10,
      bigBlind: 20,
      rng: mulberry32(0x90ce7),
    }));
    return { render: (target, t) => scene.renderScene(target, t) };
  }
  const scene = new TileScene();
  scene.setMode('board');
  scene.seedDemo();
  scene.settle();
  if (name === 'catan-dice') scene.rollDice();
  return {
    render: (target, t) => scene.renderScene(target, t),
    hasForeground: name === 'catan-dice' ? () => scene.hasForegroundSceneLayer() : undefined,
  };
}

function run(name: BenchScene, mode: BenchMode): void {
  const ss = supersampleForViewport(mode, cols, rows);
  const target = new RenderTarget(cols * ss, rows * 2 * ss);
  const scene = createScene(name);
  const surface = new Surface(cols, rows);
  const differ = new CellDiffer();
  const catanScene = name === 'catan' || name === 'catan-dice';
  const glyphCache = catanScene ? new ShapeGlyphSurfaceCache() : undefined;
  const render = stat();
  const present = stat();
  const diff = stat();
  const ansi256 = stat();
  const total = stat();
  let display: RenderTarget | undefined;
  let bytes = 0;
  let sink = 0;

  const frame = (index: number, measured: boolean): void => {
    const start = performance.now();
    const t = index / 30;
    if (measured) timed(render, () => scene.render(target, t));
    else scene.render(target, t);

    surface.clear();
    if (measured) {
      timed(present, () => {
        if (mode === 'pixels') {
          display = downsample(target, ss, display);
          halfBlockToSurface(surface, display);
          if (scene.hasForeground?.() && display) {
            halfBlockLayerToSurface(surface, display);
          }
        } else {
          shapeGlyphToSurface(
            surface,
            target,
            cols,
            rows,
            {
              coloredBackground: mode === 'hybrid',
              blankOutsideDepthBounds: catanScene && !scene.hasForeground?.(),
            },
            0,
            0,
            glyphCache,
          );
          if (scene.hasForeground?.()) {
            shapeGlyphLayerToSurface(
              surface,
              target,
              cols,
              rows,
              { coloredBackground: mode === 'hybrid' },
            );
          }
        }
      });
    } else if (mode === 'pixels') {
      display = downsample(target, ss, display);
      halfBlockToSurface(surface, display);
      if (scene.hasForeground?.() && display) {
        halfBlockLayerToSurface(surface, display);
      }
    } else {
      shapeGlyphToSurface(
        surface,
        target,
        cols,
        rows,
        {
          coloredBackground: mode === 'hybrid',
          blankOutsideDepthBounds: catanScene && !scene.hasForeground?.(),
        },
        0,
        0,
        glyphCache,
      );
      if (scene.hasForeground?.()) {
        shapeGlyphLayerToSurface(
          surface,
          target,
          cols,
          rows,
          { coloredBackground: mode === 'hybrid' },
        );
      }
    }

    const output = measured ? timed(diff, () => differ.diff(surface)) : differ.diff(surface);
    if (measured) {
      const converted = timed(ansi256, () => applyTerminalColorMode(output, '256-color'));
      bytes = output.length;
      sink += converted.length;
      total.samples.push(performance.now() - start);
    }
  };

  for (let i = 0; i < 10; i++) frame(i, false);
  differ.reset();
  for (let i = 0; i < frames; i++) frame(i + 10, true);

  const med = median(total);
  console.log(`\n${name} / ${mode} @ ${cols}x${rows}  RT ${target.width}x${target.height}  SS${ss}`);
  console.log(formatStat('render', render));
  console.log(formatStat('present', present));
  console.log(formatStat('diff', diff));
  console.log(formatStat('256-color', ansi256));
  console.log(`${formatStat('frame', total)}  ${(1000 / med).toFixed(0)} fps headroom  ${(bytes / 1024).toFixed(1)} KiB last diff`);
  if (sink < 0) console.log(sink);
}

console.log(`Arcade render benchmark: ${frames} measured frames after 10 warmup frames`);
for (const scene of scenes) for (const mode of modes) run(scene, mode);
