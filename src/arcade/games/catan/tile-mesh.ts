// Prototype 3D hex tiles for Catan, rebuilt tile-by-tile from reference art. Shared design:
// a THIN, flat-top hexagon slab — a short brown side wall, a thin flat brown rim ledge, and
// the terrain surface sitting nearly flush (a hair proud, no deep indent). The terrain is a
// gently-undulating, coarsely-triangulated surface so facets catch the light. Number chips
// are intentionally NOT baked in — they're a separate component added later.
//
// Everything bakes into one mesh per tile (positions + per-face normals), drawn in one
// lambert pass. Faces go through `faceTri`/`faceQuad`, which orient winding to an "outward"
// hint. Terrain height is a pure function of (x,z) so independently-built sectors meet
// seamlessly and props can be sat exactly on the surface.
//
// Status: WHEAT (fields) is rebuilt to reference. The other five still use their older props
// on the new thin base and will be redone tile-by-tile.

import type { Mesh } from '../../../engine/index.ts';
import type { Vec3 } from '../../../engine/index.ts';
import type { VertexIn } from '../../../engine/shader.ts';
import { mulberry32 } from '../../scenes/wisp.ts';
import { type Terrain } from '../../../rules/catan/types.ts';

type RGB = [number, number, number];
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const hash2 = (x: number, z: number): number => {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
};

interface Build {
  vertices: VertexIn[];
  indices: number[];
}
const build = (): Build => ({ vertices: [], indices: [] });

function faceTri(m: Build, a: Vec3, b: Vec3, c: Vec3, color: RGB, outward: Vec3): void {
  let n = norm(cross(sub(b, a), sub(c, a)));
  if (n.x * outward.x + n.y * outward.y + n.z * outward.z < 0) {
    [b, c] = [c, b];
    n = { x: -n.x, y: -n.y, z: -n.z };
  }
  const col = { x: color[0], y: color[1], z: color[2] };
  const base = m.vertices.length;
  for (const p of [a, b, c]) m.vertices.push({ position: { ...p }, normal: n, uv: [0, 0], color: col });
  m.indices.push(base, base + 1, base + 2);
}
function faceQuad(m: Build, a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: RGB, outward: Vec3): void {
  faceTri(m, a, b, c, color, outward);
  faceTri(m, a, c, d, color, outward);
}
// Emit a low-poly cell as ONE flat quadrilateral: both triangles share a single averaged
// normal + color, so it reads as a quad (not two triangles). Winding is irrelevant — lambert
// lights from the stored normal and cull is 'none'.
function faceQuadFlat(m: Build, a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: RGB, outward: Vec3): void {
  let n = norm(cross(sub(c, a), sub(b, d))); // normal from the diagonals
  if (n.x * outward.x + n.y * outward.y + n.z * outward.z < 0) n = { x: -n.x, y: -n.y, z: -n.z };
  const col = { x: color[0], y: color[1], z: color[2] };
  const base = m.vertices.length;
  for (const p of [a, b, c, d]) m.vertices.push({ position: { ...p }, normal: n, uv: [0, 0], color: col });
  m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
const UP: Vec3 = { x: 0, y: 1, z: 0 };
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

// ── Shared thin, flat-top base ────────────────────────────────────────────────

const R_OUT = 1.0; // outer edge of the wooden wall
const R_RIM = 0.92; // inner edge of the thin flat rim ledge (ledge width 0.08)
const EDGE_Y = 0.03; // terrain edge sits a hair proud of the rim ledge (small step, no indent)
const WALL = 0.16; // short side wall below the rim

// Flat-top hexagon corners (flat edges top/bottom, points left/right).
function hexCorners(r: number, y: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    out.push(v(r * Math.cos(a), y, r * Math.sin(a)));
  }
  return out;
}

const FRAME_TOP: RGB = [150, 124, 92];
const FRAME_SIDE: RGB = [120, 96, 68];

// Clamp a point to inside the flat-top hexagon of circumradius R (vertices at 0°,60°,…, edge
// normals at 30°,90°,…). Points outside are pulled radially onto the nearest edge — so an
// oversized pad gets "cut off" by the tile boundary instead of poking past the rim.
function clampToHex(x: number, z: number, R: number): { x: number; z: number } {
  const a = R * Math.cos(Math.PI / 6); // apothem (center → edge)
  const ang = Math.atan2(z, x);
  const n = Math.round((ang - Math.PI / 6) / (Math.PI / 3)) * (Math.PI / 3) + Math.PI / 6;
  const rb = a / Math.cos(ang - n); // boundary radius in this direction
  const r = Math.hypot(x, z);
  return r > rb ? { x: (x * rb) / r, z: (z * rb) / r } : { x, z };
}

// Terrain height at (x,z): a broad gentle swell PLUS a per-location bump so neighbouring
// vertices land at noticeably different heights (the little hills/dips that make the faceted
// surface read as uneven, not flat). Fades to the proud edge at the rim. Pure function of
// (x,z) so sectors meet and props sit exactly on the ground.
function groundNoise(x: number, z: number, amp: number, seed: number): number {
  const r = Math.hypot(x, z);
  const fall = smooth((R_RIM - r) / R_RIM);
  const swell = Math.sin(x * 2.0 + seed) * Math.cos(z * 1.8 - seed * 0.6);
  const bump = hash2(x * 8.9 + seed, z * 8.9 - seed) * 2 - 1; // per-location, -1..1
  return EDGE_Y + amp * fall * (0.45 + 0.24 * swell + 0.5 * bump);
}
// Sample the surface so props rest on it.
function surfaceY(x: number, z: number, amp: number, seed: number): number {
  return groundNoise(x, z, amp, seed);
}

interface GroundOpts {
  color: RGB;
  amp: number;
  seed: number;
  facet?: number;
}

// The thin proud lip (terrain edge → rim ledge), the flat rim ledge, and the short outer
// wall. Shared by every tile's base; the terrain surface above it is per-tile.
function rimAndWall(m: Build, fieldColor: RGB): void {
  const Fi = hexCorners(R_RIM, EDGE_Y);
  const Ri = hexCorners(R_RIM, 0);
  const O = hexCorners(R_OUT, 0);
  const Ob = hexCorners(R_OUT, -WALL);
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    const radial = norm(v(O[i].x + O[j].x, 0, O[i].z + O[j].z));
    faceQuad(m, Fi[i], Fi[j], Ri[j], Ri[i], shade(fieldColor, 0.8), radial); // proud lip
    faceQuad(m, Ri[i], Ri[j], O[j], O[i], FRAME_TOP, UP); // flat rim ledge
    faceQuad(m, O[i], O[j], Ob[j], Ob[i], FRAME_SIDE, radial); // short outer wall
  }
}

// Flat-shaded low-poly terrain over the hex: a coarse triangulation whose INTERIOR vertices
// are jittered in x/z (less than a cell, so no flips) — turning the uniform grid into
// irregular triangles (the cheap stand-in for a Delaunay-of-jittered-points mesh) — with
// smooth-noise heights and slight per-facet color variation. Boundary vertices stay pinned so
// the hex edge is clean; sector seams match because jitter + height are pure functions of the
// pre-jitter (x,z).
function irregularGround(m: Build, o: GroundOpts & { M?: number }): void {
  const M = o.M ?? 3; // coarse: fewer, larger facets like the reference
  const facet = o.facet ?? 0.05;
  const V = hexCorners(R_RIM, 0);
  const jit = (R_RIM / M) * 0.42;
  const at = (b: Vec3, c: Vec3, i: number, j: number): Vec3 => {
    const ox = (i / M) * b.x + (j / M) * c.x;
    const oz = (i / M) * b.z + (j / M) * c.z;
    let x = ox;
    let z = oz;
    if (i + j < M && (i > 0 || j > 0)) {
      x = ox + (hash2(ox * 41 + o.seed, oz * 41 - o.seed) - 0.5) * 2 * jit;
      z = oz + (hash2(ox * 23 - o.seed, oz * 23 + o.seed) - 0.5) * 2 * jit;
    }
    return v(x, groundNoise(x, z, o.amp, o.seed), z);
  };
  // Most cells render as a single flat QUAD; the diagonal edge cells are lone triangles — a
  // mix of quads + triangles, like the hand-modeled reference.
  for (let s = 0; s < 6; s++) {
    const b = V[s];
    const c = V[(s + 1) % 6];
    for (let i = 0; i < M; i++) {
      for (let j = 0; j < M - i; j++) {
        const p00 = at(b, c, i, j);
        const p10 = at(b, c, i + 1, j);
        const p01 = at(b, c, i, j + 1);
        const col = shade(o.color, 1 + (hash2(p00.x + s * 3, p00.z - s * 3) - 0.5) * 2 * facet);
        if (j < M - i - 1) faceQuadFlat(m, p00, p10, at(b, c, i + 1, j + 1), p01, col, UP);
        else faceTri(m, p00, p10, p01, col, UP);
      }
    }
  }
}

// A whole tile base: the irregular low-poly terrain + the rim/wall. (Used by tiles not yet
// individually rebuilt.)
function tileBase(m: Build, o: GroundOpts): void {
  irregularGround(m, o);
  rimAndWall(m, o.color);
}

// ── Wheat ground: overlapping octagonal terrace pads ────────────────────────────
// The field is ~3 large, slightly-irregular octagonal pads that overlap at slightly
// different heights, over a coarse base plane — a low-poly terraced surface with visible
// step-edges (not fine uniform triangles). `dh` is the pad's rise above the base.
interface Pad {
  cx: number;
  cz: number;
  r: number;
  dh: number;
  seed: number;
}
// Three raised grain patches near the rim (≈120° apart) so they don't overlap and leave clear
// channels + a clear centre for the props. Seeded: an overall rotation plus per-pad angle,
// radius, size, and height jitter, so no two grain hexes are identical.
function wheatPads(rng: () => number, baseRot: number, seed: number): Pad[] {
  const pads: Pad[] = [];
  for (let k = 0; k < 3; k++) {
    const th = baseRot + (k * 2 * Math.PI) / 3 + (rng() - 0.5) * 0.5;
    const rp = 0.44 + rng() * 0.06;
    pads.push({ cx: rp * Math.cos(th), cz: rp * Math.sin(th), r: 0.27 + rng() * 0.05, dh: 0.04 + rng() * 0.06, seed: (seed * 97 + k * 31) | 0 });
  }
  return pads;
}
// Height of the terraced field at (x,z): the highest pad whose octagon covers it, else base.
function wheatHeightAt(pads: Pad[], x: number, z: number): number {
  let h = EDGE_Y;
  for (const p of pads) if (Math.hypot(x - p.cx, z - p.cz) < p.r * 0.86) h = Math.max(h, EDGE_Y + p.dh);
  return h;
}
// True if (x,z) (with a prop of half-extent `ext`) stays clear of every raised pad.
function clearOfPads(pads: Pad[], x: number, z: number, ext: number): boolean {
  return pads.every((p) => Math.hypot(x - p.cx, z - p.cz) > p.r * 1.05 + ext);
}

// One irregular octagonal pad, CLIPPED to the tile hexagon: a flat-ish faceted top + a short
// skirt down to the base level. Oversized pads therefore end flush at the rim.
function octaPad(m: Build, p: Pad, color: RGB): void {
  const rng = mulberry32(p.seed);
  const top = EDGE_Y + p.dh;
  const sides = 8;
  const ring: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const ang = (2 * Math.PI * i) / sides + 0.15;
    const rr = p.r * (0.88 + rng() * 0.24); // irregular radius
    const c = clampToHex(p.cx + rr * Math.cos(ang), p.cz + rr * Math.sin(ang), R_RIM);
    ring.push(v(c.x, top, c.z)); // flat top (no height jitter)
  }
  const center = v(p.cx, top, p.cz);
  for (let i = 0; i < sides; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % sides];
    faceTri(m, center, a, b, color, UP); // FLAT, uniform top face
    const abot = v(a.x, EDGE_Y, a.z);
    const bbot = v(b.x, EDGE_Y, b.z);
    const rad = norm(v((a.x + b.x) / 2 - p.cx, 0.25, (a.z + b.z) / 2 - p.cz));
    faceTri(m, a, b, bbot, shade(color, 0.82), rad); // skirt down to base
    faceTri(m, a, bbot, abot, shade(color, 0.82), rad);
  }
}


// ── Prop primitives ───────────────────────────────────────────────────────────

// Axis-aligned box from yBase up by h, centered at (cx,cz), optional yaw.
function box(m: Build, cx: number, cz: number, w: number, h: number, d: number, color: RGB, ry = 0, yBase = 0): void {
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
function cone(m: Build, cx: number, cz: number, r: number, h: number, sides: number, color: RGB, yBase = 0, spin = 0, leanX = 0, leanZ = 0): void {
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
function blob(m: Build, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, color: RGB, seed = 1, jit = 0, latN = 3, lonN = 6, belly?: RGB, yaw = 0): void {
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

// A thin square-section beam between two 3D points (for angled struts like sheep legs).
function beam(m: Build, a: Vec3, b: Vec3, w: number, color: RGB): void {
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

function scatter(rng: () => number, n: number, rMax: number, minGap: number): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  let guard = 0;
  while (pts.length < n && guard++ < n * 60) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * rMax;
    const x = r * Math.cos(a);
    const z = r * Math.sin(a);
    if (pts.every((p) => Math.hypot(p.x - x, p.z - z) > minGap)) pts.push({ x, z });
  }
  return pts;
}

// ── Wheat-specific props ──────────────────────────────────────────────────────

const FENCE_WOOD: RGB = [92, 58, 36];

// A post-and-rail fence between (x0,z0) and (x1,z1): thin dark posts that stick up above two
// thin rails. Each post drops to the terraced surface via `hAt`.
function fence(m: Build, x0: number, z0: number, x1: number, z1: number, hAt: (x: number, z: number) => number): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const ang = Math.atan2(dz, dx);
  const n = Math.max(2, Math.round(len / 0.16));
  const postH = 0.22;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = x0 + dx * t;
    const pz = z0 + dz * t;
    box(m, px, pz, 0.03, postH, 0.03, FENCE_WOOD, ang, hAt(px, pz));
  }
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  const y = hAt(mx, mz);
  box(m, mx, mz, len, 0.025, 0.018, FENCE_WOOD, ang, y + 0.17); // top rail
  box(m, mx, mz, len, 0.025, 0.018, FENCE_WOOD, ang, y + 0.09); // lower rail
}

// A round hay bale: an OCTAGONAL PRISM lying on its side, so the octagon end-faces point
// sideways (a low-poly round bale). Axis is horizontal along `ry`; it rests on the surface.
function roundBale(m: Build, cx: number, cz: number, y0: number, ry: number): void {
  const gold: RGB = [232, 198, 82]; // close to the field yellow, a touch deeper
  const cap = shade(gold, 1.08);
  const len = 0.16;
  const r = 0.062;
  const sides = 8;
  const Ax = Math.cos(ry);
  const Az = Math.sin(ry); // horizontal axis
  const Wx = -Math.sin(ry);
  const Wz = Math.cos(ry); // horizontal perpendicular
  const cy = y0 + r * 0.9; // lift so the bale rests on the ground
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
    faceQuad(m, r0[i], r0[j], r1[j], r1[i], gold, norm(sub(mid, axisMid))); // side stave
  }
  const c0 = v(e0.x, cy, e0.z);
  const c1 = v(e1.x, cy, e1.z);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    faceTri(m, c0, r0[i], r0[j], cap, v(-Ax, 0, -Az)); // octagon end-cap (faces sideways)
    faceTri(m, c1, r1[i], r1[j], cap, v(Ax, 0, Az));
  }
}

// A stack of round bales: two side by side + (optionally) one on top, beside the fences.
function baleStack(m: Build, cx: number, cz: number, hAt: (x: number, z: number) => number, ry: number, pair = true): void {
  // `pair` = two bales side by side; otherwise a single bale. Small footprint so it tucks
  // into the flat gaps without touching a grain patch.
  const Wx = -Math.sin(ry);
  const Wz = Math.cos(ry);
  const g = 0.07;
  const y0 = hAt(cx, cz);
  if (pair) {
    roundBale(m, cx - Wx * g, cz - Wz * g, y0, ry);
    roundBale(m, cx + Wx * g, cz + Wz * g, y0, ry);
  } else {
    roundBale(m, cx, cz, y0, ry);
  }
}

// ── Palette (non-wheat tiles, pending their rebuilds) ────────────────────────────
const PAL = {
  forest: { top: [126, 168, 96] as RGB, pineDark: [56, 108, 66] as RGB, pineLite: [78, 138, 84] as RGB, leaf: [96, 150, 86] as RGB },
  hills: { top: [190, 118, 84] as RGB, brick: [176, 96, 66] as RGB, rock: [150, 96, 72] as RGB },
  pasture: { top: [150, 194, 108] as RGB, rock: [120, 156, 104] as RGB },
  desert: { top: [230, 210, 156] as RGB, dune: [220, 198, 140] as RGB },
} as const;
const TRUNK: RGB = [104, 72, 44];

function pine(m: Build, cx: number, cz: number, y0: number, scale: number, dark: RGB, lite: RGB): void {
  box(m, cx, cz, 0.05 * scale, 0.14 * scale, 0.05 * scale, TRUNK, 0, y0);
  ([[0.26, 0.26, 0.1], [0.2, 0.26, 0.28], [0.13, 0.24, 0.46]] as [number, number, number][]).forEach(([r, h, yy], i) =>
    cone(m, cx, cz, r * scale, h * scale, 6, i === 2 ? lite : dark, y0 + yy * scale, cx + cz),
  );
}
// A broadleaf tree: a short brown trunk under a big rounded faceted canopy (flat shading
// gives the two-tone sunlit/shadow look).
function roundTree(m: Build, cx: number, cz: number, y0: number, scale: number, leaf: RGB, seed: number): void {
  box(m, cx, cz, 0.075 * scale, 0.2 * scale, 0.075 * scale, TRUNK, 0, y0);
  blob(m, cx, y0 + 0.44 * scale, cz, 0.26 * scale, 0.27 * scale, 0.26 * scale, leaf, seed, 0.16, 4, 7);
}

// A bush: a rounded faceted green blob sitting directly on the ground (no trunk).
function bush(m: Build, cx: number, cz: number, y0: number, scale: number, color: RGB, seed: number): void {
  blob(m, cx, y0 + 0.11 * scale, cz, 0.16 * scale, 0.13 * scale, 0.16 * scale, color, seed, 0.2, 3, 6);
}
// A low-poly sheep: a fat rounded body (white top → cream belly), a black head tilted up at
// the front with two ear nubs, and four short thin black legs. Faces along `ry`.
function sheep(m: Build, cx: number, cz: number, y0: number, ry: number, seed: number): void {
  const rng = mulberry32(seed | 0 || 1);
  const WHITE: RGB = [246, 246, 242];
  const CREAM: RGB = [226, 212, 184];
  const BLACK: RGB = [36, 36, 42];
  const s = 0.38 + rng() * 0.12; // roughly half the old size — closer to the trees
  const cos = Math.cos(ry);
  const sin = Math.sin(ry);
  const at = (fwd: number, side: number): { x: number; z: number } => ({ x: cx + cos * fwd - sin * side, z: cz + sin * fwd + cos * side });
  // legs: short and splayed — inner/high near the body, outer/low at the ground.
  for (const [fw, sd] of [[0.11, 0.06], [0.11, -0.06], [-0.11, 0.06], [-0.11, -0.06]] as const) {
    const top = at(fw * 0.8 * s, sd * 0.7 * s);
    const bot = at(fw * s, sd * 1.25 * s);
    beam(m, v(top.x, y0 + 0.13 * s, top.z), v(bot.x, y0, bot.z), 0.016 * s, BLACK);
  }
  // Body: a fat ovoid, LONGER front-to-back (along the facing) than it is wide/tall, white
  // over a cream belly — like the reference, not a round ball.
  blob(m, cx, y0 + 0.2 * s, cz, 0.21 * s, 0.135 * s, 0.15 * s, WHITE, seed + 1, 0.05, 4, 9, CREAM, ry);
  const h = at(0.2 * s, 0);
  blob(m, h.x, y0 + 0.25 * s, h.z, 0.078 * s, 0.082 * s, 0.072 * s, BLACK, seed + 2, 0.06, 3, 5); // head
  for (const sd of [0.07, -0.07] as const) {
    const e = at(0.16 * s, sd * s);
    box(m, e.x, e.z, 0.02 * s, 0.028 * s, 0.045 * s, BLACK, ry, y0 + 0.26 * s); // ear nub
  }
}
function rock(m: Build, cx: number, cz: number, y0: number, scale: number, color: RGB, seed: number): void {
  blob(m, cx, y0 + 0.07 * scale, cz, 0.2 * scale, 0.13 * scale, 0.18 * scale, color, seed, 0.4, 3, 6);
}
// A single small clay brick (cuboid), long axis along `ry`.
function brick(m: Build, cx: number, cz: number, y0: number, ry: number, color: RGB): void {
  box(m, cx, cz, 0.105, 0.052, 0.064, color, ry, y0);
}
// A low brick wall: a course (or two, half-staggered) of bricks laid end-to-end along the
// segment, each dropped to the clay surface.
function brickWall(m: Build, x0: number, z0: number, x1: number, z1: number, hAt: (x: number, z: number) => number, color: RGB, rng: () => number): void {
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
function brickStack(m: Build, cx: number, cz: number, y0: number, ry: number, color: RGB, rng: () => number): void {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const put = (ox: number, oz: number, oy: number): void => brick(m, cx + ox * c - oz * s, cz + ox * s + oz * c, y0 + oy, ry, color);
  for (let r = 0; r < 2; r++) for (let i = -1; i <= 1; i++) put(i * 0.1, (r - 0.5) * 0.075, 0);
  if (rng() < 0.8) put(-0.05, 0, 0.05); // one or two on the 2nd course (still low)
  if (rng() < 0.6) put(0.05, 0, 0.05);
}
// A small offset heap: a couple of bricks per layer, staggered over 1–2 low layers.
function brickHeap(m: Build, cx: number, cz: number, y0: number, ry: number, color: RGB, rng: () => number): void {
  const layers = 1 + Math.floor(rng() * 2);
  for (let l = 0; l < layers; l++) {
    const a = ry + (rng() - 0.5) * 0.6;
    const jx = (rng() - 0.5) * 0.04;
    const jz = (rng() - 0.5) * 0.04;
    brick(m, cx + jx, cz + jz, y0 + l * 0.05, a, color);
    if (rng() < 0.75) brick(m, cx + jx + Math.cos(a) * 0.11, cz + jz + Math.sin(a) * 0.11, y0 + l * 0.05, a, color);
  }
}
function cairn(m: Build, cx: number, cz: number, y0: number): void {
  const grey: RGB = [96, 98, 104];
  blob(m, cx, y0 + 0.12, cz, 0.16, 0.14, 0.15, grey, 11, 0.3, 3, 6);
  blob(m, cx, y0 + 0.32, cz, 0.12, 0.11, 0.11, shade(grey, 1.1), 13, 0.3, 3, 6);
  blob(m, cx, y0 + 0.48, cz, 0.08, 0.09, 0.08, shade(grey, 1.2), 17, 0.3, 3, 5);
}

// ── Per-terrain tiles ─────────────────────────────────────────────────────────

// WHEAT — rebuilt to reference: a terraced golden field (3 overlapping octagonal pads), three
// short post-and-rail fences at varied angles, and octagonal round-bale stacks tucked beside
// them. No number chip.
function fieldsTile(seed: number): Build {
  const m = build();
  const WHEAT: RGB = [242, 210, 74];
  const rng = mulberry32((Math.abs(seed) * 2246822519 + 0x85ebca6b) >>> 0 || 1);
  const baseRot = rng() * Math.PI * 2; // whole-composition rotation → biggest variation
  const pads = wheatPads(rng, baseRot, seed);
  const hAt = (x: number, z: number): number => wheatHeightAt(pads, x, z);

  irregularGround(m, { color: shade(WHEAT, 0.95), amp: 0.05, seed: seed + 4.2, facet: 0.05 }); // gently-uneven base
  for (const p of pads) octaPad(m, p, WHEAT);
  rimAndWall(m, WHEAT);

  // One post-and-rail fence in each of the three gaps between pads (bisector angles), each at a
  // jittered radius, orientation, and length so they read hand-placed and vary per tile.
  for (let k = 0; k < 3; k++) {
    const gap = baseRot + Math.PI / 3 + (k * 2 * Math.PI) / 3 + (rng() - 0.5) * 0.4;
    const rad = 0.4 + rng() * 0.08;
    const cx = rad * Math.cos(gap);
    const cz = rad * Math.sin(gap);
    const ori = gap + Math.PI / 2 + (rng() - 0.5) * 0.9; // ~tangential to the gap, jittered
    const half = (0.18 + rng() * 0.12) / 2;
    fence(m, cx - Math.cos(ori) * half, cz - Math.sin(ori) * half, cx + Math.cos(ori) * half, cz + Math.sin(ori) * half, hAt);
  }

  // Hay: a centre cluster plus 1–2 in the gaps — varied count, clumping (pair vs single), and
  // rotation. Each is nudged toward the centre until it clears the raised patches.
  const place = (x0: number, z0: number, pair: boolean): void => {
    const ext = pair ? 0.16 : 0.1;
    let x = x0;
    let z = z0;
    for (let t = 0; t < 6 && !clearOfPads(pads, x, z, ext); t++) {
      x *= 0.85;
      z *= 0.85;
    }
    baleStack(m, x, z, hAt, rng() * Math.PI, pair);
  };
  place((rng() - 0.5) * 0.16, (rng() - 0.5) * 0.16, rng() < 0.6); // centre cluster
  const extra = 1 + Math.floor(rng() * 2); // 1–2 more clusters in gaps
  for (let e = 0; e < extra; e++) {
    const gap = baseRot + Math.PI / 3 + Math.floor(rng() * 3) * (2 * Math.PI / 3) + (rng() - 0.5) * 0.4;
    const rad = 0.28 + rng() * 0.12;
    place(rad * Math.cos(gap), rad * Math.sin(gap), rng() < 0.45);
  }
  return m;
}

function forestTile(): Build {
  const m = build();
  const p = PAL.forest;
  const seed = 3.1;
  const amp = 0.09;
  tileBase(m, { color: p.top, amp, seed });
  const rng = mulberry32(0x0f0f0f);
  scatter(rng, 13, 0.66, 0.2).forEach((pt, i) => {
    const sc = 0.85 + rng() * 0.5;
    const y = surfaceY(pt.x, pt.z, amp, seed);
    if (i % 4 === 0) roundTree(m, pt.x, pt.z, y, sc, p.leaf, i * 7 + 1);
    else pine(m, pt.x, pt.z, y, sc, p.pineDark, p.pineLite);
  });
  return m;
}

// BRICK — a raised, bumpy clay dome with a recessed hexagonal center pocket (where the number
// chip nestles). Height = broad dome + clay-clump bumps − a flat-bottomed hex indent.
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
function hillsTile(seed: number): Build {
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
function pastureTile(seed: number): Build {
  const m = build();
  const GRASS: RGB = [150, 200, 148];
  const CANOPY: RGB = [116, 158, 104];
  const BUSH: RGB = [86, 132, 78]; // darker + smaller than tree canopies, so clearly distinct
  const amp = 0.15; // clearly rolling meadow (was too flat)
  const gseed = seed + 1.9;
  tileBase(m, { color: GRASS, amp, seed: gseed });
  const hAt = (x: number, z: number): number => surfaceY(x, z, amp, gseed);
  const rng = mulberry32((Math.abs(seed) * 374761393 + 0x9e3779b9) >>> 0 || 1);
  // Scatter positions with a shared min-gap (big enough that even two sheep never touch),
  // then assign types. Sheep are taken FIRST so they always get spots.
  const pts = scatter(rng, 12, 0.68, 0.26);
  let i = 0;
  const take = (): { x: number; z: number } | undefined => pts[i++];
  for (let s = 0, n = 3 + Math.floor(rng() * 2); s < n; s++) {
    const p = take();
    if (p) sheep(m, p.x, p.z, hAt(p.x, p.z), rng() * Math.PI * 2, (seed * 23 + i) | 0);
  }
  // Small trees — only a bit taller than a sheep, like the reference (canopy ~0.1 radius).
  for (let t = 0, n = 2 + Math.floor(rng() * 2); t < n; t++) {
    const p = take();
    if (p) roundTree(m, p.x, p.z, hAt(p.x, p.z), 0.36 + rng() * 0.12, CANOPY, (seed * 13 + i) | 0);
  }
  for (let b = 0, n = 3 + Math.floor(rng() * 3); b < n; b++) {
    const p = take();
    if (p) bush(m, p.x, p.z, hAt(p.x, p.z), 0.48 + rng() * 0.32, BUSH, (seed * 17 + i) | 0);
  }
  return m;
}

// ORE — the whole tile is ONE raised rocky massif (not flat ground + spikes): a plateau that
// rises from the rim, several summit bumps, strong per-vertex jitter for angular rock facets,
// flat-shaded grey, with the highest facets capped in snow.
// Several distinct ROUNDED rock mounds (local maxima) spread across the tile, fused above a
// modest base lift into one massif — a bit shorter and more varied than a single dome. Snow
// only reaches the tallest one or two.
// Generate the mound set from a seeded RNG so every ore tile shares the STYLE but differs:
// an irregular, clustered group of VARIED width/height mounds — one big broad mound, a couple
// of taller narrow peaks (which catch the snow), and a few smaller bumps, scattered with a
// minimum gap. On a real board each ore hex would seed this from its position.
function mountainPeaks(rng: () => number): [number, number, number, number][] {
  const pts: { x: number; z: number }[] = [];
  const n = 5 + Math.floor(rng() * 3); // 5–7 mounds
  let guard = 0;
  while (pts.length < n && guard++ < 300) {
    const a = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * 0.5;
    const x = rad * Math.cos(a);
    const z = rad * Math.sin(a);
    if (pts.every((p) => Math.hypot(p.x - x, p.z - z) > 0.22)) pts.push({ x, z });
  }
  return pts.map((p, i): [number, number, number, number] => {
    if (i === 0) return [p.x, p.z, 0.22 + rng() * 0.06, 0.36 + rng() * 0.06]; // big broad mound
    if (i <= 2) return [p.x, p.z, 0.3 + rng() * 0.08, 0.24 + rng() * 0.05]; // tall narrow → snow
    return [p.x, p.z, 0.15 + rng() * 0.12, 0.2 + rng() * 0.12]; // smaller bumps
  });
}
function mountainsTile(seed: number): Build {
  const m = build();
  const rng = mulberry32((Math.abs(seed) * 2654435761 + 0x9e3779b9) >>> 0 || 1);
  const peaks = mountainPeaks(rng);
  const ROCK: RGB = [156, 160, 172];
  const SNOW: RGB = [240, 243, 250];
  const M = 6; // finer facets for rocky detail
  const V = hexCorners(R_RIM, 0);
  const jit = (R_RIM / M) * 0.5;
  const snowLine = EDGE_Y + 0.3;
  const height = (x: number, z: number): number => {
    const r = Math.hypot(x, z);
    const rimFade = smooth((R_RIM - r) / 0.24); // full height until close to the rim
    let h = 0.09; // modest base lift so the mounds fuse into one raised mass
    for (const [px, pz, ph, pr] of peaks) {
      const d = Math.hypot(x - px, z - pz);
      if (d < pr) h += ph * smooth(1 - d / pr); // rounded dome (smoothstep, not conical)
    }
    h += (hash2(x * 9.3 + seed, z * 9.3 - seed) - 0.5) * 0.09; // light rocky facet jitter
    return EDGE_Y + Math.max(0, h) * rimFade;
  };
  const at = (b: Vec3, c: Vec3, i: number, j: number): Vec3 => {
    const ox = (i / M) * b.x + (j / M) * c.x;
    const oz = (i / M) * b.z + (j / M) * c.z;
    let x = ox;
    let z = oz;
    if (i + j < M && (i > 0 || j > 0)) {
      x = ox + (hash2(ox * 41 + seed, oz * 41 - seed) - 0.5) * 2 * jit;
      z = oz + (hash2(ox * 23 - seed, oz * 23 + seed) - 0.5) * 2 * jit;
    }
    return v(x, height(x, z), z);
  };
  const face = (p0: Vec3, p1: Vec3, p2: Vec3): void => {
    const cy = (p0.y + p1.y + p2.y) / 3;
    const snowy = cy > snowLine + (hash2(p0.x * 5, p0.z * 5) - 0.5) * 0.1; // irregular snow line
    const base = snowy ? SNOW : ROCK;
    const k = 1 + (hash2(p0.x + p0.z, p0.z - p0.x) - 0.5) * 2 * (snowy ? 0.03 : 0.13);
    faceTri(m, p0, p1, p2, shade(base, k), UP);
  };
  for (let s = 0; s < 6; s++) {
    const b = V[s];
    const c = V[(s + 1) % 6];
    for (let i = 0; i < M; i++) {
      for (let j = 0; j < M - i; j++) {
        const p00 = at(b, c, i, j);
        const p10 = at(b, c, i + 1, j);
        const p01 = at(b, c, i, j + 1);
        face(p00, p10, p01);
        if (j < M - i - 1) face(p10, at(b, c, i + 1, j + 1), p01);
      }
    }
  }
  rimAndWall(m, ROCK);
  return m;
}

function desertTile(): Build {
  const m = build();
  const p = PAL.desert;
  const seed = 2.7;
  const amp = 0.06;
  tileBase(m, { color: p.top, amp, seed, facet: 0.05 });
  cairn(m, -0.1, 0.05, surfaceY(-0.1, 0.05, amp, seed));
  const rng = mulberry32(0xdd2717);
  for (const pt of scatter(rng, 2, 0.6, 0.4)) rock(m, pt.x, pt.z, surfaceY(pt.x, pt.z, amp, seed), 0.6, shade(p.dune, 0.9), (pt.z * 61) | 0);
  return m;
}

// Builders take a per-tile `seed` (ore varies with it; the others ignore it for now — a
// parameterless builder is assignable, so only mountainsTile declares the param).
const BUILDERS: Record<Terrain, (seed: number) => Build> = {
  forest: forestTile,
  hills: hillsTile,
  pasture: pastureTile,
  fields: fieldsTile,
  mountains: mountainsTile,
  desert: desertTile,
};

// Cache one baked mesh per (terrain, seed) — so a given ore variant is built once.
const cache = new Map<string, Mesh>();
export function tileMesh(terrain: Terrain, seed = 0): Mesh {
  const key = `${terrain}:${seed}`;
  let m = cache.get(key);
  if (!m) {
    m = BUILDERS[terrain](seed);
    cache.set(key, m);
  }
  return m;
}
