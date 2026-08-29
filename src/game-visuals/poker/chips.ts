// Procedural 3D poker chips (no model import): a short cylinder per denomination with a
// classic clay-chip face — an inner ring line and six evenly-spaced edge spots that wrap
// the rim onto the top/bottom faces — stacked into scattered columns. Purely a visual read
// of the live chip state: each seat's carried stack (beside its cards), the chips it has
// pushed out to bet, and the collected pot pile. Denomination values are chosen for 10/20
// blinds and $1000 starts, and player stacks are spread across denominations (not one fat
// tower) so a table of stacks reads as a lively mix of colors.

import { type Mat4, mat4Multiply, mat4RotY, mat4Translate, type Mesh, rasterize, type RenderTarget, lambertMaterial, ResourceCache, type VertexIn, type Vec3 } from '../../engine/index.ts';

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
  { value: 50, base: { x: 34, y: 72, z: 142 }, spot: WHITE }, // blue
  { value: 20, base: { x: 168, y: 46, z: 50 }, spot: WHITE }, // red
  { value: 10, base: WHITE, spot: { x: 34, y: 72, z: 142 } }, // white (blue spots)
  { value: 1, base: { x: 116, y: 72, z: 142 }, spot: WHITE }, // purple change (rare split-pot remainder)
];
// Player stacks balance every casino color, including black $500 chips; pots stay greedy
// so pushed chips remain compact when a visual inventory needs to make change.
const PLAYER_VALUES = [500, 100, 50, 20, 10];
const POT_VALUES = [500, 100, 50, 20, 10, 1];

// Chip geometry + stacking (world units; a card is 1.0×1.4 for scale). Sized so a stack of
// a handful of chips reads as a real little tower from the overview.
const CHIP_R = 0.26;
const CHIP_H = 0.07;
const SEGMENTS = 24; // around; smoother circles, still divisible into six even accents
const TICKS = 6; // edge/face spots (the classic six-spot rim)
const TICK_SEGMENTS = 2; // each outer accent spans half of its six-segment period
const RING_ACCENTS = 12; // 24 alternating inset-ring sections: 12 accent, 12 body
const RING_INNER = 0.58; // fraction of R: larger inner field
const RING_OUTER = 0.64; // fraction of R: outer edge of the thin inner ring
const TICK_INNER = 0.72; // fraction of R: body-colored gap before the rim accents
const MAX_COLUMNS_PER_COLOR = 2;
const SECOND_COLUMN_AT = 16; // prefer height; split a color only once its first tower is tall
const PILE_SPACING = 0.5; // tight initial grid; the collision solve below separates it
const BASE_Y = 0.02; // bottom chip rests just clear of the felt
const COL_JIT = 0.07; // per-column world jitter off the grid cell (an unruly pile, not a lattice)
const CHIP_JIT = 0.025; // bounded wobble; slightly tighter than the original loose pile
const COLLISION_GAP = 0.005;
// Column centers leave room for both chip radii plus the maximum opposing radial
// wobble. This guarantees that cylinders in neighboring stacks cannot intersect.
export const CHIP_COLLISION_DISTANCE = 2 * CHIP_R + 2 * CHIP_JIT + COLLISION_GAP;

// One chip mesh per denomination, built once and drawn many. Flat clay disc: top + bottom
// faces each carry a larger base field, a thin segmented ring, a clean body-color gap, and six
// broad rim accents; the side wall repeats those six accents around the edge. All
// per-vertex color under lambert (cull: 'none', so winding is free).
const meshCache = new ResourceCache<number, Mesh>();
function chipMesh(value: number): Mesh {
  return meshCache.getOrCreate(value, () => {
    const d = DENOMS.find((x) => x.value === value) ?? DENOMS[DENOMS.length - 1];
    const V: VertexIn[] = [];
    const I: number[] = [];
    const top = CHIP_H / 2;
    const bot = -CHIP_H / 2;
    const ang = (s: number): number => (s / SEGMENTS) * Math.PI * 2;
    const rim = (s: number, rf: number): { x: number; z: number } => ({ x: Math.cos(ang(s)) * CHIP_R * rf, z: Math.sin(ang(s)) * CHIP_R * rf });
    const isRimAccent = (s: number): boolean => s % (SEGMENTS / TICKS) < TICK_SEGMENTS;
    const isRingAccent = (s: number): boolean => s % (SEGMENTS / RING_ACCENTS) === 0;
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
        // Thin inset ring: 24 equal sections alternating 12 contrast dashes and 12 gaps.
        const l0 = rim(s, RING_OUTER);
        const l1 = rim(s1, RING_OUTER);
        quad([i0, i1, l1, l0], [y, y, y, y], ny, isRingAccent(s) ? d.spot : d.base);
        // A narrow body-colored gap separates the inset ring from the rim accents.
        const g0 = rim(s, TICK_INNER);
        const g1 = rim(s1, TICK_INNER);
        quad([l0, l1, g1, g0], [y, y, y, y], ny, d.base);
        const o0 = rim(s, 1);
        const o1 = rim(s1, 1);
        quad([g0, g1, o1, o0], [y, y, y, y], ny, isRimAccent(s) ? d.spot : d.base);
      }
    }
    // Side wall: one quad per segment, radial normal, ticks matching the face spots.
    for (let s = 0; s < SEGMENTS; s++) {
      const s1 = (s + 1) % SEGMENTS;
      const p0 = rim(s, 1);
      const p1 = rim(s1, 1);
      const mid = ang(s + 0.5);
      const n: Vec3 = { x: Math.cos(mid), y: 0, z: Math.sin(mid) };
      quad([p0, p1, p1, p0], [bot, bot, top, top], n, isRimAccent(s) ? d.spot : d.base);
    }
    return { vertices: V, indices: I };
  });
}

// One column of `count` identical chips (a single denomination).
export interface ChipColumn {
  value: number;
  count: number;
}

// Count chips without caring how same-color towers are currently split.
function countsFor(cols: readonly ChipColumn[], values = POT_VALUES): number[] {
  return values.map((value) =>
    cols.reduce((total, col) => total + (col.value === value ? Math.max(0, Math.floor(col.count)) : 0), 0),
  );
}

// At most two towers per color. A color stays in one tall tower until SECOND_COLUMN_AT,
// then divides evenly into two; columns are interleaved by color to avoid solid blocks.
function columnsFromCounts(counts: readonly number[], values = POT_VALUES): ChipColumn[] {
  const parts = counts.map((raw) => {
    const count = Math.max(0, Math.floor(raw));
    return count > SECOND_COLUMN_AT
      ? [Math.ceil(count / MAX_COLUMNS_PER_COLOR), Math.floor(count / MAX_COLUMNS_PER_COLOR)]
      : count > 0
        ? [count]
        : [];
  });
  const cols: ChipColumn[] = [];
  for (let layer = 0; layer < MAX_COLUMNS_PER_COLOR; layer++) {
    for (let i = 0; i < values.length; i++) {
      const count = parts[i][layer] ?? 0;
      if (count > 0) cols.push({ value: values[i], count });
    }
  }
  return cols;
}

// Greedy denomination counts (large chips first), used for compact pot/change fallbacks.
function greedyCounts(amount: number, values: readonly number[]): number[] {
  const counts = values.map(() => 0);
  let rem = Math.max(0, Math.round(amount));
  for (let i = 0; i < values.length; i++) {
    counts[i] = Math.floor(rem / values[i]);
    rem -= counts[i] * values[i];
  }
  return counts;
}

// Balanced decomposition: hand out one chip of each denomination in turn. This keeps every
// color present while black chips absorb large stacks instead of making them fan outward.
function balancedCounts(amount: number, values: readonly number[]): number[] {
  const counts = values.map(() => 0);
  let rem = Math.max(0, Math.round(amount));
  const floor = Math.min(...values);
  for (let i = 0; rem >= floor; i++) {
    const vi = i % values.length;
    if (values[vi] <= rem) {
      counts[vi]++;
      rem -= values[vi];
    }
  }
  return counts;
}

export function chipAmount(cols: readonly ChipColumn[]): number {
  return cols.reduce((total, col) => total + col.value * col.count, 0);
}

export function cloneChipColumns(cols: readonly ChipColumn[]): ChipColumn[] {
  return cols.map((col) => ({ ...col }));
}

export function mergeChipColumns(...groups: readonly ChipColumn[][]): ChipColumn[] {
  const counts = POT_VALUES.map((value) =>
    groups.reduce(
      (total, cols) =>
        total + cols.reduce((sum, col) => sum + (col.value === value ? Math.max(0, Math.floor(col.count)) : 0), 0),
      0,
    ),
  );
  return columnsFromCounts(counts);
}

// Find an exact subset of the chips currently owned. Larger denominations are preferred,
// but the search honors finite counts so a bet never invents a color when exact change exists.
function exactSelection(counts: readonly number[], amount: number): number[] | null {
  const selected = counts.map(() => 0);
  const dead = new Set<string>();
  const visit = (i: number, rem: number): boolean => {
    if (rem === 0) return true;
    if (i >= POT_VALUES.length || rem < 0) return false;
    const key = `${i}:${rem}`;
    if (dead.has(key)) return false;
    const value = POT_VALUES[i];
    const max = Math.min(counts[i], Math.floor(rem / value));
    for (let n = max; n >= 0; n--) {
      selected[i] = n;
      if (visit(i + 1, rem - n * value)) return true;
    }
    selected[i] = 0;
    dead.add(key);
    return false;
  };
  return visit(0, amount) ? selected.slice() : null;
}

export interface TakenChips {
  remaining: ChipColumn[];
  pushed: ChipColumn[];
  converted: boolean;
}

// Remove a bet from a persistent visual stack. An all-in (or any full-stack amount) returns
// the exact existing columns. Ordinary bets use existing chips when possible and only color
// up/down as a last-resort change-making step.
export function takeChipColumns(
  cols: readonly ChipColumn[],
  amount: number,
  allIn = false,
): TakenChips {
  const total = chipAmount(cols);
  const target = Math.max(0, Math.min(total, Math.round(amount)));
  if (target === 0) return { remaining: cloneChipColumns(cols), pushed: [], converted: false };
  if (allIn || target === total) {
    return { remaining: [], pushed: cloneChipColumns(cols), converted: false };
  }

  const takeFrom = (source: readonly ChipColumn[], converted: boolean): TakenChips | null => {
    const counts = countsFor(source);
    const selected = exactSelection(counts, target);
    if (!selected) return null;
    return {
      remaining: columnsFromCounts(counts.map((count, i) => count - selected[i])),
      pushed: columnsFromCounts(selected),
      converted,
    };
  };

  const existing = takeFrom(cols, false);
  if (existing) return existing;

  // Exact change is unavailable: recolor the current stack once, then take the bet. This
  // path is intentionally forbidden for all-ins above, preserving the shoved stack exactly.
  const recolored = playerColumns(total);
  const changed = takeFrom(recolored, true);
  if (changed) return changed;
  return {
    remaining: playerColumns(total - target),
    pushed: potColumns(target),
    converted: true,
  };
}

// New hands are the color-up boundary: balanced denominations, black chips for large values,
// height before width, and never more than two towers of one color.
export function playerColumns(amount: number): ChipColumn[] {
  const rounded = Math.max(0, Math.round(amount));
  const counts = balancedCounts(rounded, PLAYER_VALUES);
  const represented = counts.reduce((total, count, i) => total + count * PLAYER_VALUES[i], 0);
  // Split pots can create a sub-$10 remainder. Keep that exact with a small purple change
  // tower without distributing $1 chips throughout normal starting stacks.
  return columnsFromCounts([...counts, rounded - represented], POT_VALUES);
}

export function potColumns(amount: number): ChipColumn[] {
  return columnsFromCounts(greedyCounts(amount, POT_VALUES), POT_VALUES);
}

// The half-extents (world units) of the footprint drawChipStack piles `cols` into: how far
// the cluster reaches from its center along the pile `axis` and its `perp`. It uses the same
// resolved layout as drawing. The scene reads `perp` to push a seat's carried stack far enough
// along the seat tangent that a tall stack's cluster
// never creeps back over the seat's own hole cards.
export function chipPileHalfExtent(cols: ChipColumn[], seed = 0): { axis: number; perp: number } {
  const placements = chipColumnPlacements(cols.length, seed);
  if (placements.length === 0) return { axis: 0, perp: 0 };
  const margin = CHIP_COLLISION_DISTANCE / 2;
  return {
    axis: Math.max(...placements.map((p) => Math.abs(p.axis))) + margin,
    perp: Math.max(...placements.map((p) => Math.abs(p.perp))) + margin,
  };
}

// Deterministic fractional hash in [0,1) from a handful of ints — stable across frames so the
// pile doesn't shimmer. Keyed by (seed, column, chip, salt) for per-column and per-chip wobble.
function frac(seed: number, i: number, k: number, salt: number): number {
  const x = Math.sin(seed * 127.1 + i * 311.7 + k * 74.7 + salt * 269.5) * 43758.5453;
  return x - Math.floor(x);
}
export interface ChipColumnPlacement {
  axis: number;
  perp: number;
}

// Start from the hand-placed jittered grid, then relax overlapping column
// footprints like equal rigid discs. Moving whole columns keeps every tower
// supported while retaining an irregular, non-lattice silhouette.
export function chipColumnPlacements(count: number, seed = 0): ChipColumnPlacement[] {
  const n = Math.max(0, Math.floor(count));
  const side = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / side);
  const out: ChipColumnPlacement[] = Array.from({ length: n }, (_, i) => ({
    axis: ((i % side) - (side - 1) / 2) * PILE_SPACING + (frac(seed, i, 0, 1) * 2 - 1) * COL_JIT,
    perp: (Math.floor(i / side) - (rows - 1) / 2) * PILE_SPACING + (frac(seed, i, 0, 2) * 2 - 1) * COL_JIT,
  }));

  const minSq = CHIP_COLLISION_DISTANCE * CHIP_COLLISION_DISTANCE;
  for (let pass = 0; pass < Math.max(16, n * 4); pass++) {
    let corrected = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = out[j].axis - out[i].axis;
        let dz = out[j].perp - out[i].perp;
        const dSq = dx * dx + dz * dz;
        if (dSq >= minSq - 1e-12) continue;
        let distance = Math.sqrt(dSq);
        if (distance < 1e-9) {
          const angle = frac(seed, i, j, 8) * Math.PI * 2;
          dx = Math.cos(angle);
          dz = Math.sin(angle);
          distance = 1;
        }
        const push = (CHIP_COLLISION_DISTANCE - (dSq < 1e-18 ? 0 : distance)) / 2;
        const ux = dx / distance;
        const uz = dz / distance;
        out[i].axis -= ux * push;
        out[i].perp -= uz * push;
        out[j].axis += ux * push;
        out[j].perp += uz * push;
        corrected = true;
      }
    }
    if (!corrected) break;
  }
  // Give each stable seed a different local pile orientation. Seats use their index as
  // the seed, so identical stacks no longer repeat the same top-left/top-right pattern.
  // Rotating the resolved rigid-column layout cannot introduce new intersections.
  const turns = ((Math.trunc(seed) % 4) + 4) % 4;
  const mirror = Math.floor(Math.abs(Math.trunc(seed)) / 4) % 2 === 1;
  return out.map((placement) => {
    let axis = mirror ? -placement.axis : placement.axis;
    let perp = placement.perp;
    for (let turn = 0; turn < turns; turn++) [axis, perp] = [-perp, axis];
    return { axis, perp };
  });
}

// Deterministically shuffle which denomination tower occupies each resolved position.
// This is draw-only: counts, values, height preference, and the two-towers-per-color cap
// remain untouched. A stable seed avoids shimmer while giving each player a distinct pile.
export function arrangeChipColumns(cols: readonly ChipColumn[], seed = 0): ChipColumn[] {
  const arranged = cloneChipColumns(cols);
  for (let i = arranged.length - 1; i > 0; i--) {
    const j = Math.floor(frac(seed + 17, i, arranged.length, 9) * (i + 1));
    [arranged[i], arranged[j]] = [arranged[j], arranged[i]];
  }
  return arranged;
}

// Draw a set of columns piled at felt position `center` in a rough square (grid whose long
// side runs along `axis`), each column jittered off its cell and every chip given its own
// slight wobble + free rotation so the edge spots never line up and the pile looks placed by
// hand. Lit with the scene's table light so chips match the chairs / frame. `vp` is the camera
// view-projection; `seed` keys the stable jitter and `lift` raises a pile in flight.
export function drawChipStack(
  target: RenderTarget,
  vp: Mat4,
  center: { x: number; z: number },
  axis: { x: number; z: number },
  cols: ChipColumn[],
  light: Vec3,
  ambient: number,
  seed = 0,
  lift = 0,
): void {
  const perp = { x: -axis.z, z: axis.x }; // unit perpendicular in the felt plane
  const placements = chipColumnPlacements(cols.length, seed);
  const arranged = arrangeChipColumns(cols, seed);
  for (let i = 0; i < arranged.length; i++) {
    const { axis: ox, perp: oy } = placements[i];
    const bx = center.x + axis.x * ox + perp.x * oy;
    const bz = center.z + axis.z * ox + perp.z * oy;
    const mesh = chipMesh(arranged[i].value);
    for (let k = 0; k < arranged[i].count; k++) {
      // Radial jitter (rather than independent square-axis jitter) gives every
      // chip a hand-placed wobble while keeping its displacement strictly bounded.
      const jitterR = frac(seed, i, k, 3) * CHIP_JIT;
      const jitterA = frac(seed, i, k, 4) * Math.PI * 2;
      const cx = bx + Math.cos(jitterA) * jitterR;
      const cz = bz + Math.sin(jitterA) * jitterR;
      const model: Mat4 = mat4Multiply(mat4Translate(cx, BASE_Y + lift + CHIP_H * (k + 0.5), cz), mat4RotY(frac(seed, i, k, 5) * Math.PI * 2));
      rasterize(target, mesh, lambertMaterial, { mvp: mat4Multiply(vp, model), model, lightDir: light, ambient });
    }
  }
}
