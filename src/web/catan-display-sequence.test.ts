import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserCatanCinematic, catanDisplaySequence } from './browser-game-cinematics.ts';

test('Catan display study flows ASCII to hybrid to pixel and back to ASCII', () => {
  assert.deepEqual(catanDisplaySequence(0.7), { from: 'ascii', to: 'ascii', mix: 0 });
  assert.equal(catanDisplaySequence(0.79).to, 'hybrid');
  assert.equal(catanDisplaySequence(0.85).to, 'pixel');
  assert.equal(catanDisplaySequence(0.91).to, 'hybrid');
  assert.equal(catanDisplaySequence(0.97).to, 'ascii');
  assert.deepEqual(catanDisplaySequence(1), { from: 'hybrid', to: 'ascii', mix: 1 });
});

test('Catan dice and display-mode windows retain island coverage in every quadrant', () => {
  const scene = new BrowserCatanCinematic();
  for (const progress of [0.34, 0.4, 0.5, 0.6, 0.68, 0.78, 0.85, 0.91, 0.97, 1]) {
    const frame = scene.frame(120, 54, progress, 3);
    const quadrants = [0, 0, 0, 0];
    for (let y = 0; y < frame.rows; y++) for (let x = 0; x < frame.cols; x++) {
      const cell = frame.getCell(x, y);
      if (cell?.opaque && cell.ch !== ' ') quadrants[(y >= frame.rows / 2 ? 2 : 0) + (x >= frame.cols / 2 ? 1 : 0)]++;
    }
    assert.ok(quadrants.every((count) => count > 250), `progress ${progress} collapsed quadrants: ${quadrants.join(',')}`);
  }
});
