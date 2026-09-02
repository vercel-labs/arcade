import type { Mesh, Vec3 } from '../../engine/index.ts';
import { build, faceQuad, type RGB, v } from './build.ts';

let cache: Mesh | null = null;
/** Canonical pip die shared by the CLI and browser cinematics. */
export function dieMesh(): Mesh {
  if (cache) return cache;
  const m = build(); const H = 0.5; const IVORY: RGB = [238, 234, 222]; const PIP: RGB = [18, 16, 20]; const offset = 0.3; const size = 0.125;
  const quad = (c: Vec3, u: Vec3, vv: Vec3, hu: number, hv: number, color: RGB, n: Vec3) => faceQuad(m,
    v(c.x-u.x*hu-vv.x*hv,c.y-u.y*hu-vv.y*hv,c.z-u.z*hu-vv.z*hv), v(c.x+u.x*hu-vv.x*hv,c.y+u.y*hu-vv.y*hv,c.z+u.z*hu-vv.z*hv),
    v(c.x+u.x*hu+vv.x*hv,c.y+u.y*hu+vv.y*hv,c.z+u.z*hu+vv.z*hv), v(c.x-u.x*hu+vv.x*hv,c.y-u.y*hu+vv.y*hv,c.z-u.z*hu+vv.z*hv), color, n);
  const pips: Record<number, [number, number][]> = {1:[[0,0]],2:[[-1,1],[1,-1]],3:[[-1,1],[0,0],[1,-1]],4:[[-1,-1],[-1,1],[1,-1],[1,1]],5:[[-1,-1],[-1,1],[0,0],[1,-1],[1,1]],6:[[-1,-1],[-1,0],[-1,1],[1,-1],[1,0],[1,1]]};
  const faces = [{n:v(0,1,0),u:v(1,0,0),w:v(0,0,1),val:1},{n:v(0,-1,0),u:v(1,0,0),w:v(0,0,-1),val:6},{n:v(0,0,1),u:v(1,0,0),w:v(0,1,0),val:2},{n:v(0,0,-1),u:v(-1,0,0),w:v(0,1,0),val:5},{n:v(1,0,0),u:v(0,0,-1),w:v(0,1,0),val:3},{n:v(-1,0,0),u:v(0,0,1),w:v(0,1,0),val:4}];
  for (const f of faces) { const c=v(f.n.x*H,f.n.y*H,f.n.z*H); quad(c,f.u,f.w,H,H,IVORY,f.n); const pc=v(c.x+f.n.x*.03,c.y+f.n.y*.03,c.z+f.n.z*.03); for(const [a,b] of pips[f.val]) quad(v(pc.x+f.u.x*a*offset+f.w.x*b*offset,pc.y+f.u.y*a*offset+f.w.y*b*offset,pc.z+f.u.z*a*offset+f.w.z*b*offset),f.u,f.w,size,size,PIP,f.n); }
  return cache = m;
}
