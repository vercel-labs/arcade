import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TUTORIAL_CHAPTERS } from './chapters.ts';
import { TUTORIAL_NEXT_ID, TutorialController, type TutorialHost } from './tutorial.ts';

function host(gateway = true): TutorialHost & { shown: string[]; exited: number } {
  const h = {
    shown: [] as string[],
    exited: 0,
    stepAvailable: (step: { requires?: string }) => step.requires !== 'gateway' || gateway,
    show(chapter: { id: string }) {
      h.shown.push(chapter.id);
    },
    exit() {
      h.exited++;
    },
    requestRender() {},
  };
  return h;
}

test('every step signal is unique within its chapter and every chapter has copy', () => {
  for (const chapter of TUTORIAL_CHAPTERS) {
    assert.ok(chapter.intro.length > 0, `${chapter.id} intro`);
    const ids = new Set<string>();
    for (const step of chapter.steps) {
      assert.ok(!ids.has(step.id), `${chapter.id}.${step.id} duplicated`);
      ids.add(step.id);
      assert.ok(step.hint.length > 0, `${chapter.id}.${step.id} hint`);
    }
    if (chapter.steps.length === 0) assert.ok(chapter.action, `${chapter.id} needs a primary action`);
  }
});

test('signals tick steps in any order; a finished chapter waits for continue', () => {
  const h = host();
  const t = new TutorialController(h);
  t.start();
  assert.equal(t.chapter().id, 'welcome');
  assert.deepEqual(h.shown, ['welcome']);
  assert.ok(t.complete()); // step-less: complete on arrival, its action moves on
  t.next();
  assert.equal(t.chapter().id, 'camera');

  t.signal('camera.reset'); // out of order is fine
  t.signal('camera.zoom');
  assert.equal(t.currentStep()?.id, 'orbit');
  assert.ok(!t.complete());
  t.signal('nonsense'); // ignored
  t.signal('camera.orbit');
  t.signal('camera.pan');
  t.signal('camera.panKey');
  for (let i = 0; i < 3; i++) t.signal('terminal.denser');
  assert.equal(t.currentStep()?.id, 'font-bigger');
  for (let i = 0; i < 3; i++) t.signal('terminal.coarser');
  assert.ok(t.complete());
  assert.deepEqual(t.attentionIds(), [TUTORIAL_NEXT_ID]);
  t.signal('camera.zoom'); // more of the same changes nothing, and nothing advances by itself
  assert.equal(t.chapter().id, 'camera');
  t.next();
  assert.equal(t.chapter().id, 'menu');
  assert.deepEqual(h.shown, ['welcome', 'camera', 'menu']);
});

test('gateway steps drop out of the checklist when signed out and count when signed in', () => {
  const out = new TutorialController(host(false));
  out.start();
  out.next(); // camera
  out.next(); // menu
  out.next(); // chess
  const chess = out.chapter();
  const gated = chess.steps.filter((s) => s.requires === 'gateway');
  assert.equal(gated.length, 2);
  for (const step of chess.steps.filter((s) => !s.requires)) out.signal(typeof step.signal === 'string' ? step.signal : step.signal[0]);
  assert.ok(out.complete(), 'the chapter completes without the match steps');
  assert.ok(gated.every((s) => !out.isAvailable(s) && !out.isDone(s)));

  const inn = new TutorialController(host(true));
  inn.start();
  inn.next();
  inn.next();
  inn.next();
  for (const step of chess.steps.filter((s) => !s.requires)) inn.signal(typeof step.signal === 'string' ? step.signal : step.signal[0]);
  assert.ok(!inn.complete());
  assert.equal(inn.currentStep()?.id, 'start');
  inn.signal('chess.matchStarted');
  inn.signal('chess.swap');
  assert.ok(inn.complete());
});

test('a counted step ticks only after hearing its signal enough times', () => {
  const h = host();
  const t = new TutorialController(h);
  t.start();
  while (t.chapter().id !== 'keyboard') t.next();
  const display = t.chapter().steps.find((s) => s.id === 'display')!;
  t.signal('key.d');
  t.signal('key.d');
  assert.equal(t.stepProgress(display), 2);
  assert.ok(!t.isDone(display));
  t.signal('key.d');
  assert.ok(t.isDone(display));
});

test('a step listening to several signals completes on any of them', () => {
  const h = host();
  const t = new TutorialController(h);
  t.start();
  t.next(); // camera
  t.next(); // menu
  t.next(); // chess
  t.signal('chess.capture');
  assert.ok(t.isDone(t.chapter().steps.find((s) => s.id === 'move')!));
  assert.ok(!t.isDone(t.chapter().steps.find((s) => s.id === 'select')!));
});

test('back reopens the previous chapter with a fresh checklist and is inert on the first', () => {
  const h = host();
  const t = new TutorialController(h);
  t.start();
  t.prev();
  assert.equal(t.chapter().id, 'welcome');
  t.next(); // camera
  t.signal('camera.zoom');
  t.next(); // menu
  t.prev();
  assert.equal(t.chapter().id, 'camera');
  assert.ok(!t.isDone(t.chapter().steps[0]), 'progress does not carry back');
  assert.deepEqual(h.shown, ['welcome', 'camera', 'menu', 'camera']);
});

test('attention follows the current step; exit and the closing action both leave', () => {
  const h = host();
  const t = new TutorialController(h);
  t.start();
  t.next(); // camera
  t.next(); // menu
  assert.deepEqual(t.attentionIds(), ['chess-menu']);
  t.signal('ui.menuOpen');
  assert.deepEqual(t.attentionIds(), ['chess-menu-mode']);

  t.exit();
  assert.ok(!t.active());
  assert.equal(h.exited, 1);
  assert.deepEqual(t.attentionIds(), []);
  t.signal('ui.display'); // inert once stopped

  const t2 = new TutorialController(h);
  t2.start();
  while (t2.chapterIndex() < TUTORIAL_CHAPTERS.length - 1) t2.next();
  assert.equal(t2.chapter().id, 'done');
  assert.ok(t2.complete(), 'the closing chapter has no steps');
  t2.next(); // the "end tutorial" action
  assert.ok(!t2.active());
  assert.equal(h.exited, 2);
});
