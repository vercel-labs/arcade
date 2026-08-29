// The clickable 3D die used by the board's roll overlay.

import { type Mesh, type Vec3 } from '../../../../engine/index.ts';
import { build, faceQuad, type RGB, v } from '../../../../game-visuals/catan/build.ts';

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
