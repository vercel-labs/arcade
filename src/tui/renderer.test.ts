import assert from 'node:assert/strict';
import test from 'node:test';
import { Renderer } from './renderer.ts';

class FakeOutput {
  writes: string[] = [];
  accept = true;
  private drain: (() => void) | null = null;

  write(value: string | Uint8Array): boolean {
    this.writes.push(String(value));
    return this.accept;
  }

  once(event: string, listener: () => void): this {
    assert.equal(event, 'drain');
    this.drain = listener;
    return this;
  }

  emitDrain(): void {
    const listener = this.drain;
    this.drain = null;
    listener?.();
  }
}

test('adaptive renderer demotes expensive work and promotes only after a full cheap window', () => {
  let now = 0;
  let work = 14;
  const output = new FakeOutput();
  const renderer = new Renderer({ maxFps: 60, minFps: 30, fastFrameBudgetMs: 13, sampleWindow: 4, overloadWindow: 4, output, now: () => now });
  renderer.requestLive();
  renderer.onFrame(() => { now += work; });

  for (let i = 0; i < 4; i++) renderer.tick(true);
  assert.equal(renderer.activeFps, 30);
  work = 5;
  for (let i = 0; i < 3; i++) renderer.tick(true);
  assert.equal(renderer.activeFps, 30, 'promotion waits for the complete hysteresis window');
  renderer.tick(true);
  assert.equal(renderer.activeFps, 60);
});

test('backpressure drops stale frame requests and resumes with newest wall-clock state', () => {
  let now = 100;
  const output = new FakeOutput();
  output.accept = false;
  const deltas: number[] = [];
  const renderer = new Renderer({ maxFps: 60, minFps: 30, sampleWindow: 4, output, now: () => now });
  renderer.onFrame((dt) => {
    deltas.push(dt);
    renderer.write(`frame-${deltas.length}`);
    now += 2;
  });

  renderer.requestRender();
  renderer.tick(true);
  assert.deepEqual(output.writes, ['frame-1']);
  renderer.requestRender();
  renderer.requestRender();
  now = 200;
  renderer.tick(true);
  assert.equal(deltas.length, 1, 'no obsolete work is produced while stdout is blocked');

  output.accept = true;
  output.emitDrain();
  assert.deepEqual(output.writes, ['frame-1', 'frame-2']);
  assert.equal(deltas.length, 2, 'several blocked requests coalesce into one latest frame');
  assert.ok(deltas[1] >= 0.098, 'animation delta includes time spent waiting for terminal drain');
});

test('steady cadence skips alternating 60 Hz heartbeats without losing requested work', () => {
  let now = 0;
  let work = 14;
  const renderer = new Renderer({ maxFps: 60, minFps: 30, fastFrameBudgetMs: 13, sampleWindow: 4, overloadWindow: 4, output: new FakeOutput(), now: () => now });
  let frames = 0;
  renderer.requestLive();
  renderer.onFrame(() => { frames++; now += work; });
  for (let i = 0; i < 4; i++) renderer.tick(true);
  assert.equal(renderer.activeFps, 30);

  work = 0;
  now = 100;
  renderer.tick(true);
  const after = frames;
  now += 16.7;
  renderer.tick();
  assert.equal(frames, after, '30 Hz mode skips the intermediate heartbeat');
  now += 16.7;
  renderer.tick();
  assert.equal(frames, after + 1);
});
