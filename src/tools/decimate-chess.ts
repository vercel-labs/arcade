// Decimate the chess piece OBJs via vertex clustering and write the reduced
// meshes to a new folder. ASCII rendering destroys fine detail, so the full
// ~10–18k-triangle pieces are wild overkill; clustering cuts that by ~10× with
// no visible difference at terminal resolution, making a full 32-piece board
// fast. Originals are left untouched.
//
//   pnpm exec tsx src/tools/decimate-chess.ts [grid]
//
// `grid` = number of cells along the piece's longest axis (default 56). Higher
// = more detail, more triangles.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { meshBounds, type Mesh, parseObj } from '../engine/index.ts';

const SRC_DIR = 'public/assets/chess';
const OUT_DIR = 'public/assets/chess_decimated';
const NAMES = ['pawn', 'queen', 'bishop', 'rook', 'king', 'knight'];
const GRID = Number(process.argv[2]) || 56;

interface P3 {
  x: number;
  y: number;
  z: number;
}

// Collapse vertices that share a grid cell into one averaged vertex, then keep
// only the non-degenerate, unique triangles that survive the remap.
function cluster(mesh: Mesh, grid: number): { positions: P3[]; tris: [number, number, number][] } {
  const b = meshBounds(mesh);
  const ext = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
  const cell = ext / grid || 1; // cubic cells preserve proportions
  const cellKey = (p: P3): string =>
    `${Math.floor((p.x - b.min.x) / cell)},${Math.floor((p.y - b.min.y) / cell)},${Math.floor((p.z - b.min.z) / cell)}`;

  // Each original vertex → its cell; accumulate cell centroid + assign a new index.
  const acc = new Map<string, { sx: number; sy: number; sz: number; n: number; idx: number }>();
  const vertCell = mesh.vertices.map((v) => cellKey(v.position));
  mesh.vertices.forEach((v, i) => {
    let c = acc.get(vertCell[i]);
    if (!c) {
      c = { sx: 0, sy: 0, sz: 0, n: 0, idx: -1 };
      acc.set(vertCell[i], c);
    }
    c.sx += v.position.x;
    c.sy += v.position.y;
    c.sz += v.position.z;
    c.n++;
  });
  const positions: P3[] = [];
  for (const c of acc.values()) {
    c.idx = positions.length;
    positions.push({ x: c.sx / c.n, y: c.sy / c.n, z: c.sz / c.n });
  }

  const tris: [number, number, number][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = acc.get(vertCell[mesh.indices[i]])!.idx;
    const b2 = acc.get(vertCell[mesh.indices[i + 1]])!.idx;
    const c2 = acc.get(vertCell[mesh.indices[i + 2]])!.idx;
    if (a === b2 || b2 === c2 || a === c2) continue; // collapsed to a line/point
    const key = [a, b2, c2].sort((x, y) => x - y).join(','); // unordered: drop duplicate faces
    if (seen.has(key)) continue;
    seen.add(key);
    tris.push([a, b2, c2]);
  }
  return { positions, tris };
}

mkdirSync(OUT_DIR, { recursive: true });
let beforeTotal = 0;
let afterTotal = 0;
for (const name of NAMES) {
  const mesh = parseObj(readFileSync(`${SRC_DIR}/${name}.obj`, 'utf8'));
  const before = mesh.indices.length / 3;
  const { positions, tris } = cluster(mesh, GRID);
  beforeTotal += before;
  afterTotal += tris.length;

  let out = `# ${name} — decimated (vertex clustering, grid ${GRID}) from ${SRC_DIR}/${name}.obj\n`;
  for (const p of positions) out += `v ${p.x.toFixed(6)} ${p.y.toFixed(6)} ${p.z.toFixed(6)}\n`;
  for (const t of tris) out += `f ${t[0] + 1} ${t[1] + 1} ${t[2] + 1}\n`;
  writeFileSync(`${OUT_DIR}/${name}.obj`, out);
  console.log(`${name.padEnd(7)} ${String(before).padStart(6)} -> ${String(tris.length).padStart(5)} tris  (${((1 - tris.length / before) * 100).toFixed(0)}% fewer)`);
}
console.log(`total   ${beforeTotal} -> ${afterTotal} tris  (${((1 - afterTotal / beforeTotal) * 100).toFixed(0)}% fewer)  → ${OUT_DIR}`);
