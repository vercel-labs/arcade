import assert from 'node:assert/strict';
import test from 'node:test';
import { islandersCinematicCamera } from '../cinematic/camera.ts';
import { BrowserIslandersCinematic, islandersDisplaySequence } from './browser-game-cinematics.ts';

test('Islanders display study flows ASCII to hybrid to pixel and back to ASCII', () => {
  assert.deepEqual(islandersDisplaySequence(0.7), { from: 'ascii', to: 'ascii', mix: 0 });
  assert.equal(islandersDisplaySequence(0.75).to, 'hybrid');
  assert.equal(islandersDisplaySequence(0.81).to, 'pixel');
  assert.equal(islandersDisplaySequence(0.87).to, 'hybrid');
  assert.equal(islandersDisplaySequence(0.93).to, 'ascii');
  assert.deepEqual(islandersDisplaySequence(0.96), { from: 'ascii', to: 'ascii', mix: 0 });
  assert.deepEqual(islandersDisplaySequence(1), { from: 'ascii', to: 'ascii', mix: 0 });
});

test('Islanders holds settled ASCII while the coast camera completes its final movement', () => {
  for (const progress of [0.96, 0.97, 0.98, 0.99, 1]) {
    assert.deepEqual(islandersDisplaySequence(progress), { from: 'ascii', to: 'ascii', mix: 0 });
  }
  const before = islandersCinematicCamera(0.96, 1.6);
  const after = islandersCinematicCamera(1, 1.6);
  assert.ok(after.azimuth - before.azimuth > 0.15, 'the final ASCII hold should retain a visible coast orbit');
  assert.ok(Math.hypot(after.target.x - before.target.x, after.target.z - before.target.z) > 0.15, 'the final ASCII hold should retain camera travel');
});

test('Islanders dice and display-mode windows retain island coverage in every quadrant', () => {
  const scene = new BrowserIslandersCinematic();
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
