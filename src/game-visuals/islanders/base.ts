// The shared thin, flat-top hexagon slab every terrain sits on: a short side wall, a thin flat
// rim ledge, and a gently-undulating triangulated ground. Terrain height is a pure function of
// (x,z) so independently-built sectors meet seamlessly and props can be sat exactly on it.

import type { Vec3 } from '../../engine/math.ts';
import type { Mesh } from '../../engine/mesh.ts';
import { build, type Build, DOWN, faceQuad, faceQuadFlat, faceTri, hash2, norm, type RGB, shade, smooth, UP, v } from './build.ts';

// ── Shared thin, flat-top base ────────────────────────────────────────────────

const R_OUT = 1.0; // outer edge of the wooden wall
export const R_RIM = 0.92; // inner edge of the thin flat rim ledge (ledge width 0.08)
export const EDGE_Y = 0.03; // terrain edge sits a hair proud of the rim ledge (small step, no indent)
export const WALL = 0.16; // short side wall below the rim

// Flat-top hexagon corners (flat edges top/bottom, points left/right).
export function hexCorners(r: number, y: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    out.push(v(r * Math.cos(a), y, r * Math.sin(a)));
  }
  return out;
}

// A warm buff ledge, close to the dry beach but a little browner so the island still has a
// readable tile lattice. The side wall stays one value step darker to preserve the slab depth
// without turning the space between neighboring hexes into dark gray seams.
const FRAME_TOP: RGB = [218, 190, 137];
const FRAME_SIDE: RGB = [174, 143, 99];

// Clamp a point to inside the flat-top hexagon of circumradius R (vertices at 0°,60°,…, edge
// normals at 30°,90°,…). Points outside are pulled radially onto the nearest edge — so an
// oversized pad gets "cut off" by the tile boundary instead of poking past the rim.
export function clampToHex(x: number, z: number, R: number): { x: number; z: number } {
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
export function surfaceY(x: number, z: number, amp: number, seed: number): number {
  return groundNoise(x, z, amp, seed);
}

interface GroundOpts {
  color: RGB;
  amp: number;
  seed: number;
  facet?: number;
}

/**
 * Seal a raised terrain surface to the shared flat rim.
 *
 * Height falloff is radial while the tile boundary is hexagonal, so the middle
 * of a flat side can remain above EDGE_Y even though every corner lands on it.
 * One quad per existing boundary segment closes that otherwise visible slit
 * without adding vertices to the terrain interior.
 */
export function terrainPerimeterSkirt(
  m: Build,
  heightAt: (x: number, z: number) => number,
  color: RGB,
  segments: number,
): void {
  const corners = hexCorners(R_RIM, EDGE_Y);
  const sideColor = shade(color, 0.82);
  for (let side = 0; side < 6; side++) {
    const a = corners[side];
    const b = corners[(side + 1) % 6];
    const outward = norm(v(a.x + b.x, 0, a.z + b.z));
    for (let segment = 0; segment < segments; segment++) {
      const t0 = segment / segments;
      const t1 = (segment + 1) / segments;
      const x0 = a.x + (b.x - a.x) * t0;
      const z0 = a.z + (b.z - a.z) * t0;
      const x1 = a.x + (b.x - a.x) * t1;
      const z1 = a.z + (b.z - a.z) * t1;
      const top0 = v(x0, Math.max(EDGE_Y, heightAt(x0, z0)), z0);
      const top1 = v(x1, Math.max(EDGE_Y, heightAt(x1, z1)), z1);
      if (top0.y <= EDGE_Y + 1e-6 && top1.y <= EDGE_Y + 1e-6) continue;
      faceQuad(m, top0, top1, v(x1, EDGE_Y, z1), v(x0, EDGE_Y, z0), sideColor, outward);
    }
  }
}

// The thin proud lip (terrain edge → rim ledge), the flat rim ledge, and the short outer
// wall. Shared by every tile's base; the terrain surface above it is per-tile.
export function rimAndWall(m: Build, fieldColor: RGB): void {
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
export function irregularGround(m: Build, o: GroundOpts & { M?: number }): void {
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
  terrainPerimeterSkirt(m, (x, z) => groundNoise(x, z, o.amp, o.seed), o.color, M);
}

// A whole tile base: the irregular low-poly terrain + the rim/wall. (Used by tiles not yet
// individually rebuilt.)
export function tileBase(m: Build, o: GroundOpts): void {
  irregularGround(m, o);
  rimAndWall(m, o.color);
}

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
