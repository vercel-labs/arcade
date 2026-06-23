import { cross3, normalize3, sub3, type Vec3 } from './math.ts';
import type { Mesh } from './mesh.ts';
import type { VertexIn } from './shader.ts';

export interface ParseObjOptions {
  /** Base per-vertex color (0..255). Defaults to a neutral ivory. */
  color?: Vec3;
}

// Parses Wavefront OBJ text into a Mesh. Handles `v`/`vn`/`vt`/`f`, n-gon faces
// (fan-triangulated), shared and negative (relative) indices, and faces that omit
// texcoords (`v//vn`). Unique `v/vt/vn` triples are deduped into one vertex each.
// If the file carries no normals, smooth normals are computed from face geometry.
export function parseObj(text: string, opts: ParseObjOptions = {}): Mesh {
  const color = opts.color ?? { x: 225, y: 222, z: 215 };
  const pos: Vec3[] = [];
  const nrm: Vec3[] = [];
  const uvs: [number, number][] = [];
  const vertices: VertexIn[] = [];
  const indices: number[] = [];
  const cache = new Map<string, number>();

  // Resolve an OBJ index: 1-based positive, or negative relative to the end.
  const resolve = (raw: number, len: number): number => (raw < 0 ? len + raw : raw - 1);

  const vertexFor = (key: string, pi: number, ti: number, ni: number): number => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const idx = vertices.length;
    vertices.push({
      position: pos[pi],
      normal: ni >= 0 ? nrm[ni] : { x: 0, y: 0, z: 0 },
      uv: ti >= 0 ? uvs[ti] : [0, 0],
      color,
    });
    cache.set(key, idx);
    return idx;
  };

  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      pos.push({ x: +p[1], y: +p[2], z: +p[3] });
    } else if (line.startsWith('vn ')) {
      const p = line.split(/\s+/);
      nrm.push({ x: +p[1], y: +p[2], z: +p[3] });
    } else if (line.startsWith('vt ')) {
      const p = line.split(/\s+/);
      uvs.push([+p[1], +(p[2] ?? 0)]);
    } else if (line.startsWith('f ')) {
      const toks = line.trim().split(/\s+/).slice(1);
      const ring = toks.map((tok) => {
        const a = tok.split('/');
        const pi = resolve(parseInt(a[0], 10), pos.length);
        const ti = a[1] ? resolve(parseInt(a[1], 10), uvs.length) : -1;
        const ni = a[2] ? resolve(parseInt(a[2], 10), nrm.length) : -1;
        return vertexFor(tok, pi, ti, ni);
      });
      for (let i = 2; i < ring.length; i++) indices.push(ring[0], ring[i - 1], ring[i]);
    }
  }

  if (nrm.length === 0) computeSmoothNormals(vertices, indices);
  return { vertices, indices };
}

// Area-weighted smooth normals (fallback when the OBJ has no `vn` data).
function computeSmoothNormals(vertices: VertexIn[], indices: number[]): void {
  for (const v of vertices) v.normal = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < indices.length; i += 3) {
    const a = vertices[indices[i]];
    const b = vertices[indices[i + 1]];
    const c = vertices[indices[i + 2]];
    const fn = cross3(sub3(b.position, a.position), sub3(c.position, a.position));
    for (const v of [a, b, c]) {
      v.normal.x += fn.x;
      v.normal.y += fn.y;
      v.normal.z += fn.z;
    }
  }
  for (const v of vertices) v.normal = normalize3(v.normal);
}
