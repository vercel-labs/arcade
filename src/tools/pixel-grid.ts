// Inspect a pixel-art PNG: detect its native logical grid (the sprite is usually
// authored small then upscaled, so each "pixel" is a kxk block), and print the
// recovered low-res grid as a char map + palette. Used to render sprites with
// clean integer scaling instead of guessing pixel boundaries.
//
//   pnpm exec tsx src/tools/pixel-grid.ts [public/assets/games/frogger.png]
import { readFileSync } from 'node:fs';
import { decodePng } from '../engine/index.ts';

const path = process.argv[2] ?? 'public/assets/games/frogger.png';
const t = decodePng(readFileSync(path));
const { width: W, height: H, data: d } = t;
const rgb = (x: number, y: number): [number, number, number] => {
  const i = (y * W + x) * 4;
  return [d[i], d[i + 1], d[i + 2]];
};
const diff = (a: number[], b: number[]): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const TOL = 60; // color-change threshold (ignores mild anti-aliasing)

// Collect the x/y offsets where the color changes along sampled scanlines; the
// GCD of those offsets is the cell size (the grid is aligned to 0).
const bounds = new Set<number>();
const ystep = Math.max(1, Math.floor(H / 80));
const xstep = Math.max(1, Math.floor(W / 80));
for (let y = 0; y < H; y += ystep) {
  let p = rgb(0, y);
  for (let x = 1; x < W; x++) {
    const c = rgb(x, y);
    if (diff(c, p) > TOL) bounds.add(x);
    p = c;
  }
}
for (let x = 0; x < W; x += xstep) {
  let p = rgb(x, 0);
  for (let y = 1; y < H; y++) {
    const c = rgb(x, y);
    if (diff(c, p) > TOL) bounds.add(y);
    p = c;
  }
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
// argv[3] forces a cell size (handy when AA defeats auto-detect).
const cell = Number(process.argv[3]) || [...bounds].reduce((g, v) => gcd(g, v), 0) || W;
const nx = Math.round(W / cell);
const ny = Math.round(H / cell);

// Recover the logical grid by sampling each cell's center; build a palette.
// A wide merge tolerance folds anti-aliased blends into their base color.
const PTOL = 110;
const palette: [number, number, number][] = [];
const keyOf = (c: number[]): number => {
  for (let i = 0; i < palette.length; i++) if (diff(palette[i], c) <= PTOL) return i;
  palette.push([c[0], c[1], c[2]]);
  return palette.length - 1;
};
const LETTERS = ' .:oOYGMBRCWyrgmbcw#%*+=';
const grid: number[][] = [];
for (let ly = 0; ly < ny; ly++) {
  const row: number[] = [];
  for (let lx = 0; lx < nx; lx++) {
    row.push(keyOf(rgb(Math.floor((lx + 0.5) * cell), Math.floor((ly + 0.5) * cell))));
  }
  grid.push(row);
}

console.log(`${path}`);
console.log(`image ${W}x${H}  ·  cell ${cell}px  ·  logical ${nx}x${ny}  ·  ${palette.length} colors`);
console.log('');
for (const row of grid) console.log(row.map((k) => LETTERS[k] ?? '?').join(''));
console.log('');
palette.forEach((c, i) => console.log(`  ${LETTERS[i]}  rgb(${c[0]}, ${c[1]}, ${c[2]})`));
