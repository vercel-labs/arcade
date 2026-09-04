import assert from 'node:assert/strict';
import test from 'node:test';
import { ARCADE_CATALOGUE } from '../../cinematic/catalogue.ts';
import { SOCIAL_TRAILER_SECONDS, trailerCoverTextures, TrailerScene } from './trailer-scene.ts';
import { SOCIAL_TRAILER_BEATS, SOCIAL_TRAILER_CHESS_HOOK_MOVES, SOCIAL_TRAILER_CHESS_HOOK_MOVE_SECONDS, SOCIAL_TRAILER_CHESS_HOOK_SCRIPT_START, SOCIAL_TRAILER_COVER_MOTION_SECONDS, SOCIAL_TRAILER_INK_SECONDS, SOCIAL_TRAILER_ISLANDERS_HOOK_GAMEPLAY_START, SOCIAL_TRAILER_ISLANDERS_HOOK_VISUAL_START, SOCIAL_TRAILER_RENDER_STYLE, SocialTrailerDirector, socialTrailerChessHookCamera, socialTrailerCoverPosition, socialTrailerIslandersCamera, socialTrailerIslandersElapsed, socialTrailerIslandersHookBoard, socialTrailerIslandersHookCamera, socialTrailerIslandersHookGameplay, socialTrailerIslandersHookTileRotation, socialTrailerPokerHookCamera, socialTrailerSample } from './social-trailer.ts';
import { ISLANDERS_GAMEPLAY_START, islandersCinematicGameplay } from '../../cinematic/islanders-choreography.ts';
import { CHESS_LOOP_SECONDS, POKER_LOOP_SECONDS, pokerLoopState } from '../../cinematic/scripted-games.ts';
import { islandersCinematicCamera } from '../../cinematic/camera.ts';
import { BrowserIslandersCinematic, BrowserPokerCinematic } from '../../web/browser-game-cinematics.ts';
import { BrowserChessBoardShowcase } from '../../web/browser-mini-scenes.ts';
import { GLYPH_SUPERSAMPLE } from '../render-quality.ts';
import { islandersWaterMesh as productionIslandersWaterMesh } from '../games/islanders/water.ts';
import type { Texture } from '../../engine/texture-data.ts';
import { TrailerCreatorWisps } from './trailer-wisps.ts';
import { ChessState } from '../../rules/chess/chess.ts';

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
  trailer.seek(SOCIAL_TRAILER_SECONDS - 0.1);
  assert.equal(trailer.done(), false);
  trailer.seek(SOCIAL_TRAILER_SECONDS);
  assert.equal(trailer.done(), true);
  assert.equal(trailer.progress(), 1);
});

test('Trailer replay and backward seeking reset production wisp state', async () => {
  const trailer = new TrailerScene();
  await trailer.prepare();
  assert.equal(trailer.start(), true);
  trailer.seek(14);
  const first = surfaceSignature(trailer.frame(80, 30));
  assert.equal(trailer.start(), true);
  trailer.seek(14);
  assert.equal(surfaceSignature(trailer.frame(80, 30)), first);
  trailer.seek(20);
  trailer.frame(80, 30);
  trailer.seek(14);
  assert.equal(surfaceSignature(trailer.frame(80, 30)), first);

  const sequential = new TrailerScene();
  await sequential.prepare();
  assert.equal(sequential.start(), true);
  sequential.seek(13);
  sequential.frame(80, 30);
  sequential.seek(14);
  assert.equal(surfaceSignature(sequential.frame(80, 30)), first, 'absolute time must not depend on rendered-frame history');
});

test('production wisp preparation accumulates creators for a shared renderer', async () => {
  const wisps = new TrailerCreatorWisps(1, {});
  await wisps.prepare(['xai', 'google']);
  await wisps.prepare(['anthropic']);
  const prepared = (wisps as unknown as { preparedCreators: string[] }).preparedCreators;
  assert.deepEqual(prepared, ['xai', 'google', 'anthropic']);
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
  assert.equal(socialTrailerSample(26.9).beat, 'prism');
  assert.equal(SOCIAL_TRAILER_BEATS.find(({ beat }) => beat === 'covers')?.durationSeconds, 1.15);
  assert.equal(SOCIAL_TRAILER_BEATS.at(-1)?.durationSeconds, 3.1);
});

test('Poker hook starts in motion, stays close, and lowers the shuffle in frame', () => {
  const start = socialTrailerPokerHookCamera(0);
  const middle = socialTrailerPokerHookCamera(0.5);
  const end = socialTrailerPokerHookCamera(1);
  assert.ok(start.progress > 0.02, 'hook must begin beyond the camera curve dead zone');
  assert.ok(middle.progress > start.progress && end.progress > middle.progress);
  assert.ok(end.progress - start.progress >= 0.1, 'hook must visibly rotate and pull back');
  assert.ok(start.distanceScale < 0.9, 'hook begins more tightly focused on the cards');
  assert.ok(end.distanceScale > start.distanceScale, 'hook adds immediate linear pullback from frame one');
  assert.ok(start.ndcOffsetY < 0, 'negative film shift lowers the cards in frame');
});

test('Chess hook completes the Double Bongcloud in a distinct over-the-shoulder move', () => {
  const state = new ChessState();
  for (const notation of SOCIAL_TRAILER_CHESS_HOOK_MOVES) {
    const move = state.actionFromStringLoose(notation);
    assert.ok(move, `${notation} must remain legal in the hook continuation`);
    state.applyAction(move);
  }
  const openingPly = SOCIAL_TRAILER_CHESS_HOOK_SCRIPT_START / SOCIAL_TRAILER_CHESS_HOOK_MOVE_SECONDS;
  const endingPly = (SOCIAL_TRAILER_CHESS_HOOK_SCRIPT_START + 1.75) / SOCIAL_TRAILER_CHESS_HOOK_MOVE_SECONDS;
  assert.ok(openingPly > 1 && openingPly < 2, 'the hook should enter while e5 is moving');
  assert.ok(endingPly > 3 && endingPly < 4, 'Ke2 should finish while Ke7 remains in motion at the cut');
  const start = socialTrailerChessHookCamera(0);
  const kingMove = socialTrailerChessHookCamera(0.65);
  const end = socialTrailerChessHookCamera(1);
  assert.ok(kingMove.distance < start.distance - 0.45, 'camera should close on Claude’s king during Ke2');
  assert.ok(end.azimuth - start.azimuth >= 0.09 && end.azimuth - start.azimuth <= 0.12, 'hook should use only slight lateral rotation');
  assert.ok(end.azimuth < -0.25, 'camera must stay off the e-file so the two king wisps do not stack');
  assert.ok(start.elevation < 0.5 && end.elevation < 0.5, 'hook stays lower than the extended overview');
  const poses = Array.from({ length: 9 }, (_, index) => socialTrailerChessHookCamera(index / 8));
  const steps = poses.slice(1).map((pose, index) => Math.hypot(
    pose.azimuth - poses[index].azimuth,
    pose.elevation - poses[index].elevation,
    pose.distance - poses[index].distance,
    pose.target.x - poses[index].target.x,
    pose.target.y - poses[index].target.y,
    pose.target.z - poses[index].target.z,
  ));
  assert.ok(Math.max(...steps) - Math.min(...steps) < 1e-9, 'camera must use one constant-velocity interpolation');
});

test('equal hooks reach the Islanders landing and complete Poker bridge before their hard cuts', () => {
  const diceAtCut = islandersCinematicGameplay(ISLANDERS_GAMEPLAY_START + 10.8 + 1.75).dice;
  assert.equal(diceAtCut?.rolling, false, 'Islanders dice should settle before its hook cuts');
  const pokerAtCut = pokerLoopState((0.6 + 1.75) / POKER_LOOP_SECONDS, 0);
  const shuffleClock = pokerAtCut.shuffle * 4.5;
  assert.ok(shuffleClock > 3.05, 'Poker hook should complete the bridge and cascade before cutting');
});

test('Poker shuffle uses the host-provided production face artwork', () => {
  const magenta: Texture = { width: 1, height: 1, data: new Uint8Array([255, 0, 255, 255]) };
  const options = { rasterScale: GLYPH_SUPERSAMPLE, productionLighting: true, shadowGlyphs: true } as const;
  const args = [48, 20, 0.02, 0.6, 0.6 / POKER_LOOP_SECONDS, 0] as const;
  const fallback = surfaceSignature(new BrowserPokerCinematic(options).frame(...args));
  const injected = surfaceSignature(new BrowserPokerCinematic({ ...options, faceTexture: () => magenta }).frame(...args));
  assert.notEqual(injected, fallback, 'the exposed riffle and bridge faces must use the injected provider');
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

test('CLI Trailer routes production game presentation without changing website renderer defaults', async () => {
  const livingTitle = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../../web/living-title-scene.ts', import.meta.url), 'utf8'));
  assert.deepEqual(SOCIAL_TRAILER_RENDER_STYLE, {
    rasterScale: GLYPH_SUPERSAMPLE,
    productionLighting: true,
    shadowGlyphs: true,
  });
  assert.doesNotMatch(livingTitle, /productionLighting|shadowGlyphs/);

  const cols = 48, rows = 20;
  const director = new SocialTrailerDirector();
  const islandersVisualSeconds = SOCIAL_TRAILER_ISLANDERS_HOOK_VISUAL_START;
  const islandersGameplaySeconds = SOCIAL_TRAILER_ISLANDERS_HOOK_GAMEPLAY_START;
  director.seek(0);
  assert.equal(
    surfaceSignature(director.frame(cols, rows)),
    surfaceSignature(new BrowserIslandersCinematic(
      socialTrailerIslandersHookCamera,
      SOCIAL_TRAILER_RENDER_STYLE.rasterScale,
      { productionLighting: SOCIAL_TRAILER_RENDER_STYLE.productionLighting },
      { full: productionIslandersWaterMesh(), settled: productionIslandersWaterMesh({ omitSettledLand: true }) },
      {
        board: socialTrailerIslandersHookBoard(),
        gameplayFor: socialTrailerIslandersHookGameplay,
        tileRotationFor: socialTrailerIslandersHookTileRotation,
      },
    ).frame(cols, rows, 0, islandersVisualSeconds, islandersGameplaySeconds)),
    'Islanders hook must render with the Trailer production style',
  );

  director.seek(1.75);
  const pokerHookCamera = socialTrailerPokerHookCamera(0);
  assert.equal(
    surfaceSignature(director.frame(cols, rows)),
    surfaceSignature(new BrowserPokerCinematic({
      rasterScale: SOCIAL_TRAILER_RENDER_STYLE.rasterScale,
      productionLighting: SOCIAL_TRAILER_RENDER_STYLE.productionLighting,
      shadowGlyphs: SOCIAL_TRAILER_RENDER_STYLE.shadowGlyphs,
    }).frame(cols, rows, pokerHookCamera.progress, 0.6, 0.6 / POKER_LOOP_SECONDS, 0, pokerHookCamera)),
    'Poker hook must render with production lighting and shadow glyphs',
  );

  director.seek(3.5);
  const chessOptions = {
    rasterScale: SOCIAL_TRAILER_RENDER_STYLE.rasterScale,
    productionLighting: SOCIAL_TRAILER_RENDER_STYLE.productionLighting,
    shadowGlyphs: SOCIAL_TRAILER_RENDER_STYLE.shadowGlyphs,
  } as const;
  const hookChess = new BrowserChessBoardShowcase(chessOptions, true);
  hookChess.setChromeVisible(false);
  hookChess.setCinematicScript(socialTrailerChessHookCamera(0), SOCIAL_TRAILER_CHESS_HOOK_MOVES, SOCIAL_TRAILER_CHESS_HOOK_SCRIPT_START, SOCIAL_TRAILER_CHESS_HOOK_MOVE_SECONDS);
  const trailerChess = surfaceSignature(hookChess.frame(cols, rows, 5.15).surface);
  assert.equal(surfaceSignature(director.frame(cols, rows)), trailerChess, 'Chess hook must render with the Trailer production style');

  const islandersArgs = [cols, rows, 0.54, islandersGameplaySeconds, islandersGameplaySeconds] as const;
  const browserIslanders = surfaceSignature(new BrowserIslandersCinematic().frame(...islandersArgs));
  assert.equal(browserIslanders, surfaceSignature(new BrowserIslandersCinematic(
    islandersCinematicCamera, 3, { productionLighting: false },
  ).frame(...islandersArgs)));
  assert.notEqual(browserIslanders, surfaceSignature(new BrowserIslandersCinematic(
    islandersCinematicCamera, 3, { productionLighting: true },
  ).frame(...islandersArgs)));

  const pokerArgs = [cols, rows, 0.02, 0.6, 0.6 / POKER_LOOP_SECONDS, 0] as const;
  const browserPoker = surfaceSignature(new BrowserPokerCinematic().frame(...pokerArgs));
  assert.equal(browserPoker, surfaceSignature(new BrowserPokerCinematic({
    productionLighting: false, shadowGlyphs: false,
  }).frame(...pokerArgs)));
  assert.notEqual(browserPoker, surfaceSignature(new BrowserPokerCinematic({
    productionLighting: true, shadowGlyphs: true,
  }).frame(...pokerArgs)));

  const browserChess = chessFrame({}, cols, rows);
  assert.equal(browserChess, chessFrame({ productionLighting: false, shadowGlyphs: false }, cols, rows));
  assert.notEqual(browserChess, chessFrame({ productionLighting: true, shadowGlyphs: true }, cols, rows));
});

function chessFrame(options: ConstructorParameters<typeof BrowserChessBoardShowcase>[0], cols: number, rows: number, exactDimensions = false): string {
  const chess = new BrowserChessBoardShowcase(options, exactDimensions);
  chess.setChromeVisible(false);
  chess.setCinematicState(0.4, 5.15 / CHESS_LOOP_SECONDS);
  return surfaceSignature(chess.frame(cols, rows, 5.15).surface);
}

function surfaceSignature(surface: ReturnType<SocialTrailerDirector['frame']>): string {
  let signature = '';
  for (let y = 0; y < surface.rows; y++) for (let x = 0; x < surface.cols; x++) {
    const cell = surface.getCell(x, y);
    if (cell?.opaque) signature += `${x},${y},${cell.ch},${cell.fg.join('.')},${cell.bg.join('.')},${cell.style};`;
  }
  return signature;
}

test('Trailer Cover Flow reaches Tutorial as its outgoing burn begins and brakes smoothly without an end target', () => {
  const step = 0.25;
  const clocks = Array.from({ length: Math.round(SOCIAL_TRAILER_COVER_MOTION_SECONDS / step) + 1 }, (_, index) => index * step);
  clocks[clocks.length - 1] = SOCIAL_TRAILER_COVER_MOTION_SECONDS;
  const samples = clocks.map(socialTrailerCoverPosition);
  const burnStart = SOCIAL_TRAILER_COVER_MOTION_SECONDS - SOCIAL_TRAILER_INK_SECONDS;
  const tutorialIndex = ARCADE_CATALOGUE.findIndex(({ id }) => id === 'tutorial');
  assert.ok(Math.abs(socialTrailerCoverPosition(burnStart) - (ARCADE_CATALOGUE.length + tutorialIndex)) < 1e-9, 'the outgoing prism burn should begin with Tutorial centered');
  assert.ok(samples.every((position, index) => index === 0 || position > samples[index - 1]));
  const speed = (clock: number): number => (socialTrailerCoverPosition(clock + 0.01) - socialTrailerCoverPosition(clock)) / 0.01;
  const visibleStartSpeed = speed(SOCIAL_TRAILER_INK_SECONDS);
  const finalSpeed = (socialTrailerCoverPosition(SOCIAL_TRAILER_COVER_MOTION_SECONDS) - socialTrailerCoverPosition(SOCIAL_TRAILER_COVER_MOTION_SECONDS - 0.01)) / 0.01;
  assert.ok(Math.abs(visibleStartSpeed - 3.2) < 0.01, 'the clean cover beat should enter at the authored 3.2 covers per second');
  assert.ok(Math.abs(finalSpeed - 2.5) < 0.01, 'the covers should retain the authored 2.5 covers per second at disappearance');
  assert.ok(visibleStartSpeed / finalSpeed < 1.3, 'the visible slowdown should remain slight');
  const visibleSpeeds = [1.5, 2, 2.5, 3, 3.5, 4].map(speed);
  assert.ok(visibleSpeeds.every((value, index) => index === 0 || value < visibleSpeeds[index - 1]), 'the cover speed should decrease continuously');
  const speedDrops = visibleSpeeds.slice(1).map((value, index) => visibleSpeeds[index] - value);
  assert.ok(Math.max(...speedDrops) - Math.min(...speedDrops) < 1e-9, 'constant deceleration should avoid easing shoulders or speed jolts');
});

test('Trailer Islanders preserves setup and reaches two colors of initial placement before its burn', () => {
  const opening = islandersCinematicGameplay(socialTrailerIslandersElapsed(0));
  const beforeBurn = islandersCinematicGameplay(socialTrailerIslandersElapsed(5));
  assert.equal(opening.placements.length, 0, 'the proof shot should still begin during board setup');
  assert.ok(beforeBurn.placements.some(({ color, action }) => color === 'red' && action.type === 'initialRoad'));
  assert.ok(beforeBurn.placements.some(({ color, action }) => color === 'blue' && action.type === 'initialSettlement'));
  assert.ok(beforeBurn.placements.length >= 5, 'the proof should show two complete build pairs and begin a third settlement before the burn');
  assert.ok(beforeBurn.placements.some(({ color, action }) => color === 'purple' && action.type === 'initialSettlement'));
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
  assert.ok(Math.max(...parameterSteps) / Math.min(...parameterSteps) < 1.12, 'the shot should enter at its established velocity instead of easing from rest');
});

test('Trailer Islanders dice hook holds a close center-pasture composition independently of the setup path', () => {
  const harbor = { x: -3.6, z: -3.12 };
  const start = socialTrailerIslandersHookCamera(0, 16 / 9, harbor);
  const hook = socialTrailerIslandersHookCamera(0.58, 16 / 9, harbor);
  const end = socialTrailerIslandersHookCamera(1, 16 / 9, harbor);
  const extended = socialTrailerIslandersCamera(0.58, 16 / 9, harbor);
  const distance = (camera: typeof hook) => Math.hypot(camera.eye.x - camera.target.x, camera.eye.y - camera.target.y, camera.eye.z - camera.target.z);
  assert.ok(Math.hypot(hook.target.x - 0.28, hook.target.z - 0.16) < 0.08, 'the focal center-pasture sheep should stay on the optical axis');
  assert.ok(distance(start) < 2.7 && distance(end) < distance(start), 'the hook should begin close and continue its restrained push');
  assert.ok(end.azimuth - start.azimuth < 0.15, 'the close animal insert should retain only a slight orbit');
  assert.ok(distance(hook) < distance(extended), 'the dice hook should remain the tighter composition');
});

test('Trailer Islanders hook rearranges terrain without changing the production terrain multiset', () => {
  const board = socialTrailerIslandersHookBoard();
  assert.equal(board.hexes[4].terrain, 'desert', 'the forest above the focal pasture becomes the visible desert');
  assert.equal(board.robberHex, 4, 'the robber follows the Trailer-only desert');
  assert.equal(board.hexes[7].terrain, 'mountains', 'the upper-right fields become the visible ore tile');
  assert.equal(board.hexes[8].terrain, 'fields', 'the tile adjoining the focal pasture carries the windmill');
  assert.equal(board.hexes[9].terrain, 'pasture', 'the focal grazing tile remains pasture');
  const counts = new Map<string, number>();
  for (const hex of board.hexes) counts.set(hex.terrain, (counts.get(hex.terrain) ?? 0) + 1);
  assert.deepEqual(Object.fromEntries(counts), {
    hills: 3,
    fields: 4,
    forest: 4,
    desert: 1,
    mountains: 3,
    pasture: 4,
  });
  assert.equal(socialTrailerIslandersHookTileRotation(8), Math.PI / 3, 'the adjacent fields dressing rotates one edge toward the sheep');
  assert.equal(socialTrailerIslandersHookTileRotation(9), 0, 'the focal pasture and other tiles retain their authored orientation');
});

test('Trailer Islanders hook replaces settled cities with two in-frame settlement and road drops', () => {
  const start = socialTrailerIslandersHookGameplay(SOCIAL_TRAILER_ISLANDERS_HOOK_GAMEPLAY_START);
  const middle = socialTrailerIslandersHookGameplay(SOCIAL_TRAILER_ISLANDERS_HOOK_GAMEPLAY_START + 0.9);
  const end = socialTrailerIslandersHookGameplay(SOCIAL_TRAILER_ISLANDERS_HOOK_GAMEPLAY_START + 1.74);
  assert.equal(start.placements.length, 0);
  assert.deepEqual(middle.placements.map(({ action }) => action.type), ['initialSettlement', 'initialRoad', 'initialSettlement']);
  assert.deepEqual(end.placements.map(({ action }) => action.type), ['initialSettlement', 'initialRoad', 'initialSettlement', 'initialRoad']);
  assert.ok(end.placements.every(({ progress }) => progress === 1), 'every new piece should land before the hard cut');
  assert.ok(end.placements.every(({ action }) => action.type !== 'buildCity'), 'the opening insert should contain no prebuilt cities');
  assert.ok(middle.dice, 'the original dice hook continues while pieces drop');
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

test('Trailer loads every packaged cover in Node', () => {
  const covers = trailerCoverTextures();
  assert.deepEqual(Object.keys(covers), ARCADE_CATALOGUE.map(({ id }) => id));
  for (const texture of Object.values(covers)) assert.ok(texture.width > 1 && texture.height > 1 && texture.data.some((channel) => channel !== 0));
});

test('Trailer frame contains no text or controls', () => {
  const trailer = new TrailerScene();
  trailer.step(22);
  const surface = trailer.frame(100, 40);
  const text = Array.from({ length: surface.rows }, (_, y) => Array.from({ length: surface.cols }, (_, x) => surface.getCell(x, y)?.ch ?? ' ').join('')).join('\n');
  for (const phrase of ['Every player', 'has a tell', 'Discover the hidden tendencies', 'Chess', 'coming soon']) assert.doesNotMatch(text, new RegExp(phrase));
});

test('Trailer renders Chess at the exact requested compact grid', () => {
  const chess = new BrowserChessBoardShowcase({ productionLighting: true, shadowGlyphs: true }, true);
  const frame = chess.frame(30, 18).surface;
  assert.equal(frame.cols, 30);
  assert.equal(frame.rows, 18);
});

test('the app gives Trailer only Escape-to-home and the hard exit hatch', async () => {
  const main = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../main.ts', import.meta.url), 'utf8'));
  const keyHandler = main.slice(main.indexOf('function onKeyImpl'), main.indexOf('function onMouseImpl'));
  const trailerGate = keyHandler.slice(keyHandler.indexOf("if (mode === 'trailer') {"), keyHandler.indexOf("if (failureNotice)"));
  assert.match(trailerGate, /ev\.name === 'escape'/);
  assert.doesNotMatch(trailerGate, /ev\.name === 'm'|ui\.handleKey/);
  assert.match(main, /if \(mode === 'trailer'\) trailerScene = null/);
  assert.doesNotMatch(main, /buildTrailerOverlay|trailer-menu-button/);
  assert.ok(keyHandler.indexOf("ev.ctrl && ev.name === 'c'") < keyHandler.indexOf("if (mode === 'trailer') {"));
});
