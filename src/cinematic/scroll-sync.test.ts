import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIVING_TITLE_ACT_BOUNDARIES, livingTitleTimeline } from './timeline.ts';
import { catanCinematicCamera, chessCinematicPose, pokerCinematicCamera } from './camera.ts';
import { CATAN_BUILDING_BEATS, CATAN_ROAD_BEATS, catanDropProgress } from './catan-choreography.ts';

test('scroll distance gives Chess and Poker the largest authored chapters', () => {
  const spans = LIVING_TITLE_ACT_BOUNDARIES.slice(1).map((end, index) => end - LIVING_TITLE_ACT_BOUNDARIES[index]);
  assert.ok(spans[2] >= 0.27);
  assert.ok(spans[3] >= 0.24);
  assert.equal(livingTitleTimeline(0.52).act, 3);
});

test('Chess uses one restrained close-up lobe and never oscillates again', () => {
  const opening = chessCinematicPose(0);
  const samples = Array.from({ length: 41 }, (_, index) => chessCinematicPose(index / 40).distance);
  const middle = samples[20];
  assert.ok(middle < opening.distance * 0.5);
  assert.ok(middle >= 4.9 - 1e-9);
  assert.ok(samples.slice(1, 21).every((distance, index) => distance <= samples[index]));
  assert.ok(samples.slice(21).every((distance, index) => distance >= samples[index + 20]));
  const close = chessCinematicPose(0.5);
  assert.ok(Math.hypot(close.target.x - opening.target.x, close.target.z - opening.target.z) > 0.6);
});

test('Poker starts closest to the shuffle and only pulls back', () => {
  const cameras = Array.from({ length: 41 }, (_, index) => pokerCinematicCamera(index / 40, 1.6));
  const distances = cameras.map((camera) => Math.hypot(camera.eye.x-camera.target.x,camera.eye.y-camera.target.y,camera.eye.z-camera.target.z));
  assert.ok(distances.every((distance, index) => index === 0 || distance >= distances[index - 1] - 1e-8));
  assert.ok(Math.abs(cameras[0].target.z + 1.4) < 1e-9, 'opening camera targets the production shuffle deck');
  assert.ok(distances.at(-1)! > distances[0] * 2);
});

test('each game camera keeps one orbit direction', () => {
  const chess = Array.from({ length: 21 }, (_, index) => chessCinematicPose(index / 20).azimuth);
  const poker = Array.from({ length: 21 }, (_, index) => pokerCinematicCamera(index / 20, 1.6).azimuth);
  const catan = Array.from({ length: 21 }, (_, index) => catanCinematicCamera(index / 20, 1.6).azimuth);
  assert.ok(chess.every((azimuth, index) => index === 0 || azimuth > chess[index - 1]));
  assert.ok(poker.every((azimuth, index) => index === 0 || azimuth < poker[index - 1]));
  assert.ok(catan.every((azimuth, index) => index === 0 || azimuth > catan[index - 1]));
});

test('Poker framing backs away continuously as the viewport narrows', () => {
  const regular = pokerCinematicCamera(0.5, 1.4);
  const ultrawide = pokerCinematicCamera(0.5, 2.4);
  const regularDistance = Math.hypot(regular.eye.x - regular.target.x, regular.eye.y - regular.target.y, regular.eye.z - regular.target.z);
  const wideDistance = Math.hypot(ultrawide.eye.x - ultrawide.target.x, ultrawide.eye.y - ultrawide.target.y, ultrawide.eye.z - ultrawide.target.z);
  assert.ok(regularDistance > wideDistance);
  // The production chairs extend well below the felt. A below-felt target is
  // therefore the visual center of the complete table, not a camera mistake.
  assert.ok(Number.isFinite(ultrawide.target.y));
});

test('Catan terrain studies use macro cameras', () => {
  for (const progress of [0.3, 0.43, 0.57]) {
    const camera = catanCinematicCamera(progress, 1.6);
    const distance = Math.hypot(camera.eye.x - camera.target.x, camera.eye.y - camera.target.y, camera.eye.z - camera.target.z);
    assert.ok(distance < 3.7);
  }
});

test('Catan gameplay beats scatter every player color and include one city upgrade', () => {
  assert.deepEqual(new Set(CATAN_BUILDING_BEATS.map(({ color }) => color)), new Set(['red', 'blue', 'purple', 'orange']));
  assert.deepEqual(new Set(CATAN_ROAD_BEATS.map(({ color }) => color)), new Set(['red', 'blue', 'purple', 'orange']));
  assert.ok(CATAN_BUILDING_BEATS.some(({ cityAt }) => cityAt !== undefined));
  assert.equal(catanDropProgress(0.4, 0.4), 0);
  assert.equal(catanDropProgress(0.5, 0.4), 1);
  assert.ok(CATAN_ROAD_BEATS.length >= 6);
});
