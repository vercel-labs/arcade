import { performance } from 'node:perf_hooks';
import { LivingTitleScene } from '../web/living-title-scene.ts';
import { CanvasSurfaceHost, type Canvas2DContextLike, type CanvasLike } from '../web/canvas-surface-host.ts';
import { LIVING_TITLE_ACT_BOUNDARIES, LIVING_TITLE_MORPH_STARTS } from '../cinematic/timeline.ts';

const cols = Number(process.argv[2] ?? 210);
const rows = Number(process.argv[3] ?? 54);
const json = process.argv.includes('--json');
const results: Array<Record<string, string | number>> = [];
const scene = new LivingTitleScene();
const transitions = ['prism-covers', 'covers-chess', 'chess-poker', 'poker-islanders'].map((name, act) => {
  const start = LIVING_TITLE_ACT_BOUNDARIES[act];
  const end = LIVING_TITLE_ACT_BOUNDARIES[act + 1];
  const morph = start + (end - start) * LIVING_TITLE_MORPH_STARTS[act];
  return [name, act, morph + (end - morph) * 0.5] as const;
});

for (const [name, act, progress] of transitions) {
  const primeStart = performance.now();
  scene.prepareTransition(act, cols, rows, 1);
  const primeMs = performance.now() - primeStart;
  const samples: number[] = [];
  for (let frame = 0; frame < 30; frame++) {
    const start = performance.now();
    scene.frame({ cols, rows, timeSeconds: 1 + frame / 60, progress });
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  results.push({ kind: 'transition', name, cols, rows, primeMs, medianMs: median, p95Ms: p95, fps: 1000 / median });
  if (!json) console.log(`${name.padEnd(14)} prime=${primeMs.toFixed(1)}ms median=${median.toFixed(1)}ms p95=${p95.toFixed(1)}ms  ${(1000 / median).toFixed(0)} fps`);
  if (p95 > 16.7) process.exitCode = 1;
}

const context: Canvas2DContextLike & { commands: number } = {
  commands: 0, fillStyle: '', font: '', globalAlpha: 1, textAlign: '', textBaseline: '',
  fillRect() { this.commands++; }, fillText() { this.commands++; },
};
const canvas: CanvasLike = { width: 0, height: 0, style: { width: '', height: '' }, getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
const host = new CanvasSurfaceHost(canvas, { devicePixelRatio: 1, cellAspectRatio: 0.5 });
host.resize(cols * 6, rows * 12, cols, rows);
for (const [name, progress] of [['prism', .04], ['covers', .17], ['chess', .38], ['poker', .62], ['islanders', .86]] as const) {
  const frameTimes: number[] = [], drawTimes: number[] = [], commands: number[] = [];
  for (let frame = 0; frame < 40; frame++) {
    const started = performance.now();
    const surface = scene.frame({ cols, rows, timeSeconds: 4 + frame / 60, progress });
    const rendered = performance.now(); context.commands = 0; host.draw(surface);
    frameTimes.push(rendered - started); drawTimes.push(performance.now() - rendered); commands.push(context.commands);
  }
  frameTimes.sort((a,b)=>a-b); drawTimes.sort((a,b)=>a-b); commands.sort((a,b)=>a-b);
  const sceneP50 = percentile(frameTimes,.5), sceneP95 = percentile(frameTimes,.95), drawP50 = percentile(drawTimes,.5), drawP95 = percentile(drawTimes,.95);
  results.push({ kind: 'scene', name, cols, rows, sceneP50Ms: sceneP50, sceneP95Ms: sceneP95, drawP50Ms: drawP50, drawP95Ms: drawP95, fps: 1000 / (sceneP50 + drawP50), commands: percentile(commands,.5) });
  if (!json) console.log(`${name.padEnd(14)} scene p50=${sceneP50.toFixed(1)}ms p95=${sceneP95.toFixed(1)}ms draw p50=${drawP50.toFixed(1)}ms p95=${drawP95.toFixed(1)}ms  ${(1000 / (sceneP50 + drawP50)).toFixed(0)} fps  cmds=${percentile(commands,.5)}`);
}

if (json) console.log(JSON.stringify({ cols, rows, results }, null, 2));

function percentile(values:number[], p:number):number { return values[Math.min(values.length-1,Math.floor(values.length*p))]; }
