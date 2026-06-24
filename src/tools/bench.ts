// Headless per-stage benchmark for the chess scene. Drives the real render +
// present pipeline (no TTY) and reports where per-frame time actually goes, so
// optimization targets the dominant layer instead of guessing.
//
//   pnpm exec tsx src/tools/bench.ts [cols] [rows] [frames]
import { downsample, RenderTarget, toHalfBlock, toLuminance, toShapeGlyph } from '../engine/index.ts';
import { ChessGameScene } from '../arcade/chess-game.ts';

const cols = Number(process.argv[2]) || 140;
const rows = Number(process.argv[3]) || 50;
const FRAMES = Number(process.argv[4]) || 200;
const SS = Number(process.argv[5]) || 3;
const presentRows = rows - 2; // mirrors ATTRACT_RESERVE in main.ts

const target = new RenderTarget(cols * SS, presentRows * 2 * SS);
const scene = new ChessGameScene();

// ── timing helper ────────────────────────────────────────────────────────────
interface Stat {
  label: string;
  samples: number[];
}
function stat(label: string): Stat {
  return { label, samples: [] };
}
function time(s: Stat, fn: () => void): void {
  const t0 = performance.now();
  fn();
  s.samples.push(performance.now() - t0);
}
function report(s: Stat, extra = ''): void {
  const xs = [...s.samples].sort((a, b) => a - b);
  const med = xs[xs.length >> 1];
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const p95 = xs[Math.floor(xs.length * 0.95)];
  console.log(
    `${s.label.padEnd(22)} med ${med.toFixed(3)}ms  mean ${mean.toFixed(3)}ms  p95 ${p95.toFixed(3)}ms${extra}`,
  );
}

// ── stages ───────────────────────────────────────────────────────────────────
const sRender = stat('render (rasterize)');
const sAscii = stat('present ascii(glyph)');
const sLum = stat('present luminance');
const sDown = stat('downsample (SS=3)');
const sHalf = stat('present halfblock');

let sink = 0; // defeat dead-code elimination
let asciiBytes = 0;
let halfBytes = 0;
let display: ReturnType<typeof downsample> | undefined;

// warmup (JIT)
for (let i = 0; i < 20; i++) {
  scene.renderScene(target);
  sink += toShapeGlyph(target, cols, presentRows, { color: true }).length;
}

for (let i = 0; i < FRAMES; i++) {
  time(sRender, () => scene.renderScene(target));

  time(sAscii, () => {
    const out = toShapeGlyph(target, cols, presentRows, { color: true });
    asciiBytes = out.length;
    sink += out.length;
  });

  time(sLum, () => {
    const out = toLuminance(target, cols, presentRows, { color: true });
    sink += out.length;
  });

  time(sDown, () => {
    display = downsample(target, SS, display);
  });
  time(sHalf, () => {
    const out = toHalfBlock(display!);
    halfBytes = out.length;
    sink += out.length;
  });
}

// ── triangle / fill stats ──────────────────────────────────────────────────
console.log(`\nchess scene @ ${cols}x${rows}  (RT ${target.width}x${target.height} px, SS=${SS})  ${FRAMES} frames`);
console.log('─'.repeat(72));
report(sRender);
console.log('  ── present, per mode (pick ONE per frame) ──');
report(sAscii, `   out ${(asciiBytes / 1024).toFixed(1)}KB/frame`);
report(sLum);
report(sDown);
report(sHalf, `   out ${(halfBytes / 1024).toFixed(1)}KB/frame (after downsample)`);
console.log('─'.repeat(72));
const medRender = [...sRender.samples].sort((a, b) => a - b)[sRender.samples.length >> 1];
const medAscii = [...sAscii.samples].sort((a, b) => a - b)[sAscii.samples.length >> 1];
const frameAscii = medRender + medAscii;
console.log(`ASCII frame total (render+present): ${frameAscii.toFixed(3)}ms  →  ${(1000 / frameAscii).toFixed(0)} fps headroom`);
console.log(`budget @30fps = 33.3ms;  @60fps = 16.7ms`);
console.log(`sink=${sink}`); // keep
