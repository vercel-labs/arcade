import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { POKER_TABLE_ASSET_URLS, parsePokerTableMeshes } from '../game-visuals/poker/table.ts';
import { BrowserIslandersCinematic, BrowserPokerCinematic, islandersPortraitDiceScale } from './browser-game-cinematics.ts';

const table = parsePokerTableMeshes(
  readFileSync(new URL(POKER_TABLE_ASSET_URLS.table), 'utf8'),
  readFileSync(new URL(POKER_TABLE_ASSET_URLS.chair), 'utf8'),
);

test('browser Islanders shrinks dice only for narrow portrait framing', () => {
  assert.ok(islandersPortraitDiceScale(390 / 844) < 0.8);
  assert.equal(islandersPortraitDiceScale(0.8), 1);
  assert.equal(islandersPortraitDiceScale(844 / 390), 1);
  assert.equal(islandersPortraitDiceScale(16 / 9), 1);
});

test('production Poker table occupies the full desktop viewport without a dead top band', () => {
  const poker = new BrowserPokerCinematic({ table });
  for (const [cols, rows] of [[341, 90], [213, 60]] as const) {
    for (let step = 0; step <= 16; step++) {
      const frame = poker.frame(cols, rows, step / 20, 5, 0.5);
      const bounds = paintedBounds(frame);
      // The close card insert deliberately excludes distant chairs. Once the
      // pullback begins revealing seats, artwork must stay inside the header's
      // blur band rather than opening a visible dead strip beneath it.
      const headerBand = step < 16 ? 11 : Math.ceil(rows * 64 / 720);
      assert.ok(bounds.top <= headerBand, `Poker has no visible color beneath the header at ${cols}x${rows}, step ${step}: row ${bounds.top}`);
    }
  }
});

test('no Poker camera frame is dominated by one cinematic wisp', () => {
  const poker = new BrowserPokerCinematic({ table });
  for (let step = 0; step <= 80; step++) for (const time of [0, 0.4, 0.8, 1.2]) {
    const frame = poker.frame(160, 45, step / 80, time, 0.4);
    let painted = 0, green = 0;
    for (let y = 0; y < frame.rows; y++) for (let x = 0; x < frame.cols; x++) {
      const cell = frame.getCell(x, y);
      if (!cell || cell.ch === ' ') continue;
      painted++;
      const [r, g, b] = cell.fg;
      if (g > r * 1.35 && g > b * 1.08) green++;
    }
    assert.ok(green / Math.max(1, painted) < 0.55, `Poker frame ${step / 80} at t=${time} is ${green / painted} green`);
  }
});

test('Poker presentation preserves additive wisp pixels outside mesh depth bounds', () => {
  const poker = new BrowserPokerCinematic({ table });
  for (const [cols, rows] of [[341, 90], [213, 60]] as const) {
    const frame = poker.frame(cols, rows, 0.75, 0.4, 0.5);
    let blueAboveTable = 0;
    for (let y = 0; y < Math.ceil(rows * 0.1); y++) for (let x = 0; x < cols; x++) {
      const cell = frame.getCell(x, y);
      if (!cell || cell.ch === ' ') continue;
      const [r, g, b] = cell.fg;
      if (b > r * 1.35 && b > g * 1.18 && b > 55) blueAboveTable++;
    }
    assert.ok(blueAboveTable > 0, `Poker wisp cap was cropped at ${cols}x${rows}`);
  }
});

test('Islanders coast study keeps water painted across the bottom edge', () => {
  const islanders = new BrowserIslandersCinematic();
  for (const [cols, rows] of [[341, 90], [213, 60]] as const) {
    for (let step = 16; step <= 20; step++) {
      const frame = islanders.frame(cols, rows, step / 20, 5);
      let painted = 0;
      for (let x = 0; x < cols; x++) {
        const cell = frame.getCell(x, rows - 1);
        if (cell?.opaque && cell.ch !== ' ') painted++;
      }
      assert.ok(painted / cols >= 0.72, `Islanders bottom edge opened at ${cols}x${rows}, step ${step}: ${painted}/${cols}`);
    }
  }
});

function paintedBounds(frame: ReturnType<BrowserPokerCinematic['frame']>): { top: number } {
  let top = frame.rows;
  for (let y = 0; y < frame.rows; y++) {
    let visible = 0;
    for (let x = 0; x < frame.cols; x++) {
      const cell = frame.getCell(x, y);
      if (!cell?.opaque || cell.ch === ' ') continue;
      const luminance = cell.fg[0] * 0.2126 + cell.fg[1] * 0.7152 + cell.fg[2] * 0.0722;
      if (luminance >= 50) { top = Math.min(top, y); visible++; }
    }
  }
  return { top };
}
