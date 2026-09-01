// The poker table + chair 3D props (OBJ). Loaded once, recolored (felt green, wood
// dark brown), scaled into the card world, and placed so the FELT sits at y=0 —
// exactly where the cards already lie, so the deck / hand / dealt cards rest on the
// surface. Chairs are placed around the rail facing the table center.
//
// Geometry facts (from src/tools measurement of the bundled OBJs):
//   table  — Y-up, footprint radius ~34.8, height 0..27; the felt is the big flat
//            up-facing plane at y≈26 (the rail top is a thin ring at ~27).
//   chair  — Y-up, ~5.3w × 10.2h × 5.8d; backrest at −z, so it FACES +z; the OBJ's
//            many `polySurface` groups are flattened into one mesh by parseObj.

import { readFileSync } from 'node:fs';
import { flatShade, type Mat4, mat4Multiply, mat4RotY, mat4Scale, mat4Translate, type Mesh, parseObj, type Vec3 } from '../../../engine/index.ts';
import { asset } from '../../assets.ts';
import { POKER_FELT_GREEN as FELT_GREEN, POKER_FELT_STIPPLE as FELT_STIPPLE, POKER_WOOD_BROWN as WOOD_BROWN } from '../../../game-visuals/poker/table.ts';

// A very dark green felt: flat and uniformly lit, its base brightness is low
// enough that the shape-glyph presenter matches it to blank cells (no card-border
// shimmer), so the surface reads as a calm near-black green. The felt is drawn
// with `feltMaterial`, which scatters a sparse, surface-locked stipple of faint
// brighter-green flecks over it — occasional cells catch a fleck and resolve to a
// low-coverage glyph ('.'/','/'o'), giving the felt texture without the shimmer.
// (It used to be pure black precisely because a flat green shape-matched to
// blanks; the stipple is what makes the green legible.) The brown rail frames the
// oval; it's a separate mesh drawn with plain lambert (no stipple).

// Stipple config for the felt's `feltMaterial` (see engine/materials.ts): a sparse
// scatter of faint brighter-green flecks, keyed to the table's OBJECT space (felt
// radius ~34.8) so the dots stay fixed to the surface as the overview orbits.
// Tuned so a handful of cells catch a fleck and resolve to a low-coverage glyph.
// Exported so every scene drawing this table shares one felt texture; spread it
// into feltMaterial's uniforms alongside the scene's own lightDir/ambient.
export { FELT_STIPPLE };

// Table local-space landmarks (see header) and the scale that maps it into the
// card world. Cards are ~1.0×1.4; scaling the ~34.8-radius table by 0.16 gives a
// ~5.57-unit outer radius — a felt that comfortably holds the deck + a deal ring.
const TABLE_FELT_Y = 26;
const TABLE_OUTER = 34.8;
const TABLE_SCALE = 0.16; // ~5.6-unit felt: room for the deck, the board, and up to 6 seats' hole cards
export const TABLE_RADIUS = TABLE_OUTER * TABLE_SCALE; // world outer radius (~5.57)
export const FLOOR_Y = -TABLE_FELT_Y * TABLE_SCALE; // felt dropped to y=0 → floor/base sits here (~−4.16)

// Scale the table, then drop it so the felt plane lands on y=0.
export const TABLE_MODEL: Mat4 = mat4Multiply(mat4Translate(0, -TABLE_FELT_Y * TABLE_SCALE, 0), mat4Scale(TABLE_SCALE, TABLE_SCALE, TABLE_SCALE));

// The felt plane and the frame (rail/apron/legs) are split into two meshes that
// SHARE one vertex array (disjoint index lists) so they can take different
// materials: the felt gets `feltMaterial` (stipple), the frame plain lambert.
let feltCache: Mesh | null = null;
let frameCache: Mesh | null = null;
function buildTable(): void {
  const m = flatShade(parseObj(readFileSync(asset('poker/poker-table.obj'), 'utf8')));
  const v = m.vertices;
  const feltIdx: number[] = [];
  const frameIdx: number[] = [];
  // Per triangle: the flat, up-facing plane near y≈26 is the felt (green); every
  // other face (rail, apron, legs) is the frame (dark brown).
  for (let i = 0; i < m.indices.length; i += 3) {
    const i0 = m.indices[i];
    const i1 = m.indices[i + 1];
    const i2 = m.indices[i + 2];
    const a = v[i0];
    const b = v[i1];
    const c = v[i2];
    const yc = (a.position.y + b.position.y + c.position.y) / 3;
    const isFelt = a.normal.y > 0.85 && yc > 25.5 && yc < 26.5;
    const col = isFelt ? FELT_GREEN : WOOD_BROWN;
    a.color = { ...col };
    b.color = { ...col };
    c.color = { ...col };
    (isFelt ? feltIdx : frameIdx).push(i0, i1, i2);
  }
  feltCache = { vertices: v, indices: feltIdx };
  frameCache = { vertices: v, indices: frameIdx };
}
export function feltMesh(): Mesh {
  if (!feltCache) buildTable();
  return feltCache!;
}
export function frameMesh(): Mesh {
  if (!frameCache) buildTable();
  return frameCache!;
}

// Scaled so the tall backrest (local y up to ~9.7) clears the felt: with the base on
// the floor (~y=−4.16) the backrest top lands at ~+0.9 — visibly above the table edge
// — while the seat (local y≈3.7) tucks to ~−2.3, under the felt. This makes the
// furniture read at a believable ratio against the enlarged table rather than the old
// 0.33, where the whole chair (backrest included) sat below the surface.
const CHAIR_SCALE = 0.5;
const CHAIR_MIN_Y = -0.47; // chair local min y (so its base can be set on the floor)

let chairCache: Mesh | null = null;
export function chairMesh(): Mesh {
  if (chairCache) return chairCache;
  const m = flatShade(parseObj(readFileSync(asset('poker/chair.obj'), 'utf8')));
  for (const vt of m.vertices) vt.color = { ...WOOD_BROWN };
  chairCache = m;
  return m;
}

// A chair at seat angle `a` (0 = +z, the front / hero seat), placed just outside
// the rail with its base on the floor and rotated to FACE the table center. The
// chair model faces +z, so rotating by a+π turns its facing toward the origin.
export function chairModel(a: number, radius = TABLE_RADIUS + 0.5): Mat4 {
  const px = Math.sin(a) * radius;
  const pz = Math.cos(a) * radius;
  const py = FLOOR_Y - CHAIR_MIN_Y * CHAIR_SCALE; // base rests on the floor
  return mat4Multiply(
    mat4Translate(px, py, pz),
    mat4Multiply(mat4RotY(a + Math.PI), mat4Scale(CHAIR_SCALE, CHAIR_SCALE, CHAIR_SCALE)),
  );
}
