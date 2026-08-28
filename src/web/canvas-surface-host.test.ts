import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Surface } from '../engine/index.ts';
import { CanvasSurfaceHost, type Canvas2DContextLike, type CanvasLike } from './canvas-surface-host.ts';

test('canvas host sizes, paints, and maps pointer coordinates without DOM globals', () => {
  const calls: string[] = [];
  const context: Canvas2DContextLike = {
    fillStyle: '',
    font: '',
    globalAlpha: 1,
    textAlign: '',
    textBaseline: '',
    fillRect: (x, y, width, height) => calls.push(`rect:${x}:${y}:${width}:${height}`),
    fillText: (text, x, y) => calls.push(`text:${text}:${x}:${y}`),
  };
  const canvas: CanvasLike = {
    width: 0,
    height: 0,
    style: { width: '', height: '' },
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  };
  const host = new CanvasSurfaceHost(canvas, { devicePixelRatio: 2 });
  host.resize(100, 60, 10, 6);
  const surface = new Surface(10, 6);
  surface.fillRect(0, 0, 10, 6, [0, 0, 0]);
  surface.drawText(2, 3, 'A', [255, 255, 255], [0, 0, 0]);
  host.draw(surface);

  assert.equal(canvas.width, 200);
  assert.equal(canvas.height, 120);
  assert.deepEqual(host.cellAt(35, 55), { x: 2, y: 3 });
  assert.ok(calls.some((call) => call.startsWith('text:A:')));
});
