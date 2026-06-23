import {
  cameraMatrices,
  type Camera,
  cross3,
  dot3,
  glassMaterial,
  hslToRgb,
  mat4Multiply,
  mat4MulDir,
  mat4MulVec4,
  mat4RotX,
  mat4RotY,
  mat4Translate,
  normalize3,
  rasterize,
  type RenderTarget,
  sub3,
  TETRA_FACES,
  tetrahedron,
  TETRA_VERTS,
  type Vec3,
} from '../engine/index.ts';

const camera: Camera = {
  eye: { x: 0, y: 0, z: 4 },
  target: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fovy: (52 * Math.PI) / 180,
  near: 0.1,
  far: 100,
};

const mesh = tetrahedron();
const ROT_SPEED = 0.45;
const TILT = -0.28;
const PLACE_Y = 0; // prism centered on screen

interface P2 {
  x: number;
  y: number;
}

export class AttractScene {
  // Draws the prism + beam + rainbow into the (supersampled) render target.
  renderScene(target: RenderTarget, t: number): void {
    target.clear(0, 0, 0);
    const W = target.width;
    const H = target.height;
    const aspect = W / H;
    const { view, viewProjection } = cameraMatrices(camera, aspect);
    const model = mat4Multiply(mat4Translate(0, PLACE_Y, 0), mat4Multiply(mat4RotY(t * ROT_SPEED), mat4RotX(TILT)));
    const mvp = mat4Multiply(viewProjection, model);

    const project = (p: Vec3): P2 => {
      const c = mat4MulVec4(mvp, { x: p.x, y: p.y, z: p.z, w: 1 });
      const w = c.w || 1e-4;
      return { x: ((c.x / w) * 0.5 + 0.5) * W, y: (1 - ((c.y / w) * 0.5 + 0.5)) * H };
    };

    const worldVerts = TETRA_VERTS.map((p) => {
      const w = mat4MulVec4(model, { x: p.x, y: p.y, z: p.z, w: 1 });
      return { x: w.x, y: w.y, z: w.z };
    });
    const centerW = mat4MulVec4(model, { x: 0, y: 0, z: 0, w: 1 });
    const center = project({ x: 0, y: 0, z: 0 });
    const apex = project(TETRA_VERTS[0]);
    const radius = Math.max(6, Math.hypot(apex.x - center.x, apex.y - center.y));

    // Screen-space normal of each face (which way it faces in the image plane).
    const faceNormals: P2[] = TETRA_FACES.map(([a, b, c]) => {
      let n = normalize3(cross3(sub3(worldVerts[b], worldVerts[a]), sub3(worldVerts[c], worldVerts[a])));
      const fc: Vec3 = {
        x: (worldVerts[a].x + worldVerts[b].x + worldVerts[c].x) / 3,
        y: (worldVerts[a].y + worldVerts[b].y + worldVerts[c].y) / 3,
        z: (worldVerts[a].z + worldVerts[b].z + worldVerts[c].z) / 3,
      };
      if (dot3(n, sub3(fc, { x: centerW.x, y: centerW.y, z: centerW.z })) < 0) n = { x: -n.x, y: -n.y, z: -n.z };
      const vn = mat4MulDir(view, n);
      const l = Math.hypot(vn.x, vn.y) || 1;
      return { x: vn.x / l, y: -vn.y / l };
    });

    const effective = (sign: number): P2 => {
      let sx = 0;
      let sy = 0;
      let wsum = 0;
      for (const fn of faceNormals) {
        const facing = sign > 0 ? Math.max(0, fn.x) : Math.max(0, -fn.x);
        const w = facing * facing;
        sx += w * fn.x;
        sy += w * fn.y;
        wsum += w;
      }
      if (wsum < 1e-4) return { x: sign > 0 ? 1 : -1, y: 0 };
      const l = Math.hypot(sx, sy) || 1;
      return { x: sx / l, y: sy / l };
    };

    const exitN = effective(1);
    const entryN = effective(-1);

    // Rainbow leaves bent toward the exit-face normal; the more oblique, the wider.
    const k = 0.65;
    let bx = (1 - k) + k * exitN.x;
    let by = k * exitN.y;
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl;
    by /= bl;
    const angle = Math.atan2(by, bx);
    const oblique = 1 - Math.max(0, exitN.x);
    const spread = 0.22 + 0.16 * oblique;

    // Anchor the beam and rainbow INSIDE the prism silhouette (well within
    // `radius`) so there's no gap between the light and the glass — the beam
    // runs into the prism and the rainbow emerges from within it.
    const entry: P2 = { x: center.x + entryN.x * radius * 0.85, y: center.y + entryN.y * radius * 0.85 };
    const beamEnd: P2 = { x: center.x - entryN.x * radius * 0.1, y: center.y - entryN.y * radius * 0.1 };

    drawRainbow(target, center, angle, W, radius * 0.12, Math.min(H * 0.5, W * Math.tan(spread)), 0.85);
    drawBeam(target, { x: 0, y: entry.y - H * 0.08 }, beamEnd, 1.2);

    rasterize(target, mesh, glassMaterial, {
      mvp,
      model,
      cameraPos: camera.eye,
      edgeColor: { x: 215, y: 222, z: 240 },
      edgeWidth: 0.03,
      glassColor: { x: 180, y: 198, z: 225 },
      bodyStrength: 0.42,
      ambient: 0.42,
      fresnelPower: 2,
      dispersion: 0.16,
    });
  }
}

function addGlow(target: RenderTarget, px: number, py: number, r: number, g: number, b: number, radius: number): void {
  const cx = Math.round(px);
  const cy = Math.round(py);
  const rad = Math.max(1, Math.ceil(radius));
  const c = target.color;
  const W = target.width;
  const H = target.height;
  for (let dy = -rad; dy <= rad; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= H) continue;
    for (let dx = -rad; dx <= rad; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= W) continue;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const f = Math.exp(-(d * d) / (2 * (radius / 2) ** 2));
      const i = (y * W + x) * 3;
      c[i] += r * f;
      c[i + 1] += g * f;
      c[i + 2] += b * f;
    }
  }
}

function drawBeam(target: RenderTarget, a: P2, b: P2, intensity: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  const v = 255 * intensity;
  for (let i = 0; i <= steps; i++) {
    const tt = i / steps;
    // Dim toward the prism end so the beam visibly fades as it meets the glass.
    const vv = v * (1 - 0.45 * tt);
    addGlow(target, a.x + dx * tt, a.y + dy * tt, vv, vv, vv, 1.7);
  }
}

// Inverse-mapped widening wedge. Across the fan, top = blue/violet, bottom = red
// (matching the reference); soft transverse falloff for the glow.
function drawRainbow(
  target: RenderTarget,
  origin: P2,
  angle: number,
  length: number,
  hwStart: number,
  hwEnd: number,
  intensity: number,
): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  const W = target.width;
  const H = target.height;
  const c = target.color;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const rx = x - origin.x;
      const ry = y - origin.y;
      const s = rx * dx + ry * dy;
      if (s < 0 || s > length) continue;
      const u = rx * px + ry * py;
      const hw = hwStart + (hwEnd - hwStart) * (s / length);
      const e = u / hw;
      if (Math.abs(e) > 1) continue;
      const across = (e + 1) / 2;
      const [r, g, b] = hslToRgb((1 - across) * 250, 1, 0.5);
      const cov = Math.abs(e) < 0.78 ? 1 : Math.max(0, (1 - Math.abs(e)) / 0.22);
      const along = 1 - 0.12 * (s / length);
      const bright = intensity * cov * along;
      const i = (y * W + x) * 3;
      c[i] += r * bright;
      c[i + 1] += g * bright;
      c[i + 2] += b * bright;
    }
  }
}
