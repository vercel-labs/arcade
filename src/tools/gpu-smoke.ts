// Exercise every game-facing WebGPU integration with real Dawn readback. These are deliberately
// multi-frame checks: the first render submits asynchronously and may use the canonical CPU
// fallback, while the second consumes the completed GPU frame and composites CPU overlays.

import { mkdirSync, writeFileSync } from 'node:fs';
import { CardsScene } from '../arcade/games/poker/cards-scene.ts';
import { PokerGameScene, type PokerSeatView } from '../arcade/games/poker/poker-scene.ts';
import { TileScene } from '../arcade/games/catan/tile-scene.ts';
import { ChessGameScene } from '../arcade/games/chess/scene.ts';
import {
  disposeWebGpuRenderer,
  ensureWebGpuRenderer,
  mulberry32,
  onRenderBackendChange,
  RenderTarget,
  renderBackendInfo,
  setRenderBackendPreference,
} from '../engine/index.ts';
import { HoldemState } from '../rules/poker/holdem.ts';

const cols = positiveInt(process.argv[2], 140);
const rows = positiveInt(process.argv[3], 50);
const targetWidth = cols;
const targetHeight = rows * 2;

interface Case {
  name: string;
  render(target: RenderTarget, time: number): void;
}

try {
  setRenderBackendPreference('gpu');
  await ensureWebGpuRenderer();
  const initialized = renderBackendInfo();
  if (initialized.state !== 'ready') throw new Error(`WebGPU unavailable: ${initialized.detail ?? initialized.state}`);

  const cases = smokeCases();
  mkdirSync('.snapshots/gpu-smoke', { recursive: true });
  for (const smoke of cases) {
    const target = new RenderTarget(targetWidth, targetHeight);
    await renderGpuFrame(smoke, target);
    assertVisible(target, smoke.name);
    writePpm(target, `.snapshots/gpu-smoke/${smoke.name}.ppm`);
    const info = renderBackendInfo();
    if (info.active !== 'gpu') throw new Error(`${smoke.name}: expected GPU base, got ${info.active}: ${info.detail ?? 'no detail'}`);
    console.log(`${smoke.name.padEnd(18)} gpu  ${info.stats?.draws ?? 0} draws  ${info.stats?.triangles ?? 0} triangles`);
  }
  console.log(`adapter            ${renderBackendInfo().detail ?? 'unknown'}`);
  console.log(`previews           .snapshots/gpu-smoke/*.ppm`);
} finally {
  await disposeWebGpuRenderer();
}

function smokeCases(): Case[] {
  const chess = new ChessGameScene();

  const cardsHand = new CardsScene();
  cardsHand.setMode('hand');
  cardsHand.setHovered(0);

  const cardsDeck = new CardsScene();
  cardsDeck.setMode('deck');
  cardsDeck.deal();

  const poker = new PokerGameScene();
  const seats: PokerSeatView[] = [
    { kind: 'human', label: 'You' },
    { kind: 'ai', label: 'GPU opponent' },
    { kind: 'ai', label: 'CPU opponent' },
  ];
  poker.beginSession(seats);
  poker.beginHand(new HoldemState({
    stacks: seats.map(() => 1_000),
    button: 0,
    smallBlind: 10,
    bigBlind: 20,
    rng: mulberry32(0x90ce7),
  }));

  const catanBoard = new TileScene();
  catanBoard.setMode('board');
  catanBoard.seedDemo();
  catanBoard.settle();
  catanBoard.rollDice([3, 4]);
  let catanDicePrimed = false;

  const catanPieces = new TileScene();
  catanPieces.setMode('pieces');

  const catanPort = new TileScene();
  catanPort.setMode('port');

  return [
    { name: 'chess-board', render: (target, time) => chess.renderScene(target, time) },
    { name: 'cards-hand', render: (target, time) => cardsHand.renderScene(target, time) },
    { name: 'cards-deck', render: (target, time) => cardsDeck.renderScene(target, time) },
    { name: 'poker-hand', render: (target, time) => poker.renderScene(target, time) },
    {
      name: 'catan-dice',
      render: (target, time) => {
        // Advance the animation clock into the visible tumble before validating the completed
        // GPU board readback plus the CPU dice overlay.
        if (!catanDicePrimed) {
          for (let frame = 1; frame <= 39; frame++) catanBoard.renderScene(target, frame / 60);
          catanDicePrimed = true;
        }
        catanBoard.renderScene(target, 0.65 + time);
      },
    },
    { name: 'catan-pieces', render: (target, time) => catanPieces.renderScene(target, time) },
    { name: 'catan-port', render: (target, time) => catanPort.renderScene(target, time) },
  ];
}

async function renderGpuFrame(smoke: Case, target: RenderTarget): Promise<void> {
  let time = 0.05;
  // Switching scenes resets the readback ring. Wait for a completed submission, then render
  // again to copy it into the terminal-facing CPU target and draw that scene's CPU overlays.
  for (let attempt = 0; attempt < 3; attempt++) {
    const pending = nextBackendFrame();
    smoke.render(target, time);
    await pending;
    time += 1 / 30;
    smoke.render(target, time);
    if (renderBackendInfo().active === 'gpu') return;
  }
  throw new Error(`${smoke.name}: GPU frame never became active`);
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

function assertVisible(target: RenderTarget, name: string): void {
  let nonBackground = 0;
  const r0 = target.color[0] ?? 0;
  const g0 = target.color[1] ?? 0;
  const b0 = target.color[2] ?? 0;
  for (let pixel = 0; pixel < target.depth.length; pixel++) {
    const offset = pixel * 3;
    if (
      Math.abs((target.color[offset] ?? 0) - r0) > 2 ||
      Math.abs((target.color[offset + 1] ?? 0) - g0) > 2 ||
      Math.abs((target.color[offset + 2] ?? 0) - b0) > 2
    ) nonBackground++;
  }
  if (nonBackground < target.depth.length * 0.01) throw new Error(`${name}: rendered frame is blank`);
}

function writePpm(target: RenderTarget, path: string): void {
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
