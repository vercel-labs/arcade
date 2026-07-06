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

// TEMP: felt painted pure black so the ASCII (shape-glyph) present path draws no
// glyphs on it — a calm, characterless surface that stops the shimmer around the
// card borders. The brown rail still frames the oval so it reads as a table. Swap
// back to a (muted) green like { x: 30, y: 110, z: 64 } to restore the felt.
const FELT_GREEN: Vec3 = { x: 0, y: 0, z: 0 };
const WOOD_BROWN: Vec3 = { x: 132, y: 88, z: 52 };

// Table local-space landmarks (see header) and the scale that maps it into the
// card world. Cards are ~1.0×1.4; scaling the ~34.8-radius table by 0.13 gives a
// ~4.5-unit outer radius — a felt that comfortably holds the deck + a deal ring.
const TABLE_FELT_Y = 26;
const TABLE_OUTER = 34.8;
const TABLE_SCALE = 0.16; // ~5.6-unit felt: room for the deck, the board, and up to 6 seats' hole cards
export const TABLE_RADIUS = TABLE_OUTER * TABLE_SCALE; // world outer radius (~4.52)
export const FLOOR_Y = -TABLE_FELT_Y * TABLE_SCALE; // felt dropped to y=0 → floor/base sits here (~−3.38)

// Scale the table, then drop it so the felt plane lands on y=0.
export const TABLE_MODEL: Mat4 = mat4Multiply(mat4Translate(0, -TABLE_FELT_Y * TABLE_SCALE, 0), mat4Scale(TABLE_SCALE, TABLE_SCALE, TABLE_SCALE));

let tableCache: Mesh | null = null;
export function tableMesh(): Mesh {
  if (tableCache) return tableCache;
  const m = flatShade(parseObj(readFileSync('public/assets/poker/poker-table.obj', 'utf8')));
  // Color per triangle: the flat, up-facing felt plane (near y≈26) green; every
  // other face (rail, apron, legs) dark brown.
  const v = m.vertices;
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = v[m.indices[i]];
    const b = v[m.indices[i + 1]];
    const c = v[m.indices[i + 2]];
    const yc = (a.position.y + b.position.y + c.position.y) / 3;
    const isFelt = a.normal.y > 0.85 && yc > 25.5 && yc < 26.5;
    const col = isFelt ? FELT_GREEN : WOOD_BROWN;
    a.color = { ...col };
    b.color = { ...col };
    c.color = { ...col };
  }
  tableCache = m;
  return m;
}

const CHAIR_SCALE = 0.33;
const CHAIR_MIN_Y = -0.47; // chair local min y (so its base can be set on the floor)

let chairCache: Mesh | null = null;
export function chairMesh(): Mesh {
  if (chairCache) return chairCache;
  const m = flatShade(parseObj(readFileSync('public/assets/poker/chair.obj', 'utf8')));
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
