import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchoredInkMatchCut, earlyScenePortraitScale, LIVING_TITLE_ACT_BOUNDARIES, LIVING_TITLE_MORPH_STARTS, LivingTitleScene } from './living-title-scene.ts';
import { Surface } from '../engine/surface.ts';
import { inkNoise } from '../cinematic/transitions/ink-match-cut.ts';
import { ARCADE_CATALOGUE } from '../cinematic/catalogue.ts';
import { POKER_LOOP_SECONDS } from '../cinematic/scripted-games.ts';

test('living title renders prism, Cover Flow, chess, poker, and Islanders acts at one grid size', () => {
  const scene = new LivingTitleScene();
  const frames = [0, 0.2, 0.42, 0.62, 0.82, 1].map((progress) => scene.frame({
    cols: 80,
    rows: 36,
    timeSeconds: 1,
    progress,
    pointer: { x: 0.6, y: 0.45 },
  }));

  for (const frame of frames) {
    assert.equal(frame.cols, 80);
    assert.equal(frame.rows, 36);
    assert.ok(countPaintedCells(frame) > 20);
    assert.ok(allCellBackgroundsAreBlack(frame), 'living title should default to plain ASCII, not hybrid cells');
  }
});

test('scene readiness becomes explicit when asynchronous browser assets finish', async () => {
  let resolveText!: (value: string) => void;
  const pending = new Promise<string>((resolve) => { resolveText = resolve; });
  const scene = new LivingTitleScene({ chess: { chessPieceFetchText: () => pending }, poker: { fetchTableText: () => pending } });
  assert.equal(scene.ready(), false);
  const triangle = 'v -0.5 0 0\nv 0.5 0 0\nv 0 1 0\nf 1 2 3';
  const prepared = scene.prepare();
  resolveText(triangle);
  await prepared;
  assert.equal(scene.ready(), true);
  assert.ok(countPaintedCells(scene.frame({ cols: 80, rows: 36, timeSeconds: 1, progress: 0.35 })) > 20);
});

test('living title maps scroll progress to the expected game act', () => {
  const scene = new LivingTitleScene();
  assert.equal(scene.actAt(0), 'prism');
  assert.equal(scene.actAt(0.14), 'covers');
  assert.equal(scene.actAt(0.35), 'chess');
  assert.equal(scene.actAt(0.54), 'poker');
  assert.equal(scene.actAt(0.77), 'islanders');
});

test('browser Cover Flow uses the complete shared production catalogue', () => {
  assert.equal(ARCADE_CATALOGUE.at(-1)?.id, 'website');
});

test('opening scenes pull back only in narrow portrait framing', () => {
  assert.equal(earlyScenePortraitScale(1), 1);
  assert.equal(earlyScenePortraitScale(16 / 9), 1);
  assert.ok(earlyScenePortraitScale(390 / 844) < 0.88);
  assert.ok(earlyScenePortraitScale(0.7) > earlyScenePortraitScale(390 / 844));
});

test('Chess, Poker, and Islanders gameplay continue while scroll and camera remain still', () => {
  const scene = new LivingTitleScene();
  const chessA = scene.frame({ cols: 80, rows: 36, timeSeconds: 10, progress: 0.36 });
  const chessB = scene.frame({ cols: 80, rows: 36, timeSeconds: 12, progress: 0.36 });
  assert.notEqual(surfaceSignature(chessA), surfaceSignature(chessB));
  const pokerA = scene.frame({ cols: 80, rows: 36, timeSeconds: 20, progress: 0.6 });
  const pokerB = scene.frame({ cols: 80, rows: 36, timeSeconds: 24.8, progress: 0.6 });
  assert.notEqual(surfaceSignature(pokerA), surfaceSignature(pokerB));
  const islandersA = scene.frame({ cols: 100, rows: 44, timeSeconds: 30, progress: 0.82 });
  const islandersB = scene.frame({ cols: 100, rows: 44, timeSeconds: 38, progress: 0.82 });
  assert.notEqual(surfaceSignature(islandersA), surfaceSignature(islandersB));
});

test('Islanders camera and display remain scroll-driven at one active scene time', () => {
  const scene = new LivingTitleScene();
  scene.frame({ cols: 100, rows: 44, timeSeconds: 50, progress: 0.78 });
  const near = scene.frame({ cols: 100, rows: 44, timeSeconds: 58, progress: 0.82 });
  const coast = scene.frame({ cols: 100, rows: 44, timeSeconds: 58, progress: 0.96 });
  assert.notEqual(surfaceSignature(near), surfaceSignature(coast));
});

test('reduced motion presents a settled Islanders board instead of a frozen setup stack', () => {
  const reduced = new LivingTitleScene().frame({ cols: 100, rows: 44, timeSeconds: 0, progress: 0.82, reducedMotion: true });
  const reducedLater = new LivingTitleScene().frame({ cols: 100, rows: 44, timeSeconds: 100, progress: 0.82, reducedMotion: true });
  const initial = new LivingTitleScene().frame({ cols: 100, rows: 44, timeSeconds: 0, progress: 0.82 });
  assert.notEqual(surfaceSignature(reduced), surfaceSignature(initial));
  assert.equal(surfaceSignature(reducedLater), surfaceSignature(reduced), 'reduced motion should not advance the settled board');
});

test('opening splash advances on wall clock while scroll leaves its core animation alone', () => {
  const scene = new LivingTitleScene();
  const start = scene.frame({ cols: 80, rows: 36, timeSeconds: 200.2, progress: 0 });
  const later = scene.frame({ cols: 80, rows: 36, timeSeconds: 202.4, progress: 0 });
  assert.notEqual(surfaceSignature(start), surfaceSignature(later), 'triangle should extrude without scrolling');
  const sameTimeScrolled = scene.frame({ cols: 80, rows: 36, timeSeconds: 202.4, progress: 0.04 });
  assert.equal(surfaceSignature(later), surfaceSignature(sameTimeScrolled), 'scroll should not rotate or morph the prism before ink');
});

test('late Chess orbit never lets the OpenAI wisp dominate the frame', () => {
  const scene = new LivingTitleScene();
  const start = LIVING_TITLE_ACT_BOUNDARIES[2], end = LIVING_TITLE_ACT_BOUNDARIES[3];
  for (const local of [0.68, 0.72, 0.76, 0.8, 0.84, 0.88]) {
    const frame = scene.frame({ cols: 210, rows: 60, timeSeconds: 9, progress: start + (end - start) * local });
    let painted = 0, green = 0;
    for (let y = 0; y < frame.rows; y++) for (let x = 0; x < frame.cols; x++) {
      const cell = frame.getCell(x, y);
      if (!cell || cell.ch === ' ') continue;
      painted++;
      if (cell.fg[1] > cell.fg[0] * 1.35 && cell.fg[1] > cell.fg[2] * 1.15) green++;
    }
    assert.ok(green / Math.max(1, painted) < 0.7, `OpenAI wisp dominates late Chess at ${local}`);
  }
});

test('Chess cinematic preserves scene pixels at the bottom edge', () => {
  const scene = new LivingTitleScene();
  const start = LIVING_TITLE_ACT_BOUNDARIES[2], end = LIVING_TITLE_ACT_BOUNDARIES[3];
  for (const local of [0.2, 0.45, 0.7, 0.9]) {
    const frame = scene.frame({ cols: 213, rows: 60, timeSeconds: 9, progress: start + (end - start) * local });
    let painted = 0;
    for (let y = frame.rows - 4; y < frame.rows; y++) for (let x = 0; x < frame.cols; x++) {
      if (frame.getCell(x, y)?.ch !== ' ') painted++;
    }
    assert.ok(painted > 0, `Chess bottom edge was erased at ${local}`);
  }
});

test('anchored ink handoffs remain populated through the impossible scene cut', () => {
  const scene = new LivingTitleScene();
  for (const progress of transitionProgresses(0.86)) {
    const frame = scene.frame({ cols: 80, rows: 36, timeSeconds: 1, progress });
    assert.ok(countPaintedCells(frame) > 40, `transition at ${progress} should not flash to black`);
  }
});

test('Chess and Poker ink cuts begin from the exact last live frame', () => {
  for (const act of [2, 3]) {
    const scene = new LivingTitleScene();
    const start = LIVING_TITLE_ACT_BOUNDARIES[act];
    const end = LIVING_TITLE_ACT_BOUNDARIES[act + 1];
    const boundary = start + (end - start) * LIVING_TITLE_MORPH_STARTS[act];
    const before = scene.frame({ cols: 120, rows: 50, timeSeconds: 9, progress: boundary - 1e-8 });
    // Cross the boundary by a sub-pixel amount so floating-point reconstruction of local
    // progress cannot leave this sample on the live-scene side of the comparison.
    const firstCut = scene.frame({ cols: 120, rows: 50, timeSeconds: 9, progress: boundary + 1e-12 });
    assert.equal(surfaceSignature(firstCut), surfaceSignature(before), `transition ${act} replaced its outgoing plate`);
  }
});

test('browser ink cuts keep both scene clocks alive while alternating live plate refreshes', () => {
  const scene = new LivingTitleScene();
  const act = 2;
  const start = LIVING_TITLE_ACT_BOUNDARIES[act], end = LIVING_TITLE_ACT_BOUNDARIES[act + 1];
  const morph = LIVING_TITLE_MORPH_STARTS[act];
  const progress = (local: number) => start + (end - start) * local;
  const first = scene.frame({ cols: 100, rows: 40, timeSeconds: 20, progress: progress(morph + 0.025) });
  scene.frame({ cols: 100, rows: 40, timeSeconds: 20.2, progress: progress(morph + 0.05) });
  const third = scene.frame({ cols: 100, rows: 40, timeSeconds: 20.4, progress: progress(morph + 0.075) });
  assert.notEqual(surfaceSignature(first), surfaceSignature(third), 'the burn should not reuse one frozen composite');
  const refreshes = (scene as unknown as { transitionRefreshSource: Map<string, boolean> }).transitionRefreshSource;
  assert.equal(refreshes.get('2:100:40'), false, 'source and destination refresh ownership should alternate');
  const pokerLoop = (scene as unknown as { pokerLoop: { sample(total: number, active: boolean, duration: number): { elapsed: number } } }).pokerLoop;
  assert.ok(pokerLoop.sample(20.5, true, POKER_LOOP_SECONDS).elapsed > 0, 'incoming Poker gameplay should already be moving beneath the burn');
});

test('anchored ink match cut preserves exact endpoints and returns a cold silver seam', () => {
  const from = solidSurface(20, 10, 'A', [220, 120, 50]);
  const to = solidSurface(20, 10, 'B', [40, 210, 120]);
  const cut = { from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.5 }, direction: { x: 1, y: 0.5 } };
  assert.equal(anchoredInkMatchCut(from, to, 20, 10, 0, cut).getCell(10, 5)?.ch, 'A');
  assert.equal(anchoredInkMatchCut(from, to, 20, 10, 1, cut).getCell(10, 5)?.ch, 'B');
  const middle = anchoredInkMatchCut(from, to, 20, 10, 0.5, cut);
  let silverCells = 0;
  let coolCells = 0;
  for (let y = 0; y < middle.rows; y++) for (let x = 0; x < middle.cols; x++) {
    const color = middle.getCell(x, y)?.fg;
    if (!color) continue;
    const chroma = Math.max(...color) - Math.min(...color);
    if (Math.min(...color) > 160 && chroma < 24) silverCells++;
    if (color[2] > color[0]) coolCells++;
  }
  assert.ok(silverCells > 2, 'the burn front should retain a narrow bright silver contour');
  assert.ok(coolCells > 0, 'the revealed edge should retain a faint cool afterglow');
});

test('ink noise remains continuous across its former lattice boundaries', () => {
  const epsilon = 1e-5;
  for (const boundary of [1, 2, 3]) {
    const left = inkNoise(boundary - epsilon, 1.37);
    const right = inkNoise(boundary + epsilon, 1.37);
    assert.ok(Math.abs(right - left) < 0.001, `noise jumped at x=${boundary}: ${left} -> ${right}`);
  }
});

test('ink cut connects empty black regions with a sparse charcoal fiber seam', () => {
  const from = solidSurface(120, 50, ' ', [0, 0, 0]);
  const to = solidSurface(120, 50, ' ', [0, 0, 0]);
  const cut = { from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.5 }, direction: { x: 0.84, y: 0.54 } };
  const middle = anchoredInkMatchCut(from, to, 120, 50, 0.5, cut);
  let fibers = 0;
  let brightest = 0;
  let mostChroma = 0;
  for (let y = 0; y < middle.rows; y++) for (let x = 0; x < middle.cols; x++) {
    const cell = middle.getCell(x, y);
    if (!cell || cell.ch === ' ') continue;
    fibers++;
    brightest = Math.max(brightest, ...cell.fg);
    mostChroma = Math.max(mostChroma, Math.max(...cell.fg) - Math.min(...cell.fg));
    assert.ok(['·', ':', '~'].includes(cell.ch), `unexpected empty-space fiber ${cell.ch}`);
  }
  assert.ok(fibers > 25, 'the charcoal seam should connect sparse scene silhouettes');
  assert.ok(fibers < middle.cols * middle.rows * 0.08, 'empty black space should remain predominantly black');
  assert.ok(brightest <= 42, `charcoal fibers became too bright: ${brightest}`);
  assert.ok(mostChroma <= 5, `charcoal fibers should remain grayscale: ${mostChroma}`);
  assert.equal(countPaintedCells(anchoredInkMatchCut(from, to, 120, 50, 0, cut)), 0);
  assert.equal(countPaintedCells(anchoredInkMatchCut(from, to, 120, 50, 1, cut)), 0);
});

test('anchored ink cut advances an outgoing moving plate while preserving endpoints', () => {
  const from = solidSurface(20, 10, 'A', [220, 120, 50]);
  const moving = solidSurface(20, 10, 'M', [180, 150, 80]);
  const to = solidSurface(20, 10, 'B', [40, 210, 120]);
  const cut = { from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.5 }, direction: { x: 1, y: 0.5 } };
  assert.equal(anchoredInkMatchCut(from, to, 20, 10, 0, cut, null, moving).getCell(10, 5)?.ch, 'A');
  assert.equal(anchoredInkMatchCut(from, to, 20, 10, 1, cut, null, moving).getCell(10, 5)?.ch, 'B');
  const middle = anchoredInkMatchCut(from, to, 20, 10, 0.42, cut, null, moving);
  let movingCells = 0;
  for (let y = 0; y < middle.rows; y++) for (let x = 0; x < middle.cols; x++) if (middle.getCell(x, y)?.ch === 'M') movingCells++;
  assert.ok(movingCells > 0);
});

test('ink transitions preserve authored plate coordinates instead of panning or zooming', () => {
  const from = markerSurface(40, 20, 8, 5, 'S');
  const to = markerSurface(40, 20, 31, 15, 'T');
  const cut = { from: { x: 0.72, y: 0.24 }, to: { x: 0.2, y: 0.8 }, direction: { x: 1, y: 0.4 } };
  for (const progress of [0.15, 0.35, 0.65, 0.85]) {
    const frame = anchoredInkMatchCut(from, to, 40, 20, progress, cut);
    const source = glyphPosition(frame, 'S');
    const target = glyphPosition(frame, 'T');
    if (source) assert.ok(Math.hypot(source.x - 8, source.y - 5) <= 2, `source drifted at ${progress}`);
    if (target) assert.ok(Math.hypot(target.x - 31, target.y - 15) <= 2, `target drifted at ${progress}`);
  }
});

test('every anchored transition has visible source, seam, and destination frames', () => {
  const scene = new LivingTitleScene();
  for (let act = 0; act < 4; act++) {
    const start = LIVING_TITLE_ACT_BOUNDARIES[act];
    const end = LIVING_TITLE_ACT_BOUNDARIES[act + 1];
    const morphStart = start + (end - start) * LIVING_TITLE_MORPH_STARTS[act];
    for (const mix of [0.2, 0.5, 0.9]) {
      const progress = morphStart + (end - morphStart) * mix;
      const frame = scene.frame({ cols: 80, rows: 36, timeSeconds: 1, progress });
      assert.ok(countPaintedCells(frame) > 40, `transition ${act} at mix ${mix} should remain visible`);
    }
  }
});

test('Cover Flow title and Chess handoff never collapse into an empty ultrawide frame', () => {
  const scene = new LivingTitleScene();
  const start = LIVING_TITLE_ACT_BOUNDARIES[1];
  const end = LIVING_TITLE_ACT_BOUNDARIES[2];
  for (let local = 0.76; local <= 1; local += 0.02) {
    const progress = start + (end - start) * local;
    const frame = scene.frame({ cols: 218, rows: 91, timeSeconds: 1, progress });
    assert.ok(countPaintedCells(frame) > 1_500, `ultrawide Cover Flow handoff at ${local.toFixed(2)} should stay visually occupied`);
  }
});

test('transition plate cache stays bounded across repeated viewport resizes', () => {
  const scene = new LivingTitleScene();
  for (let index = 0; index < 14; index++) scene.prepareTransitionPart(0, 80 + index, 36, 'destination', 1);
  const plates = (scene as unknown as { transitionPlates: Map<string, unknown> }).transitionPlates;
  const refreshes = (scene as unknown as { transitionRefreshSource: Map<string, boolean> }).transitionRefreshSource;
  assert.equal(plates.size, 8);
  assert.ok(refreshes.size <= 8);
  assert.ok(!plates.has('0:80:36'));
  assert.ok(plates.has('0:93:36'));
});

function transitionProgresses(local: number): number[] {
  return [0, 1, 2, 3].map((act) => {
    const start = LIVING_TITLE_ACT_BOUNDARIES[act];
    return start + (LIVING_TITLE_ACT_BOUNDARIES[act + 1] - start) * local;
  });
}

function solidSurface(cols: number, rows: number, glyph: string, color: [number, number, number]): Surface {
  const surface = new Surface(cols, rows);
  surface.fillRect(0, 0, cols, rows, [0, 0, 0]);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) surface.setCell(x, y, glyph, color, [0, 0, 0]);
  return surface;
}

function markerSurface(cols: number, rows: number, x: number, y: number, glyph: string): Surface {
  const surface = new Surface(cols, rows);
  surface.fillRect(0, 0, cols, rows, [0, 0, 0]);
  surface.setCell(x, y, glyph, [240, 240, 240], [0, 0, 0]);
  return surface;
}

function glyphPosition(surface: Surface, glyph: string): { x: number; y: number } | null {
  for (let y = 0; y < surface.rows; y++) for (let x = 0; x < surface.cols; x++) if (surface.getCell(x, y)?.ch === glyph) return { x, y };
  return null;
}

function countPaintedCells(frame: ReturnType<LivingTitleScene['frame']>): number {
  let count = 0;
  for (let y = 0; y < frame.rows; y++) {
    for (let x = 0; x < frame.cols; x++) {
      const cell = frame.getCell(x, y);
      if (cell?.opaque && (cell.ch !== ' ' || cell.fg.some((channel) => channel > 10))) count++;
    }
  }
  return count;
}

function allCellBackgroundsAreBlack(frame: ReturnType<LivingTitleScene['frame']>): boolean {
  for (let y = 0; y < frame.rows; y++) {
    for (let x = 0; x < frame.cols; x++) {
      const cell = frame.getCell(x, y);
      if (cell?.opaque && cell.bg.some((channel) => channel !== 0)) return false;
    }
  }
  return true;
}

function surfaceSignature(frame: ReturnType<LivingTitleScene['frame']>): string {
  let signature = '';
  for (let y = 0; y < frame.rows; y++) for (let x = 0; x < frame.cols; x++) {
    const cell = frame.getCell(x, y);
    if (cell?.opaque) signature += `${x},${y},${cell.ch},${cell.fg.join('.')};`;
  }
  return signature;
}
