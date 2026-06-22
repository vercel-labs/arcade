import { renderDemo } from './scene.ts';
import { downsample, RenderTarget, toHalfBlock } from '../engine/index.ts';
import { createInputParser } from '../platform/input.ts';
import * as term from '../platform/terminal.ts';

const FPS = 30;
// Supersample factor: render this many times larger per axis, then box-average
// down for antialiased edges. 2 is a good quality/cost balance; 3 is smoother.
const SS = 2;

let cols = process.stdout.columns ?? 80;
let rows = process.stdout.rows ?? 24;
let target = new RenderTarget(cols * SS, (rows - 1) * 2 * SS);
let display: RenderTarget | undefined;
let t = 0;
let frame: ReturnType<typeof setInterval> | undefined;

function quit(): void {
  if (frame) clearInterval(frame);
  term.leave();
  process.exit(0);
}

const parse = createInputParser({
  onKey(key) {
    if (key === 'quit' || key === 'q' || key === 'escape') quit();
  },
});

function hud(): string {
  const text = ' engine demo — rotating lit cube · q: quit ';
  return `\x1b[${rows};1H\x1b[2m${text.slice(0, cols)}\x1b[0m\x1b[K`;
}

process.stdout.on('resize', () => {
  cols = process.stdout.columns ?? 80;
  rows = process.stdout.rows ?? 24;
  target = new RenderTarget(cols * SS, (rows - 1) * 2 * SS);
  display = undefined;
});

term.enter();
process.stdin.on('data', parse);
frame = setInterval(() => {
  t += 1 / FPS;
  renderDemo(target, t);
  display = downsample(target, SS, display);
  process.stdout.write(toHalfBlock(display) + hud());
}, 1000 / FPS);
