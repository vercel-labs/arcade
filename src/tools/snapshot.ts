// Headless render of a scene frame to a PPM image (convert to PNG with `sips`).
// Lets the rendered output be viewed directly as an image instead of a live TTY.
//
//   pnpm exec tsx src/tools/snapshot.ts [cols] [rows] [t] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts chess [cols] [rows] [out.ppm]
import { writeFileSync } from 'node:fs';
import { bloom, downsample, RenderTarget } from '../engine/index.ts';
import { AttractScene } from '../arcade/attract.ts';
import { ChessScene } from '../arcade/chess.ts';
import { ChessGameScene } from '../arcade/chess-game.ts';

const scene = process.argv[2] === 'chess' || process.argv[2] === 'chess-game' ? process.argv[2] : null;
const args = scene ? process.argv.slice(3) : process.argv.slice(2);
const cols = Number(args[0]) || 110;
const rows = Number(args[1]) || 44;
const t = Number(args[2]) || 0.6;
const out = args[3] || `.snapshots/${scene ?? 'attract'}.ppm`;
const SS = 3;

const target = new RenderTarget(cols * SS, (rows - 1) * 2 * SS);
if (scene === 'chess') {
  new ChessScene().renderScene(target);
} else if (scene === 'chess-game') {
  new ChessGameScene().renderScene(target);
} else {
  new AttractScene().renderScene(target, t);
}
const display = downsample(target, SS);
if (!scene) bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });

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
