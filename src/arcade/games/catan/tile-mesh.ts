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
import { type PlayerColor, type Terrain } from '../../../rules/catan/types.ts';

export type RGB = [number, number, number];
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
const DOWN: Vec3 = { x: 0, y: -1, z: 0 };
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

const FRAME_TOP: RGB = [182, 156, 118]; // warm tan ledge — lighter than before but short of the
const FRAME_SIDE: RGB = [150, 126, 94]; // box's cream so white settlements still read against it

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
  // Closed underside — only ever seen when a tile is flipped face-down during the board's
  // placement animation; keeps the stack/flip looking solid rather than hollow.
  const cb = v(0, -WALL, 0);
  for (let i = 0; i < 6; i++) faceTri(m, cb, Ob[(i + 1) % 6], Ob[i], FRAME_SIDE, DOWN);
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
// A horizontal octagonal-prism log/beam (axis along `ry`, resting on the ground): `side` for
// the staves, `cap` for the octagon end faces. Shared by hay bales (gold) and lumber (brown).
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
function roundBale(m: Build, cx: number, cz: number, y0: number, ry: number): void {
  logBeam(m, cx, cz, y0, 0.16, 0.062, ry, [232, 198, 82], [246, 214, 108]);
}
// A stack of cut logs: three on the bottom, two on top (a bundled woodpile), lying along `ry`.
// A casually-piled bundle of cut logs: a bottom row of 2-3 with 1-2 resting on top, each log
// jittered in position, length, and angle so the stack looks tossed together, not stacked to a
// grid. `ry` is the pile's rough axis.
function lumberStack(m: Build, cx: number, cz: number, y0: number, ry: number, rng: () => number): void {
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
function felledTree(m: Build, cx: number, cz: number, y0: number, ry: number): void {
  logBeam(m, cx, cz, y0, 0.3, 0.038, ry, [112, 74, 48], [144, 100, 70]);
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
const TRUNK: RGB = [104, 72, 44];

// A low-poly conifer: a thin trunk under THREE prominent skirts. Each skirt is a cone whose
// flared base clearly overhangs the narrowing tip of the one below, so the tree reads as three
// distinct stacked pyramids of leaves. `green` tints the whole tree.
function pine(m: Build, cx: number, cz: number, y0: number, scale: number, green: RGB, seed: number): void {
  box(m, cx, cz, 0.032 * scale, 0.08 * scale, 0.032 * scale, TRUNK, 0, y0 - 0.02);
  // Wide-based, short skirts that only just overlap: each tier's flared base juts well past the
  // narrowing tip below it, giving a strongly stepped silhouette (not a smooth cone) from afar.
  const r = [0.17, 0.13, 0.085];
  const baseY = [0.03, 0.14, 0.25];
  const h = [0.16, 0.16, 0.185];
  for (let t = 0; t < 3; t++) {
    cone(m, cx, cz, r[t] * scale, h[t] * scale, 6, shade(green, 1 - t * 0.03), y0 + baseY[t] * scale, seed + t * 0.9);
  }
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
function sheep(m: Build, cx: number, cz: number, y0: number, ry: number, seed: number, scale = 1): void {
  const rng = mulberry32(seed | 0 || 1);
  const WHITE: RGB = [246, 246, 242];
  const CREAM: RGB = [226, 212, 184];
  const BLACK: RGB = [36, 36, 42];
  const s = (0.437 + rng() * 0.138) * scale; // ~15% larger than the trimmed size — a bit chunkier vs the trees
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

function forestTile(seed: number): Build {
  const m = build();
  const GRASS: RGB = [104, 152, 108]; // deep shady green — reads clearly darker than pasture mint from afar
  // A spread of pine greens — dark forest through medium — assigned per tree for variety.
  const GREENS: RGB[] = [
    [56, 108, 66],
    [72, 132, 82],
    [92, 152, 92],
    [62, 118, 74],
  ];
  const amp = 0.12;
  const gseed = seed + 3.1;
  tileBase(m, { color: GRASS, amp, seed: gseed });
  const hAt = (x: number, z: number): number => surfaceY(x, z, amp, gseed);
  const rng = mulberry32((Math.abs(seed) * 2246822519 + 0x27d4eb2f) >>> 0 || 1);
  // A dense scatter, with the center kept clear for the (later) number chip. Lumber and the
  // felled tree are placed first (bigger footprint), then the rest of the spots become pines.
  const pts = scatter(rng, 34, 0.74, 0.12).filter((p) => Math.hypot(p.x, p.z) > 0.26);
  // Logs sit in an interior mid-radius band (like the reference) — never hugging the rim.
  const inner = pts.filter((p) => Math.hypot(p.x, p.z) < 0.5);
  const used = new Set<{ x: number; z: number }>();
  let ii = 0;
  const takeInner = (): { x: number; z: number } | undefined => {
    const p = inner[ii++];
    if (p) used.add(p);
    return p;
  };
  const felled = takeInner();
  if (felled) felledTree(m, felled.x, felled.z, hAt(felled.x, felled.z), rng() * Math.PI);
  for (let s = 0, n = 1 + Math.floor(rng() * 2); s < n; s++) {
    const p = takeInner();
    if (p) lumberStack(m, p.x, p.z, hAt(p.x, p.z), rng() * Math.PI, rng);
  }
  let i = 0;
  for (const p of pts) {
    if (used.has(p)) continue;
    pine(m, p.x, p.z, hAt(p.x, p.z), 0.68 + rng() * 0.26, GREENS[Math.floor(rng() * GREENS.length)], (seed * 31 + i++) | 0);
  }
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

// ── Desert props: bones (inherent) + the robber (toggle-only) ──────────────────

const BONE: RGB = [232, 230, 216];

// A tapered curved blade that rises from the sand and arcs toward one side (`curve` bends it
// within its broad plane; `tilt` leans the base). The shared primitive for the skeleton's ribs
// and the skull's horns. Cross-section is a thin rectangle (wBroad × wThick) shrinking to a tip.
function curvedBone(m: Build, bx: number, by: number, bz: number, yaw: number, length: number, curve: number, wBroad: number, wThick: number, color: RGB, tilt: number): void {
  const N = 4;
  const Fx = Math.cos(yaw);
  const Fz = Math.sin(yaw);
  const Tx = -Math.sin(yaw);
  const Tz = Math.cos(yaw);
  const rings: Vec3[][] = [];
  const axis: Vec3[] = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const s = 1 - t * 0.82; // taper toward the tip
    const px = bx + Fx * (curve * t * t + tilt * t);
    const pz = bz + Fz * (curve * t * t + tilt * t);
    const py = by + length * t;
    axis.push(v(px, py, pz));
    const hb = wBroad * 0.5 * s;
    const ht = wThick * 0.5 * s;
    rings.push([
      v(px + Fx * hb + Tx * ht, py, pz + Fz * hb + Tz * ht),
      v(px - Fx * hb + Tx * ht, py, pz - Fz * hb + Tz * ht),
      v(px - Fx * hb - Tx * ht, py, pz - Fz * hb - Tz * ht),
      v(px + Fx * hb - Tx * ht, py, pz + Fz * hb - Tz * ht),
    ]);
  }
  for (let k = 0; k < N; k++) {
    const a = rings[k];
    const b = rings[k + 1];
    const ctr = v((axis[k].x + axis[k + 1].x) / 2, (axis[k].y + axis[k + 1].y) / 2, (axis[k].z + axis[k + 1].z) / 2);
    for (let e = 0; e < 4; e++) {
      const f = (e + 1) % 4;
      const mid = v((a[e].x + a[f].x + b[f].x + b[e].x) / 4, (a[e].y + a[f].y + b[f].y + b[e].y) / 4, (a[e].z + a[f].z + b[f].z + b[e].z) / 4);
      faceQuad(m, a[e], a[f], b[f], b[e], color, norm(sub(mid, ctr)));
    }
  }
  faceQuad(m, rings[0][0], rings[0][1], rings[0][2], rings[0][3], color, DOWN);
  const tp = rings[N];
  faceQuad(m, tp[0], tp[3], tp[2], tp[1], color, UP);
}

// A row of 3-4 curved ribs standing in a slight fan — the exposed ribcage of the reference.
function ribRow(m: Build, cx: number, cz: number, y0: number, baseYaw: number, rng: () => number): void {
  const n = 3 + Math.floor(rng() * 2);
  const Lx = Math.cos(baseYaw + Math.PI / 2);
  const Lz = Math.sin(baseYaw + Math.PI / 2);
  const bend = rng() < 0.5 ? 1 : -1; // whole cage curves the same way
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2) * 0.055;
    const yaw = baseYaw + (rng() - 0.5) * 0.5;
    curvedBone(m, cx + Lx * off, y0, cz + Lz * off, yaw, 0.15 + rng() * 0.07, bend * (0.05 + rng() * 0.06), 0.05, 0.02, BONE, bend * rng() * 0.03);
  }
}

// A bleached horned skull: a rounded cranium + a shorter snout, two dark eye hollows, and two
// horns sweeping out and up from the back corners.
function boneSkull(m: Build, cx: number, cz: number, y0: number, yaw: number, rng: () => number): void {
  const DARK: RGB = [44, 42, 44];
  const fx = Math.cos(yaw);
  const fz = Math.sin(yaw);
  const px = -Math.sin(yaw);
  const pz = Math.cos(yaw);
  const cy = y0 + 0.055;
  const sd = (rng() * 1000) | 0;
  blob(m, cx, cy, cz, 0.12, 0.072, 0.092, BONE, sd, 0.07, 3, 6, undefined, yaw); // cranium
  blob(m, cx + fx * 0.1, cy - 0.012, cz + fz * 0.1, 0.058, 0.05, 0.055, BONE, sd + 7, 0.07, 3, 5, undefined, yaw); // snout
  for (const s of [1, -1] as const) {
    blob(m, cx + fx * 0.04 + px * s * 0.05, cy + 0.05, cz + fz * 0.04 + pz * s * 0.05, 0.022, 0.02, 0.022, DARK, sd + 20 + s, 0.1, 2, 5); // eye hollow
    const hy = Math.atan2(pz * s, px * s);
    curvedBone(m, cx - fx * 0.05 + px * s * 0.06, cy + 0.04, cz - fz * 0.05 + pz * s * 0.06, hy, 0.13, 0.07, 0.032, 0.03, BONE, 0.03); // horn
  }
}

// The robber: a dark charcoal pawn — a solid of revolution (flared base → pinched waist →
// rounded body → neck → domed head). NOT terrain; baked in only when the toggle is on.
function robber(m: Build, cx: number, cz: number, y0: number): void {
  const GREY: RGB = [130, 134, 144]; // medium charcoal — stays legible even in ASCII
  const sides = 8;
  const S = 1.2; // scale relative to the tile
  // Skittle profile [radius, height] matched to the real piece: a thin foot disk on a narrow
  // stem, a big dominant egg body, a pinched neck, then a distinctly smaller ball head.
  const prof: [number, number][] = [
    [0.115, 0.0], // foot disk (wide, ~⅘ of the belly)
    [0.12, 0.04],
    [0.065, 0.07], // narrow stem
    [0.1, 0.12], // egg widening
    [0.14, 0.22], // egg belly (widest point)
    [0.115, 0.3],
    [0.06, 0.36], // neck pinch
    [0.085, 0.42], // head
    [0.095, 0.47], // head widest (~⅔ of the belly)
    [0.06, 0.52],
    [0.0, 0.55], // crown
  ];
  const ring = (r: number, y: number): Vec3[] => {
    const pts: Vec3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (2 * Math.PI * i) / sides + Math.PI / 8;
      pts.push(v(cx + Math.cos(a) * r * S, y0 + y * S, cz + Math.sin(a) * r * S));
    }
    return pts;
  };
  let prev = ring(prof[0][0], prof[0][1]);
  const cbot = v(cx, y0 + prof[0][1], cz);
  for (let i = 0; i < sides; i++) faceTri(m, cbot, prev[(i + 1) % sides], prev[i], shade(GREY, 0.75), DOWN);
  for (let sIdx = 1; sIdx < prof.length; sIdx++) {
    const [r, y] = prof[sIdx];
    if (r === 0) {
      const apex = v(cx, y0 + y * S, cz);
      for (let i = 0; i < sides; i++) faceTri(m, apex, prev[i], prev[(i + 1) % sides], shade(GREY, 1.12), UP);
      break;
    }
    const cur = ring(r, y);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const mx = (prev[i].x + prev[j].x + cur[j].x + cur[i].x) / 4;
      const mz = (prev[i].z + prev[j].z + cur[j].z + cur[i].z) / 4;
      faceQuad(m, prev[i], prev[j], cur[j], cur[i], GREY, norm(v(mx - cx, 0, mz - cz)));
    }
    prev = cur;
  }
}

// Ground height at (x,z): the LOWEST surface vertex within a small radius (props rise ABOVE
// the ground, so the minimum tracks the terrain even directly under a prop). Skips the wall
// undersides (negative y).
function groundYAt(m: Build, x: number, z: number, r: number): number {
  const r2 = r * r;
  let best = Infinity;
  for (const vert of m.vertices) {
    const p = vert.position;
    if (p.y < -0.02) continue;
    if ((p.x - x) ** 2 + (p.z - z) ** 2 <= r2 && p.y < best) best = p.y;
  }
  return best === Infinity ? EDGE_Y : best;
}
// Whether a prop stands in a spot: any vertex within `r` sitting well above the local ground.
// The threshold is high enough that gentle terrain slope doesn't count, but a sheep/tree/bone/
// brick does.
function spotBlocked(m: Build, x: number, z: number, r: number, aboveY: number): boolean {
  const r2 = r * r;
  for (const vert of m.vertices) {
    const p = vert.position;
    if (p.y > aboveY && (p.x - x) ** 2 + (p.z - z) ** 2 <= r2) return true;
  }
  return false;
}
// Seat the robber flush on the ground at the spot nearest the centre whose base area is clear
// of props — so it never perches on top of a piece or floats. Falls back to the centre.
function placeRobber(m: Build): void {
  const cands: { x: number; z: number }[] = [{ x: 0, z: 0 }];
  for (const rr of [0.22, 0.34, 0.46]) for (let k = 0; k < 8; k++) cands.push({ x: Math.cos((k * Math.PI) / 4) * rr, z: Math.sin((k * Math.PI) / 4) * rr });
  for (const c of cands) {
    const gy = groundYAt(m, c.x, c.z, 0.07);
    if (!spotBlocked(m, c.x, c.z, 0.17, gy + 0.1)) {
      robber(m, c.x, c.z, gy);
      return;
    }
  }
  robber(m, 0, 0, groundYAt(m, 0, 0, 0.07));
}

// DESERT dunes: pale wind-blown sand shaped as long, gently-meandering RIDGE LINES (not
// peaks). A directional sine field along `dir` makes one or two crests run across the tile.
function duneHeight(x: number, z: number, seed: number, dir: number): number {
  const r = Math.hypot(x, z);
  const rimFade = smooth((R_RIM - r) / 0.22);
  const cosD = Math.cos(dir);
  const sinD = Math.sin(dir);
  const u = x * cosD + z * sinD; // across the ridges
  const vv = -x * sinD + z * cosD; // along the ridges
  const um = u + 0.34 * Math.sin(vv * 1.5 + seed); // meander so the crest curves
  let h = 0.12 * (0.5 + 0.5 * Math.sin(um * 2.2 + seed * 0.7)); // the long dune ridge(s)
  h += 0.035 * Math.sin(vv * 0.85 + seed * 1.7); // gentle rise/fall along a crest
  h += (hash2(x * 6 + seed, z * 6 - seed) - 0.5) * 0.02; // faint grain
  return EDGE_Y + Math.max(0, h) * rimFade;
}

// DESERT: pale ridged dunes strewn with bleached bones (a horned skull + a rib row). The
// robber is NOT part of the tile — it's added by tileMesh only when toggled on.
function desertTile(seed: number): Build {
  const m = build();
  const SAND: RGB = [234, 216, 140];
  const dseed = seed + 2.7;
  const rng = mulberry32((Math.abs(seed) * 2246822519 + 0x68e31da4) >>> 0 || 1);
  const dir = rng() * Math.PI; // wind direction → ridge orientation
  const M = 5;
  const V = hexCorners(R_RIM, 0);
  const jit = (R_RIM / M) * 0.32;
  const hAt = (x: number, z: number): number => duneHeight(x, z, dseed, dir);
  const at = (b: Vec3, c: Vec3, i: number, j: number): Vec3 => {
    const ox = (i / M) * b.x + (j / M) * c.x;
    const oz = (i / M) * b.z + (j / M) * c.z;
    let x = ox;
    let z = oz;
    if (i + j < M && (i > 0 || j > 0)) {
      x = ox + (hash2(ox * 41 + dseed, oz * 41 - dseed) - 0.5) * 2 * jit;
      z = oz + (hash2(ox * 23 - dseed, oz * 23 + dseed) - 0.5) * 2 * jit;
    }
    return v(x, hAt(x, z), z);
  };
  const face = (p0: Vec3, p1: Vec3, p2: Vec3): void => {
    const cy = (p0.y + p1.y + p2.y) / 3;
    const k = 1 + smooth((cy - EDGE_Y) / 0.16) * 0.05 + (hash2(p0.x + p1.z, p0.z - p1.x) - 0.5) * 0.04; // crest tops a touch lighter + faint grain
    faceTri(m, p0, p1, p2, shade(SAND, k), UP);
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
  rimAndWall(m, SAND);
  // Bones scatter off-centre so they never clash with the robber's centre spot.
  const spots = scatter(rng, 4, 0.58, 0.26).filter((p) => Math.hypot(p.x, p.z) > 0.3);
  let bi = 0;
  const sp = spots[bi++];
  if (sp) boneSkull(m, sp.x, sp.z, hAt(sp.x, sp.z), rng() * Math.PI * 2, rng);
  const rp = spots[bi++];
  if (rp) ribRow(m, rp.x, rp.z, hAt(rp.x, rp.z), rng() * Math.PI * 2, rng);
  const rp2 = spots[bi++];
  if (rp2 && rng() < 0.6) ribRow(m, rp2.x, rp2.z, hAt(rp2.x, rp2.z), rng() * Math.PI * 2, rng);
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
// `robberOn` bakes the robber (seated on the tile's centre surface) into the returned mesh —
// the robber is available on every terrain and toggled from the HUD, never part of the tile.
let backMesh: Mesh | null = null;
// A blank tile back — a flat hex top on the same rim/wall — shown while a tile is face-down
// during the board's placement animation, before it flips to reveal its terrain.
export function tileBackMesh(): Mesh {
  if (backMesh) return backMesh;
  const m = build();
  const BACK: RGB = [206, 186, 150];
  const V = hexCorners(R_RIM, EDGE_Y);
  const c = v(0, EDGE_Y, 0);
  for (let i = 0; i < 6; i++) faceTri(m, c, V[i], V[(i + 1) % 6], BACK, UP);
  rimAndWall(m, BACK);
  backMesh = m;
  return m;
}

let dieCache: Mesh | null = null;
// A single die: an ivory cube (half-size 0.5, centered at the origin) with big, near-black
// pips. Face values by axis: +Y=1, −Y=6, +Z=2, −Z=5, +X=3, −X=4 (opposite faces sum to 7).
// Pips are large + high-contrast so they survive the ASCII glyph mapper's per-cell averaging.
export function dieMesh(): Mesh {
  if (dieCache) return dieCache;
  const m = build();
  const H = 0.5;
  const IVORY: RGB = [238, 234, 222];
  const PIP: RGB = [18, 16, 20];
  const o = 0.6; // pip offset from face center (half-size units)
  const ps = 0.125; // pip half-size — as large as fits without adjacent pips merging
  // A quad centered at (cx,cy,cz) spanning ±hu along u and ±hv along vv.
  const quad = (c: Vec3, u: Vec3, vv: Vec3, hu: number, hv: number, color: RGB, n: Vec3): void => {
    const a = v(c.x - u.x * hu - vv.x * hv, c.y - u.y * hu - vv.y * hv, c.z - u.z * hu - vv.z * hv);
    const b = v(c.x + u.x * hu - vv.x * hv, c.y + u.y * hu - vv.y * hv, c.z + u.z * hu - vv.z * hv);
    const cc = v(c.x + u.x * hu + vv.x * hv, c.y + u.y * hu + vv.y * hv, c.z + u.z * hu + vv.z * hv);
    const d = v(c.x - u.x * hu + vv.x * hv, c.y - u.y * hu + vv.y * hv, c.z - u.z * hu + vv.z * hv);
    faceQuad(m, a, b, cc, d, color, n);
  };
  const PIPS: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [[-1, 1], [1, -1]],
    3: [[-1, 1], [0, 0], [1, -1]],
    4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
    5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
    6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
  };
  const faces: { n: Vec3; u: Vec3; vv: Vec3; val: number }[] = [
    { n: v(0, 1, 0), u: v(1, 0, 0), vv: v(0, 0, 1), val: 1 },
    { n: v(0, -1, 0), u: v(1, 0, 0), vv: v(0, 0, -1), val: 6 },
    { n: v(0, 0, 1), u: v(1, 0, 0), vv: v(0, 1, 0), val: 2 },
    { n: v(0, 0, -1), u: v(-1, 0, 0), vv: v(0, 1, 0), val: 5 },
    { n: v(1, 0, 0), u: v(0, 0, -1), vv: v(0, 1, 0), val: 3 },
    { n: v(-1, 0, 0), u: v(0, 0, 1), vv: v(0, 1, 0), val: 4 },
  ];
  for (const f of faces) {
    const c = v(f.n.x * H, f.n.y * H, f.n.z * H);
    quad(c, f.u, f.vv, H, H, IVORY, f.n); // the face
    const pc = v(c.x + f.n.x * 0.03, c.y + f.n.y * 0.03, c.z + f.n.z * 0.03); // pips sit proud
    for (const [pu, pv] of PIPS[f.val]) {
      const center = v(pc.x + f.u.x * pu * o * H + f.vv.x * pv * o * H, pc.y + f.u.y * pu * o * H + f.vv.y * pv * o * H, pc.z + f.u.z * pu * o * H + f.vv.z * pv * o * H);
      quad(center, f.u, f.vv, ps, ps, PIP, f.n);
    }
  }
  dieCache = m;
  return m;
}

// The four Catan player colors as RGB.
const PLAYER_RGB: Record<PlayerColor, RGB> = {
  red: [201, 58, 47],
  blue: [56, 106, 200],
  white: [232, 230, 222],
  orange: [227, 129, 42],
};

// The hover/ghost highlight for a player color: a bright, lightened tint of that color (blended
// halfway to white). Legible on every terrain and clearly "the active color" — unlike a fixed
// pale gold, which vanished against the desert and grain fields.
export function hoverColorFor(color: PlayerColor): RGB {
  const [r, g, b] = PLAYER_RGB[color];
  const t = 0.5;
  return [Math.round(r + (255 - r) * t), Math.round(g + (255 - g) * t), Math.round(b + (255 - b) * t)];
}

// A gable (ridged) roof: two sloped faces + two triangular gable ends. The ridge runs along
// local x; `h` is its height above the eaves at `yBase`. Face windings resolve outward from
// the roof center so lighting is correct.
function gableRoof(m: Build, cx: number, cz: number, yBase: number, w: number, d: number, h: number, color: RGB, ry: number): void {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const eave = (x: number, z: number): Vec3 => v(cx + x * c - z * s, yBase, cz + x * s + z * c);
  const hw = w / 2;
  const hd = d / 2;
  const A = eave(-hw, -hd);
  const B = eave(hw, -hd);
  const C = eave(hw, hd);
  const D = eave(-hw, hd);
  const L = v(cx - hw * c, yBase + h, cz - hw * s); // ridge end at -x
  const R = v(cx + hw * c, yBase + h, cz + hw * s); // ridge end at +x
  const ctr = v(cx, yBase + h * 0.4, cz);
  const out = (...ps: Vec3[]): Vec3 => {
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (const p of ps) {
      mx += p.x;
      my += p.y;
      mz += p.z;
    }
    return norm(sub(v(mx / ps.length, my / ps.length, mz / ps.length), ctr));
  };
  faceQuad(m, A, B, R, L, color, out(A, B, R, L)); // −z slope
  faceQuad(m, D, C, R, L, color, out(D, C, R, L)); // +z slope
  faceTri(m, A, L, D, color, out(A, L, D)); // −x gable
  faceTri(m, B, C, R, color, out(B, C, R)); // +x gable
}

// ── Buildable pieces (shared by pieces mode + the board editor) ────────────────
// Each builder places a piece of scale `s` at (cx,cz) on the surface `y0`.
function addRoad(m: Build, cx: number, cz: number, y0: number, len: number, ry: number, color: RGB, s: number): void {
  box(m, cx, cz, len, 0.09 * s, 0.16 * s, color, ry, y0);
}
function addSettlement(m: Build, cx: number, cz: number, y0: number, s: number, color: RGB): void {
  box(m, cx, cz, 0.3 * s, 0.2 * s, 0.3 * s, color, 0, y0);
  gableRoof(m, cx, cz, y0 + 0.2 * s, 0.3 * s, 0.3 * s, 0.16 * s, color, 0);
}
function addCity(m: Build, cx: number, cz: number, y0: number, s: number, color: RGB): void {
  box(m, cx - 0.13 * s, cz, 0.28 * s, 0.22 * s, 0.3 * s, color, 0, y0); // lower wing
  gableRoof(m, cx - 0.13 * s, cz, y0 + 0.22 * s, 0.28 * s, 0.3 * s, 0.13 * s, color, 0);
  box(m, cx + 0.13 * s, cz, 0.24 * s, 0.42 * s, 0.3 * s, color, 0, y0); // taller wing
  gableRoof(m, cx + 0.13 * s, cz, y0 + 0.42 * s, 0.24 * s, 0.3 * s, 0.12 * s, color, 0);
}

const pieceCache = new Map<PlayerColor, Mesh>();
// A row of the three buildable pieces in the chosen player color: a flat road stick (left), a
// house-shaped settlement (centre), and a bigger two-section city with a taller wing (right).
export function piecesMesh(color: PlayerColor): Mesh {
  const cached = pieceCache.get(color);
  if (cached) return cached;
  const m = build();
  const c = PLAYER_RGB[color];
  addRoad(m, -0.72, 0, 0, 0.5, 0, c, 1);
  addSettlement(m, 0, 0, 0, 1, c);
  addCity(m, 0.7, 0, 0, 1, c);
  pieceCache.set(color, m);
  return m;
}

// ── Board editor overlay: placed pieces + the hover highlight ──────────────────
export interface BuildingSpec {
  x: number;
  z: number;
  city: boolean;
  color: PlayerColor;
  hot: boolean; // hovered → drawn in the highlight color instead of its own
  lift?: number; // elevation above the rim, for the build-drop animation (0 = seated)
}
export interface EdgeRoadSpec {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  color: PlayerColor;
  hot: boolean;
  lift?: number; // elevation above the rim, for the build-drop animation (0 = seated)
}
export interface OverlaySpec {
  buildings: BuildingSpec[];
  roads: EdgeRoadSpec[];
  ghostSettlement: { x: number; z: number } | null; // hovered empty vertex
  ghostRoad: { x0: number; z0: number; x1: number; z1: number } | null; // hovered empty placeable edge
  hoverColor: RGB; // the highlight/ghost color (a lightened tint of the active color)
}
const BUILDING_SCALE = 0.94; // settlements/cities — big enough to read, may overlap the hex
const ROAD_SCALE = 0.5; // roads stay slimmer than the buildings
const RIM_Y = EDGE_Y + 0.01; // pieces sit flush on the rim

function drawRoad(m: Build, e: { x0: number; z0: number; x1: number; z1: number }, color: RGB, y = RIM_Y): void {
  const ang = Math.atan2(e.z1 - e.z0, e.x1 - e.x0);
  const len = Math.hypot(e.x1 - e.x0, e.z1 - e.z0);
  addRoad(m, (e.x0 + e.x1) / 2, (e.z0 + e.z1) / 2, y, len * 0.62, ang, color, ROAD_SCALE);
}
export function boardOverlayMesh(o: OverlaySpec): Mesh {
  const m = build();
  for (const b of o.buildings) {
    const col = b.hot ? o.hoverColor : PLAYER_RGB[b.color];
    const y = RIM_Y + (b.lift ?? 0);
    if (b.city) addCity(m, b.x, b.z, y, BUILDING_SCALE, col);
    else addSettlement(m, b.x, b.z, y, BUILDING_SCALE, col);
  }
  for (const r of o.roads) drawRoad(m, r, r.hot ? o.hoverColor : PLAYER_RGB[r.color], RIM_Y + (r.lift ?? 0));
  // Ghost previews (3D, in the highlight color) of what a click would place.
  if (o.ghostSettlement) addSettlement(m, o.ghostSettlement.x, o.ghostSettlement.z, RIM_Y, BUILDING_SCALE, o.hoverColor);
  if (o.ghostRoad) drawRoad(m, o.ghostRoad, o.hoverColor);
  return m;
}

// ── Port boat (harbor ship) ──────────────────────────────────────────────────
// A low-poly Catan harbor ship: a dark reddish-brown hull with a raised pointed prow and a
// raised squared stern, an open deck ringed by a lighter lip, a forward mast flying a
// billowing two-tone sail + a small pennant, and cargo that depends on the port's trade type.
// A 3:1 port is the empty (generic) ship; each 2:1 port carries a load of its resource.
export type PortKind = 'generic' | 'brick' | 'grain' | 'lumber' | 'ore' | 'wool';

// A warm, fairly LIGHT wood so the hull reads in ASCII on the dark background — a Lambert face
// can't get brighter than its base color, so a dark brown crushes to near-black there no matter
// the light. Form still comes from the raking key + wrap shading these faces differently.
const HULL: RGB = [154, 100, 72]; // outer planking
const HULL_DK: RGB = [124, 80, 58]; // keel underside + inner walls (shadowed, for form)
const LIP: RGB = [184, 130, 98]; // the gunwale rim band (lighter, catches the light)
const DECK: RGB = [180, 122, 90]; // interior floor
const MASTC: RGB = [112, 78, 58]; // mast + spar
const SAIL_TAN: RGB = [227, 219, 203]; // warm cream for the masthead pennant
const SAIL_WHITE: RGB = [244, 242, 236]; // the sail (one consistent color)

// Longitudinal stations from stern (−x) to bow (+x): deck-edge half-width/height (T) and keel
// half-width/height (B) at each. Both the sheer (TY) and the keel (BY) rise toward the ends for
// the raised prow + stern; the widths taper to near-points at bow and stern.
const ST_X = [-0.70, -0.50, -0.24, 0.04, 0.32, 0.58, 0.80];
const ST_TW = [0.17, 0.30, 0.35, 0.35, 0.32, 0.24, 0.08];
const ST_TY = [0.52, 0.46, 0.42, 0.30, 0.32, 0.38, 0.44];
const ST_BW = [0.09, 0.18, 0.22, 0.21, 0.18, 0.11, 0.03];
const ST_BY = [0.30, 0.1, 0.03, 0.02, 0.04, 0.12, 0.31];
const LIPW = 0.055; // rim band width
const FLOOR_Y = 0.19; // main (cargo well) deck height — cargo sits here
const AFT_Y = 0.38; // raised aft-deck (poop) height: below the stern rim, above the well floor
const STEP = 2; // station where the poop deck steps down to the well
const BOW = 5; // bow bulkhead station (forward end of the well)

// One hull side wall (`s` = +1 / −1) as a smooth-shaded strip: per-vertex normals are averaged
// across the wall facets, so the curved side lights as one smooth gradient instead of stepping
// facet-to-facet (which, under the raking key, left a dark wedge where two flat facets met).
function smoothWall(m: Build, s: number): void {
  const N = ST_X.length;
  const top = ST_X.map((x, i) => v(x, ST_TY[i], s * ST_TW[i]));
  const bot = ST_X.map((x, i) => v(x, ST_BY[i], s * ST_BW[i]));
  const nt = top.map(() => v(0, 0, 0));
  const nb = bot.map(() => v(0, 0, 0));
  const out = v(0, 0.25, s);
  for (let i = 0; i < N - 1; i++) {
    let n = norm(cross(sub(top[i + 1], top[i]), sub(bot[i], top[i])));
    if (n.x * out.x + n.y * out.y + n.z * out.z < 0) n = v(-n.x, -n.y, -n.z);
    for (const acc of [nt[i], nt[i + 1], nb[i], nb[i + 1]]) {
      acc.x += n.x;
      acc.y += n.y;
      acc.z += n.z;
    }
  }
  const col = { x: HULL[0], y: HULL[1], z: HULL[2] };
  const push = (p: Vec3, nn: Vec3): void => void m.vertices.push({ position: { ...p }, normal: norm(nn), uv: [0, 0], color: col });
  for (let i = 0; i < N - 1; i++) {
    const base = m.vertices.length;
    push(top[i], nt[i]);
    push(top[i + 1], nt[i + 1]);
    push(bot[i + 1], nb[i + 1]);
    push(bot[i], nb[i]);
    m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function boatHull(m: Build): void {
  const N = ST_X.length;
  const IW = ST_TW.map((w) => Math.max(0.02, w - LIPW)); // inner (deck-opening) half-width
  // Outer side walls (smooth-shaded) + the lip band on top, both sides.
  smoothWall(m, 1);
  smoothWall(m, -1);
  for (let i = 0; i < N - 1; i++) {
    for (const s of [1, -1]) {
      faceQuadFlat(m, v(ST_X[i], ST_TY[i], s * ST_TW[i]), v(ST_X[i + 1], ST_TY[i + 1], s * ST_TW[i + 1]), v(ST_X[i + 1], ST_TY[i + 1], s * IW[i + 1]), v(ST_X[i], ST_TY[i], s * IW[i]), LIP, UP);
    }
  }
  // Keel underside.
  for (let i = 0; i < N - 1; i++) {
    faceQuadFlat(m, v(ST_X[i], ST_BY[i], ST_BW[i]), v(ST_X[i + 1], ST_BY[i + 1], ST_BW[i + 1]), v(ST_X[i + 1], ST_BY[i + 1], -ST_BW[i + 1]), v(ST_X[i], ST_BY[i], -ST_BW[i]), HULL_DK, DOWN);
  }
  // Bow & stern end caps + the lip closing across each end.
  for (const e of [0, N - 1]) {
    const nx = e === 0 ? -1 : 1;
    faceQuadFlat(m, v(ST_X[e], ST_TY[e], ST_TW[e]), v(ST_X[e], ST_BY[e], ST_BW[e]), v(ST_X[e], ST_BY[e], -ST_BW[e]), v(ST_X[e], ST_TY[e], -ST_TW[e]), HULL, v(nx, 0.25, 0));
    faceQuadFlat(m, v(ST_X[e], ST_TY[e], ST_TW[e]), v(ST_X[e], ST_TY[e], IW[e]), v(ST_X[e], ST_TY[e], -IW[e]), v(ST_X[e], ST_TY[e], -ST_TW[e]), LIP, UP);
  }
  // Helper: a lofted deck floor between two stations at height `y`, plus the short inner
  // bulwark walls from that floor up to the rim on both sides.
  // Inner bulwark walls use the lit DECK tone (not the dark keel color): they face inward/away
  // from the key, so a dark color made them read as a black gouge across the open deck.
  const deckSeg = (i: number, y: number): void => {
    faceQuadFlat(m, v(ST_X[i], y, IW[i]), v(ST_X[i + 1], y, IW[i + 1]), v(ST_X[i + 1], y, -IW[i + 1]), v(ST_X[i], y, -IW[i]), DECK, UP);
    for (const s of [1, -1]) {
      faceQuadFlat(m, v(ST_X[i], ST_TY[i], s * IW[i]), v(ST_X[i + 1], ST_TY[i + 1], s * IW[i + 1]), v(ST_X[i + 1], y, s * IW[i + 1]), v(ST_X[i], y, s * IW[i]), DECK, v(0, 0.2, -s));
    }
  };
  // Raised aft deck (poop) from the stern to the step — a solid deck flush inside the hull.
  for (let i = 0; i < STEP; i++) deckSeg(i, AFT_Y);
  // Step riser: the front face of the poop deck, down to the well.
  faceQuadFlat(m, v(ST_X[STEP], AFT_Y, IW[STEP]), v(ST_X[STEP], AFT_Y, -IW[STEP]), v(ST_X[STEP], FLOOR_Y, -IW[STEP]), v(ST_X[STEP], FLOOR_Y, IW[STEP]), DECK, v(1, 0.2, 0));
  // Open cargo well from the step to the bow.
  for (let i = STEP; i < BOW; i++) deckSeg(i, FLOOR_Y);
  // Bow bulkhead + a small solid foredeck capping the prow (so there's no hole at the tip).
  faceQuadFlat(m, v(ST_X[BOW], ST_TY[BOW], IW[BOW]), v(ST_X[BOW], ST_TY[BOW], -IW[BOW]), v(ST_X[BOW], FLOOR_Y, -IW[BOW]), v(ST_X[BOW], FLOOR_Y, IW[BOW]), DECK, v(-1, 0.2, 0));
  for (let i = BOW; i < N - 1; i++) {
    faceQuadFlat(m, v(ST_X[i], ST_TY[i], IW[i]), v(ST_X[i + 1], ST_TY[i + 1], IW[i + 1]), v(ST_X[i + 1], ST_TY[i + 1], -IW[i + 1]), v(ST_X[i], ST_TY[i], -IW[i]), DECK, UP);
  }
}

// Mast + billowing sail + masthead pennant, stepped on the raised aft deck so the open bow
// well ahead of it carries the cargo, as in the reference ships.
const MAST_X = -0.3;
const MAST_BASE = 0.34;
const MAST_H = 1.14;
// Sail: a wide, fairly flat billboard (it carries the projected trade-info chip). PORT_SAIL_CENTER
// is the world-space anchor the chip projects onto. Its Y sits a touch above the geometric midpoint:
// the sail billows more at the foot than the head, so the closer, larger lower half eats more screen
// rows in perspective and drags the visible center down — biasing the anchor up re-centers the chip.
const SAIL_HALFW = 0.44;
const SAIL_BOT = 0.64;
const SAIL_TOP = 1.3;
const SAIL_BILLOW = 0.14;
export const PORT_SAIL_CENTER = { x: MAST_X + SAIL_BILLOW * 0.775, y: SAIL_BOT + (SAIL_TOP - SAIL_BOT) * 0.6, z: 0 };
function boatRig(m: Build): void {
  const topY = MAST_BASE + MAST_H;
  box(m, MAST_X, 0, 0.045, MAST_H, 0.045, MASTC, 0, MAST_BASE);
  // Sail: a grid in the Y–Z plane hanging from the upper mast, bulging toward the bow (+x) —
  // more at the foot than the head — so it reads as wind-filled fabric. One consistent color.
  const halfW = SAIL_HALFW;
  const botY = SAIL_BOT;
  const topSailY = SAIL_TOP;
  const nz = 4;
  const ny = 3;
  const billow = SAIL_BILLOW;
  const P: Vec3[][] = [];
  for (let iy = 0; iy <= ny; iy++) {
    const ty = iy / ny;
    const y = botY + (topSailY - botY) * ty;
    const row: Vec3[] = [];
    for (let iz = 0; iz <= nz; iz++) {
      const tz = iz / nz;
      const hump = Math.sin(Math.PI * tz); // 0 at the luff/leech edges, 1 in the belly
      const x = MAST_X + billow * hump * (0.55 + 0.45 * (1 - ty));
      row.push(v(x, y, -halfW + 2 * halfW * tz));
    }
    P.push(row);
  }
  for (let iy = 0; iy < ny; iy++) {
    for (let iz = 0; iz < nz; iz++) {
      faceQuadFlat(m, P[iy][iz], P[iy][iz + 1], P[iy + 1][iz + 1], P[iy + 1][iz], SAIL_WHITE, v(1, 0, 0));
    }
  }
  // A thin spar across the head of the sail, and a small swallowtail pennant above it.
  box(m, MAST_X, 0, 0.03, 0.03, 2 * halfW + 0.04, MASTC, 0, topSailY - 0.02);
  const fy = topY;
  faceQuad(m, v(MAST_X, fy, 0), v(MAST_X - 0.22, fy - 0.02, 0), v(MAST_X - 0.16, fy - 0.09, 0), v(MAST_X, fy - 0.13, 0), SAIL_TAN, v(0, 0, 1));
}

// A cone whose axis points in an arbitrary direction — the segment of a felled tree. A ring
// perpendicular to `axis` at `base`, tapering to an apex `len` along the axis.
function coneAxis(m: Build, base: Vec3, axis: Vec3, r: number, len: number, sides: number, color: RGB, spin = 0): void {
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
// A felled conifer lying on its side along `ry` (a slight upward tilt) — three stacked skirts
// down a near-horizontal axis plus a short trunk stub. A chopped-down tree, not a standing one.
function felledPine(m: Build, cx: number, cz: number, y0: number, ry: number, scale: number, green: RGB, seed: number): void {
  const a = norm(v(Math.cos(ry), 0.14, Math.sin(ry)));
  let start = v(cx, y0 + 0.09 * scale, cz);
  const r = [0.15, 0.115, 0.075];
  const seg = [0.2, 0.19, 0.22];
  for (let t = 0; t < 3; t++) {
    coneAxis(m, start, a, r[t] * scale, (seg[t] + (t < 2 ? 0.05 : 0)) * scale, 6, shade(green, 1 - t * 0.03), seed + t);
    start = v(start.x + a.x * seg[t] * 0.6 * scale, start.y + a.y * seg[t] * 0.6 * scale, start.z + a.z * seg[t] * 0.6 * scale);
  }
  const tb = v(cx - a.x * 0.06 * scale, y0 + 0.06 * scale, cz - a.z * 0.06 * scale);
  beam(m, tb, v(tb.x - a.x * 0.12 * scale, tb.y, tb.z - a.z * 0.12 * scale), 0.02 * scale, TRUNK);
}

// Cargo for a 2:1 port: a large load of that resource filling the open bow deck ahead of the
// mast (the generic 3:1 ship carries nothing). Sized to the reference — the load nearly fills
// the deck.
function boatCargo(m: Build, kind: PortKind, seed: number): void {
  const y = FLOOR_Y;
  if (kind === 'grain') {
    const CORN: RGB = [232, 198, 82];
    const CAP: RGB = [246, 214, 108];
    logBeam(m, 0.22, 0.12, y, 0.36, 0.12, 0, CORN, CAP);
    logBeam(m, 0.22, -0.12, y, 0.36, 0.12, 0, CORN, CAP);
    logBeam(m, 0.04, 0.0, y + 0.02, 0.32, 0.11, 0.1, CORN, CAP);
  } else if (kind === 'ore') {
    const GREY: RGB = [150, 154, 164];
    blob(m, 0.24, y + 0.22, 0.12, 0.25, 0.22, 0.24, GREY, seed, 0.4, 3, 6);
    blob(m, 0.1, y + 0.19, -0.12, 0.22, 0.19, 0.22, shade(GREY, 0.92), seed + 3, 0.4, 3, 6);
  } else if (kind === 'lumber') {
    const GREEN: RGB = [78, 122, 68];
    felledPine(m, 0.02, 0.11, y, 0.18, 1.05, GREEN, seed);
    felledPine(m, 0.24, -0.06, y, -0.12, 1.05, GREEN, seed + 3);
    felledPine(m, 0.12, 0.02, y + 0.06, 0.48, 0.95, GREEN, seed + 6);
  } else if (kind === 'wool') {
    sheep(m, 0.28, 0.09, y, 0.2, seed, 1.55);
    sheep(m, 0.05, -0.05, y, -0.4, seed + 4, 1.55);
    sheep(m, 0.34, -0.14, y, 0.05, seed + 8, 1.4);
  } else if (kind === 'brick') {
    const BRICK: RGB = [196, 112, 84];
    box(m, 0.16, 0.11, 0.3, 0.13, 0.2, BRICK, 0, y);
    box(m, 0.16, -0.11, 0.3, 0.13, 0.2, BRICK, 0, y);
    box(m, 0.2, 0.0, 0.28, 0.13, 0.34, shade(BRICK, 0.94), 0, y + 0.13);
  }
}

const portCache = new Map<string, Mesh>();
export function portMesh(kind: PortKind, seed = 1): Mesh {
  const key = `${kind}:${seed}`;
  const cached = portCache.get(key);
  if (cached) return cached;
  const m = build();
  boatHull(m);
  boatRig(m);
  boatCargo(m, kind, seed);
  portCache.set(key, m);
  return m;
}

export function tileMesh(terrain: Terrain, seed = 0, robberOn = false): Mesh {
  const key = `${terrain}:${seed}:${robberOn ? 1 : 0}`;
  let m = cache.get(key);
  if (!m) {
    const built = BUILDERS[terrain](seed);
    if (robberOn) placeRobber(built);
    m = built;
    cache.set(key, m);
  }
  return m;
}
