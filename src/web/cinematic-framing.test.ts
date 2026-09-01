import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { POKER_TABLE_ASSET_URLS, parsePokerTableMeshes } from '../game-visuals/poker/table.ts';
import { BrowserPokerCinematic } from './browser-game-cinematics.ts';

const table = parsePokerTableMeshes(
  readFileSync(new URL(POKER_TABLE_ASSET_URLS.table), 'utf8'),
  readFileSync(new URL(POKER_TABLE_ASSET_URLS.chair), 'utf8'),
);

test('production Poker table occupies the full desktop viewport without a dead top band', () => {
  const poker = new BrowserPokerCinematic({ table });
  for (const [cols, rows] of [[341, 90], [213, 60]] as const) {
    for (let step = 0; step <= 16; step++) {
      const frame = poker.frame(cols, rows, step / 20, 5, 0.5);
      const bounds = paintedBounds(frame);
      assert.ok(bounds.top / rows <= 0.1, `Poker has no visible color beneath the header at ${cols}x${rows}, step ${step}: row ${bounds.top}`);
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
