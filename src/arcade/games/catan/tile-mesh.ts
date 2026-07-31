// Prototype 3D hex tiles for Catan, rebuilt tile-by-tile from reference art. Shared design:
// a THIN, flat-top hexagon slab — a short brown side wall, a thin flat brown rim ledge, and
// the terrain surface sitting nearly flush (a hair proud, no deep indent). The terrain is a
// gently-undulating, coarsely-triangulated surface so facets catch the light. Number chips
// are intentionally NOT baked in — they're a separate component added later.
//
// Static terrain bakes into one cached mesh per tile (positions + per-face normals); the
// windmill rotor and sheep use small time-varying overlay meshes. Faces go through
// `faceTri`/`faceQuad`, which orient winding to an "outward" hint. Terrain height is a pure
// function of (x,z) so independently-built sectors meet seamlessly and props can be sat
// exactly on the surface.
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
// Emit faces with an intentionally softened lighting normal. Useful for tiny corrugations
// whose true geometric slope would over-darken at terminal resolution.
function faceTriWithNormal(m: Build, a: Vec3, b: Vec3, c: Vec3, color: RGB, normal: Vec3): void {
  const col = { x: color[0], y: color[1], z: color[2] };
  const n = norm(normal);
  const base = m.vertices.length;
  for (const p of [a, b, c]) m.vertices.push({ position: { ...p }, normal: n, uv: [0, 0], color: col });
  m.indices.push(base, base + 1, base + 2);
}
function faceQuadWithNormal(m: Build, a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: RGB, normal: Vec3): void {
  const col = { x: color[0], y: color[1], z: color[2] };
  const n = norm(normal);
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

// ── Wheat ground: dense standing crop cut by curved harvested lanes ────────────

interface HarvestLane {
  p0: { x: number; z: number };
  p1: { x: number; z: number };
  p2: { x: number; z: number };
  p3: { x: number; z: number };
  startWidth: number;
  endWidth: number;
  phase: number;
}

type FarmPoint = readonly [u: number, w: number];
type FarmPolygon = readonly FarmPoint[];

interface FieldLayout {
  angle: number;
  rowAngle: number;
  spacing: number;
  phase: number;
  bend: number;
  wave: number;
  harvestLanes: readonly HarvestLane[];
  grassParcel: FarmPolygon;
  windmillPosition: FarmPoint;
  shackPosition: FarmPoint;
  bushPosition: FarmPoint;
}

const fieldToWorld = (angle: number, u: number, w: number): { x: number; z: number } => ({
  x: Math.cos(angle) * u - Math.sin(angle) * w,
  z: Math.sin(angle) * u + Math.cos(angle) * w,
});

function fieldLayout(rng: () => number, seed: number): FieldLayout {
  // Coordinates use screen-right (u) and screen-down (w), matching the reference photograph.
  // Every seed keeps the same farm topology while moving the dividers, grass boundary, and props.
  // Rotate the WHOLE composition in 60-degree steps so adjacent board tiles do not all pin the
  // pasture to the same corner or send their harvested pass between the same pair of edges.
  const orientation = ((Math.trunc(seed) % 6) + 6) % 6;
  const angle = -0.62 + orientation * (Math.PI / 3) + (rng() - 0.5) * 0.05;
  const laneStart = -0.09 + (rng() - 0.5) * 0.16;
  const laneEnd = 0.37 + (rng() - 0.5) * 0.2;
  const laneBend = (rng() - 0.5) * 0.24;
  const grassRight = -0.12 + (rng() - 0.5) * 0.32;
  const grassBottom = -0.14 + (rng() - 0.5) * 0.26;
  const grassShoulder = -0.43 + (rng() - 0.5) * 0.24;
  const swapFarmProps = rng() < 0.5;
  const toLane = (
    points: readonly [FarmPoint, FarmPoint, FarmPoint, FarmPoint],
    width: number,
    phase: number,
    endWidth = width * 0.94,
  ): HarvestLane => {
    const p = points.map(([u, w]) => fieldToWorld(angle, u, w)) as [
      { x: number; z: number },
      { x: number; z: number },
      { x: number; z: number },
      { x: number; z: number },
    ];
    return { p0: p[0], p1: p[1], p2: p[2], p3: p[3], startWidth: width, endWidth, phase };
  };
  // Cycle three clearly different but compatible combine passes: almost straight, one broad
  // curve, and the same broad curve with a short fork. This is shape variation, not a return to
  // the unrelated full-tile pattern families that previously made the wheat incoherent.
  const harvestStyle = ((Math.trunc(seed) % 3) + 3) % 3;
  // A little broader than the first reference-derived pass: still narrow close up, but legible
  // as a band of cut stalks when all nineteen tiles are viewed together.
  const laneWidth = 0.059 + rng() * 0.018;
  const deltaW = laneEnd - laneStart;
  const mainPoints: [FarmPoint, FarmPoint, FarmPoint, FarmPoint] = harvestStyle === 0
    ? [
        [-1.03, laneStart],
        [-0.35, laneStart + deltaW / 3 + (rng() - 0.5) * 0.025],
        [0.35, laneStart + (deltaW * 2) / 3 + (rng() - 0.5) * 0.025],
        [1.03, laneEnd],
      ]
    : [
        [-1.03, laneStart],
        [-0.56 + (rng() - 0.5) * 0.18, laneStart - 0.03 - laneBend],
        [0.02 + (rng() - 0.5) * 0.18, laneEnd - 0.09 + laneBend],
        [1.03, laneEnd],
      ];
  const mainLane = toLane(mainPoints, laneWidth, seed * 0.31);
  const harvestLanes: HarvestLane[] = [mainLane];
  if (harvestStyle === 2) {
    const join = cubicCurvePoint(mainLane, 0.54 + (rng() - 0.5) * 0.08);
    const middleW = laneStart + deltaW * 0.55;
    const p1 = fieldToWorld(angle, 0.18, middleW - 0.035);
    const p2 = fieldToWorld(angle, 0.38 + (rng() - 0.5) * 0.06, middleW - 0.18 + (rng() - 0.5) * 0.06);
    const p3 = fieldToWorld(angle, 0.57 + (rng() - 0.5) * 0.08, middleW - 0.34 + (rng() - 0.5) * 0.08);
    harvestLanes.push({
      p0: join,
      p1,
      p2,
      p3,
      startWidth: laneWidth * 1.05,
      endWidth: laneWidth * 0.72,
      phase: seed * 0.53 + 2.1,
    });
  }
  return {
    angle,
    rowAngle: angle + (rng() - 0.5) * 0.09,
    spacing: 0.05 + rng() * 0.005,
    phase: (rng() - 0.5) * 0.05,
    bend: (rng() - 0.5) * 0.035,
    wave: 0.006 + rng() * 0.008,
    harvestLanes,
    // The outer points deliberately extend past the inner hex and are clipped onto its edge.
    grassParcel: [
      [-1.04, -0.86],
      [grassRight, -0.84],
      [grassRight + (rng() - 0.5) * 0.045, grassBottom],
      [grassShoulder, grassBottom + 0.04 + (rng() - 0.5) * 0.05],
      [-1.04, -0.18 + (rng() - 0.5) * 0.09],
    ],
    windmillPosition: [-0.47 + (rng() - 0.5) * 0.08, -0.48 + (rng() - 0.5) * 0.08],
    shackPosition: swapFarmProps
      ? [Math.max(-0.34, grassRight - 0.09) + (rng() - 0.5) * 0.04, -0.27 + (rng() - 0.5) * 0.06]
      : [-0.62 + (rng() - 0.5) * 0.05, -0.29 + (rng() - 0.5) * 0.06],
    bushPosition: [grassRight - 0.07 - rng() * 0.04, grassBottom - 0.015 - rng() * 0.035],
  };
}

function cubicCurvePoint(lane: HarvestLane, t: number): { x: number; z: number } {
  const inv = 1 - t;
  const a = inv * inv * inv;
  const b = 3 * inv * inv * t;
  const c = 3 * inv * t * t;
  const d = t * t * t;
  return {
    x: lane.p0.x * a + lane.p1.x * b + lane.p2.x * c + lane.p3.x * d,
    z: lane.p0.z * a + lane.p1.z * b + lane.p2.z * c + lane.p3.z * d,
  };
}

function harvestedWeight(lane: HarvestLane, x: number, z: number): number {
  const segments = 14;
  let best = 0;
  let a = lane.p0;
  for (let i = 1; i <= segments; i++) {
    const b = cubicCurvePoint(lane, i / segments);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz || 1;
    const q = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSq));
    const nearestX = a.x + dx * q;
    const nearestZ = a.z + dz * q;
    const distance = Math.hypot(x - nearestX, z - nearestZ);
    const t = (i - 1 + q) / segments;
    const baseWidth = lane.startWidth + (lane.endWidth - lane.startWidth) * t;
    const width = baseWidth * (1 + Math.sin(t * Math.PI * 4 + lane.phase) * 0.055);
    best = Math.max(best, smooth((width + 0.045 - distance) / 0.09));
    a = b;
  }
  return best;
}

function polygonCoverage(x: number, z: number, polygon: FarmPolygon): number {
  let inside = false;
  let minDistance = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const dx = xi - xj;
    const dz = zi - zj;
    const lengthSq = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - xj) * dx + (z - zj) * dz) / lengthSq));
    minDistance = Math.min(minDistance, Math.hypot(x - (xj + dx * t), z - (zj + dz * t)));
  }
  const signedDistance = inside ? -minDistance : minDistance;
  return smooth((0.055 - signedDistance) / 0.11);
}

function scaleFarmPolygon(polygon: FarmPolygon, scale: number): FarmPolygon {
  const centerU = polygon.reduce((sum, [u]) => sum + u, 0) / polygon.length;
  const centerW = polygon.reduce((sum, [, w]) => sum + w, 0) / polygon.length;
  return polygon.map(([u, w]) => [centerU + (u - centerU) * scale, centerW + (w - centerW) * scale] as const);
}

function worldToField(layout: FieldLayout, x: number, z: number): { u: number; w: number } {
  const c = Math.cos(layout.angle);
  const s = Math.sin(layout.angle);
  return { u: x * c + z * s, w: -x * s + z * c };
}

function fieldCoverage(layout: FieldLayout, x: number, z: number): number {
  const { u, w } = worldToField(layout, x, z);
  const grass = polygonCoverage(u, w, layout.grassParcel);
  let harvested = 0;
  for (const lane of layout.harvestLanes) harvested = Math.max(harvested, harvestedWeight(lane, x, z));
  return (1 - grass) * (1 - harvested);
}

function harvestedFieldCoverage(layout: FieldLayout, x: number, z: number): number {
  const { u, w } = worldToField(layout, x, z);
  const grass = polygonCoverage(u, w, layout.grassParcel);
  let harvested = 0;
  for (const lane of layout.harvestLanes) harvested = Math.max(harvested, harvestedWeight(lane, x, z));
  return harvested * (1 - grass);
}

function farmParcelPatch(
  m: Build,
  layout: FieldLayout,
  polygon: FarmPolygon,
  yAt: (x: number, z: number) => number,
  color: RGB,
  lift = 0.006,
): void {
  const points = polygon.map(([u, w]) => {
    const p = fieldToWorld(layout.angle, u, w);
    const q = clampToHex(p.x, p.z, R_RIM - 0.018);
    return v(q.x, yAt(q.x, q.z) + lift, q.z);
  });
  const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const centerZ = points.reduce((sum, p) => sum + p.z, 0) / points.length;
  const center = v(centerX, yAt(centerX, centerZ) + lift, centerZ);
  for (let i = 0; i < points.length; i++) {
    faceTriWithNormal(m, center, points[i], points[(i + 1) % points.length], shade(color, 0.97 + (i % 3) * 0.025), UP);
  }
}

function insideFieldHex(x: number, z: number): boolean {
  const c = clampToHex(x, z, R_RIM - 0.025);
  return Math.hypot(c.x - x, c.z - z) < 1e-5;
}

function fieldRowPoint(layout: FieldLayout, row: number, u: number): { x: number; z: number } {
  const baseW = row * layout.spacing + layout.phase;
  const w = baseW + layout.bend * (u * u - 0.35) + layout.wave * Math.sin(u * 3.2 + row * 0.43);
  return fieldToWorld(layout.rowAngle, u, w);
}

// A harvested row is genuinely raised: two sloping faces meet along its crest, and short cut
// stems protrude from that crest. These rows only exist in the combine lanes, rather than being
// flat lines painted across the soil.
function harvestedRows(m: Build, layout: FieldLayout, soilY: (x: number, z: number) => number, color: RGB, seed: number): void {
  const count = 33;
  const segments = 28;
  for (let k = 0; k < count; k++) {
    const row = k - (count - 1) / 2;
    for (let i = 0; i < segments; i++) {
      const u0 = -1.02 + (2.04 * i) / segments;
      const u1 = -1.02 + (2.04 * (i + 1)) / segments;
      const a = fieldRowPoint(layout, row, u0);
      const b = fieldRowPoint(layout, row, u1);
      if (!insideFieldHex(a.x, a.z) || !insideFieldHex(b.x, b.z)) continue;
      const midX = (a.x + b.x) / 2;
      const midZ = (a.z + b.z) / 2;
      if (harvestedFieldCoverage(layout, midX, midZ) < 0.48) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const wx = (-dz / len) * 0.024;
      const wz = (dx / len) * 0.024;
      const leftA = v(a.x - wx, soilY(a.x - wx, a.z - wz) + 0.004, a.z - wz);
      const crestA = v(a.x, soilY(a.x, a.z) + 0.021, a.z);
      const rightA = v(a.x + wx, soilY(a.x + wx, a.z + wz) + 0.004, a.z + wz);
      const leftB = v(b.x - wx, soilY(b.x - wx, b.z - wz) + 0.004, b.z - wz);
      const crestB = v(b.x, soilY(b.x, b.z) + 0.021, b.z);
      const rightB = v(b.x + wx, soilY(b.x + wx, b.z + wz) + 0.004, b.z + wz);
      const col = shade(color, 0.94 + ((k + i) % 3) * 0.035);
      faceQuadFlat(m, leftA, leftB, crestB, crestA, col, UP);
      faceQuadFlat(m, crestA, crestB, rightB, rightA, shade(col, 1.05), UP);

      if ((i + k) % 2 === 0) {
        stubbleTuft(m, midX, midZ, soilY(midX, midZ) + 0.018, layout.rowAngle, seed + k * 37 + i * 11);
      }
    }
  }
}

// A low corrugated under-canopy gives the standing crop enough continuous golden coverage to
// survive board-distance rasterization. It follows the same curved rows and harvested mask as
// the stalks, so it never becomes a rectangular pad; individual tufts still provide the close
// silhouette and grain detail above it.
function standingCanopy(m: Build, layout: FieldLayout, soilY: (x: number, z: number) => number, color: RGB): void {
  const rows = 33;
  const segments = 30;
  for (let k = 0; k < rows; k++) {
    const row = k - (rows - 1) / 2;
    for (let i = 0; i < segments; i++) {
      const u0 = -1.02 + (2.04 * i) / segments;
      const u1 = -1.02 + (2.04 * (i + 1)) / segments;
      const a = fieldRowPoint(layout, row, u0);
      const b = fieldRowPoint(layout, row, u1);
      if (!insideFieldHex(a.x, a.z) || !insideFieldHex(b.x, b.z)) continue;
      const wa = smooth((fieldCoverage(layout, a.x, a.z) - 0.44) / 0.28);
      const wb = smooth((fieldCoverage(layout, b.x, b.z) - 0.44) / 0.28);
      if (wa < 0.04 && wb < 0.04) continue;

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const half = layout.spacing * 0.51;
      const wx = (-dz / len) * half;
      const wz = (dx / len) * half;
      const edgeA = soilY(a.x, a.z) + 0.009 + wa * 0.021;
      const crestA = soilY(a.x, a.z) + 0.009 + wa * 0.046;
      const edgeB = soilY(b.x, b.z) + 0.009 + wb * 0.021;
      const crestB = soilY(b.x, b.z) + 0.009 + wb * 0.046;
      const leftA = v(a.x - wx, edgeA, a.z - wz);
      const midA = v(a.x, crestA, a.z);
      const rightA = v(a.x + wx, edgeA, a.z + wz);
      const leftB = v(b.x - wx, edgeB, b.z - wz);
      const midB = v(b.x, crestB, b.z);
      const rightB = v(b.x + wx, edgeB, b.z + wz);
      const band = shade(color, 0.97 + ((k + i) % 3) * 0.025);
      const px = wx / half;
      const pz = wz / half;
      faceQuadWithNormal(m, leftA, leftB, midB, midA, shade(band, 0.98), v(-px * 0.24, 1, -pz * 0.24));
      faceQuadWithNormal(m, midA, midB, rightB, rightA, shade(band, 1.035), v(px * 0.24, 1, pz * 0.24));
    }
  }
}

// Dense, individually modelled stalks fill every unharvested portion of the tile. Their rows
// follow the same gentle curves as the stubble, so the cut and standing crop read as one field.
function standingWheat(m: Build, layout: FieldLayout, soilY: (x: number, z: number) => number, seed: number): void {
  const rows = 33;
  const along = 41;
  for (let k = 0; k < rows; k++) {
    const row = k - (rows - 1) / 2;
    for (let i = 0; i < along; i++) {
      const jitter = hash2(i * 3.7 + seed, k * 5.1 - seed);
      const u = -0.98 + (1.96 * (i + 0.5 + (jitter - 0.5) * 0.62)) / along;
      const q = fieldRowPoint(layout, row, u);
      const acrossJitter = (hash2(i * 5.9 - seed, k * 3.3 + seed) - 0.5) * 0.03;
      q.x -= Math.sin(layout.rowAngle) * acrossJitter;
      q.z += Math.cos(layout.rowAngle) * acrossJitter;
      const coverage = fieldCoverage(layout, q.x, q.z);
      if (!insideFieldHex(q.x, q.z) || coverage < 0.48) continue;
      const r = Math.hypot(q.x, q.z);
      if (r < 0.205) continue;
      const h = 0.112 + hash2(i * 11.3 + seed, k * 8.7 - seed) * 0.032;
      const lean = layout.rowAngle + (hash2(i - seed * 0.7, k + seed * 0.3) - 0.5) * 0.34;
      const stalkSeed = seed + k * 43 + i * 17;
      const y0 = soilY(q.x, q.z) + 0.006;
      if (coverage < 0.76 || r > 0.72) wheatStalk(m, q.x, q.z, y0, h, lean, stalkSeed);
      else wheatTuft(m, q.x, q.z, y0, h, lean, stalkSeed);
    }
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

type RockProfile = 'crag' | 'slab' | 'wedge';

// Three deliberately different angular-rock constructions: a peaked crag, a broad flat slab,
// or a sharp ridge-backed wedge. Their distinct topology—not only random vertex jitter—keeps a
// pile from reading as copies of one procedural boulder.
function angularRock(m: Build, cx: number, cz: number, y0: number, rx: number, h: number, rz: number, color: RGB, seed: number, profile: RockProfile, spin = 0): void {
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

function scatter(
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

// ── Wheat-specific props ──────────────────────────────────────────────────────

const WHEAT_STEM: RGB = [248, 202, 48];
const WHEAT_HEAD: RGB = [255, 229, 86];

// Wheat heads are tiny enough that true cone normals make the unlit faces turn muddy.
// Keep a little radial component for shape, but bias every face upward so the crop stays
// warm and golden across camera angles.
function wheatGrainHead(
  m: Build,
  cx: number,
  cz: number,
  r: number,
  h: number,
  sides: number,
  color: RGB,
  yBase: number,
  spin: number,
  leanX: number,
  leanZ: number,
): void {
  const apex = v(cx + leanX, yBase + h, cz + leanZ);
  const ring: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (Math.PI * 2 * i) / sides + spin;
    ring.push(v(cx + r * Math.cos(a), yBase, cz + r * Math.sin(a)));
  }
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const a = (Math.PI * 2 * (i + 0.5)) / sides + spin;
    faceTriWithNormal(
      m,
      ring[i],
      ring[j],
      apex,
      shade(color, 0.985 + (i % 2) * 0.025),
      v(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3),
    );
  }
}

function wheatStalk(m: Build, cx: number, cz: number, y0: number, h: number, leanAngle: number, seed: number): void {
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
    0.014 + rng() * 0.003,
    0.03 + rng() * 0.008,
    4,
    shade(WHEAT_HEAD, 0.95 + rng() * 0.1),
    shoulder.y - 0.003,
    leanAngle + Math.PI / 4,
    lx * 0.006,
    lz * 0.006,
  );
}

// Three close stalks for the body of a standing field. Each keeps a separate stem and grain
// head, but the stems are single low-poly blades instead of four-sided beams. Detailed beam
// stalks remain at every harvested boundary and around the tile silhouette.
function wheatTuft(m: Build, cx: number, cz: number, y0: number, h: number, angle: number, seed: number): void {
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
      0.013 + rng() * 0.0025,
      0.029 + rng() * 0.007,
      3,
      shade(WHEAT_HEAD, 0.95 + rng() * 0.1),
      y0 + stalkH - 0.003,
      stalkAngle,
      lx * 0.006,
      lz * 0.006,
    );
  }
}

function stubbleTuft(m: Build, cx: number, cz: number, y0: number, angle: number, seed: number): void {
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

function farmWindmillBody(m: Build, cx: number, cz: number, y0: number, angle: number, seed: number): void {
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

function farmWindmillRotor(m: Build, cx: number, cz: number, y0: number, angle: number, seed: number, time: number): void {
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

function farmShack(m: Build, cx: number, cz: number, y0: number, angle: number, seed: number): void {
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

function farmBush(m: Build, cx: number, cz: number, y0: number, scale: number, seed: number): void {
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

// ── Palette (non-wheat tiles, pending their rebuilds) ────────────────────────────
const TRUNK: RGB = [104, 72, 44];
const PINE_RADII = [0.17, 0.13, 0.085] as const;
const PINE_TIER_BASES = [0.03, 0.14, 0.25] as const;
const PINE_TIER_HEIGHTS = [0.16, 0.16, 0.185] as const;
const PINE_GREENS: readonly RGB[] = [
  [56, 108, 66],
  [72, 132, 82],
  [92, 152, 92],
  [62, 118, 74],
];

// A low-poly conifer: a thin trunk under THREE prominent skirts. Each skirt is a cone whose
// flared base clearly overhangs the narrowing tip of the one below, so the tree reads as three
// distinct stacked pyramids of leaves. `green` tints the whole tree.
function pine(m: Build, cx: number, cz: number, y0: number, scale: number, green: RGB, seed: number): void {
  box(m, cx, cz, 0.032 * scale, 0.08 * scale, 0.032 * scale, TRUNK, 0, y0 - 0.02);
  // Wide-based, short skirts that only just overlap: each tier's flared base juts well past the
  // narrowing tip below it, giving a strongly stepped silhouette (not a smooth cone) from afar.
  for (let t = 0; t < 3; t++) {
    cone(m, cx, cz, PINE_RADII[t] * scale, PINE_TIER_HEIGHTS[t] * scale, 6, shade(green, 1 - t * 0.03), y0 + PINE_TIER_BASES[t] * scale, seed + t * 0.9);
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
interface SheepPose {
  gait?: number; // -1..1: diagonal hoof swing while walking
  headDip?: number; // 0..1: lower the head to graze
  groundY?: (x: number, z: number) => number; // rendered terrain beneath each individual hoof
}

// A low-poly sheep: a fat rounded body (white top → cream belly), a black head tilted up at
// the front with two ear nubs, and four short thin black legs. Faces along `ry`. Animated poses
// swing diagonal leg pairs, add a restrained body bob, and lower the head all the way to grass.
function sheep(m: Build, cx: number, cz: number, y0: number, ry: number, seed: number, scale = 1, pose: SheepPose = {}): void {
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

// WHEAT — one reference-derived farm composition with three dense crop parcels, an upper-left
// grass parcel, and one thin curved strip of cut stalks. Seeds reshape those boundaries and move
// the farm details without swapping the tile into an unrelated pattern family.
function fieldsTile(seed: number): Build {
  const m = build();
  const FIELD_GROUND: RGB = [220, 169, 60];
  const GRASS_BLEND: RGB = [194, 163, 69];
  const GRASS: RGB = [124, 143, 78];
  const STUBBLE_ROW: RGB = [235, 183, 66];
  const WHEAT_CANOPY: RGB = [255, 221, 63];
  const amp = 0.025;
  const groundSeed = seed + 4.2;
  const rng = mulberry32((Math.abs(seed) * 2246822519 + 0x85ebca6b) >>> 0 || 1);
  const layout = fieldLayout(rng, seed);
  const soilY = (x: number, z: number): number => surfaceY(x, z, amp, groundSeed);

  irregularGround(m, { color: FIELD_GROUND, amp, seed: groundSeed, facet: 0.065 });
  farmParcelPatch(m, layout, scaleFarmPolygon(layout.grassParcel, 1.16), soilY, GRASS_BLEND, 0.007);
  farmParcelPatch(m, layout, layout.grassParcel, soilY, GRASS, 0.011);
  harvestedRows(m, layout, soilY, STUBBLE_ROW, seed);
  standingCanopy(m, layout, soilY, WHEAT_CANOPY);
  standingWheat(m, layout, soilY, seed);

  const windmill = fieldToWorld(layout.angle, layout.windmillPosition[0], layout.windmillPosition[1]);
  const shack = fieldToWorld(layout.angle, layout.shackPosition[0], layout.shackPosition[1]);
  const shrub = fieldToWorld(layout.angle, layout.bushPosition[0], layout.bushPosition[1]);
  farmWindmillBody(m, windmill.x, windmill.z, soilY(windmill.x, windmill.z) + 0.014, layout.angle, seed * 101 + 7);
  farmShack(m, shack.x, shack.z, soilY(shack.x, shack.z) + 0.014, layout.angle + 0.1 + (rng() - 0.5) * 0.24, seed * 107 + 11);
  farmBush(m, shrub.x, shrub.z, soilY(shrub.x, shrub.z) + 0.01, 0.78 + rng() * 0.08, seed * 109 + 13);

  rimAndWall(m, shade(FIELD_GROUND, 1.03));
  return m;
}

function animatedFieldsTile(seed: number, time: number): Build {
  const m = build();
  const amp = 0.025;
  const groundSeed = seed + 4.2;
  const rng = mulberry32((Math.abs(seed) * 2246822519 + 0x85ebca6b) >>> 0 || 1);
  const layout = fieldLayout(rng, seed);
  const windmill = fieldToWorld(layout.angle, layout.windmillPosition[0], layout.windmillPosition[1]);
  const y0 = surfaceY(windmill.x, windmill.z, amp, groundSeed) + 0.014;
  farmWindmillRotor(m, windmill.x, windmill.z, y0, layout.angle, seed * 101 + 7, time);
  return m;
}

function forestTile(seed: number): Build {
  const m = build();
  const GRASS: RGB = [104, 152, 108]; // deep shady green — reads clearly darker than pasture mint from afar
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
    pine(m, p.x, p.z, hAt(p.x, p.z), 0.68 + rng() * 0.26, PINE_GREENS[Math.floor(rng() * PINE_GREENS.length)], (seed * 31 + i++) | 0);
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
interface PastureSheepSpec {
  x: number;
  z: number;
  seed: number;
  pathAngle: number;
  amplitude: number;
  phase: number;
  cycle: number;
}

interface PastureTreeSpec {
  x: number;
  z: number;
  scale: number;
  seed: number;
}

interface PastureBushSpec extends PastureTreeSpec {}

interface PastureLayout {
  sheep: PastureSheepSpec[];
  trees: PastureTreeSpec[];
  bushes: PastureBushSpec[];
}

function pastureLayout(seed: number): PastureLayout {
  const rng = mulberry32((Math.abs(seed) * 374761393 + 0x9e3779b9) >>> 0 || 1);
  const sheepCount = 3 + Math.floor(rng() * 2);
  const treeCount = 2 + Math.floor(rng() * 2);
  const bushCount = 3 + Math.floor(rng() * 3);
  const pts = scatter(rng, sheepCount + treeCount + bushCount, 0.68, 0.28, (x, z) => Math.hypot(x, z) > 0.22);
  let i = 0;
  const take = (): { x: number; z: number } | undefined => pts[i++];
  const sheepSpecs: PastureSheepSpec[] = [];
  for (let s = 0; s < sheepCount; s++) {
    const p = take();
    if (!p) break;
    sheepSpecs.push({
      ...p,
      seed: (seed * 23 + i) | 0,
      pathAngle: rng() * Math.PI * 2,
      amplitude: 0.068 + rng() * 0.022,
      phase: rng(),
      cycle: 11.5 + rng() * 4.5,
    });
  }
  const trees: PastureTreeSpec[] = [];
  for (let t = 0; t < treeCount; t++) {
    const p = take();
    if (!p) break;
    trees.push({ ...p, scale: 0.36 + rng() * 0.12, seed: (seed * 13 + i) | 0 });
  }
  const bushes: PastureBushSpec[] = [];
  for (let b = 0; b < bushCount; b++) {
    const p = take();
    if (!p) break;
    bushes.push({ ...p, scale: 0.48 + rng() * 0.32, seed: (seed * 17 + i) | 0 });
  }
  return { sheep: sheepSpecs, trees, bushes };
}

interface MovingSheep {
  x: number;
  z: number;
  yaw: number;
  gait: number;
  headDip: number;
  moving: number;
}

function sheepMotion(spec: PastureSheepSpec, time: number): MovingSheep {
  const forward = { x: Math.cos(spec.pathAngle), z: Math.sin(spec.pathAngle) };
  const side = { x: -forward.z, z: forward.x };
  const point = (f: number, s: number): { x: number; z: number } => ({
    x: spec.x + (forward.x * f + side.x * s) * spec.amplitude,
    z: spec.z + (forward.z * f + side.z * s) * spec.amplitude,
  });
  const points = [point(-0.62, -0.12), point(0.62, 0.2), point(-0.08, 0.72)] as const;
  const p = (((time / spec.cycle + spec.phase) % 1) + 1) % 1;
  let from = points[0];
  let to = points[1];
  let progress = 0;
  let moving = 0;
  let headDip = 0;
  if (p < 0.27) {
    progress = p / 0.27;
    moving = 1;
  } else if (p < 0.39) {
    from = points[1];
    to = points[1];
  } else if (p < 0.58) {
    from = points[1];
    to = points[2];
    progress = (p - 0.39) / 0.19;
    moving = 1;
  } else if (p < 0.78) {
    from = points[2];
    to = points[2];
    const graze = (p - 0.58) / 0.2;
    headDip = smooth(Math.min(graze / 0.2, (1 - graze) / 0.2));
  } else if (p < 0.94) {
    from = points[2];
    to = points[0];
    progress = (p - 0.78) / 0.16;
    moving = 1;
  } else {
    from = points[0];
    to = points[0];
  }
  const eased = smooth(progress);
  const x = from.x + (to.x - from.x) * eased;
  const z = from.z + (to.z - from.z) * eased;
  // Hold the just-travelled heading through a pause or grazing stop; do not snap back to the
  // seed angle merely because the current segment has zero length.
  const heading = (fromPoint: { x: number; z: number }, toPoint: { x: number; z: number }): number => Math.atan2(toPoint.z - fromPoint.z, toPoint.x - fromPoint.x);
  const h01 = heading(points[0], points[1]);
  const h12 = heading(points[1], points[2]);
  const h20 = heading(points[2], points[0]);
  const turn = (a: number, b: number, amount: number): number => {
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + delta * smooth(amount);
  };
  const yaw = p < 0.27
    ? h01
    : p < 0.39
      ? turn(h01, h12, (p - 0.27) / 0.12)
      : p < 0.68
        ? h12
        : p < 0.78
          ? turn(h12, h20, (p - 0.68) / 0.1)
          : p < 0.94
            ? h20
            : turn(h20, h01, (p - 0.94) / 0.06);
  const gaitEnvelope = moving ? Math.sin(progress * Math.PI) : 0;
  const gait = gaitEnvelope * Math.sin((time / spec.cycle) * Math.PI * 18 + spec.phase * Math.PI * 2);
  return { x, z, yaw, gait, headDip, moving };
}

function sheepBodyRadius(seed: number): number {
  const rng = mulberry32(seed | 0 || 1);
  return (0.437 + rng() * 0.138) * 0.225;
}

// Intersect a vertical probe with the already-baked meadow triangles. This follows the actual
// piecewise-planar surface the player sees, rather than resampling the procedural vertex noise
// at a moving coordinate (which made a walking sheep jump between unrelated noise values).
function meshSurfaceYAt(mesh: Mesh, x: number, z: number, fallback: number): number {
  let best = Infinity;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.vertices[mesh.indices[i]];
    const b = mesh.vertices[mesh.indices[i + 1]];
    const c = mesh.vertices[mesh.indices[i + 2]];
    if (a.normal.y < 0.45 || b.normal.y < 0.45 || c.normal.y < 0.45) continue;
    const ax = a.position.x;
    const az = a.position.z;
    const bx = b.position.x;
    const bz = b.position.z;
    const cx = c.position.x;
    const cz = c.position.z;
    const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(denominator) < 1e-9) continue;
    const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
    const wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator;
    const wc = 1 - wa - wb;
    if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
    const y = wa * a.position.y + wb * b.position.y + wc * c.position.y;
    if (y < best) best = y;
  }
  return best === Infinity ? fallback : best;
}

function animatedPastureTile(seed: number, time: number): Build {
  const m = build();
  const layout = pastureLayout(seed);
  const amp = 0.15;
  const gseed = seed + 1.9;
  const meadow = tileMesh('pasture', seed);
  const hAt = (x: number, z: number): number => meshSurfaceYAt(meadow, x, z, surfaceY(x, z, amp, gseed));
  const obstacles = [
    ...layout.trees.map((tree) => ({ x: tree.x, z: tree.z, radius: 0.26 * tree.scale + 0.025 })),
    ...layout.bushes.map((bushSpec) => ({ x: bushSpec.x, z: bushSpec.z, radius: 0.16 * bushSpec.scale + 0.025 })),
  ];
  const placed: { x: number; z: number; radius: number }[] = [];
  for (const spec of layout.sheep) {
    const target = sheepMotion(spec, time);
    const radius = sheepBodyRadius(spec.seed);
    const reserved = layout.sheep
      .filter((other) => other !== spec)
      .map((other) => ({ x: other.x, z: other.z, radius: sheepBodyRadius(other.seed) }));
    const clear = (x: number, z: number): boolean => [...obstacles, ...reserved, ...placed].every((disc) => Math.hypot(x - disc.x, z - disc.z) >= radius + disc.radius);
    let factor = 0;
    // Each sheep owns a small motion cell around a pre-spaced anchor. If a long body or nearby
    // shrub narrows that cell, shorten this step toward the guaranteed-clear anchor instead of
    // allowing bodies to phase through one another or scenery.
    for (let step = 0; step <= 20; step++) {
      const candidate = 1 - step / 20;
      const x = spec.x + (target.x - spec.x) * candidate;
      const z = spec.z + (target.z - spec.z) * candidate;
      if (clear(x, z)) {
        factor = candidate;
        break;
      }
    }
    const x = spec.x + (target.x - spec.x) * factor;
    const z = spec.z + (target.z - spec.z) * factor;
    placed.push({ x, z, radius });
    sheep(m, x, z, hAt(x, z), target.yaw, spec.seed, 1, {
      gait: target.gait * factor,
      headDip: target.headDip,
      groundY: hAt,
    });
  }
  return m;
}

function pastureTile(seed: number): Build {
  const m = build();
  const GRASS: RGB = [150, 200, 148];
  const CANOPY: RGB = [116, 158, 104];
  const BUSH: RGB = [86, 132, 78]; // darker + smaller than tree canopies, so clearly distinct
  const amp = 0.15; // clearly rolling meadow (was too flat)
  const gseed = seed + 1.9;
  tileBase(m, { color: GRASS, amp, seed: gseed });
  const hAt = (x: number, z: number): number => surfaceY(x, z, amp, gseed);
  const layout = pastureLayout(seed);
  // Sheep are a small dynamic overlay; the rolling ground and vegetation remain cached.
  // Small trees — only a bit taller than a sheep, like the reference (canopy ~0.1 radius).
  for (const tree of layout.trees) {
    roundTree(m, tree.x, tree.z, hAt(tree.x, tree.z), tree.scale, CANOPY, tree.seed);
  }
  for (const bushSpec of layout.bushes) {
    bush(m, bushSpec.x, bushSpec.z, hAt(bushSpec.x, bushSpec.z), bushSpec.scale, BUSH, bushSpec.seed);
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

// Cache one baked static mesh per (terrain, seed); animated props live in a separate overlay.
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
const DECK_INSET = 0.03; // keep horizontal floors safely inside the narrowing hull shell
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
  // The outer wall narrows linearly from the sheer to the keel at each station. A floor lower
  // in the hull must use the width at that height—not the much wider opening at the rim—or its
  // edge pierces the side wall and renders as a horizontal shelf outside the boat.
  const deckWidth = (i: number, y: number): number => {
    const t = Math.max(0, Math.min(1, (y - ST_BY[i]) / (ST_TY[i] - ST_BY[i])));
    const outerAtY = ST_BW[i] + (ST_TW[i] - ST_BW[i]) * t;
    return Math.max(0.02, Math.min(IW[i], outerAtY - DECK_INSET));
  };
  // Outer side walls (smooth-shaded) + the lip band on top, both sides.
  smoothWall(m, 1);
  smoothWall(m, -1);
  for (let i = 0; i < N - 1; i++) {
    for (const s of [1, -1]) {
      faceQuadFlat(m, v(ST_X[i], ST_TY[i], s * ST_TW[i]), v(ST_X[i + 1], ST_TY[i + 1], s * ST_TW[i + 1]), v(ST_X[i + 1], ST_TY[i + 1], s * IW[i + 1]), v(ST_X[i], ST_TY[i], s * IW[i]), LIP, UP);
    }
  }
  // Stern gunwale: bridge the two side lips with a real fore-aft surface. The former end
  // "lip" varied only in Z, so all four points were collinear and rendered as a paper edge.
  const sternLipT = Math.min(1, LIPW / (ST_X[1] - ST_X[0]));
  const sternLipX = ST_X[0] + (ST_X[1] - ST_X[0]) * sternLipT;
  const sternLipY = ST_TY[0] + (ST_TY[1] - ST_TY[0]) * sternLipT;
  const sternLipW = ST_TW[0] + (ST_TW[1] - ST_TW[0]) * sternLipT;
  faceQuadFlat(
    m,
    v(ST_X[0], ST_TY[0], ST_TW[0]),
    v(sternLipX, sternLipY, sternLipW),
    v(sternLipX, sternLipY, -sternLipW),
    v(ST_X[0], ST_TY[0], -ST_TW[0]),
    LIP,
    UP,
  );
  // Keel underside.
  for (let i = 0; i < N - 1; i++) {
    faceQuadFlat(m, v(ST_X[i], ST_BY[i], ST_BW[i]), v(ST_X[i + 1], ST_BY[i + 1], ST_BW[i + 1]), v(ST_X[i + 1], ST_BY[i + 1], -ST_BW[i + 1]), v(ST_X[i], ST_BY[i], -ST_BW[i]), HULL_DK, DOWN);
  }
  // Bow & stern end caps.
  for (const e of [0, N - 1]) {
    const nx = e === 0 ? -1 : 1;
    faceQuadFlat(m, v(ST_X[e], ST_TY[e], ST_TW[e]), v(ST_X[e], ST_BY[e], ST_BW[e]), v(ST_X[e], ST_BY[e], -ST_BW[e]), v(ST_X[e], ST_TY[e], -ST_TW[e]), HULL, v(nx, 0.25, 0));
  }
  // Helper: a lofted deck floor between two stations at height `y`, plus the short inner
  // bulwark walls from that floor up to the rim on both sides.
  // Inner bulwark walls use the lit DECK tone (not the dark keel color): they face inward/away
  // from the key, so a dark color made them read as a black gouge across the open deck.
  const deckSeg = (i: number, y: number): void => {
    const wi = deckWidth(i, y);
    const wj = deckWidth(i + 1, y);
    faceQuadFlat(m, v(ST_X[i], y, wi), v(ST_X[i + 1], y, wj), v(ST_X[i + 1], y, -wj), v(ST_X[i], y, -wi), DECK, UP);
    for (const s of [1, -1]) {
      faceQuadFlat(m, v(ST_X[i], ST_TY[i], s * IW[i]), v(ST_X[i + 1], ST_TY[i + 1], s * IW[i + 1]), v(ST_X[i + 1], y, s * wj), v(ST_X[i], y, s * wi), DECK, v(0, 0.2, -s));
    }
  };
  // Raised aft deck (poop) from the stern to the step — a solid deck flush inside the hull.
  for (let i = 0; i < STEP; i++) deckSeg(i, AFT_Y);
  // Step riser: the front face of the poop deck, down to the well.
  const stepAftW = deckWidth(STEP, AFT_Y);
  const stepFloorW = deckWidth(STEP, FLOOR_Y);
  faceQuadFlat(m, v(ST_X[STEP], AFT_Y, stepAftW), v(ST_X[STEP], AFT_Y, -stepAftW), v(ST_X[STEP], FLOOR_Y, -stepFloorW), v(ST_X[STEP], FLOOR_Y, stepFloorW), DECK, v(1, 0.2, 0));
  // Open cargo well from the step to the bow.
  for (let i = STEP; i < BOW; i++) deckSeg(i, FLOOR_Y);
  // Bow bulkhead + a small solid foredeck capping the prow (so there's no hole at the tip).
  const bowFloorW = deckWidth(BOW, FLOOR_Y);
  faceQuadFlat(m, v(ST_X[BOW], ST_TY[BOW], IW[BOW]), v(ST_X[BOW], ST_TY[BOW], -IW[BOW]), v(ST_X[BOW], FLOOR_Y, -bowFloorW), v(ST_X[BOW], FLOOR_Y, bowFloorW), DECK, v(-1, 0.2, 0));
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

// An octagonal capped log between arbitrary 3D endpoints. The ordinary `logBeam` rests
// horizontally on a surface; this variant lets a felled tree pitch upward as it leans across
// other cargo while keeping its trunk exactly aligned with the foliage axis.
function logBeamAxis(m: Build, start: Vec3, end: Vec3, r: number, side: RGB, cap: RGB): void {
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
// A felled version of the forest tile's pine: the same broad, stepped three-skirt silhouette,
// rotated onto its side. One continuous capped trunk runs through the foliage, with only the cut
// end exposed behind the widest skirt; the far end stops short of the leafy tip.
function felledPine(m: Build, cx: number, cz: number, y0: number, ry: number, pitch: number, scale: number, green: RGB, seed: number): void {
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

// ── Sheaves (the grain port's cargo) ────────────────────────────────────────
// A sheaf is a bundle of cut stalks corded at the waist, so it flares at both ends and pinches
// in the middle — the bowtie silhouette of the physical wheat token. Built around an arbitrary
// axis so bundles can lie on their sides at any angle, the way a load settles in a hold.
const STRAW: RGB = [226, 184, 84]; // stalk sides
const STRAW_CUT: RGB = [242, 216, 152]; // the packed disc of cut ends at the butt
const STRAW_HEAD: RGB = [208, 156, 66]; // the grain end, browner than the straw
const TWINE: RGB = [124, 84, 46]; // the cord — dark enough to draw the waist as a line

// Bundle radius at `t` along its length (0 = butt, 1 = grain end). The exponent makes the flare
// concave: stalks splay quickly near the ends and stay gathered through the tie.
const sheafRadius = (t: number, waist: number, end: number): number => waist + (end - waist) * Math.abs(2 * t - 1) ** 2;

function wheatBundle(m: Build, cx: number, cy: number, cz: number, yaw: number, pitch: number, len: number, endR: number, seed: number): void {
  const rng = mulberry32(seed | 0 || 1);
  const cp = Math.cos(pitch);
  const axis = norm(v(Math.cos(yaw) * cp, Math.sin(pitch), Math.sin(yaw) * cp));
  const ref: Vec3 = Math.abs(axis.y) > 0.9 ? v(1, 0, 0) : UP;
  const u = norm(cross(axis, ref));
  const w = norm(cross(axis, u));
  const waist = endR * 0.42;
  const STALKS = 12;
  const SEGS = 4;
  // A point `t` along the axis, `ang` around it, `r` out from it, slid `tan` across (tangentially)
  // — enough to lay a narrow ribbon along each stalk.
  const at = (t: number, ang: number, r: number, tan = 0): Vec3 => {
    const d = (t - 0.5) * len;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const ru = ca * r - sa * tan;
    const rw = sa * r + ca * tan;
    return v(cx + axis.x * d + u.x * ru + w.x * rw, cy + axis.y * d + u.y * ru + w.y * rw, cz + axis.z * d + u.z * ru + w.z * rw);
  };
  const radial = (ang: number): Vec3 => norm(v(u.x * Math.cos(ang) + w.x * Math.sin(ang), u.y * Math.cos(ang) + w.y * Math.sin(ang), u.z * Math.cos(ang) + w.z * Math.sin(ang)));

  // Whole-bundle tint, so a stack doesn't read as one repeated object.
  const tint = 0.93 + rng() * 0.15;
  // Each stalk is its own ribbon, lit from its own radial normal, so the bundle reads as ribbed
  // straw instead of one smooth spindle. Per-stalk flare keeps the flared ends off-round, and
  // each ribbon overruns the cap by its own margin so the cut ends bristle instead of lining up
  // on a machined plane.
  for (let i = 0; i < STALKS; i++) {
    const ang = (Math.PI * 2 * i) / STALKS + (rng() - 0.5) * 0.14;
    const flare = 0.88 + rng() * 0.24;
    const tone = shade(STRAW, tint * (0.84 + rng() * 0.28));
    const n = radial(ang);
    const from = -rng() * 0.055;
    const span = 1 - from + rng() * 0.06;
    for (let s = 0; s < SEGS; s++) {
      const t0 = from + (span * s) / SEGS;
      const t1 = from + (span * (s + 1)) / SEGS;
      const r0 = sheafRadius(t0, waist, endR) * flare;
      const r1 = sheafRadius(t1, waist, endR) * flare;
      // Ribbons cover most of the spacing between stalks, so the bundle stays solid where it
      // splays and the leftover seams read as ribs rather than gaps into a hollow shell.
      const hw0 = ((Math.PI * r0) / STALKS) * 0.88;
      const hw1 = ((Math.PI * r1) / STALKS) * 0.88;
      faceQuadFlat(m, at(t0, ang, r0, -hw0), at(t0, ang, r0, hw0), at(t1, ang, r1, hw1), at(t1, ang, r1, -hw1), tone, n);
    }
  }

  // Both ends are capped so the bundle isn't hollow seen end-on: a nearly flat pale disc of cut
  // stalks at the butt, a blunt dome of grain at the far end. Normals lean out from the axis
  // toward the rim so the grain end rounds off instead of reading as one flat plate. Each rim
  // point also rides in or out along the axis, which breaks the disc off a clean plane; the
  // points are shared between neighbouring wedges so that jitter can't tear it open.
  for (const end of [0, 1]) {
    const sides = 12;
    const rEnd = sheafRadius(end, waist, endR);
    const out = end === 0 ? -1 : 1;
    const rim = Array.from({ length: sides }, (_, i) => {
      const p = at(end, (Math.PI * 2 * i) / sides, rEnd * (0.88 + rng() * 0.18));
      const lift = out * rEnd * (rng() - 0.45) * 0.34;
      return v(p.x + axis.x * lift, p.y + axis.y * lift, p.z + axis.z * lift);
    });
    const bulge = rEnd * (end === 0 ? 0.08 : 0.2) * out;
    const c = at(end, 0, 0);
    const hub = v(c.x + axis.x * bulge, c.y + axis.y * bulge, c.z + axis.z * bulge);
    const base = end === 0 ? STRAW_CUT : STRAW_HEAD;
    for (let i = 0; i < sides; i++) {
      const rad = radial((Math.PI * 2 * (i + 0.5)) / sides);
      const n = norm(v(axis.x * out * 0.85 + rad.x * 0.55, axis.y * out * 0.85 + rad.y * 0.55, axis.z * out * 0.85 + rad.z * 0.55));
      faceTriWithNormal(m, hub, rim[i], rim[(i + 1) % sides], shade(base, tint * (0.9 + rng() * 0.2)), n);
    }
  }

  // The cord: two wraps cinching the waist, standing clear of the pinched stalks so the dark
  // band draws a line across the bundle at the size this is actually seen.
  const bandR = waist * 1.3;
  for (const bt of [0.42, 0.58]) {
    const sides = 10;
    for (let i = 0; i < sides; i++) {
      const a0 = (Math.PI * 2 * i) / sides;
      const a1 = (Math.PI * 2 * (i + 1)) / sides;
      faceQuadFlat(m, at(bt - 0.05, a0, bandR), at(bt + 0.05, a0, bandR), at(bt + 0.05, a1, bandR), at(bt - 0.05, a1, bandR), shade(TWINE, 0.88 + (i % 2) * 0.22), radial((a0 + a1) / 2));
    }
  }
}

// Cargo for a 2:1 port: a large load of that resource filling the open bow deck ahead of the
// mast (the generic 3:1 ship carries nothing). Sized to the reference — the load nearly fills
// the deck.
function boatCargo(m: Build, kind: PortKind, seed: number): void {
  const y = FLOOR_Y;
  if (kind === 'grain') {
    // Sheaves pitched into the well: four laid across the floor, two more settled into the seams
    // between them, each at its own angle. `rest` sits a bundle's flared ends on what's below it —
    // the second layer rides a seam, so it clears the floor by less than a full bundle width.
    // Lengths and offsets keep each bundle's flared ends inside the well floor, which narrows
    // sharply toward the bow — overrun the floor and an end pokes out through the planking.
    const rest = (endR: number, on = 0): number => y + on + endR * 0.92;
    wheatBundle(m, -0.12, rest(0.086), 0.02, 1.18, 0.03, 0.28, 0.086, seed + 1);
    wheatBundle(m, 0.05, rest(0.098), -0.07, 1.48, 0.02, 0.33, 0.098, seed + 5);
    wheatBundle(m, 0.24, rest(0.096), 0.04, 1.66, -0.02, 0.31, 0.096, seed + 9);
    wheatBundle(m, 0.42, rest(0.078), -0.02, 0.92, 0.04, 0.24, 0.078, seed + 13);
    wheatBundle(m, 0.13, rest(0.09, 0.112), 0.02, 0.26, 0.06, 0.32, 0.09, seed + 17);
    wheatBundle(m, 0.34, rest(0.082, 0.1), -0.03, -0.34, -0.05, 0.28, 0.082, seed + 21);
  } else if (kind === 'ore') {
    const GREY: RGB = [150, 154, 164];
    angularRock(m, -0.02, 0.08, y, 0.16, 0.23, 0.13, GREY, seed, 'slab', 0.1);
    angularRock(m, 0.15, -0.08, y, 0.17, 0.25, 0.14, shade(GREY, 0.93), seed + 3, 'crag', -0.18);
    angularRock(m, 0.32, 0.04, y, 0.13, 0.18, 0.1, shade(GREY, 1.05), seed + 6, 'wedge', 0.32);
    angularRock(m, 0.16, 0.11, y, 0.095, 0.15, 0.08, shade(GREY, 0.98), seed + 9, 'wedge', -0.4);
    angularRock(m, 0.09, 0.0, y + 0.09, 0.11, 0.16, 0.09, shade(GREY, 1.08), seed + 12, 'crag', 0.22);
  } else if (kind === 'lumber') {
    felledPine(m, -0.07, -0.135, y, -0.22, 0.05, 0.94, PINE_GREENS[0], seed);
    felledPine(m, 0.01, 0.135, y + 0.01, 0.32, 0.08, 0.88, PINE_GREENS[1], seed + 3);
    felledPine(m, 0.04, -0.02, y + 0.14, 1.0, 0.2, 0.9, PINE_GREENS[2], seed + 6);
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

// Small time-varying overlays for the two animated terrain types. The terrain, wheat canopy,
// vegetation, and tile slab stay in tileMesh's cache; only blades and sheep are rebuilt.
export function animatedTileMesh(terrain: Terrain, seed = 0, time = 0): Mesh | null {
  const t = Number.isFinite(time) ? time : 0;
  if (terrain === 'fields') return animatedFieldsTile(seed, t);
  if (terrain === 'pasture') return animatedPastureTile(seed, t);
  return null;
}
