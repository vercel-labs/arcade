// Props that dress the wheat tile: grain heads, stalks and tufts, cut stubble, the windmill
// (body plus its animated rotor), a field shack and hedge bushes.

import type { Vec3 } from '../../../../engine/math.ts';
import { mulberry32 } from '../../../../engine/random.ts';
import { WALL } from '../../base.ts';
import { type Build, cross, faceQuad, faceQuadFlat, faceQuadWithNormal, faceTri, faceTriWithNormal, norm, type RGB, shade, v } from '../../build.ts';
import { beam, blob, box, cone } from '../../props.ts';
import { fieldToWorld } from './layout.ts';

// ── Wheat-specific props ──────────────────────────────────────────────────────

const WHEAT_STEM: RGB = [248, 202, 48];
const WHEAT_HEAD: RGB = [255, 229, 86];

// A wheat ear built from a few overlapping diamond-shaped kernel tiers. Rotating successive
// tiers around the stem gives it the braided, barley-like silhouette of a real ear without
// modelling every grain. Dense interior tufts use two tiers; exposed stalks use three and get
// two tiny awns. Soft upward normals keep these sub-cell faces golden from every camera angle.
function wheatGrainHead(
  m: Build,
  cx: number,
  cz: number,
  r: number,
  h: number,
  color: RGB,
  yBase: number,
  spin: number,
  leanX: number,
  leanZ: number,
  tiers: 2 | 3,
  awns = false,
): void {
  const axis = (t: number): Vec3 => v(cx + leanX * t, yBase + h * t, cz + leanZ * t);
  for (let i = 0; i < tiers; i++) {
    const lowerT = Math.max(0, i / tiers - 0.025);
    const middleT = (i + 0.5) / tiers;
    const upperT = Math.min(1, (i + 1.08) / tiers);
    const lower = axis(lowerT);
    const middle = axis(middleT);
    const upper = axis(upperT);
    const angle = spin + i * 1.07;
    const sx = Math.cos(angle);
    const sz = Math.sin(angle);
    const taper = 0.72 + Math.sin(middleT * Math.PI) * 0.32 - middleT * 0.16;
    const width = r * taper;
    const left = v(middle.x - sx * width, middle.y, middle.z - sz * width);
    const right = v(middle.x + sx * width, middle.y, middle.z + sz * width);
    const normal = v(-sz * 0.27, 1, sx * 0.27);
    faceTriWithNormal(m, lower, right, upper, shade(color, 1.015 - i * 0.018), normal);
    faceTriWithNormal(m, lower, upper, left, shade(color, 0.965 + i * 0.018), normal);
  }

  if (awns) {
    const top = axis(0.94);
    const tipBase = axis(1);
    const sideX = Math.cos(spin + 0.6);
    const sideZ = Math.sin(spin + 0.6);
    for (const side of [-1, 1] as const) {
      const root = v(top.x + sideX * side * r * 0.24, top.y, top.z + sideZ * side * r * 0.24);
      const shoulder = v(tipBase.x + sideX * side * r * 0.12, tipBase.y, tipBase.z + sideZ * side * r * 0.12);
      const tip = v(tipBase.x + leanX * 0.22 + sideX * side * r * 0.42, tipBase.y + h * 0.28, tipBase.z + leanZ * 0.22 + sideZ * side * r * 0.42);
      faceTriWithNormal(m, root, shoulder, tip, shade(color, 1.035), v(-sideZ * side * 0.22, 1, sideX * side * 0.22));
    }
  }
}

export function wheatStalk(m: Build, cx: number, cz: number, y0: number, h: number, leanAngle: number, seed: number): void {
  const rng = mulberry32(seed | 0 || 1);
  const lx = Math.cos(leanAngle);
  const lz = Math.sin(leanAngle);
  const lean = 0.008 + rng() * 0.008;
  const shoulder = v(cx + lx * lean, y0 + h, cz + lz * lean);
  beam(m, v(cx, y0, cz), shoulder, 0.0033, shade(WHEAT_STEM, 0.94 + rng() * 0.1));
  wheatGrainHead(
    m,
    shoulder.x,
    shoulder.z,
    0.015 + rng() * 0.003,
    0.036 + rng() * 0.008,
    shade(WHEAT_HEAD, 0.95 + rng() * 0.1),
    shoulder.y - 0.003,
    leanAngle + Math.PI / 4,
    lx * 0.008,
    lz * 0.008,
    3,
    true,
  );
}

// Three close stalks for the body of a standing field. Each keeps a separate stem and grain
// head, but the stems are single low-poly blades instead of four-sided beams. Detailed beam
// stalks remain at every harvested boundary and around the tile silhouette.
export function wheatTuft(m: Build, cx: number, cz: number, y0: number, h: number, angle: number, seed: number): void {
  const rng = mulberry32(seed | 0 || 1);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const wx = -s;
  const wz = c;
  const offsets = [
    [-0.013, -0.015],
    [0.014, -0.001],
    [-0.002, 0.016],
  ] as const;

  for (let i = 0; i < offsets.length; i++) {
    const along = offsets[i][0] + (rng() - 0.5) * 0.006;
    const across = offsets[i][1] + (rng() - 0.5) * 0.006;
    const bx = cx + c * along + wx * across;
    const bz = cz + s * along + wz * across;
    const stalkAngle = angle + (i - 1) * 0.18 + (rng() - 0.5) * 0.13;
    const lx = Math.cos(stalkAngle);
    const lz = Math.sin(stalkAngle);
    const px = -lz;
    const pz = lx;
    const stalkH = h * (0.9 + rng() * 0.15);
    const lean = 0.007 + rng() * 0.009;
    const half = 0.0033;
    const tx = bx + lx * lean;
    const tz = bz + lz * lean;
    faceQuadFlat(
      m,
      v(bx - px * half, y0, bz - pz * half),
      v(bx + px * half, y0, bz + pz * half),
      v(tx + px * half, y0 + stalkH, tz + pz * half),
      v(tx - px * half, y0 + stalkH, tz - pz * half),
      shade(WHEAT_STEM, 0.9 + rng() * 0.16),
      norm(v(lx, 0.08, lz)),
    );
    wheatGrainHead(
      m,
      tx,
      tz,
      0.014 + rng() * 0.0025,
      0.034 + rng() * 0.007,
      shade(WHEAT_HEAD, 0.95 + rng() * 0.1),
      y0 + stalkH - 0.003,
      stalkAngle,
      lx * 0.007,
      lz * 0.007,
      i === 1 ? 3 : 2,
    );
  }
}

export function stubbleTuft(m: Build, cx: number, cz: number, y0: number, angle: number, seed: number): void {
  const rng = mulberry32(seed | 0 || 1);
  const wx = -Math.sin(angle);
  const wz = Math.cos(angle);
  const count = 2 + (Math.abs(seed) % 2);
  for (let i = 0; i < count; i++) {
    const side = (i - (count - 1) / 2) * 0.012;
    const bx = cx + wx * side;
    const bz = cz + wz * side;
    const h = 0.028 + rng() * 0.017;
    const lean = (rng() - 0.5) * 0.009;
    beam(m, v(bx, y0, bz), v(bx + wx * lean, y0 + h, bz + wz * lean), 0.0028, shade(WHEAT_STEM, 0.88 + rng() * 0.1));
  }
}

function windmillStyle(seed: number): { scale: number; baseSpin: number; speed: number } {
  const rng = mulberry32(seed | 0 || 1);
  return {
    scale: 0.92 + rng() * 0.1,
    baseSpin: 0.35 + (rng() - 0.5) * 0.45,
    speed: 0.78 + rng() * 0.24,
  };
}

export function farmWindmillBody(m: Build, cx: number, cz: number, y0: number, angle: number, seed: number): void {
  const STONE: RGB = [124, 124, 112];
  const PLASTER: RGB = [223, 218, 196];
  const ROOF: RGB = [94, 76, 58];
  const { scale } = windmillStyle(seed);
  const sides = 7;
  const lower: Vec3[] = [];
  const upper: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = angle + (Math.PI * 2 * i) / sides;
    lower.push(v(cx + Math.cos(a) * 0.085 * scale, y0, cz + Math.sin(a) * 0.085 * scale));
    upper.push(v(cx + Math.cos(a) * 0.055 * scale, y0 + 0.19 * scale, cz + Math.sin(a) * 0.055 * scale));
  }
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const color = i % 3 === 0 ? shade(PLASTER, 0.92) : PLASTER;
    faceQuad(m, lower[i], lower[j], upper[j], upper[i], color, norm(v(lower[i].x + lower[j].x - cx * 2, 0.2, lower[i].z + lower[j].z - cz * 2)));
  }
  // A low dark stone footing and compact roof anchor the pale tapered mill body.
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const a = v(lower[i].x, y0 + 0.045 * scale, lower[i].z);
    const b = v(lower[j].x, y0 + 0.045 * scale, lower[j].z);
    faceQuad(m, lower[i], lower[j], b, a, shade(STONE, 0.9 + (i % 2) * 0.08), norm(v(lower[i].x + lower[j].x - cx * 2, 0.1, lower[i].z + lower[j].z - cz * 2)));
  }
  cone(m, cx, cz, 0.073 * scale, 0.055 * scale, sides, ROOF, y0 + 0.19 * scale, angle);
}

export function farmWindmillRotor(m: Build, cx: number, cz: number, y0: number, angle: number, seed: number, time: number): void {
  const WOOD: RGB = [111, 73, 43];
  const BLADE: RGB = [225, 217, 189];
  const { scale, baseSpin, speed } = windmillStyle(seed);
  // The rotor faces the tile camera. Four broad tapered paddles read clearly at terminal scale;
  // only this compact overlay is rebuilt as time advances, not the dense wheat geometry.
  const facing = fieldToWorld(angle, 0, 1);
  const axis = norm(v(facing.x, 0.34, facing.z));
  const side = norm(v(axis.z, 0, -axis.x));
  const vertical = norm(cross(axis, side));
  const hub = v(
    cx + axis.x * 0.071 * scale,
    y0 + 0.2 * scale + axis.y * 0.071 * scale,
    cz + axis.z * 0.071 * scale,
  );
  beam(m, v(cx, y0 + 0.195 * scale, cz), hub, 0.013 * scale, WOOD);
  const spin = baseSpin + time * speed;
  const add = (a: Vec3, b: Vec3, amount: number): Vec3 => v(a.x + b.x * amount, a.y + b.y * amount, a.z + b.z * amount);
  for (let i = 0; i < 4; i++) {
    const a = spin + (Math.PI * i) / 2;
    const dir = v(
      side.x * Math.cos(a) + vertical.x * Math.sin(a),
      vertical.y * Math.sin(a),
      side.z * Math.cos(a) + vertical.z * Math.sin(a),
    );
    const across = v(
      -side.x * Math.sin(a) + vertical.x * Math.cos(a),
      vertical.y * Math.cos(a),
      -side.z * Math.sin(a) + vertical.z * Math.cos(a),
    );
    const inner = add(hub, dir, 0.024 * scale);
    const outer = add(hub, dir, (0.165 + (i % 2) * 0.012) * scale);
    const p0 = add(inner, across, -0.014 * scale);
    const p1 = add(inner, across, 0.014 * scale);
    const p2 = add(outer, across, 0.034 * scale);
    const p3 = add(outer, across, -0.034 * scale);
    faceQuadWithNormal(m, p0, p1, p2, p3, shade(BLADE, 0.96 + (i % 2) * 0.06), axis);
    faceQuadWithNormal(m, p3, p2, p1, p0, shade(BLADE, 0.9), v(-axis.x, 0, -axis.z));
  }
  blob(m, hub.x, hub.y, hub.z, 0.026 * scale, 0.026 * scale, 0.026 * scale, WOOD, seed + 31, 0.05, 2, 6);
}

export function farmShack(m: Build, cx: number, cz: number, y0: number, angle: number, seed: number): void {
  const rng = mulberry32(seed | 0 || 1);
  const WALL: RGB = [147, 98, 57];
  const ROOF: RGB = [92, 59, 40];
  const DOOR: RGB = [73, 49, 35];
  const scale = 0.9 + rng() * 0.12;
  const width = 0.18 * scale;
  const depth = 0.12 * scale;
  const wallH = 0.09 * scale;
  box(m, cx, cz, width, wallH, depth, shade(WALL, 0.95 + rng() * 0.08), angle, y0);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const pt = (x: number, y: number, z: number): Vec3 => v(cx + x * c - z * s, y0 + y, cz + x * s + z * c);
  const x = width * 0.58;
  const z = depth * 0.68;
  const eaveY = wallH;
  const ridgeY = wallH + 0.065 * scale;
  const a = pt(-x, eaveY, -z);
  const b = pt(x, eaveY, -z);
  const c0 = pt(x, eaveY, z);
  const d = pt(-x, eaveY, z);
  const r0 = pt(-x, ridgeY, 0);
  const r1 = pt(x, ridgeY, 0);
  faceQuad(m, a, b, r1, r0, shade(ROOF, 0.94), norm(v(Math.sin(angle), 0.7, -Math.cos(angle))));
  faceQuad(m, r0, r1, c0, d, shade(ROOF, 1.04), norm(v(-Math.sin(angle), 0.7, Math.cos(angle))));
  faceTri(m, a, r0, d, WALL, norm(v(-Math.cos(angle), 0.2, -Math.sin(angle))));
  faceTri(m, b, c0, r1, WALL, norm(v(Math.cos(angle), 0.2, Math.sin(angle))));
  const frontX = cx - Math.sin(angle) * (depth * 0.5 + 0.004);
  const frontZ = cz + Math.cos(angle) * (depth * 0.5 + 0.004);
  box(m, frontX, frontZ, 0.045 * scale, 0.058 * scale, 0.008, DOOR, angle, y0);
}

export function farmBush(m: Build, cx: number, cz: number, y0: number, scale: number, seed: number): void {
  const rng = mulberry32(seed | 0 || 1);
  const colors: RGB[] = [[66, 119, 60], [77, 132, 65], [88, 142, 72]];
  const clusters = [
    [0, 0, 1],
    [-0.055, 0.012, 0.82],
    [0.052, 0.016, 0.88],
    [-0.016, -0.048, 0.76],
    [0.035, -0.042, 0.7],
  ] as const;
  for (let i = 0; i < clusters.length; i++) {
    const [ox, oz, size] = clusters[i];
    const r = 0.07 * scale * size;
    blob(
      m,
      cx + ox * scale,
      y0 + r * (0.9 + rng() * 0.18),
      cz + oz * scale,
      r,
      r * 0.9,
      r,
      colors[i % colors.length],
      seed + i * 17,
      0.18,
      3,
      6,
    );
  }
}
