// The hills tile: a low broad clay mound with a pocket floor, brickwork and stacks.

import { type Vec3 } from '../../../../../engine/index.ts';
import { mulberry32 } from '../../../../scenes/wisp.ts';
import { EDGE_Y, hexCorners, R_RIM, rimAndWall } from '../base.ts';
import { build, type Build, faceQuadFlat, faceTri, hash2, type RGB, shade, smooth, UP, v } from '../build.ts';
import { brickHeap, brickStack, brickWall } from '../nature.ts';

const HILL_AMP = 0.13; // a LOW, broad, gentle mound (not a jagged mountain)
const HILL_INDENT_R = 0.38; // center pocket circumradius (flat-top hex)
const HILL_INDENT_DEPTH = 0.08;
function hillHeight(x: number, z: number, seed: number): number {
  const r = Math.hypot(x, z);
  const dome = HILL_AMP * smooth((R_RIM - r) / 0.34); // broad raised mound, falls near the rim
  const ca = HILL_INDENT_R * Math.cos(Math.PI / 6);
  const ang = Math.atan2(z, x);
  const nrm = Math.round((ang - Math.PI / 6) / (Math.PI / 3)) * (Math.PI / 3) + Math.PI / 6;
  const inside = ca / Math.cos(ang - nrm) - r; // >0 inside the centre hex
  const dip = smooth(Math.max(0, Math.min(1, inside / 0.14))); // flat pocket floor, gently sloped walls
  const bump = (hash2(x * 8 + seed, z * 8 - seed) - 0.5) * 0.035 * (1 - dip); // very gentle clay undulation
  return EDGE_Y + Math.max(0, dome + bump - HILL_INDENT_DEPTH * dip);
}
function clayFloor(m: Build, color: RGB, seed: number): void {
  const M = 4; // coarse — few large facets
  const V = hexCorners(R_RIM, 0);
  const jit = (R_RIM / M) * 0.4;
  const at = (b: Vec3, c: Vec3, i: number, j: number): Vec3 => {
    const ox = (i / M) * b.x + (j / M) * c.x;
    const oz = (i / M) * b.z + (j / M) * c.z;
    let x = ox;
    let z = oz;
    // Suppress the position-jitter near the centre so the chip pocket stays clean; the outer
    // clay keeps its irregular bumpy facets.
    const jitS = smooth(Math.max(0, Math.min(1, (Math.hypot(ox, oz) - 0.28) / 0.32)));
    if (i + j < M && (i > 0 || j > 0) && jitS > 0) {
      x = ox + (hash2(ox * 41 + seed, oz * 41 - seed) - 0.5) * 2 * jit * jitS;
      z = oz + (hash2(ox * 23 - seed, oz * 23 + seed) - 0.5) * 2 * jit * jitS;
    }
    return v(x, hillHeight(x, z, seed), z);
  };
  for (let s = 0; s < 6; s++) {
    const b = V[s];
    const c = V[(s + 1) % 6];
    for (let i = 0; i < M; i++) {
      for (let j = 0; j < M - i; j++) {
        const p00 = at(b, c, i, j);
        const p10 = at(b, c, i + 1, j);
        const p01 = at(b, c, i, j + 1);
        const col = shade(color, 1 + (hash2(p00.x + s * 3, p00.z - s * 3) - 0.5) * 0.09);
        if (j < M - i - 1) faceQuadFlat(m, p00, p10, at(b, c, i + 1, j + 1), p01, col, UP);
        else faceTri(m, p00, p10, p01, col, UP);
      }
    }
  }
  rimAndWall(m, color);
}
export function hillsTile(seed: number): Build {
  const m = build();
  const CLAY: RGB = [182, 100, 76];
  const BRICK: RGB = [196, 112, 84]; // essentially the clay shade — bricks read by shape/shadow, not color
  const hseed = seed + 5.7;
  clayFloor(m, CLAY, hseed);
  const hAt = (x: number, z: number): number => hillHeight(x, z, hseed);
  const rng = mulberry32((Math.abs(seed) * 2654435761 + 12345) >>> 0 || 1);
  const baseRot = rng() * Math.PI * 2;
  const pol = (a: number, rr: number): { x: number; z: number } => ({ x: Math.cos(a) * rr, z: Math.sin(a) * rr });
  // A long low wall along one outer side (tangential-ish to the rim).
  const wc = pol(baseRot, 0.44);
  const wdir = baseRot + Math.PI / 2 + (rng() - 0.5) * 0.5;
  const wl = 0.58;
  brickWall(m, wc.x - Math.cos(wdir) * wl / 2, wc.z - Math.sin(wdir) * wl / 2, wc.x + Math.cos(wdir) * wl / 2, wc.z + Math.sin(wdir) * wl / 2, hAt, BRICK, rng);
  // A tall stack just outside the centre pocket.
  const sa = baseRot + 2.4 + (rng() - 0.5) * 0.6;
  const sp = pol(sa, 0.46);
  brickStack(m, sp.x, sp.z, hAt(sp.x, sp.z), sa, BRICK, rng);
  // 2–3 small heaps scattered around the mid-field (outside the pocket).
  for (let k = 0, n = 2 + Math.floor(rng() * 2); k < n; k++) {
    const p = pol(baseRot + 1.1 + k * 1.7 + (rng() - 0.5) * 0.5, 0.4 + rng() * 0.16);
    brickHeap(m, p.x, p.z, hAt(p.x, p.z), rng() * Math.PI, BRICK, rng);
  }
  return m;
}

// SHEEP — a soft mint-green meadow (gently rolling low-poly ground) with sheep, round-canopy
// trees, and green bushes scattered across it. Seeded so every pasture hex varies.
