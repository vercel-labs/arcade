import type { Framebuffer } from './framebuffer.ts';
import { TRIANGLES, VERTICES } from './cube.ts';
import { clamp, dot, normalize, rotateX, rotateY, type Vec3 } from './math.ts';

export type Color = [number, number, number];

/** A cube placed in the world: position, spin, size, and tint. */
export interface Instance {
  position: Vec3;
  rotX: number;
  rotY: number;
  scale: number;
  color: Color;
}

// Denser glyphs read as brighter surfaces.
const RAMP = ' .:-=+*#%@';

// Terminal cells are roughly twice as tall as they are wide, so horizontal
// distances must be stretched ~2x for geometry to look square.
const CHAR_ASPECT = 2.0;

// 60° vertical field of view.
const FOCAL = 1 / Math.tan((60 * Math.PI) / 180 / 2);

// Direction toward the light, in view space. Negative z points back at the
// camera (which sits at the view-space origin looking down +z).
const LIGHT = normalize({ x: -0.4, y: 0.7, z: -0.6 });

const AMBIENT = 0.25;
const NEAR = 0.2;

function edge(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

// Renders every instance into the shared depth buffer. The camera sits at the
// origin looking down +z, so a vertex's view-space position is just its world
// position minus the camera position — no camera rotation involved.
export function renderScene(fb: Framebuffer, instances: Instance[], camera: Vec3): void {
  const cx = fb.cols / 2;
  const cy = fb.rows / 2;
  const scale = fb.rows / 2;

  for (const inst of instances) {
    const view: Vec3[] = VERTICES.map((v) => {
      const scaled = { x: v.x * inst.scale, y: v.y * inst.scale, z: v.z * inst.scale };
      const r = rotateY(rotateX(scaled, inst.rotX), inst.rotY);
      return {
        x: r.x + inst.position.x - camera.x,
        y: r.y + inst.position.y - camera.y,
        z: r.z + inst.position.z - camera.z,
      };
    });

    const screen = view.map((v) => ({
      sx: cx + (v.x / v.z) * FOCAL * scale * CHAR_ASPECT,
      sy: cy - (v.y / v.z) * FOCAL * scale,
    }));

    for (const tri of TRIANGLES) {
      const va = view[tri.a];
      const vb = view[tri.b];
      const vc = view[tri.c];
      if (va.z <= NEAR || vb.z <= NEAR || vc.z <= NEAR) continue;

      const normal = rotateY(rotateX(tri.normal, inst.rotX), inst.rotY);
      const centroid: Vec3 = {
        x: (va.x + vb.x + vc.x) / 3,
        y: (va.y + vb.y + vc.y) / 3,
        z: (va.z + vb.z + vc.z) / 3,
      };
      // A face points away from the camera when its normal agrees with the
      // direction to its centroid (camera is at the view-space origin).
      if (dot(normal, centroid) >= 0) continue;

      const intensity = clamp(dot(normal, LIGHT), AMBIENT, 1);
      const r = Math.round(inst.color[0] * intensity);
      const g = Math.round(inst.color[1] * intensity);
      const b = Math.round(inst.color[2] * intensity);
      const char = RAMP[Math.max(1, Math.round(intensity * (RAMP.length - 1)))];

      const pa = screen[tri.a];
      const pb = screen[tri.b];
      const pc = screen[tri.c];

      const minX = Math.max(0, Math.floor(Math.min(pa.sx, pb.sx, pc.sx)));
      const maxX = Math.min(fb.cols - 1, Math.ceil(Math.max(pa.sx, pb.sx, pc.sx)));
      const minY = Math.max(0, Math.floor(Math.min(pa.sy, pb.sy, pc.sy)));
      const maxY = Math.min(fb.rows - 1, Math.ceil(Math.max(pa.sy, pb.sy, pc.sy)));

      const area = edge(pa.sx, pa.sy, pb.sx, pb.sy, pc.sx, pc.sy);
      if (area === 0) continue;

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = edge(pb.sx, pb.sy, pc.sx, pc.sy, px, py) / area;
          const w1 = edge(pc.sx, pc.sy, pa.sx, pa.sy, px, py) / area;
          const w2 = edge(pa.sx, pa.sy, pb.sx, pb.sy, px, py) / area;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * va.z + w1 * vb.z + w2 * vc.z;
          fb.plot(x, y, z, char, r, g, b);
        }
      }
    }
  }
}

// A fixed crosshair marking the player's ship at screen center. Drawn at a
// negative depth so it always sits on top of the scene.
export function drawReticle(fb: Framebuffer): void {
  const cx = Math.floor(fb.cols / 2);
  const cy = Math.floor(fb.rows / 2);
  const [r, g, b]: Color = [120, 255, 160];
  fb.plot(cx, cy, -1, '+', r, g, b);
  fb.plot(cx - 1, cy, -1, '-', r, g, b);
  fb.plot(cx + 1, cy, -1, '-', r, g, b);
  fb.plot(cx, cy - 1, -1, '|', r, g, b);
  fb.plot(cx, cy + 1, -1, '|', r, g, b);
}
