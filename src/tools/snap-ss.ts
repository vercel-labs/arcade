// Render the chess scene at a given supersample factor to PNG-able PPM, so SS
// levels can be compared for fidelity. Usage: tsx snap-ss.ts <SS> <cols> <rows>
import { writeFileSync } from 'node:fs';
import { downsample, RenderTarget } from '../engine/index.ts';
import { ChessGameScene } from '../arcade/chess-game.ts';

const SS = Number(process.argv[2]) || 3;
const cols = Number(process.argv[3]) || 140;
const rows = Number(process.argv[4]) || 50;
const out = process.argv[5] || `.snapshots/chess-ss${SS}.ppm`;

const target = new RenderTarget(cols * SS, (rows - 2) * 2 * SS);
new ChessGameScene().renderScene(target);
const display = downsample(target, SS);

const W = display.width;
const H = display.height;
const body = Buffer.alloc(W * H * 3);
const c = display.color;
for (let i = 0; i < W * H * 3; i++) {
  const v = c[i];
  body[i] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}
writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii'), body]));
console.log(`wrote ${out} (${W}x${H})`);
