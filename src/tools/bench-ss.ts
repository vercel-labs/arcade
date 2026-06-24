// Decisive experiment: is the rasterizer fill-bound (per-pixel) or setup-bound
// (per-triangle)? Render the SAME chess scene at SS=1/2/3 and compare. Fill cost
// scales with SS^2; setup cost is constant in SS. The scaling tells us whether
// to attack resolution/overdraw or triangle count.
import { RenderTarget } from '../engine/index.ts';
import { ChessGameScene } from '../arcade/chess-game.ts';

const cols = Number(process.argv[2]) || 140;
const rows = Number(process.argv[3]) || 50;
const FRAMES = Number(process.argv[4]) || 120;
const presentRows = rows - 2;

const scene = new ChessGameScene();

function med(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

console.log(`chess render-only, ${cols}x${rows}, ${FRAMES} frames/level`);
console.log('─'.repeat(60));
const px: Record<number, number> = {};
const ms: Record<number, number> = {};
for (const SS of [1, 2, 3, 4]) {
  const target = new RenderTarget(cols * SS, presentRows * 2 * SS);
  for (let i = 0; i < 20; i++) scene.renderScene(target); // warmup
  const samples: number[] = [];
  for (let i = 0; i < FRAMES; i++) {
    const t0 = performance.now();
    scene.renderScene(target);
    samples.push(performance.now() - t0);
  }
  const m = med(samples);
  const pixels = target.width * target.height;
  px[SS] = pixels;
  ms[SS] = m;
  console.log(`SS=${SS}  ${String(target.width).padStart(4)}x${String(target.height).padStart(3)} = ${(pixels / 1000).toFixed(0)}k px   med ${m.toFixed(2)}ms`);
}
console.log('─'.repeat(60));
// If fill-bound, ms should scale ~linearly with pixel count. Fit the implied
// per-pixel cost and the constant (setup) floor via the two extremes.
const lo = 1;
const hi = 4;
const slope = (ms[hi] - ms[lo]) / (px[hi] - px[lo]); // ms per pixel
const setupFloor = ms[lo] - slope * px[lo]; // ms independent of pixels
console.log(`implied per-pixel fill: ${(slope * 1e6).toFixed(3)} ms / megapixel`);
console.log(`implied setup floor (SS-independent): ${setupFloor.toFixed(2)}ms`);
console.log(`→ at SS=3, fill ≈ ${(slope * px[3]).toFixed(1)}ms, setup ≈ ${setupFloor.toFixed(1)}ms`);
