// Recognisable natural props and their palette: pines (standing and felled), round trees,
// bushes, sheep, and brickwork. Shared by the terrain tiles and the harbour ship's cargo.

import { mulberry32, type Vec3 } from '../../../../engine/index.ts';
import { type Build, type RGB, shade, smooth, v } from './build.ts';
import { beam, blob, box, cone, coneAxis, logBeamAxis } from './props.ts';

// ── Palette (non-wheat tiles, pending their rebuilds) ────────────────────────────
const TRUNK: RGB = [104, 72, 44];
const PINE_RADII = [0.17, 0.13, 0.085] as const;
const PINE_TIER_BASES = [0.03, 0.14, 0.25] as const;
const PINE_TIER_HEIGHTS = [0.16, 0.16, 0.185] as const;
export const PINE_GREENS: readonly RGB[] = [
  [56, 108, 66],
  [72, 132, 82],
  [92, 152, 92],
  [62, 118, 74],
];

export interface PinePose {
  windX?: number;
  windZ?: number;
  strength?: number;
}

// A low-poly conifer: a thin trunk under THREE prominent skirts. Each skirt is a cone whose
// flared base clearly overhangs the narrowing tip of the one below, so the tree reads as three
// distinct stacked pyramids of leaves. `green` tints the whole tree.
export function pine(m: Build, cx: number, cz: number, y0: number, scale: number, green: RGB, seed: number, pose: PinePose = {}): void {
  const strength = Math.max(0, Math.min(1, pose.strength ?? 0));
  // Keep the trunk planted while the flexible crown visibly bows. The old 0.024 displacement
  // vanished at board distance; this still preserves the stepped pine silhouette but lets a
  // passing gust travel across the forest as a readable wave.
  const bendX = (pose.windX ?? 0) * strength * 0.062 * scale;
  const bendZ = (pose.windZ ?? 0) * strength * 0.062 * scale;
  box(m, cx, cz, 0.032 * scale, 0.08 * scale, 0.032 * scale, TRUNK, 0, y0 - 0.02);
  // Wide-based, short skirts that only just overlap: each tier's flared base juts well past the
  // narrowing tip below it, giving a strongly stepped silhouette (not a smooth cone) from afar.
  for (let t = 0; t < 3; t++) {
    const baseFraction = 0.12 + t * 0.32;
    const baseX = cx + bendX * baseFraction;
    const baseZ = cz + bendZ * baseFraction;
    cone(
      m,
      baseX,
      baseZ,
      PINE_RADII[t] * scale,
      PINE_TIER_HEIGHTS[t] * scale,
      6,
      shade(green, 1 - t * 0.03),
      y0 + PINE_TIER_BASES[t] * scale,
      seed + t * 0.9,
      bendX * (0.42 + t * 0.13),
      bendZ * (0.42 + t * 0.13),
    );
  }
}
// A broadleaf tree: a short brown trunk under a big rounded faceted canopy (flat shading
// gives the two-tone sunlit/shadow look).
export function roundTree(m: Build, cx: number, cz: number, y0: number, scale: number, leaf: RGB, seed: number): void {
  box(m, cx, cz, 0.075 * scale, 0.2 * scale, 0.075 * scale, TRUNK, 0, y0);
  blob(m, cx, y0 + 0.44 * scale, cz, 0.26 * scale, 0.27 * scale, 0.26 * scale, leaf, seed, 0.16, 4, 7);
}

// A bush: a rounded faceted green blob sitting directly on the ground (no trunk).
export function bush(m: Build, cx: number, cz: number, y0: number, scale: number, color: RGB, seed: number): void {
  blob(m, cx, y0 + 0.11 * scale, cz, 0.16 * scale, 0.13 * scale, 0.16 * scale, color, seed, 0.2, 3, 6);
}
interface SheepPose {
  gait?: number; // -1..1: diagonal hoof swing while walking
  headDip?: number; // 0..1: lower the head to graze
  groundY?: (x: number, z: number) => number; // rendered terrain beneath each individual hoof
}

// A low-poly sheep: a fat rounded body (white top → cream belly), a black head tilted up at
// the front with two ear nubs, and four short thin black legs. Faces along `ry`. Animated poses
// swing diagonal leg pairs, add a restrained body bob, and lower the head all the way to grass.
export function sheep(m: Build, cx: number, cz: number, y0: number, ry: number, seed: number, scale = 1, pose: SheepPose = {}): void {
  const rng = mulberry32(seed | 0 || 1);
  const WHITE: RGB = [246, 246, 242];
  const CREAM: RGB = [226, 212, 184];
  const BLACK: RGB = [36, 36, 42];
  const s = (0.437 + rng() * 0.138) * scale; // ~15% larger than the trimmed size — a bit chunkier vs the trees
  const cos = Math.cos(ry);
  const sin = Math.sin(ry);
  const gait = Math.max(-1, Math.min(1, pose.gait ?? 0));
  const headDip = smooth(Math.max(0, Math.min(1, pose.headDip ?? 0)));
  const bodyBob = Math.abs(gait) * 0.0035 * s;
  const groundY = pose.groundY ?? (() => y0);
  const at = (fwd: number, side: number): { x: number; z: number } => ({ x: cx + cos * fwd - sin * side, z: cz + sin * fwd + cos * side });
  // legs: short and splayed — inner/high near the body, outer/low at the ground.
  for (const [fw, sd] of [[0.11, 0.06], [0.11, -0.06], [-0.11, 0.06], [-0.11, -0.06]] as const) {
    const top = at(fw * 0.8 * s, sd * 0.7 * s);
    const diagonal = fw * sd > 0 ? 1 : -1;
    const stride = gait * diagonal;
    const bot = at(fw * s + stride * 0.055 * s, sd * 1.25 * s);
    const hoofLift = Math.max(0, stride) * 0.034 * s;
    beam(m, v(top.x, y0 + 0.13 * s + bodyBob, top.z), v(bot.x, groundY(bot.x, bot.z) + hoofLift, bot.z), 0.016 * s, BLACK);
  }
  // Body: a fat ovoid, LONGER front-to-back (along the facing) than it is wide/tall, white
  // over a cream belly — like the reference, not a round ball.
  blob(m, cx, y0 + 0.2 * s + bodyBob, cz, 0.21 * s, 0.135 * s, 0.15 * s, WHITE, seed + 1, 0.05, 4, 9, CREAM, ry);
  const h = at((0.2 + headDip * 0.06) * s, 0);
  const uprightHeadY = y0 + 0.25 * s + bodyBob;
  const grazingHeadY = groundY(h.x, h.z) + 0.082 * s;
  const headY = uprightHeadY + (grazingHeadY - uprightHeadY) * headDip;
  const shoulder = at(0.135 * s, 0);
  beam(
    m,
    v(shoulder.x, y0 + 0.22 * s + bodyBob, shoulder.z),
    v(h.x, headY + 0.012 * s, h.z),
    0.04 * s,
    BLACK,
  );
  blob(m, h.x, headY, h.z, 0.078 * s, 0.082 * s, 0.072 * s, BLACK, seed + 2, 0.06, 3, 5); // head
  for (const sd of [0.07, -0.07] as const) {
    const e = at((0.16 + headDip * 0.06) * s, sd * s);
    box(m, e.x, e.z, 0.02 * s, 0.028 * s, 0.045 * s, BLACK, ry, headY + 0.01 * s); // ear nub
  }
}
// A single small clay brick (cuboid), long axis along `ry`.
function brick(m: Build, cx: number, cz: number, y0: number, ry: number, color: RGB): void {
  box(m, cx, cz, 0.105, 0.052, 0.064, color, ry, y0);
}
// A low brick wall: a course (or two, half-staggered) of bricks laid end-to-end along the
// segment, each dropped to the clay surface.
export function brickWall(m: Build, x0: number, z0: number, x1: number, z1: number, hAt: (x: number, z: number) => number, color: RGB, rng: () => number): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const ang = Math.atan2(dz, dx);
  const bl = 0.105;
  const n = Math.max(2, Math.round(len / bl));
  const courses = rng() < 0.5 ? 2 : 1;
  for (let c = 0; c < courses; c++) {
    for (let i = 0; i < n; i++) {
      const d = i * bl + c * 0.5 * bl;
      if (d > len) break;
      const t = d / len;
      const px = x0 + dx * t;
      const pz = z0 + dz * t;
      brick(m, px, pz, hAt(px, pz) + c * 0.047, ang, color);
    }
  }
}
// A low double-row patch of bricks (two parallel rows, one course, with a couple laid on top)
// — like the low pile by the chip. NOT a tall tower.
export function brickStack(m: Build, cx: number, cz: number, y0: number, ry: number, color: RGB, rng: () => number): void {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const put = (ox: number, oz: number, oy: number): void => brick(m, cx + ox * c - oz * s, cz + ox * s + oz * c, y0 + oy, ry, color);
  for (let r = 0; r < 2; r++) for (let i = -1; i <= 1; i++) put(i * 0.1, (r - 0.5) * 0.075, 0);
  if (rng() < 0.8) put(-0.05, 0, 0.05); // one or two on the 2nd course (still low)
  if (rng() < 0.6) put(0.05, 0, 0.05);
}
// A small offset heap: a couple of bricks per layer, staggered over 1–2 low layers.
export function brickHeap(m: Build, cx: number, cz: number, y0: number, ry: number, color: RGB, rng: () => number): void {
  const layers = 1 + Math.floor(rng() * 2);
  for (let l = 0; l < layers; l++) {
    const a = ry + (rng() - 0.5) * 0.6;
    const jx = (rng() - 0.5) * 0.04;
    const jz = (rng() - 0.5) * 0.04;
    brick(m, cx + jx, cz + jz, y0 + l * 0.05, a, color);
    if (rng() < 0.75) brick(m, cx + jx + Math.cos(a) * 0.11, cz + jz + Math.sin(a) * 0.11, y0 + l * 0.05, a, color);
  }
}

export function felledPine(m: Build, cx: number, cz: number, y0: number, ry: number, pitch: number, scale: number, green: RGB, seed: number): void {
  const cp = Math.cos(pitch);
  const axis = v(Math.cos(ry) * cp, Math.sin(pitch), Math.sin(ry) * cp);
  const axisY = y0 + PINE_RADII[0] * scale * Math.sqrt(1 - axis.y * axis.y) + 0.01;
  const origin = v(cx, axisY, cz);
  const along = (distance: number): Vec3 =>
    v(
      origin.x + axis.x * distance,
      origin.y + axis.y * distance,
      origin.z + axis.z * distance,
    );

  const trunkStart = -0.07 * scale;
  const trunkEnd = 0.385 * scale;
  const trunkRadius = 0.018 * scale;
  logBeamAxis(m, along(trunkStart), along(trunkEnd), trunkRadius, TRUNK, shade(TRUNK, 1.14));

  for (let i = 0; i < PINE_RADII.length; i++) {
    const off = PINE_TIER_BASES[i] * scale;
    coneAxis(
      m,
      along(off),
      axis,
      PINE_RADII[i] * scale,
      PINE_TIER_HEIGHTS[i] * scale,
      6,
      shade(green, 1 - i * 0.035),
      seed + i * 0.9,
    );
  }
}
