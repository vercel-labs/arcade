import { readFileSync } from 'node:fs';
import {
  cameraMatrices,
  type Camera,
  decodePng,
  mat4Multiply,
  mat4MulVec4,
  mat4Translate,
  quad,
  rasterize,
  type RenderTarget,
  type RGB,
  type Texture,
  type Vec3,
  wispMaterial,
} from '../engine/index.ts';
import { BRAND_HUE } from './logos.ts';

// Phase 1 of the will-o'-wisp idea: AI Gateway provider logos rendered as
// glowing, brand-hued marks floating in 3D. Each logo is a camera-facing quad
// textured with the baked PNG; wispMaterial extracts the mark and recolors it,
// bloom (applied by the presenter in color mode) plus a stamped glow give the
// halo. Bobs + flickers so it reads as a living flame rather than a flat sprite.

const PROVIDERS = ['openai', 'anthropic', 'google', 'xai'] as const;

const camera: Camera = {
  eye: { x: 0, y: 0, z: 6 },
  target: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fovy: (50 * Math.PI) / 180,
  near: 0.1,
  far: 100,
};

const HALF = 0.78; // quad half-extent (logo ~1.56 world units tall)
const SPACING = 2.0; // gap between logo centers along x
const BOB_AMP = 0.16; // vertical float amplitude
const GAIN = 1.45; // emissive multiplier (>1 so the core blooms)

interface Wisp {
  tex: Texture;
  bg: Vec3; // background color of the tile (mark = whatever differs from it)
  tint: Vec3;
  x: number; // world-space column
  phase: number; // desync the bob/flicker per logo
}

// Average a few corner texels as the tile's background color, so the mask keys
// off "differs from background" rather than a hardcoded black.
function cornerColor(tex: Texture): Vec3 {
  const { width: w, height: h, data: d } = tex;
  const pts = [
    [2, 2],
    [w - 3, 2],
    [2, h - 3],
    [w - 3, h - 3],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [x, y] of pts) {
    const i = (y * w + x) * 4;
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
  }
  return { x: r / pts.length, y: g / pts.length, z: b / pts.length };
}

// Cheap two-octave flicker in [~0.7 .. ~1.05]: a slow breath plus a faster
// shimmer. Keyed on time + per-logo phase so the four don't pulse in lockstep.
function flicker(t: number, phase: number): number {
  const v = 0.86 + 0.1 * Math.sin(t * 7 + phase) + 0.06 * Math.sin(t * 19 + phase * 2.3);
  return Math.max(0.6, v);
}

export class LogosScene {
  private wisps: Wisp[];
  private mesh = quad(HALF);

  constructor(dir = 'public/assets/logos') {
    this.wisps = PROVIDERS.map((name, i) => {
      const tex = decodePng(readFileSync(`${dir}/${name}.png`));
      const tint = BRAND_HUE[name] ?? ([255, 255, 255] as RGB);
      return {
        tex,
        bg: cornerColor(tex),
        tint: { x: tint[0], y: tint[1], z: tint[2] },
        x: (i - (PROVIDERS.length - 1) / 2) * SPACING,
        phase: i * 1.7,
      };
    });
  }

  renderScene(target: RenderTarget, t: number): void {
    target.clear(0, 0, 0);
    const W = target.width;
    const H = target.height;
    const { viewProjection } = cameraMatrices(camera, W / H);

    for (const w of this.wisps) {
      const bob = Math.sin(t * 0.9 + w.phase) * BOB_AMP;
      const f = flicker(t, w.phase);
      const model = mat4Translate(w.x, bob, 0);
      const mvp = mat4Multiply(viewProjection, model);

      rasterize(target, this.mesh, wispMaterial, {
        mvp,
        logo: w.tex,
        bg: w.bg,
        tint: w.tint,
        gain: GAIN,
        flicker: f,
        // Low edge sits above the dark rounded-tile fill (~0.08 normalized) so
        // only the bright mark survives; the mark itself is ~0.6–0.9 away.
        edge0: 0.22,
        edge1: 0.5,
      });

      // Soft brand-hued halo around the mark — gives "emitted light" even in the
      // ASCII present path (which doesn't run bloom). Center + radius come from
      // projecting the quad's center and top edge to screen space.
      const center = project(mvp, 0, 0, W, H);
      const top = project(mvp, 0, HALF, W, H);
      const radius = Math.max(8, Math.hypot(top.x - center.x, top.y - center.y) * 1.6);
      addGlow(target, center.x, center.y, w.tint, radius, 0.5 * f);
    }
  }
}

interface P2 {
  x: number;
  y: number;
}

function project(mvp: ReturnType<typeof mat4Multiply>, x: number, y: number, W: number, H: number): P2 {
  const c = mat4MulVec4(mvp, { x, y, z: 0, w: 1 });
  const w = c.w || 1e-4;
  return { x: ((c.x / w) * 0.5 + 0.5) * W, y: (1 - ((c.y / w) * 0.5 + 0.5)) * H };
}

// Additive Gaussian splat (same idea as attract's beam glow), tinted to a brand
// hue and scaled by `strength`. Brightens the buffer around the logo so the wisp
// reads as a light source in every present mode.
function addGlow(target: RenderTarget, px: number, py: number, tint: Vec3, radius: number, strength: number): void {
  const cx = Math.round(px);
  const cy = Math.round(py);
  // Loop well past the sigma (σ = radius/2) so the Gaussian decays below the
  // per-pixel cutoff before the box edge — otherwise the splat clips to a square.
  const rad = Math.ceil(radius * 2);
  const c = target.color;
  const W = target.width;
  const H = target.height;
  const sigma2 = 2 * (radius / 2) ** 2;
  for (let dy = -rad; dy <= rad; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= H) continue;
    for (let dx = -rad; dx <= rad; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= W) continue;
      const f = Math.exp(-(dx * dx + dy * dy) / sigma2) * strength;
      if (f < 0.004) continue;
      const i = (y * W + x) * 3;
      c[i] += tint.x * f;
      c[i + 1] += tint.y * f;
      c[i + 2] += tint.z * f;
    }
  }
}
