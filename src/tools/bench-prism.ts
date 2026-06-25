// Render-only benchmark for the prism scene (exercises glassMaterial) so the
// allocation-free material rewrite can be measured the same way the chess fix was.
import { RenderTarget } from '../engine/index.ts';
import { PrismScene } from '../arcade/prism.ts';

const cols = Number(process.argv[2]) || 140;
const rows = Number(process.argv[3]) || 50;
const FRAMES = Number(process.argv[4]) || 150;
const SS = 3;
const target = new RenderTarget(cols * SS, (rows - 2) * 2 * SS);
const scene = new PrismScene();

function med(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

for (let i = 0; i < 20; i++) scene.renderScene(target, i * 0.05); // warmup
const samples: number[] = [];
for (let i = 0; i < FRAMES; i++) {
  const t = 0.3 + i * 0.02;
  const t0 = performance.now();
  scene.renderScene(target, t);
  samples.push(performance.now() - t0);
}
console.log(`prism render-only @ ${cols}x${rows} (RT ${target.width}x${target.height}): med ${med(samples).toFixed(2)}ms`);
