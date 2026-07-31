// Player colours and the buildable pieces — roads, settlements, cities — plus the board
// editor overlay that draws placed pieces and the hover ghost.

import { type Mesh, type Vec3 } from '../../../../engine/index.ts';
import { type PlayerColor } from '../../../../rules/catan/types.ts';
import { EDGE_Y } from './base.ts';
import { build, type Build, faceQuad, faceTri, norm, type RGB, sub, v } from './build.ts';
import { box } from './props.ts';

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

