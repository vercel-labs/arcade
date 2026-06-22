// Headless render of a scene frame to a PPM image (convert to PNG with `sips`).
// Lets the rendered output be viewed directly as an image instead of a live TTY.
//
//   pnpm exec tsx src/tools/snapshot.ts [cols] [rows] [t] [out.ppm]
import { writeFileSync } from 'node:fs';
import { bloom, downsample, RenderTarget } from '../engine/index.ts';
import { AttractScene } from '../arcade/attract.ts';

const cols = Number(process.argv[2]) || 110;
const rows = Number(process.argv[3]) || 44;
const t = Number(process.argv[4]) || 0.6;
const out = process.argv[5] || '.snapshots/attract.ppm';
const SS = 3;

const scene = new AttractScene();
const target = new RenderTarget(cols * SS, (rows - 1) * 2 * SS);
scene.renderScene(target, t);
const display = downsample(target, SS);
bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });

const W = display.width;
const H = display.height;
const header = `P6\n${W} ${H}\n255\n`;
const body = Buffer.alloc(W * H * 3);
const c = display.color;
for (let i = 0; i < W * H * 3; i++) {
  const v = c[i];
  body[i] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}
writeFileSync(out, Buffer.concat([Buffer.from(header, 'ascii'), body]));
console.log(`wrote ${out} (${W}x${H})`);
