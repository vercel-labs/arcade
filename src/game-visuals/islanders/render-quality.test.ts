import assert from 'node:assert/strict';
import test from 'node:test';
import {
  islandersWaterLayerScale,
  ISLANDERS_WATER_BUILD_LAYER_SCALE,
  ISLANDERS_WATER_LAYER_MIN_HEIGHT,
  ISLANDERS_WATER_LAYER_MIN_WIDTH,
  ISLANDERS_WATER_SETTLED_LAYER_SCALE,
} from './render-quality.ts';

test('Islanders water uses the same direct and layered quality thresholds in every host', () => {
  assert.equal(islandersWaterLayerScale(ISLANDERS_WATER_LAYER_MIN_WIDTH - 1, ISLANDERS_WATER_LAYER_MIN_HEIGHT, true), null);
  assert.equal(islandersWaterLayerScale(ISLANDERS_WATER_LAYER_MIN_WIDTH, ISLANDERS_WATER_LAYER_MIN_HEIGHT - 1, false), null);
  assert.equal(islandersWaterLayerScale(ISLANDERS_WATER_LAYER_MIN_WIDTH, ISLANDERS_WATER_LAYER_MIN_HEIGHT, true), ISLANDERS_WATER_BUILD_LAYER_SCALE);
  assert.equal(islandersWaterLayerScale(ISLANDERS_WATER_LAYER_MIN_WIDTH, ISLANDERS_WATER_LAYER_MIN_HEIGHT, false), ISLANDERS_WATER_SETTLED_LAYER_SCALE);
});
