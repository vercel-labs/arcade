// Geometric solids reused across terrains and port cargo: boxes, cones, blobs, angular rocks,
// beams and capped logs (both ground-resting and free-axis).

import { type Vec3 } from '../../../../engine/index.ts';
import { mulberry32 } from '../../../scenes/wisp.ts';
import { type Build, cross, faceQuad, faceQuadFlat, faceTri, norm, type RGB, shade, sub, UP, v } from './build.ts';

// ── Prop primitives ───────────────────────────────────────────────────────────

// Axis-aligned box from yBase up by h, centered at (cx,cz), optional yaw.
export function box(m: Build, cx: number, cz: number, w: number, h: number, d: number, color: RGB, ry = 0, yBase = 0): void {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const pt = (dx: number, dy: number, dz: number): Vec3 => v(cx + dx * c - dz * s, yBase + dy, cz + dx * s + dz * c);
  const [x0, x1, z0, z1, y0, y1] = [-w / 2, w / 2, -d / 2, d / 2, 0, h];
  faceQuad(m, pt(x0, y1, z1), pt(x1, y1, z1), pt(x1, y1, z0), pt(x0, y1, z0), color, UP);
  faceQuad(m, pt(x1, y0, z1), pt(x1, y0, z0), pt(x1, y1, z0), pt(x1, y1, z1), color, norm(v(c, 0, s)));
  faceQuad(m, pt(x0, y0, z0), pt(x0, y0, z1), pt(x0, y1, z1), pt(x0, y1, z0), color, norm(v(-c, 0, -s)));
  faceQuad(m, pt(x0, y0, z1), pt(x1, y0, z1), pt(x1, y1, z1), pt(x0, y1, z1), color, norm(v(-s, 0, c)));
  faceQuad(m, pt(x1, y0, z0), pt(x0, y0, z0), pt(x0, y1, z0), pt(x1, y1, z0), color, norm(v(s, 0, -c)));
}

// A cone/pyramid: `sides`-gon base radius r at yBase, apex at (cx+leanX, yBase+h, cz+leanZ).
export function cone(m: Build, cx: number, cz: number, r: number, h: number, sides: number, color: RGB, yBase = 0, spin = 0, leanX = 0, leanZ = 0): void {
  const apex = v(cx + leanX, yBase + h, cz + leanZ);
  const ring: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (Math.PI * 2 * i) / sides + spin;
    ring.push(v(cx + r * Math.cos(a), yBase, cz + r * Math.sin(a)));
  }
  for (let i = 0; i < sides; i++) {
    const b = ring[i];
    const c = ring[(i + 1) % sides];
    faceTri(m, apex, b, c, color, norm(v((b.x + c.x) / 2 - cx, 0.5 * h, (b.z + c.z) / 2 - cz)));
  }
}

// A faceted ellipsoid ("blob"), optional radial jitter for rocks. `belly` two-tones the faces
// below center (e.g. a sheep's white top over a cream underside); `yaw` rotates it about Y so
// an elongated blob (rx ≠ rz) can point along a facing direction.
export function blob(m: Build, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, color: RGB, seed = 1, jit = 0, latN = 3, lonN = 6, belly?: RGB, yaw = 0): void {
  const rng = mulberry32(seed | 0 || 1);
  const cyaw = Math.cos(yaw);
  const syaw = Math.sin(yaw);
  const rows: Vec3[][] = [];
  for (let i = 0; i <= latN; i++) {
    const theta = (Math.PI * i) / latN;
    const cy0 = Math.cos(theta);
    const sy0 = Math.sin(theta);
    const count = i === 0 || i === latN ? 1 : lonN;
    const ring: Vec3[] = [];
    for (let j = 0; j < count; j++) {
      const phi = (2 * Math.PI * j) / lonN;
      const jf = 1 + (jit ? (rng() - 0.5) * jit : 0);
      const dx = sy0 * Math.cos(phi) * rx * jf;
      const dz = sy0 * Math.sin(phi) * rz * jf;
      ring.push(v(cx + dx * cyaw - dz * syaw, cy + cy0 * ry * jf, cz + dx * syaw + dz * cyaw));
    }
    rows.push(ring);
  }
  const center = v(cx, cy, cz);
  const out = (p: Vec3): Vec3 => norm(sub(p, center));
  const col = (p0: Vec3, p1: Vec3, p2: Vec3): RGB => (belly && (p0.y + p1.y + p2.y) / 3 < cy ? belly : color);
  for (let i = 0; i < latN; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    for (let j = 0; j < lonN; j++) {
      const a0 = a[a.length === 1 ? 0 : j % a.length];
      const a1 = a[a.length === 1 ? 0 : (j + 1) % a.length];
      const b0 = b[b.length === 1 ? 0 : j % b.length];
      const b1 = b[b.length === 1 ? 0 : (j + 1) % b.length];
      if (a.length === 1) faceTri(m, a0, b0, b1, col(a0, b0, b1), out(b0));
      else if (b.length === 1) faceTri(m, a0, a1, b0, col(a0, a1, b0), out(a0));
      else {
        faceTri(m, a0, a1, b1, col(a0, a1, b1), out(a1));
        faceTri(m, a0, b1, b0, col(a0, b1, b0), out(b0));
      }
    }
  }
}

type RockProfile = 'crag' | 'slab' | 'wedge';

// Three deliberately different angular-rock constructions: a peaked crag, a broad flat slab,
// or a sharp ridge-backed wedge. Their distinct topology—not only random vertex jitter—keeps a
// pile from reading as copies of one procedural boulder.
export function angularRock(m: Build, cx: number, cz: number, y0: number, rx: number, h: number, rz: number, color: RGB, seed: number, profile: RockProfile, spin = 0): void {
  const rng = mulberry32(seed | 0 || 1);
  const cs = Math.cos(spin);
  const ss = Math.sin(spin);
  const point = (dx: number, dy: number, dz: number): Vec3 =>
    v(cx + dx * cs - dz * ss, y0 + dy, cz + dx * ss + dz * cs);

  if (profile === 'wedge') {
    const l0 = rx * (0.9 + rng() * 0.14);
    const l1 = rx * (0.86 + rng() * 0.16);
    const w0 = rz * (0.82 + rng() * 0.16);
    const w1 = rz * (0.88 + rng() * 0.14);
    const base = [
      point(-l0, 0.006, -w0),
      point(l1, 0.006, -w1),
      point(l1 * 0.9, 0.006, w1),
      point(-l0 * 0.88, 0.006, w0),
    ];
    const ridgeA = point(-rx * 0.48, h * (0.9 + rng() * 0.08), rz * 0.04);
    const ridgeB = point(rx * 0.46, h * (0.78 + rng() * 0.1), -rz * 0.05);
    const sideA = norm(v(-ss, 0.25, cs));
    const sideB = norm(v(ss, 0.25, -cs));
    faceQuadFlat(m, base[0], base[1], ridgeB, ridgeA, shade(color, 0.94), sideA);
    faceQuadFlat(m, base[3], ridgeA, ridgeB, base[2], shade(color, 1.06), sideB);
    faceTri(m, base[0], ridgeA, base[3], shade(color, 0.86), norm(v(-cs, 0.2, -ss)));
    faceTri(m, base[1], base[2], ridgeB, shade(color, 0.9), norm(v(cs, 0.2, ss)));
    return;
  }

  const sides = profile === 'slab' ? 5 : 5 + (Math.abs(seed) % 2);
  const angles = Array.from({ length: sides }, (_, i) => (Math.PI * 2 * i) / sides + spin + (rng() - 0.5) * 0.18);
  const ring = (y: number, scale: number, shiftX: number, shiftZ: number, verticalJitter: number): Vec3[] =>
    angles.map((a) => {
      const radial = scale * (0.78 + rng() * 0.34);
      return v(
        cx + shiftX + Math.cos(a) * rx * radial,
        y + (rng() - 0.5) * verticalJitter,
        cz + shiftZ + Math.sin(a) * rz * radial,
      );
    });
  const bottom = ring(y0 + 0.006, 0.72, 0, 0, h * 0.025);
  const shoulder = ring(y0 + h * (profile === 'slab' ? 0.4 : 0.52), 1, (rng() - 0.5) * rx * 0.1, (rng() - 0.5) * rz * 0.1, h * 0.1);
  const ridgeShiftX = (rng() - 0.5) * rx * 0.42;
  const ridgeShiftZ = (rng() - 0.5) * rz * 0.42;
  const ridge = ring(y0 + h * (profile === 'slab' ? 0.76 : 0.8), profile === 'slab' ? 0.7 : 0.43, ridgeShiftX, ridgeShiftZ, h * 0.08);
  const peak = v(
    cx + ridgeShiftX + (rng() - 0.5) * rx * 0.2,
    y0 + h * (profile === 'slab' ? 0.82 : 1),
    cz + ridgeShiftZ + (rng() - 0.5) * rz * 0.2,
  );

  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const outward = norm(v(
      shoulder[i].x + shoulder[j].x - 2 * cx,
      0.16,
      shoulder[i].z + shoulder[j].z - 2 * cz,
    ));
    faceQuadFlat(m, bottom[i], bottom[j], shoulder[j], shoulder[i], shade(color, 0.88 + rng() * 0.12), outward);
    faceQuadFlat(m, shoulder[i], shoulder[j], ridge[j], ridge[i], shade(color, 0.9 + rng() * 0.16), outward);
    faceTri(m, ridge[i], ridge[j], peak, shade(color, 0.94 + rng() * 0.16), profile === 'slab' ? UP : outward);
  }
}

// A thin square-section beam between two 3D points (for angled struts like sheep legs).
export function beam(m: Build, a: Vec3, b: Vec3, w: number, color: RGB): void {
  const dir = norm(sub(b, a));
  const ref: Vec3 = Math.abs(dir.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = norm(cross(dir, ref));
  const wv = norm(cross(dir, u));
  const off = (p: Vec3, su: number, sw: number): Vec3 => v(p.x + (u.x * su + wv.x * sw) * w, p.y + (u.y * su + wv.y * sw) * w, p.z + (u.z * su + wv.z * sw) * w);
  const cs: [number, number][] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  const ca = cs.map(([su, sw]) => off(a, su, sw));
  const cb = cs.map(([su, sw]) => off(b, su, sw));
  const center = v((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  for (let k = 0; k < 4; k++) {
    const j = (k + 1) % 4;
    const mid = v((ca[k].x + ca[j].x + cb[k].x + cb[j].x) / 4, (ca[k].y + ca[j].y + cb[k].y + cb[j].y) / 4, (ca[k].z + ca[j].z + cb[k].z + cb[j].z) / 4);
    faceQuad(m, ca[k], ca[j], cb[j], cb[k], color, norm(sub(mid, center)));
  }
}

export function scatter(
  rng: () => number,
  n: number,
  rMax: number,
  minGap: number,
  accepts: (x: number, z: number) => boolean = () => true,
): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  let guard = 0;
  while (pts.length < n && guard++ < n * 60) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * rMax;
    const x = r * Math.cos(a);
    const z = r * Math.sin(a);
    if (accepts(x, z) && pts.every((p) => Math.hypot(p.x - x, p.z - z) > minGap)) pts.push({ x, z });
  }
  return pts;
}

// A horizontal octagonal-prism log/beam (axis along `ry`, resting on the ground): `side` for
// the staves, `cap` for the octagon end faces. Shared by grain cargo and lumber.
function logBeam(m: Build, cx: number, cz: number, y0: number, len: number, r: number, ry: number, side: RGB, cap: RGB): void {
  const sides = 8;
  const Ax = Math.cos(ry);
  const Az = Math.sin(ry);
  const Wx = -Math.sin(ry);
  const Wz = Math.cos(ry);
  const cy = y0 + r * 0.92; // rest on the ground
  const end = (d: number): { x: number; z: number } => ({ x: cx + Ax * d, z: cz + Az * d });
  const ringAt = (e: { x: number; z: number }): Vec3[] => {
    const pts: Vec3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (2 * Math.PI * i) / sides + Math.PI / 8;
      pts.push(v(e.x + Wx * Math.sin(a) * r, cy + Math.cos(a) * r, e.z + Wz * Math.sin(a) * r));
    }
    return pts;
  };
  const e0 = end(-len / 2);
  const e1 = end(len / 2);
  const r0 = ringAt(e0);
  const r1 = ringAt(e1);
  const axisMid = v(cx, cy, cz);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const mid = v((r0[i].x + r0[j].x) / 2, (r0[i].y + r0[j].y) / 2, (r0[i].z + r0[j].z) / 2);
    faceQuad(m, r0[i], r0[j], r1[j], r1[i], side, norm(sub(mid, axisMid))); // stave
  }
  const c0 = v(e0.x, cy, e0.z);
  const c1 = v(e1.x, cy, e1.z);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    faceTri(m, c0, r0[i], r0[j], cap, v(-Ax, 0, -Az)); // end cap
    faceTri(m, c1, r1[i], r1[j], cap, v(Ax, 0, Az));
  }
}
// A stack of cut logs: three on the bottom, two on top (a bundled woodpile), lying along `ry`.
// A casually-piled bundle of cut logs: a bottom row of 2-3 with 1-2 resting on top, each log
// jittered in position, length, and angle so the stack looks tossed together, not stacked to a
// grid. `ry` is the pile's rough axis.
export function lumberStack(m: Build, cx: number, cz: number, y0: number, ry: number, rng: () => number): void {
  const WOOD: RGB = [116, 76, 50];
  const CAP: RGB = [150, 106, 74];
  const r = 0.03;
  const j = (s: number): number => (rng() - 0.5) * s; // symmetric jitter
  const place = (perp: number, yy: number): void => {
    const a = ry + j(0.16); // per-log twist
    const Wx = -Math.sin(ry);
    const Wz = Math.cos(ry);
    const Ax = Math.cos(ry);
    const Az = Math.sin(ry);
    const off = j(0.05); // slide along the axis
    logBeam(m, cx + Wx * perp + Ax * off, cz + Wz * perp + Az * off, y0 + yy, 0.16 + rng() * 0.07, r, a, WOOD, CAP);
  };
  const nBot = 2 + Math.floor(rng() * 2);
  for (let k = 0; k < nBot; k++) place((k - (nBot - 1) / 2) * 2.05 * r + j(0.012), 0);
  const nTop = 1 + Math.floor(rng() * 2);
  for (let k = 0; k < nTop; k++) place((k - (nTop - 1) / 2) * 2.05 * r + j(0.02), r * 1.7);
}
// A single felled tree — one thin log lying on the ground.
export function felledTree(m: Build, cx: number, cz: number, y0: number, ry: number): void {
  logBeam(m, cx, cz, y0, 0.3, 0.038, ry, [112, 74, 48], [144, 100, 70]);
}

export function logBeamAxis(m: Build, start: Vec3, end: Vec3, r: number, side: RGB, cap: RGB): void {
  const sides = 8;
  const axis = norm(sub(end, start));
  const ref: Vec3 = Math.abs(axis.y) > 0.9 ? v(1, 0, 0) : UP;
  const u = norm(cross(axis, ref));
  const w = norm(cross(axis, u));
  const ringAt = (center: Vec3): Vec3[] =>
    Array.from({ length: sides }, (_, i) => {
      const a = (Math.PI * 2 * i) / sides + Math.PI / 8;
      return v(
        center.x + (u.x * Math.cos(a) + w.x * Math.sin(a)) * r,
        center.y + (u.y * Math.cos(a) + w.y * Math.sin(a)) * r,
        center.z + (u.z * Math.cos(a) + w.z * Math.sin(a)) * r,
      );
    });
  const r0 = ringAt(start);
  const r1 = ringAt(end);
  const center = v((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const mid = v(
      (r0[i].x + r0[j].x + r1[i].x + r1[j].x) / 4,
      (r0[i].y + r0[j].y + r1[i].y + r1[j].y) / 4,
      (r0[i].z + r0[j].z + r1[i].z + r1[j].z) / 4,
    );
    faceQuad(m, r0[i], r0[j], r1[j], r1[i], side, norm(sub(mid, center)));
    faceTri(m, start, r0[j], r0[i], cap, v(-axis.x, -axis.y, -axis.z));
    faceTri(m, end, r1[i], r1[j], cap, axis);
  }
}

// A cone whose axis points in an arbitrary direction — the segment of a felled tree. A ring
// perpendicular to `axis` at `base`, tapering to an apex `len` along the axis.
export function coneAxis(m: Build, base: Vec3, axis: Vec3, r: number, len: number, sides: number, color: RGB, spin = 0): void {
  const a = norm(axis);
  const ref: Vec3 = Math.abs(a.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = norm(cross(a, ref));
  const w = norm(cross(a, u));
  const apex = v(base.x + a.x * len, base.y + a.y * len, base.z + a.z * len);
  const ring: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const t = (Math.PI * 2 * i) / sides + spin;
    const cc = Math.cos(t) * r;
    const ss = Math.sin(t) * r;
    ring.push(v(base.x + u.x * cc + w.x * ss, base.y + u.y * cc + w.y * ss, base.z + u.z * cc + w.z * ss));
  }
  for (let i = 0; i < sides; i++) {
    const b = ring[i];
    const c = ring[(i + 1) % sides];
    const mid = v((b.x + c.x) / 2, (b.y + c.y) / 2, (b.z + c.z) / 2);
    faceTri(m, apex, b, c, color, norm(sub(mid, base)));
  }
}
// A felled version of the forest tile's pine: the same broad, stepped three-skirt silhouette,
// rotated onto its side. One continuous capped trunk runs through the foliage, with only the cut
// end exposed behind the widest skirt; the far end stops short of the leafy tip.
