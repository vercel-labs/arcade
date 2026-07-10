// Procedural 3D poker chips (no model import): a short cylinder per denomination with a
// classic clay-chip face — an inner ring line and six evenly-spaced edge spots that wrap
// the rim onto the top/bottom faces — stacked into scattered columns. Purely a visual read
// of the live chip state: each seat's carried stack (beside its cards), the chips it has
// pushed out to bet, and the collected pot pile. Denomination values are chosen for 10/20
// blinds and $1000 starts, and player stacks are spread across denominations (not one fat
// tower) so a table of stacks reads as a lively mix of colors.

import { type Mat4, mat4Multiply, mat4RotY, mat4Translate, type Mesh, rasterize, type RenderTarget, lambertMaterial, type VertexIn, type Vec3 } from '../../../engine/index.ts';

// Classic casino colors, dialed a touch darker than neon so they sit into the felt. `base`
// is the chip body; `spot` is the edge/face marking (the ring line + the six rim spots).
interface Denom {
  value: number;
  base: Vec3;
  spot: Vec3;
}
const WHITE: Vec3 = { x: 224, y: 226, z: 234 };
const DENOMS: Denom[] = [
  { value: 500, base: { x: 40, y: 42, z: 50 }, spot: WHITE }, // black
  { value: 100, base: { x: 40, y: 128, z: 68 }, spot: WHITE }, // green
  { value: 50, base: { x: 48, y: 98, z: 172 }, spot: WHITE }, // blue
  { value: 20, base: { x: 168, y: 46, z: 50 }, spot: WHITE }, // red
  { value: 10, base: WHITE, spot: { x: 58, y: 100, z: 178 } }, // white (blue spots)
];
// Players decompose over the no-black set, balanced across denominations (a varied cluster
// of green/blue/red/white columns, never one dominant tower). The pot / bets use the full
// set, greedy → a compact black-bottomed pile like a real pot.
const PLAYER_VALUES = [100, 50, 20, 10];
const POT_VALUES = [500, 100, 50, 20, 10];

// Chip geometry + stacking (world units; a card is 1.0×1.4 for scale). Sized so a stack of
// a handful of chips reads as a real little tower from the overview.
const CHIP_R = 0.26;
const CHIP_H = 0.07;
const SEGMENTS = 18; // around; 18 = round enough, and divisible by 6 for even edge spots
const TICKS = 6; // edge/face spots (the classic six-spot rim)
const RING_INNER = 0.5; // fraction of R: inner disc radius
const RING_LINE = 0.64; // fraction of R: outer edge of the inner ring line
const PLAYER_COL_CAP = 6; // baseline player column height (grows for big stacks; see playerColumns)
const POT_COL_CAP = 20; // the pot pile can stack tall
const PILE_SPACING = 0.42; // grid pitch between columns (slightly < a chip Ø → a tight pile)
const BASE_Y = 0.02; // bottom chip rests just clear of the felt
const COL_JIT = 0.07; // per-column world jitter off the grid cell (an unruly pile, not a lattice)
const CHIP_JIT = 0.03; // per-chip world wobble so a column isn't a perfect cylinder

// One chip mesh per denomination, built once and drawn many. Flat clay disc: top + bottom
// faces each carry a base disc, a spot-colored ring line, and a base annulus with six
// spot-colored ticks; the side wall is base with the same six ticks wrapping the rim. All
// per-vertex color under lambert (cull: 'none', so winding is free).
const meshCache = new Map<number, Mesh>();
function chipMesh(value: number): Mesh {
  const cached = meshCache.get(value);
  if (cached) return cached;
  const d = DENOMS.find((x) => x.value === value) ?? DENOMS[DENOMS.length - 1];
  const V: VertexIn[] = [];
  const I: number[] = [];
  const top = CHIP_H / 2;
  const bot = -CHIP_H / 2;
  const ang = (s: number): number => (s / SEGMENTS) * Math.PI * 2;
  const rim = (s: number, rf: number): { x: number; z: number } => ({ x: Math.cos(ang(s)) * CHIP_R * rf, z: Math.sin(ang(s)) * CHIP_R * rf });
  const isTick = (s: number): boolean => s % (SEGMENTS / TICKS) === 0;
  const vert = (x: number, y: number, z: number, n: Vec3, col: Vec3): number => {
    V.push({ position: { x, y, z }, normal: n, uv: [0.5, 0.5], color: { ...col } });
    return V.length - 1;
  };
  const tri = (a: number, b: number, c: number): void => {
    I.push(a, b, c);
  };
  const quad = (p: { x: number; z: number }[], y: number[], n: Vec3, col: Vec3): void => {
    const a = vert(p[0].x, y[0], p[0].z, n, col);
    const b = vert(p[1].x, y[1], p[1].z, n, col);
    const c = vert(p[2].x, y[2], p[2].z, n, col);
    const e = vert(p[3].x, y[3], p[3].z, n, col);
    tri(a, b, c);
    tri(a, c, e);
  };
  // Top and bottom faces.
  for (const [y, ny] of [
    [top, { x: 0, y: 1, z: 0 }],
    [bot, { x: 0, y: -1, z: 0 }],
  ] as [number, Vec3][]) {
    const center = vert(0, y, 0, ny, d.base);
    for (let s = 0; s < SEGMENTS; s++) {
      const s1 = (s + 1) % SEGMENTS;
      const i0 = rim(s, RING_INNER);
      const i1 = rim(s1, RING_INNER);
      // Inner disc (base): a fan wedge to the centre.
      const a0 = vert(i0.x, y, i0.z, ny, d.base);
      const a1 = vert(i1.x, y, i1.z, ny, d.base);
      tri(center, a0, a1);
      // Ring line (spot): thin annulus RING_INNER → RING_LINE.
      const l0 = rim(s, RING_LINE);
      const l1 = rim(s1, RING_LINE);
      quad([i0, i1, l1, l0], [y, y, y, y], ny, d.spot);
      // Outer annulus (base, or spot on a tick segment): RING_LINE → rim.
      const o0 = rim(s, 1);
      const o1 = rim(s1, 1);
      quad([l0, l1, o1, o0], [y, y, y, y], ny, isTick(s) ? d.spot : d.base);
    }
  }
  // Side wall: one quad per segment, radial normal, ticks matching the face spots.
  for (let s = 0; s < SEGMENTS; s++) {
    const s1 = (s + 1) % SEGMENTS;
    const p0 = rim(s, 1);
    const p1 = rim(s1, 1);
    const mid = ang(s + 0.5);
    const n: Vec3 = { x: Math.cos(mid), y: 0, z: Math.sin(mid) };
    quad([p0, p1, p1, p0], [bot, bot, top, top], n, isTick(s) ? d.spot : d.base);
  }
  const mesh: Mesh = { vertices: V, indices: I };
  meshCache.set(value, mesh);
  return mesh;
}

// One column of `count` identical chips (a single denomination).
export interface ChipColumn {
  value: number;
  count: number;
}

// Greedy decomposition (biggest first), each column capped — a compact, high-denom pile.
function greedyColumns(amount: number, values: number[], cap: number): ChipColumn[] {
  const cols: ChipColumn[] = [];
  let rem = Math.max(0, Math.round(amount));
  for (const value of values) {
    let n = Math.floor(rem / value);
    rem -= n * value;
    while (n > 0) {
      const c = Math.min(cap, n);
      cols.push({ value, count: c });
      n -= c;
    }
  }
  return cols;
}

// Balanced decomposition: hand out one chip of each denomination in turn, so no single
// denomination runs away into a tall tower. Amounts are multiples of 10 (blinds are 10/20)
// and 10 is the smallest value, so this always terminates; the guard covers odd inputs.
function balancedCounts(amount: number, values: number[]): number[] {
  const counts = values.map(() => 0);
  let rem = Math.max(0, Math.round(amount));
  for (let i = 0, guard = 0; rem > 0 && guard < 100000; i++, guard++) {
    const vi = i % values.length;
    if (values[vi] <= rem) {
      counts[vi]++;
      rem -= values[vi];
    }
  }
  return counts;
}

// Turn per-denomination counts into short columns, interleaved by denomination so the
// cluster alternates colors (green/blue/red/white) rather than grouping like with like.
function splitColumns(counts: number[], values: number[], cap: number): ChipColumn[] {
  const rem = counts.slice();
  const cols: ChipColumn[] = [];
  for (let any = true; any; ) {
    any = false;
    for (let vi = 0; vi < values.length; vi++) {
      if (rem[vi] > 0) {
        const c = Math.min(cap, rem[vi]);
        cols.push({ value: values[vi], count: c });
        rem[vi] -= c;
        any = true;
      }
    }
  }
  return cols;
}

// A carried player stack (a varied square pile) and a pot / bet pile (compact, black-bottomed,
// greedy over the full denomination set). For a big stack the per-denomination columns grow
// taller (cap scales with the largest count) rather than sprawling into ever more columns, so
// the pile stays a bounded square — a taller/wider cluster still reads as "more chips".
export function playerColumns(amount: number): ChipColumn[] {
  const counts = balancedCounts(amount, PLAYER_VALUES);
  const cap = Math.max(PLAYER_COL_CAP, Math.ceil(Math.max(1, ...counts) / 3));
  return splitColumns(counts, PLAYER_VALUES, cap);
}
export function potColumns(amount: number): ChipColumn[] {
  return greedyColumns(amount, POT_VALUES, POT_COL_CAP);
}

// Deterministic fractional hash in [0,1) from a handful of ints — stable across frames so the
// pile doesn't shimmer. Keyed by (seed, column, chip, salt) for per-column and per-chip wobble.
function frac(seed: number, i: number, k: number, salt: number): number {
  const x = Math.sin(seed * 127.1 + i * 311.7 + k * 74.7 + salt * 269.5) * 43758.5453;
  return x - Math.floor(x);
}

// Draw a set of columns piled at felt position `center` in a rough square (grid whose long
// side runs along `axis`), each column jittered off its cell and every chip given its own
// slight wobble + free rotation so the edge spots never line up and the pile looks placed by
// hand. Lit with the scene's table light so chips match the chairs / frame. `vp` is the camera
// view-projection; `seed` keys the (stable) jitter per stack.
export function drawChipStack(
  target: RenderTarget,
  vp: Mat4,
  center: { x: number; z: number },
  axis: { x: number; z: number },
  cols: ChipColumn[],
  light: Vec3,
  ambient: number,
  seed = 0,
): void {
  const perp = { x: -axis.z, z: axis.x }; // unit perpendicular in the felt plane
  const n = cols.length;
  const side = Math.max(1, Math.ceil(Math.sqrt(n))); // columns along `axis`
  const rows = Math.ceil(n / side); // rows along `perp`
  for (let i = 0; i < n; i++) {
    const gx = (i % side) - (side - 1) / 2; // centred grid cell
    const gy = Math.floor(i / side) - (rows - 1) / 2;
    const ox = gx * PILE_SPACING + (frac(seed, i, 0, 1) * 2 - 1) * COL_JIT;
    const oy = gy * PILE_SPACING + (frac(seed, i, 0, 2) * 2 - 1) * COL_JIT;
    const bx = center.x + axis.x * ox + perp.x * oy;
    const bz = center.z + axis.z * ox + perp.z * oy;
    const mesh = chipMesh(cols[i].value);
    for (let k = 0; k < cols[i].count; k++) {
      const cx = bx + (frac(seed, i, k, 3) * 2 - 1) * CHIP_JIT;
      const cz = bz + (frac(seed, i, k, 4) * 2 - 1) * CHIP_JIT;
      const model: Mat4 = mat4Multiply(mat4Translate(cx, BASE_Y + CHIP_H * (k + 0.5), cz), mat4RotY(frac(seed, i, k, 5) * Math.PI * 2));
      rasterize(target, mesh, lambertMaterial, { mvp: mat4Multiply(vp, model), model, lightDir: light, ambient });
    }
  }
}
