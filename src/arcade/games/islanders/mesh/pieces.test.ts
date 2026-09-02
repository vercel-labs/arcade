import assert from 'node:assert/strict';
import test from 'node:test';
import { boardOverlayMesh, type OverlaySpec } from './pieces.ts';

function overlay(lift = 0): OverlaySpec {
  return {
    buildings: [{ x: 1, z: 2, city: false, color: 'red', hot: false, lift }],
    roads: [],
    ghostSettlement: null,
    ghostRoad: null,
    hoverColor: [228, 157, 151],
  };
}

test('stable board overlays reuse their retained procedural geometry', () => {
  assert.equal(boardOverlayMesh(overlay()), boardOverlayMesh(overlay()));
});

test('animated board overlays bypass the retained-state cache', () => {
  assert.notEqual(boardOverlayMesh(overlay(0.2)), boardOverlayMesh(overlay(0.2)));
});
