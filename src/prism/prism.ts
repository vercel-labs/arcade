import {
  cameraMatrices,
  type Camera,
  cross3,
  dot3,
  glassMaterial,
  hslToRgb,
  type Mat4,
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
// Exported so the splash intro can build models that converge on the live one.
export const ROT_SPEED = 0.45;
export const TILT = -0.28;
export const PLACE_Y = 0; // prism centered on screen

interface P2 {
  x: number;
  y: number;
}

// Drives the splash intro: the prism's look is ramped from a flat white triangle
// (the Vercel mark) up to the live glass prism. Every field's "live" value
// (white 0, beam/disp/rainbow 1, model = the default) reproduces the steady scene
// exactly, so the splash's final frame IS the first live frame (seamless handoff).
export interface PrismIntro {
  model: Mat4; // full model transform — caller bakes grow / flatten / spin / tilt
  white: number; // 0 = glass, 1 = pure-white filled triangle
  beam: number; // 0..1 beam reach + intensity (slides in from the left)
  disp: number; // 0..1 multiplier on the internal dispersion sheen
  rainbow: number; // 0..1 rainbow length + intensity
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

export class PrismScene {
  // Draws the prism + beam + rainbow into the (supersampled) render target.
  // `intro` (splash only) ramps the look up from a flat white triangle; omitting
  // it renders the live steady prism.
  renderScene(target: RenderTarget, t: number, intro?: PrismIntro): void {
    target.clear(0, 0, 0);
    const W = target.width;
    const H = target.height;
    const aspect = W / H;
    const white = intro?.white ?? 0;
    const beamF = intro?.beam ?? 1;
    const dispF = intro?.disp ?? 1;
    const rainbowF = intro?.rainbow ?? 1;
    const { view, viewProjection } = cameraMatrices(camera, aspect);
    const model =
      intro?.model ?? mat4Multiply(mat4Translate(0, PLACE_Y, 0), mat4Multiply(mat4RotY(t * ROT_SPEED), mat4RotX(TILT)));
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

    // Per face: its screen-space normal (image-plane direction), and its
    // bird's-eye (top-down XZ) rightwardness — how far toward +X the world
    // normal points, ignoring height. The latter drives face selection.
    const faceNormals: P2[] = [];
    const faceBirdRight: number[] = [];
    TETRA_FACES.forEach(([a, b, c]) => {
      let n = normalize3(cross3(sub3(worldVerts[b], worldVerts[a]), sub3(worldVerts[c], worldVerts[a])));
      const fc: Vec3 = {
        x: (worldVerts[a].x + worldVerts[b].x + worldVerts[c].x) / 3,
        y: (worldVerts[a].y + worldVerts[b].y + worldVerts[c].y) / 3,
        z: (worldVerts[a].z + worldVerts[b].z + worldVerts[c].z) / 3,
      };
      if (dot3(n, sub3(fc, { x: centerW.x, y: centerW.y, z: centerW.z })) < 0) n = { x: -n.x, y: -n.y, z: -n.z };
      // Only the three faces meeting at the apex (vertex 0) may guide the ray —
      // never the downward base face. (Tilt gives the base a big sideways normal,
      // so excluding by a small-XZ threshold is not enough; gate on apex membership.)
      const isTopFace = a === 0 || b === 0 || c === 0;
      const lxz = Math.hypot(n.x, n.z);
      faceBirdRight.push(!isTopFace || lxz < 1e-4 ? -Infinity : n.x / lxz);
      const vn = mat4MulDir(view, n);
      const l = Math.hypot(vn.x, vn.y) || 1;
      faceNormals.push({ x: vn.x / l, y: -vn.y / l });
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

    // Track the apex face whose bird's-eye (top-down XZ) normal points most to
    // the right (+X). The three apex normals are 120° apart, so exactly one is
    // ever within ±60° of straight-right; when it swings past 60° the next face
    // snaps in at -60° (300°). The ray follows that face's SCREEN normal, so the
    // rainbow stays orthogonal to it and snaps between faces as the prism turns.
    let sel = 0;
    for (let i = 1; i < faceBirdRight.length; i++) if (faceBirdRight[i] > faceBirdRight[sel]) sel = i;
    const exitN = faceNormals[sel];
    const entryN = effective(-1);

    // Rainbow exits orthogonal to the prism's right-facing (exit) face: the ray
    // direction IS the exit-face normal, so it swings up/down as the prism turns
    // counterclockwise. Purely stylistic — not Snell's law.
    const angle = Math.atan2(exitN.y, exitN.x);
    const oblique = 1 - Math.max(0, exitN.x);
    const spread = 0.22 + 0.16 * oblique;

    // Anchor the beam and rainbow INSIDE the prism silhouette (well within
    // `radius`) so there's no gap between the light and the glass — the beam
    // runs into the prism and the rainbow emerges from within it.
    const entry: P2 = { x: center.x + entryN.x * radius * 0.85, y: center.y + entryN.y * radius * 0.85 };
    const beamEnd: P2 = { x: center.x - entryN.x * radius * 0.1, y: center.y - entryN.y * radius * 0.1 };

    // Rainbow grows out of the prism: both its length and brightness ramp with
    // `rainbowF` (1 = the live fan).
    if (rainbowF > 0.001) {
      drawRainbow(target, center, angle, W * rainbowF, radius * 0.12, Math.min(H * 0.5, W * Math.tan(spread)), 0.85 * rainbowF);
    }
    // Beam slides in from the left: its leading edge advances from the screen
    // edge toward the prism as `beamF` rises, and it brightens with it.
    if (beamF > 0.001) {
      const bStart: P2 = { x: 0, y: entry.y - H * 0.08 };
      const reach = Math.min(1, beamF * 1.4);
      const bEnd: P2 = { x: bStart.x + (beamEnd.x - bStart.x) * reach, y: bStart.y + (beamEnd.y - bStart.y) * reach };
      drawBeam(target, bStart, bEnd, 1.2 * Math.min(1, beamF));
    }

    rasterize(target, mesh, glassMaterial, {
      mvp,
      model,
      cameraPos: camera.eye,
      // White phase: edges + body lerp to pure white and the fill is boosted so
      // the flat triangle reads solid white; dispersion is suppressed until glass.
      edgeColor: { x: lerp(215, 255, white), y: lerp(222, 255, white), z: lerp(240, 255, white) },
      edgeWidth: 0.03,
      glassColor: { x: lerp(180, 255, white), y: lerp(198, 255, white), z: lerp(225, 255, white) },
      bodyStrength: lerp(0.42, 1.8, white),
      ambient: lerp(0.42, 1, white),
      fresnelPower: 2,
      dispersion: 0.16 * dispF * (1 - white),
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
      // Gentle S-curve on the hue ramp: smoothstep is steepest at the middle,
      // so it moves fastest through green (compressing its fat band) and lingers
      // a touch more at the red/violet ends — balances the band widths.
      const p = 1 - across;
      const pw = p + (p * p * (3 - 2 * p) - p) * 0.5;
      const [r, g, b] = hslToRgb(pw * 250, 1, 0.5);
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
