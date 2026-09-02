import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Surface } from '../engine/index.ts';
import { CanvasSurfaceHost, TERMINAL_CELL_ASPECT_RATIO, type Canvas2DContextLike, type CanvasLike } from './canvas-surface-host.ts';

test('canvas host sizes, paints, and maps pointer coordinates without DOM globals', () => {
  const calls: string[] = [];
  const context: Canvas2DContextLike = {
    fillStyle: '',
    font: '',
    globalAlpha: 1,
    textAlign: '',
    textBaseline: '',
    fillRect: (x, y, width, height) => calls.push(`rect:${x}:${y}:${width}:${height}`),
    fillText: (text, x, y) => calls.push(`text:${text}:${x.toFixed(1)}:${y.toFixed(1)}`),
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

test('responsive canvas hosts leave CSS sizing to layout while resizing backing pixels', () => {
  const context: Canvas2DContextLike = { fillStyle: '', font: '', globalAlpha: 1, textAlign: '', textBaseline: '', fillRect() {}, fillText() {} };
  const canvas: CanvasLike = { width: 0, height: 0, style: { width: '100%', height: '100%' }, getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const host = new CanvasSurfaceHost(canvas, { devicePixelRatio: 2, manageCssSize: false });
  host.resize(390, 844, 65, 70);
  assert.equal(canvas.width, 780);
  assert.equal(canvas.height, 1688);
  assert.deepEqual(canvas.style, { width: '100%', height: '100%' });
});

test('canvas host preserves terminal cell geometry and centers the grid', () => {
  const calls: string[] = [];
  const context: Canvas2DContextLike = {
    fillStyle: '', font: '', globalAlpha: 1, textAlign: '', textBaseline: '',
    fillRect: (x, y, width, height) => calls.push(`rect:${x}:${y}:${width}:${height}`),
    fillText: (text, x, y) => calls.push(`text:${text}:${x.toFixed(1)}:${y.toFixed(1)}`),
  };
  const canvas: CanvasLike = {
    width: 0, height: 0, style: { width: '', height: '' },
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  const host = new CanvasSurfaceHost(canvas, { cellAspectRatio: TERMINAL_CELL_ASPECT_RATIO });
  host.resize(200, 100, 20, 10);
  const surface = new Surface(20, 10);
  surface.drawText(0, 0, 'A', [255, 255, 255], [0, 0, 0]);
  host.draw(surface);

  assert.deepEqual(host.cellAt(55, 5), { x: 1, y: 0 });
  assert.ok(calls.includes('text:A:52.5:8.4'));
  assert.equal(context.textAlign, 'center');
});

test('canvas host accepts a resolved font family and scales glyphs to the cell', () => {
  let assignedFont = '';
  const context: Canvas2DContextLike = {
    fillStyle: '', get font() { return assignedFont; }, set font(value) { assignedFont = value; },
    globalAlpha: 1, textAlign: '', textBaseline: '', fillRect: () => {}, fillText: () => {},
  };
  const canvas: CanvasLike = { width: 0, height: 0, style: { width: '', height: '' }, getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const host = new CanvasSurfaceHost(canvas, { fontFamily: '"GeistMono", monospace', fontScale: 1.08 });
  host.resize(50, 20, 5, 1);
  const surface = new Surface(5, 1); surface.drawText(0, 0, 'W', [255, 255, 255], [0, 0, 0]); host.draw(surface);
  assert.equal(assignedFont, '500 21.6px "GeistMono", monospace');
  assert.ok(!assignedFont.includes('var('));
});

test('canvas host does not repaint black backgrounds after clearing the backing canvas', () => {
  const calls: string[] = [];
  const context: Canvas2DContextLike = {
    fillStyle: '', font: '', globalAlpha: 1, textAlign: '', textBaseline: '',
    fillRect: (x, y, width, height) => calls.push(`rect:${x}:${y}:${width}:${height}`),
    fillText: () => {},
  };
  const canvas: CanvasLike = {
    width: 0, height: 0, style: { width: '', height: '' },
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  const host = new CanvasSurfaceHost(canvas, { devicePixelRatio: 1, background: '#000000' });
  const surface = new Surface(2, 1);
  surface.fillRect(0, 0, 2, 1, [0, 0, 0]);
  surface.setCell(0, 0, 'A', [255, 255, 255], [0, 0, 0]);
  host.resize(20, 10, 2, 1);
  host.draw(surface);
  assert.equal(calls.length, 1);
  assert.equal(context.fillStyle, 'rgb(255 255 255)');
});

test('terminal cell aspect matches the renderer projection convention', () => {
  const cols = 140;
  const rows = 50;
  assert.equal(
    cols * TERMINAL_CELL_ASPECT_RATIO / rows,
    cols / (rows * 2),
  );
});

test('canvas host submits no drawing commands for an identical retained frame', () => {
  let calls = 0;
  const context: Canvas2DContextLike = { fillStyle: '', font: '', globalAlpha: 1, textAlign: '', textBaseline: '', fillRect: () => { calls++; }, fillText: () => { calls++; } };
  const canvas: CanvasLike = { width: 0, height: 0, style: { width: '', height: '' }, getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const host = new CanvasSurfaceHost(canvas);
  const surface = new Surface(20, 10); surface.fillRect(0, 0, 20, 10, [0, 0, 0]); surface.drawText(4, 4, 'ARCADE', [220, 230, 240], [0, 0, 0]);
  host.resize(200, 100, 20, 10); host.draw(surface); calls = 0; host.draw(surface);
  assert.equal(calls, 0);
});

test('canvas host erases a changed cell and its glyph-overhang neighbors', () => {
  const calls: string[] = [];
  const context: Canvas2DContextLike = { fillStyle: '', font: '', globalAlpha: 1, textAlign: '', textBaseline: '', fillRect: (x,y,w,h) => calls.push(`r:${x}:${y}:${w}:${h}`), fillText: (t) => calls.push(`t:${t}`) };
  const canvas: CanvasLike = { width: 0, height: 0, style: { width: '', height: '' }, getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const host = new CanvasSurfaceHost(canvas); const a = new Surface(20, 10); a.fillRect(0, 0, 20, 10, [0,0,0]); a.drawText(2,2,'A',[255,255,255],[0,0,0]);
  host.resize(200,100,20,10); host.draw(a); calls.length=0; const b=new Surface(20,10);a.copyInto(b);b.drawText(2,2,'B',[255,255,255],[0,0,0]);host.draw(b);
  assert.equal(calls.filter((call) => call.startsWith('r:')).length, 9);
  assert.ok(calls.includes('r:20:20:10:10'));
  assert.ok(calls.includes('r:10:10:10:10'));
  assert.ok(calls.includes('r:30:30:10:10'));
  assert.ok(calls.includes('t:B'));
});

test('partial repaint resets the real canvas fill before erasing stale glyphs', () => {
  const erases: string[] = [];
  const context: Canvas2DContextLike = {
    fillStyle: '', font: '', globalAlpha: 1, textAlign: '', textBaseline: '',
    fillRect: () => erases.push(context.fillStyle), fillText: () => {},
  };
  const canvas: CanvasLike = { width: 0, height: 0, style: { width: '', height: '' }, getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const host = new CanvasSurfaceHost(canvas);
  const first = new Surface(20, 10); first.fillRect(0, 0, 20, 10, [0,0,0]); first.drawText(2, 2, 'A', [45, 90, 180], [0,0,0]);
  host.resize(200, 100, 20, 10); host.draw(first);
  context.fillStyle = 'rgb(45 90 180)'; erases.length = 0;
  const next = new Surface(20, 10); first.copyInto(next); next.drawText(2, 2, 'B', [255,255,255], [0,0,0]);
  host.draw(next);
  assert.ok(erases.length >= 9);
  assert.deepEqual(erases.slice(0, 9), Array(9).fill('#000000'));
});

test('partial repaint clears every dirty neighbor before drawing any overhanging glyph', () => {
  const calls: string[] = [];
  const context: Canvas2DContextLike = {
    fillStyle: '', font: '', globalAlpha: 1, textAlign: '', textBaseline: '',
    fillRect: () => calls.push('erase'), fillText: (text) => calls.push(`glyph:${text}`),
  };
  const canvas: CanvasLike = { width: 0, height: 0, style: { width: '', height: '' }, getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const host = new CanvasSurfaceHost(canvas);
  const first = new Surface(20, 10); first.fillRect(0, 0, 20, 10, [0,0,0]); first.drawText(4, 4, 'WW', [180,220,255], [0,0,0]);
  host.resize(200, 100, 20, 10); host.draw(first); calls.length = 0;
  const next = new Surface(20, 10); first.copyInto(next); next.drawText(4, 4, 'WM', [180,220,255], [0,0,0]);
  host.draw(next);
  const firstGlyph = calls.findIndex((call) => call.startsWith('glyph:'));
  assert.equal(firstGlyph, 9, `glyph drawn before all neighbor clears: ${calls.join(',')}`);
  assert.ok(calls.slice(firstGlyph).includes('glyph:W'));
  assert.ok(calls.slice(firstGlyph).includes('glyph:M'));
});

test('forceFull bypasses retained repainting for dense animated scenes', () => {
  const calls: string[] = [];
  const context: Canvas2DContextLike = {
    fillStyle: '', font: '', globalAlpha: 1, textAlign: '', textBaseline: '',
    fillRect: (x,y,w,h) => calls.push(`rect:${x}:${y}:${w}:${h}`), fillText: (text) => calls.push(`glyph:${text}`),
  };
  const canvas: CanvasLike = { width: 0, height: 0, style: { width: '', height: '' }, getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const host = new CanvasSurfaceHost(canvas);
  const surface = new Surface(20, 10); surface.fillRect(0, 0, 20, 10, [0,0,0]); surface.drawText(4, 4, 'SHEEP', [180,220,255], [0,0,0]);
  host.resize(200, 100, 20, 10); host.draw(surface); calls.length = 0;
  host.draw(surface, { forceFull: true });
  assert.equal(calls[0], 'rect:0:0:200:100');
  assert.equal(calls.filter((call) => call.startsWith('glyph:')).length, 5);
});
