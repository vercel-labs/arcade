// One-off: slice a combined chess OBJ (all pieces in one file, arranged in a row)
// into per-piece OBJs. Parses `o`/`g` objects, clusters them by position along
// the layout axis into 6 groups, re-indexes each group's geometry, recenters it
// (centered horizontally, base grounded), and writes one OBJ per piece.
//
//   pnpm exec tsx src/tools/slice-chess.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SRC = 'public/assets/chess_pieces.obj';
const OUT_DIR = 'public/assets/chess';
// Left-to-right order the user reported:
const NAMES = ['pawn', 'queen', 'bishop', 'rook', 'king', 'knight'];

type Vec3 = [number, number, number];
type FaceVert = [number, number, number]; // v, vt, vn (1-based global; 0 = absent)

const V: Vec3[] = [];
const VT: number[][] = [];
const VN: Vec3[] = [];
const objs: { name: string; faces: FaceVert[][] }[] = [];
let cur: (typeof objs)[number] | null = null;

const fix = (i: number, len: number) => (i < 0 ? len + 1 + i : i); // handle negative (relative) indices

for (const line of readFileSync(SRC, 'utf8').split('\n')) {
  if (line.startsWith('v ')) {
    const p = line.split(/\s+/);
    V.push([+p[1], +p[2], +p[3]]);
  } else if (line.startsWith('vn ')) {
    const p = line.split(/\s+/);
    VN.push([+p[1], +p[2], +p[3]]);
  } else if (line.startsWith('vt ')) {
    const p = line.split(/\s+/);
    VT.push([+p[1], +(p[2] ?? 0)]);
  } else if (line.startsWith('o ') || line.startsWith('g ')) {
    cur = { name: line.slice(2).trim(), faces: [] };
    objs.push(cur);
  } else if (line.startsWith('f ')) {
    if (!cur) {
      cur = { name: 'default', faces: [] };
      objs.push(cur);
    }
    const verts = line
      .trim()
      .split(/\s+/)
      .slice(1)
      .map((tok): FaceVert => {
        const a = tok.split('/');
        return [fix(parseInt(a[0], 10), V.length), a[1] ? fix(parseInt(a[1], 10), VT.length) : 0, a[2] ? fix(parseInt(a[2], 10), VN.length) : 0];
      });
    for (let i = 2; i < verts.length; i++) cur.faces.push([verts[0], verts[i - 1], verts[i]]); // fan-triangulate
  }
}

function objCentroid(o: (typeof objs)[number]): Vec3 {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  const seen = new Set<number>();
  for (const f of o.faces)
    for (const [vi] of f)
      if (!seen.has(vi)) {
        seen.add(vi);
        const v = V[vi - 1];
        sx += v[0];
        sy += v[1];
        sz += v[2];
        n++;
      }
  return [sx / n, sy / n, sz / n];
}

const entries = objs.filter((o) => o.faces.length).map((o) => ({ o, c: objCentroid(o) }));
const range = (ax: number) => {
  const xs = entries.map((e) => e.c[ax]);
  return Math.max(...xs) - Math.min(...xs);
};
const layout = [0, 1, 2].reduce((b, a) => (range(a) > range(b) ? a : b), 0);
const others = [0, 1, 2].filter((a) => a !== layout);
const globalRange = (ax: number) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of V) {
    lo = Math.min(lo, v[ax]);
    hi = Math.max(hi, v[ax]);
  }
  return hi - lo;
};
const up = globalRange(others[0]) > globalRange(others[1]) ? others[0] : others[1];
const depth = others[0] === up ? others[1] : others[0];
console.log(`layout axis: ${'xyz'[layout]}, up axis: ${'xyz'[up]}, depth axis: ${'xyz'[depth]}`);

entries.sort((a, b) => a.c[layout] - b.c[layout]);
const gaps = entries.slice(1).map((e, i) => ({ at: i + 1, g: e.c[layout] - entries[i].c[layout] }));
gaps.sort((a, b) => b.g - a.g);
const cuts = new Set(gaps.slice(0, NAMES.length - 1).map((g) => g.at));
const clusters: (typeof entries)[] = [[]];
entries.forEach((e, i) => {
  if (cuts.has(i)) clusters.push([]);
  clusters[clusters.length - 1].push(e);
});

mkdirSync(OUT_DIR, { recursive: true });
clusters.forEach((cl, idx) => {
  const name = NAMES[idx] ?? `piece${idx}`;
  const faces = cl.flatMap((e) => e.o.faces);
  const vMap = new Map<number, number>();
  const vtMap = new Map<number, number>();
  const vnMap = new Map<number, number>();
  const vOut: Vec3[] = [];
  const vtOut: number[][] = [];
  const vnOut: Vec3[] = [];
  const remap = (i: number, map: Map<number, number>, src: (number[] | Vec3)[], out: (number[] | Vec3)[]) => {
    if (i === 0) return 0;
    let m = map.get(i);
    if (m === undefined) {
      m = out.length + 1;
      map.set(i, m);
      out.push(src[i - 1]);
    }
    return m;
  };
  const newFaces = faces.map((f) =>
    f.map(([vi, ti, ni]): FaceVert => [remap(vi, vMap, V, vOut), remap(ti, vtMap, VT, vtOut), remap(ni, vnMap, VN, vnOut)]),
  );
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const v of vOut)
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], v[a]);
      hi[a] = Math.max(hi[a], v[a]);
    }
  const off = [0, 0, 0];
  off[layout] = (lo[layout] + hi[layout]) / 2;
  off[depth] = (lo[depth] + hi[depth]) / 2;
  off[up] = lo[up]; // ground the base

  let out = `# ${name} — sliced from ${SRC} (up axis: ${'xyz'[up]})\n`;
  for (const v of vOut) out += `v ${(v[0] - off[0]).toFixed(6)} ${(v[1] - off[1]).toFixed(6)} ${(v[2] - off[2]).toFixed(6)}\n`;
  for (const t of vtOut) out += `vt ${t[0]} ${t[1] ?? 0}\n`;
  for (const n of vnOut) out += `vn ${n[0]} ${n[1]} ${n[2]}\n`;
  for (const f of newFaces)
    out += 'f ' + f.map(([v, t, n]) => (n ? (t ? `${v}/${t}/${n}` : `${v}//${n}`) : `${v}`)).join(' ') + '\n';
  writeFileSync(`${OUT_DIR}/${name}.obj`, out);
  console.log(
    `${name.padEnd(7)} objs=${cl.length} v=${vOut.length} f=${newFaces.length} height=${(hi[up] - lo[up]).toFixed(2)} layoutPos=${cl[0].c[layout].toFixed(2)}`,
  );
});
