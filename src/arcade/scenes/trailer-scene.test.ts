import assert from 'node:assert/strict';
import test from 'node:test';
import { ARCADE_CATALOGUE } from '../../cinematic/catalogue.ts';
import { buildTrailerOverlay, SOCIAL_TRAILER_SECONDS, trailerCoverTextures, trailerWispTextures, TrailerScene } from './trailer-scene.ts';
import { SOCIAL_TRAILER_BEATS, SOCIAL_TRAILER_INK_SECONDS, socialTrailerCoverPosition, socialTrailerIslandersCamera, socialTrailerIslandersElapsed, socialTrailerIslandersHookCamera, socialTrailerSample } from './social-trailer.ts';
import { layout } from '../../tui/layout.ts';
import { ISLANDERS_GAMEPLAY_START, islandersCinematicGameplay } from '../../cinematic/islanders-choreography.ts';
import { POKER_LOOP_SECONDS, pokerLoopState } from '../../cinematic/scripted-games.ts';

test('Trailer advances through its CLI-only 30-second social cut and resets for replay', () => {
  const trailer = new TrailerScene();
  trailer.step(SOCIAL_TRAILER_SECONDS - 0.1);
  assert.equal(trailer.done(), false);
  trailer.step(0.1);
  assert.equal(trailer.done(), true);
  assert.equal(trailer.progress(), 1);
  assert.equal(trailer.start(), true);
  assert.equal(trailer.progress(), 0);
  assert.equal(trailer.done(), false);
});

test('Trailer supports wall-clock seeking without cumulative frame-step drift', () => {
  const trailer = new TrailerScene();
  trailer.seek(29.9);
  assert.equal(trailer.done(), false);
  trailer.seek(30);
  assert.equal(trailer.done(), true);
  assert.equal(trailer.progress(), 1);
});

test('Trailer construction defers synchronous asset loading until playback or preparation', () => {
  const trailer = new TrailerScene();
  assert.equal((trailer as unknown as { scene: unknown }).scene, null);
});

test('social trailer opens with three equal 1.75-second hooks then preserves four full ink burns', () => {
  assert.equal(SOCIAL_TRAILER_BEATS.reduce((total, beat) => total + beat.durationSeconds, 0), 30);
  assert.deepEqual(SOCIAL_TRAILER_BEATS.slice(0, 3).map(({ beat, durationSeconds }) => [beat, durationSeconds]), [
    ['hook-islanders', 1.75], ['hook-poker', 1.75], ['hook-chess', 1.75],
  ]);
  assert.deepEqual(SOCIAL_TRAILER_BEATS.filter(({ beat }) => beat.includes('-to-')).map(({ durationSeconds }) => durationSeconds), [
    SOCIAL_TRAILER_INK_SECONDS, SOCIAL_TRAILER_INK_SECONDS, SOCIAL_TRAILER_INK_SECONDS, SOCIAL_TRAILER_INK_SECONDS,
  ]);
  assert.equal(socialTrailerSample(5.25).beat, 'islanders');
  assert.equal(socialTrailerSample(11.75).beat, 'poker');
  assert.equal(socialTrailerSample(18.25).beat, 'chess');
  assert.equal(socialTrailerSample(24.25).beat, 'covers');
  assert.equal(socialTrailerSample(27.5).beat, 'prism');
});

test('equal hooks reach the Islanders landing and complete Poker bridge before their hard cuts', () => {
  const diceAtCut = islandersCinematicGameplay(ISLANDERS_GAMEPLAY_START + 10.8 + 1.75).dice;
  assert.equal(diceAtCut?.rolling, false, 'Islanders dice should settle before its hook cuts');
  const pokerAtCut = pokerLoopState((0.6 + 1.75) / POKER_LOOP_SECONDS, 0);
  const shuffleClock = pokerAtCut.shuffle * 4.5;
  assert.ok(shuffleClock > 3.05, 'Poker hook should complete the bridge and cascade before cutting');
});

test('CLI social trailer owns its moving cuts without changing the shared browser timeline', async () => {
  const [director, livingTitle, timeline] = await Promise.all([
    import('node:fs/promises').then(({ readFile }) => readFile(new URL('./social-trailer.ts', import.meta.url), 'utf8')),
    import('node:fs/promises').then(({ readFile }) => readFile(new URL('../../web/living-title-scene.ts', import.meta.url), 'utf8')),
    import('node:fs/promises').then(({ readFile }) => readFile(new URL('../../cinematic/timeline.ts', import.meta.url), 'utf8')),
  ]);
  assert.match(director, /One live 3D plate per terminal frame/);
  assert.match(director, /this\.transitionFrames\(cols, rows, beat, local/);
  assert.match(director, /renderScene\(this\.target, position, null\)/, 'cover proof must scroll without a flip');
  assert.doesNotMatch(livingTitle, /SocialTrailerDirector|SOCIAL_TRAILER_BEATS/);
  assert.match(timeline, /\[0, 3 \/ 38, 8 \/ 38, 17 \/ 38, 28 \/ 38, 1\]/);
});

test('Trailer Cover Flow performs one inertial catalogue swipe and settles on Chess', () => {
  const samples = [0, 0.5, 1, 1.5, 2, 2.5, 3.15].map(socialTrailerCoverPosition);
  assert.equal(samples[0], 0);
  assert.equal(samples.at(-1), ARCADE_CATALOGUE.length);
  assert.ok(samples.every((position, index) => index === 0 || position > samples[index - 1]));
  const velocities = samples.slice(1).map((position, index) => position - samples[index]);
  assert.ok(velocities[2] > velocities[0], 'the swipe should accelerate');
  assert.ok(velocities.at(-1)! < velocities[2], 'the swipe should brake into Chess');
});

test('Trailer Islanders preserves setup and reaches two colors of initial placement before its burn', () => {
  const opening = islandersCinematicGameplay(socialTrailerIslandersElapsed(0));
  const beforeBurn = islandersCinematicGameplay(socialTrailerIslandersElapsed(5));
  assert.equal(opening.placements.length, 0, 'the proof shot should still begin during board setup');
  assert.ok(beforeBurn.placements.some(({ color, action }) => color === 'red' && action.type === 'initialRoad'));
  assert.ok(beforeBurn.placements.some(({ color, action }) => color === 'blue' && action.type === 'initialSettlement'));
});

test('Trailer Islanders enters with roughly the final six setup hexes still to land', () => {
  const opening = socialTrailerIslandersElapsed(0);
  assert.ok(opening < 13 * 0.12, 'at least the final six tiles should still be waiting at the opening frame');
  assert.ok(opening > 12 * 0.12, 'the setup should already be entering its final six tiles');
});

test('Trailer Islanders camera traverses its complete overview-to-coast path without clamping early', () => {
  const harbor = { x: -3.6, z: -3.12 };
  const distances = [0, 0.25, 0.5, 0.75, 1].map((progress) => {
    const camera = socialTrailerIslandersCamera(progress, 16 / 9, harbor);
    return Math.hypot(camera.eye.x - camera.target.x, camera.eye.y - camera.target.y, camera.eye.z - camera.target.z);
  });
  assert.ok(distances.every((distance, index) => index === 0 || distance < distances[index - 1]), 'camera should keep pushing toward the coast');
  assert.ok(distances[0] > distances.at(-1)! * 2, 'the complete path should produce a legible establishing-to-detail move');
});

test('Trailer Islanders camera uses one continuous interpolation instead of a delayed second move', () => {
  const harbor = { x: -3.6, z: -3.12 };
  const cameras = Array.from({ length: 21 }, (_, index) => socialTrailerIslandersCamera(index / 20, 16 / 9, harbor));
  const distance = (camera: typeof cameras[number]) => Math.hypot(camera.eye.x - camera.target.x, camera.eye.y - camera.target.y, camera.eye.z - camera.target.z);
  const normalized = (value: number, start: number, end: number) => (value - start) / (end - start);
  const start = cameras[0], end = cameras.at(-1)!;
  for (let index = 1; index < cameras.length - 1; index++) {
    const camera = cameras[index];
    const targetTravel = normalized(camera.target.x, start.target.x, end.target.x);
    assert.ok(targetTravel > 0 && targetTravel < 1, 'target should move from the first interval through the last');
    assert.ok(Math.abs(normalized(camera.azimuth, start.azimuth, end.azimuth) - targetTravel) < 1e-9);
    assert.ok(Math.abs(normalized(distance(camera), distance(start), distance(end)) - targetTravel) < 1e-9);
    assert.ok(Math.abs(normalized(camera.ndcOffsetX ?? 0, start.ndcOffsetX ?? 0, end.ndcOffsetX ?? 0) - targetTravel) < 1e-9);
  }
  const parameterSteps = cameras.slice(1).map((camera, index) => Math.hypot(
    camera.target.x - cameras[index].target.x,
    camera.target.y - cameras[index].target.y,
    camera.target.z - cameras[index].target.z,
    camera.azimuth - cameras[index].azimuth,
    distance(camera) - distance(cameras[index]),
    (camera.ndcOffsetX ?? 0) - (cameras[index].ndcOffsetX ?? 0),
    (camera.ndcOffsetY ?? 0) - (cameras[index].ndcOffsetY ?? 0),
  ));
  const acceleration = parameterSteps.slice(1).map((step, index) => Math.abs(step - parameterSteps[index]));
  assert.ok(Math.max(...acceleration) < 0.16, 'the combined camera motion should not change phase abruptly');
});

test('Trailer Islanders dice hook retains the production close camera independently of the setup path', () => {
  const harbor = { x: -3.6, z: -3.12 };
  const hook = socialTrailerIslandersHookCamera(0.58, 16 / 9, harbor);
  const extended = socialTrailerIslandersCamera(0.58, 16 / 9, harbor);
  const distance = (camera: typeof hook) => Math.hypot(camera.eye.x - camera.target.x, camera.eye.y - camera.target.y, camera.eye.z - camera.target.z);
  assert.ok(distance(hook) < distance(extended), 'the dice hook should remain the tighter composition');
});

test('Trailer preparation is safe to start in the background', async () => {
  const trailer = new TrailerScene();
  const first = trailer.prepare();
  assert.equal(trailer.prepare(), first);
  await first;
  assert.equal(trailer.start(), true);
  assert.equal(trailer.prepare(), first, 'replay should retain prepared assets');
});

test('Trailer bounds resize-keyed transition plates', async () => {
  const trailer = new TrailerScene();
  await trailer.prepare();
  for (let index = 0; index < 14; index++) {
    trailer.seek(10.8);
    trailer.frame(80 + index, 36);
  }
  const scene = (trailer as unknown as { scene: { transitionPlates: Map<string, unknown> } }).scene;
  assert.ok(scene.transitionPlates.size <= 8);
});

test('Trailer loads every packaged cover and creator mark in Node', () => {
  const covers = trailerCoverTextures();
  assert.deepEqual(Object.keys(covers), ARCADE_CATALOGUE.map(({ id }) => id));
  for (const texture of Object.values(covers)) assert.ok(texture.width > 1 && texture.height > 1 && texture.data.some((channel) => channel !== 0));
  const wisps = trailerWispTextures();
  assert.deepEqual(Object.keys(wisps), ['xai', 'openai', 'anthropic', 'google', 'deepseek']);
  for (const texture of Object.values(wisps)) assert.ok(texture.data.some((channel, index) => index % 4 === 3 && channel > 0));
});

test('Trailer frame contains no text beyond its separate Menu overlay', () => {
  const trailer = new TrailerScene();
  trailer.step(22);
  const surface = trailer.frame(100, 40);
  const text = Array.from({ length: surface.rows }, (_, y) => Array.from({ length: surface.cols }, (_, x) => surface.getCell(x, y)?.ch ?? ' ').join('')).join('\n');
  for (const phrase of ['Every player', 'has a tell', 'Discover the hidden tendencies', 'Chess', 'coming soon']) assert.doesNotMatch(text, new RegExp(phrase));
});

test('Trailer exposes only the menu control', () => {
  const root = buildTrailerOverlay(100, 40, () => {});
  layout(root, { x: 0, y: 0, w: 100, h: 40 });
  const ids: string[] = [];
  const visit = (node: typeof root): void => {
    if (node.id) ids.push(node.id);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  assert.deepEqual(ids, ['trailer-menu-button']);
});

test('the app reserves Trailer input for Menu while retaining the hard exit hatch', async () => {
  const main = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../main.ts', import.meta.url), 'utf8'));
  const trailerGate = main.slice(main.indexOf("if (mode === 'trailer') {"), main.indexOf("if (failureNotice)"));
  assert.match(trailerGate, /ev\.name === 'escape' \|\| ev\.name === 'm'/);
  assert.match(trailerGate, /else ui\.handleKey\(ev\)/);
  const keyHandler = main.slice(main.indexOf('function onKeyImpl'), main.indexOf('function onMouseImpl'));
  assert.ok(keyHandler.indexOf("ev.ctrl && ev.name === 'c'") < keyHandler.indexOf("if (mode === 'trailer') {"));
});
