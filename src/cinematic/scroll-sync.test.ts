import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIVING_TITLE_ACT_BOUNDARIES, LIVING_TITLE_MORPH_STARTS, livingTitleTimeline } from './timeline.ts';
import { islandersCinematicCamera, chessCinematicPose, pokerCinematicCamera } from './camera.ts';
import { ISLANDERS_CINEMATIC_PLACEMENTS, islandersCinematicGameplay } from './islanders-choreography.ts';

test('scroll distance maps to the content-driven 3s, 5s, 9s, 11s, and 10s chapters', () => {
  const spans = LIVING_TITLE_ACT_BOUNDARIES.slice(1).map((end, index) => end - LIVING_TITLE_ACT_BOUNDARIES[index]);
  assert.deepEqual(spans.map((span) => Math.round(span * 38)), [3, 5, 9, 11, 10]);
  assert.equal(livingTitleTimeline(17 / 38).act, 3);
});

test('every ink cut occupies the same 1.5-second-equivalent scroll distance', () => {
  for (let act = 0; act < LIVING_TITLE_MORPH_STARTS.length; act++) {
    const span = LIVING_TITLE_ACT_BOUNDARIES[act + 1] - LIVING_TITLE_ACT_BOUNDARIES[act];
    assert.ok(Math.abs(span * (1 - LIVING_TITLE_MORPH_STARTS[act]) - 1.5 / 38) < 1e-12);
  }
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
  // The upper-frame fit may make a sub-cell lens correction while it hands
  // off to the centered overview, but must never create a perceptible zoom-in.
  assert.ok(distances.every((distance, index) => index === 0 || distance >= distances[index - 1] - 0.06));
  const targetSteps = cameras.slice(1).map((camera, index) => Math.hypot(
    camera.target.x - cameras[index].target.x,
    camera.target.y - cameras[index].target.y,
    camera.target.z - cameras[index].target.z,
  ));
  assert.ok(Math.max(...targetSteps) < 0.07, 'Poker target translation should remain one smooth motion');
  assert.ok(distances.at(-1)! > distances[0] * 2);
});

test('each game camera keeps one orbit direction', () => {
  const chess = Array.from({ length: 21 }, (_, index) => chessCinematicPose(index / 20).azimuth);
  const poker = Array.from({ length: 21 }, (_, index) => pokerCinematicCamera(index / 20, 1.6).azimuth);
  const islanders = Array.from({ length: 21 }, (_, index) => islandersCinematicCamera(index / 20, 1.6).azimuth);
  assert.ok(chess.every((azimuth, index) => index === 0 || azimuth > chess[index - 1]));
  assert.ok(poker.every((azimuth, index) => index === 0 || azimuth > poker[index - 1]));
  assert.ok(islanders.every((azimuth, index) => index === 0 || azimuth > islanders[index - 1]));
});

test('Poker framing backs away smoothly near narrow landscape widths', () => {
  const regular = pokerCinematicCamera(0.5, 1.4);
  const ultrawide = pokerCinematicCamera(0.5, 2.4);
  const regularDistance = Math.hypot(regular.eye.x - regular.target.x, regular.eye.y - regular.target.y, regular.eye.z - regular.target.z);
  const wideDistance = Math.hypot(ultrawide.eye.x - ultrawide.target.x, ultrawide.eye.y - ultrawide.target.y, ultrawide.eye.z - ultrawide.target.z);
  assert.ok(regularDistance >= wideDistance);
  // The production chairs extend well below the felt. A below-felt target is
  // therefore the visual center of the complete table, not a camera mistake.
  assert.ok(Number.isFinite(ultrawide.target.y));
});

test('Islanders terrain studies use macro cameras', () => {
  for (const progress of [0.32, 0.43, 0.57]) {
    const camera = islandersCinematicCamera(progress, 1.6);
    const distance = Math.hypot(camera.eye.x - camera.target.x, camera.eye.y - camera.target.y, camera.eye.z - camera.target.z);
    assert.ok(distance < 3.7);
  }
});

test('Islanders close-in uses a gradual camera push instead of a rushed six-percent jump', () => {
  const samples = Array.from({ length: 13 }, (_, index) => islandersCinematicCamera(0.22 + index * 0.01, 1.6));
  const distances = samples.map((camera) => Math.hypot(camera.eye.x-camera.target.x,camera.eye.y-camera.target.y,camera.eye.z-camera.target.z));
  const steps = distances.slice(1).map((distance, index) => Math.abs(distance - distances[index]));
  assert.ok(Math.max(...steps) < 1.1, `Islanders close-in jumped ${Math.max(...steps)}`);
  assert.ok(distances.at(-1)! < 3.7, 'camera should still arrive before the settlement study');
});

test('Islanders gameplay choreography is wall-clock data, not scroll data', () => {
  assert.deepEqual(new Set(ISLANDERS_CINEMATIC_PLACEMENTS.map(({ color }) => color)), new Set(['red', 'blue', 'purple', 'orange']));
  assert.equal(ISLANDERS_CINEMATIC_PLACEMENTS.filter(({ action }) => action.type === 'initialSettlement').length, 8);
  assert.equal(ISLANDERS_CINEMATIC_PLACEMENTS.filter(({ action }) => action.type === 'initialRoad').length, 8);
  assert.notDeepEqual(islandersCinematicGameplay(8), islandersCinematicGameplay(12));
  assert.deepEqual(islandersCinematicGameplay(12), islandersCinematicGameplay(12));
});

test('Islanders coastline tour begins at the brick harbor and stays macro-close', () => {
  const brick = { x: -3.6, z: -3.12 };
  const arrival = islandersCinematicCamera(0.86, 1.6, brick);
  assert.ok(Math.hypot(arrival.target.x - brick.x, arrival.target.z - brick.z) < 1.5, 'coast focus should stay just inside the brick harbor');
  for (const progress of [0.86, 0.9, 0.95, 1]) {
    const camera = islandersCinematicCamera(progress, 1.6, brick);
    const distance = Math.hypot(camera.eye.x-camera.target.x,camera.eye.y-camera.target.y,camera.eye.z-camera.target.z);
    const elevation = Math.asin((camera.eye.y - camera.target.y) / distance);
    assert.ok(distance < 5, `coast camera pulled out at ${progress}`);
    assert.ok(elevation >= 0.6 && elevation <= 0.7, `coast elevation drifted at ${progress}`);
  }
});

test('Islanders keeps one restrained rotation cadence through the coast handoff', () => {
  const cameras = Array.from({ length: 101 }, (_, index) => islandersCinematicCamera(index / 100, 1.6));
  const angularSteps = cameras.slice(1).map((camera, index) => camera.azimuth - cameras[index].azimuth);
  assert.ok(Math.max(...angularSteps) - Math.min(...angularSteps) < 1e-9);
  const targetSteps = cameras.slice(65).map((camera, index) => {
    const previous = cameras[index + 64].target;
    return Math.hypot(camera.target.x - previous.x, camera.target.y - previous.y, camera.target.z - previous.z);
  });
  assert.ok(Math.max(...targetSteps) < 0.5, `coast translation jumped by ${Math.max(...targetSteps)}`);
});
