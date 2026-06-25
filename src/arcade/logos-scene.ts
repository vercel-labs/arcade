import { readFileSync } from 'node:fs';
import {
  cameraMatrices,
  type Camera,
  decodePng,
  type Mat4,
  mat4MulVec4,
  quad,
  rasterize,
  type RenderTarget,
  type RGB,
  type Texture,
  type Vec3,
  wispMaterial,
} from '../engine/index.ts';
import { OrbitCamera } from './orbit.ts';
import { BRAND_HUE } from './logos.ts';

// Will-o'-wisp logos in 3D: each AI Gateway provider mark floats as a spectral
// plasma orb — a soft, gassy ball of brand-hued light (no hard shell) with the
// logo billboarded inside so it always faces the camera head-on, plus drifting
// ember sparks. The screen is an orbit turntable (drag/pan/zoom) like chess; the
// orb glow + embers are world-anchored so they read correctly from any angle.

const PROVIDERS = ['openai', 'anthropic', 'google', 'xai'] as const;

const FOVY = (50 * Math.PI) / 180;
const SIZE = 0.85; // logo billboard half-extent (world units; a bit bigger than a chess piece)
const SPACING = 2.8; // gap between orb centers along x
const EMBERS_PER = 14;

// The glyph grid packs 2 stacked pixels per character row, so a pixel-space
// circle reads as a wide ellipse. Compressing vertical distance by this factor
// when measuring radial falloff makes the orb/embers read round on screen.
const VY = 0.62;
// Plasma stays pure brand-hue and capped below white, so the bright (clamping-to-
// white) logo mark and the white-hot embers read as the core inside colored gas.
const PLASMA_CAP = 0.7;

interface Ember {
  x: number; // world offset from orb center
  z: number;
  h: number; // height above center (world, grows as it rises)
  vy: number; // world units/s
  life: number;
  max: number;
}

interface Wisp {
  tex: Texture;
  bg: Vec3; // tile background (mark = whatever differs from it)
  tint: Vec3; // brand hue
  x: number; // world column
  phase: number; // desync flicker/embers per logo
  embers: Ember[];
}

export class LogosScene {
  private wisps: Wisp[];
  private mesh = quad(SIZE); // shared; corners rewritten per-orb to billboard
  private cam: OrbitCamera;
  private rng: () => number;
  private lastT = -1;

  constructor(dir = 'public/assets/logos') {
    this.rng = mulberry32(0x10905c); // fixed seed → reproducible snapshots
    this.wisps = PROVIDERS.map((name, i) => {
      const tex = decodePng(readFileSync(`${dir}/${name}.png`));
      const tint = BRAND_HUE[name] ?? ([255, 255, 255] as RGB);
      const embers: Ember[] = [];
      for (let e = 0; e < EMBERS_PER; e++) embers.push(this.spawnEmber(true));
      return {
        tex,
        bg: cornerColor(tex),
        tint: { x: tint[0], y: tint[1], z: tint[2] },
        x: (i - (PROVIDERS.length - 1) / 2) * SPACING,
        phase: i * 1.7,
        embers,
      };
    });
    // Frame the whole row, viewed from a slight angle so the 3D/billboard reads.
    const rowWidth = SPACING * (PROVIDERS.length - 1) + 2 * SIZE;
    const dist = rowWidth / (2 * Math.tan(FOVY / 2)) + 1.5;
    this.cam = new OrbitCamera({ azimuth: 0.5, elevation: 0.16, distance: dist, target: { x: 0, y: 0, z: 0 } }, 3, 40);
    // Pre-warm so a single (snapshot) frame already shows a full ember column.
    for (let s = 0; s < 40; s++) for (const w of this.wisps) this.updateEmbers(w, 1 / 30);
  }

  resetView(): void {
    this.cam.reset();
  }
  orbit(dx: number, dy: number): void {
    this.cam.orbit(dx, dy);
  }
  pan(dx: number, dy: number): void {
    this.cam.pan(dx, dy);
  }
  zoomBy(factor: number): void {
    this.cam.zoomBy(factor);
  }

  private spawnEmber(seeded = false): Ember {
    const max = 1.3 + this.rng() * 1.2;
    return {
      x: (this.rng() - 0.5) * SIZE * 0.7,
      z: (this.rng() - 0.5) * SIZE * 0.7,
      h: 0,
      vy: SIZE * (1.0 + this.rng() * 0.7),
      life: seeded ? this.rng() * max : max,
      max,
    };
  }

  private updateEmbers(w: Wisp, dt: number): void {
    for (const e of w.embers) {
      e.life -= dt;
      if (e.life <= 0) {
        Object.assign(e, this.spawnEmber());
        continue;
      }
      e.h += e.vy * dt;
      e.x += (this.rng() - 0.5) * SIZE * 0.5 * dt; // gentle horizontal wander
      e.vy *= 1 + 0.2 * dt; // accelerate upward slightly
    }
  }

  renderScene(target: RenderTarget, t: number): void {
    target.clear(0, 0, 0);
    const W = target.width;
    const H = target.height;
    const dt = this.lastT < 0 ? 1 / 30 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;

    const eye = this.cam.eye();
    const camera: Camera = { eye, target: this.cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 200 };
    const { viewProjection: vp } = cameraMatrices(camera, W / H);
    const { right, up } = this.cam.basis();

    for (const w of this.wisps) {
      const P: Vec3 = { x: w.x, y: 0, z: 0 };
      const center = project(vp, P.x, P.y, P.z, W, H);
      // Projected orb radius from the camera-up edge → tracks zoom/perspective.
      const edge = project(vp, P.x + up.x * SIZE, up.y * SIZE, P.z + up.z * SIZE, W, H);
      const R = Math.max(8, Math.hypot(edge.x - center.x, edge.y - center.y));

      drawPlasma(target, center.x, center.y, R, w.tint, t, w.phase);

      // Billboard: rewrite the quad's corners from the camera basis so it faces
      // the camera, then draw the emissive mark with viewProjection as the mvp.
      billboard(this.mesh.vertices, P, right, up, SIZE);
      rasterize(target, this.mesh, wispMaterial, {
        mvp: vp,
        logo: w.tex,
        bg: w.bg,
        tint: w.tint,
        gain: 1.5,
        flicker: 0.9 + 0.1 * Math.sin(t * 7 + w.phase),
        edge0: 0.22,
        edge1: 0.5,
      });

      this.updateEmbers(w, dt);
      drawEmbers(target, vp, P, w, W, H, R, t);
    }
  }
}

interface P2 {
  x: number;
  y: number;
}

function project(vp: Mat4, x: number, y: number, z: number, W: number, H: number): P2 {
  const c = mat4MulVec4(vp, { x, y, z, w: 1 });
  const w = c.w || 1e-4;
  return { x: ((c.x / w) * 0.5 + 0.5) * W, y: (1 - ((c.y / w) * 0.5 + 0.5)) * H };
}

// Rewrite a quad's 4 corner positions to a camera-facing billboard at center `P`,
// spanning ±h along the camera right/up vectors. Order matches quad(): the
// corners are (-,-), (+,-), (+,+), (-,+) in (right, up).
function billboard(verts: { position: Vec3 }[], P: Vec3, right: Vec3, up: Vec3, h: number): void {
  const sx = [-h, h, h, -h];
  const sy = [-h, -h, h, h];
  for (let i = 0; i < 4; i++) {
    const p = verts[i].position;
    p.x = P.x + right.x * sx[i] + up.x * sy[i];
    p.y = P.y + right.y * sx[i] + up.y * sy[i];
    p.z = P.z + right.z * sx[i] + up.z * sy[i];
  }
}

// --- flame palette -----------------------------------------------------------

// Map a 0..~1.3 intensity to a flame color in `out` (0..255): dim values are a
// dark brand tint, mid values the full brand hue, hot values blow toward white —
// the brightness spread that makes the gas read as glowing rather than flat.
function flameColor(i: number, hue: Vec3, out: Vec3): void {
  if (i <= 0) {
    out.x = out.y = out.z = 0;
    return;
  }
  if (i < 0.55) {
    const k = i / 0.55;
    out.x = hue.x * k;
    out.y = hue.y * k;
    out.z = hue.z * k;
  } else {
    const k = Math.min(1, (i - 0.55) / 0.45);
    out.x = hue.x + (255 - hue.x) * k;
    out.y = hue.y + (255 - hue.y) * k;
    out.z = hue.z + (255 - hue.z) * k;
  }
}

// --- value noise (cheap fbm) -------------------------------------------------

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number): number {
  return 0.6 * vnoise(x, y) + 0.3 * vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3) + 0.15 * vnoise(x * 4.3 + 9.1, y * 4.3);
}

// --- plasma orb + embers -----------------------------------------------------

const FCOL: Vec3 = { x: 0, y: 0, z: 0 };

// Additive spectral plasma around (cx,cy): a radial gas ball (a uniform sphere
// reads as a radial falloff from every angle, so a billboarded radial splat is
// correct as the camera orbits) modulated by upward-scrolling noise for gassy
// motion, with a slight upward bias and a whole-orb flicker.
function drawPlasma(target: RenderTarget, cx: number, cy: number, R: number, hue: Vec3, t: number, phase: number): void {
  const Wt = target.width;
  const Ht = target.height;
  const c = target.color;
  const reach = R * 1.8;
  const breathe = 0.9 + 0.12 * Math.sin(t * 5 + phase);
  const x0 = Math.max(0, Math.floor(cx - reach - 2));
  const x1 = Math.min(Wt - 1, Math.ceil(cx + reach + 2));
  const y0 = Math.max(0, Math.floor(cy - reach / VY - 2));
  const y1 = Math.min(Ht - 1, Math.ceil(cy + reach / VY + 2));

  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const d = Math.sqrt(dx * dx + (dy * VY) * (dy * VY)) / reach;
      if (d >= 1) continue;
      let base = 1 - d;
      base *= base; // soft core, falls off to the rim
      // Turbulence scrolls upward; sampled in orb-radius units so it's scale-stable.
      const n = fbm((dx / R) * 1.5 + phase * 3, (dy / R) * 1.5 - t * 1.3 + phase);
      let inten = base * (0.45 + 0.95 * n) * breathe;
      inten *= 1 + 0.3 * (-dy / reach); // a touch brighter above center (rising wisp)
      if (inten <= 0.04) continue;
      // Pure brand hue, capped below the white regime — the gas around the mark.
      const k = Math.min(PLASMA_CAP, inten);
      const i = (y * Wt + x) * 3;
      c[i] += hue.x * k;
      c[i + 1] += hue.y * k;
      c[i + 2] += hue.z * k;
    }
  }
}

// Additive ember sparks: world-anchored points rising from the orb, projected to
// screen, fading over life and hottest (whitest) when young.
function drawEmbers(target: RenderTarget, vp: Mat4, P: Vec3, w: Wisp, W: number, H: number, R: number, t: number): void {
  const Wt = target.width;
  const Ht = target.height;
  const c = target.color;
  for (const e of w.embers) {
    const frac = e.life / e.max; // 1 fresh → 0 dead
    const sp = project(vp, P.x + e.x, P.y + e.h, P.z + e.z, W, H);
    if (sp.x < 0 || sp.x >= Wt || sp.y < 0 || sp.y >= Ht) continue;
    const fade = Math.min(1, frac * 4) * frac; // fast in, slow out
    const flick = 0.7 + 0.3 * Math.sin(t * 22 + e.x * 30 + w.phase);
    const inten = (0.7 + 0.5 * frac) * fade * flick;
    if (inten <= 0.02) continue;
    flameColor(0.6 + 0.6 * frac, w.tint, FCOL);
    const rad = Math.max(1, R * 0.13 * (0.5 + 0.5 * frac));
    const sigma2 = 2 * (rad * 0.6) ** 2;
    const ri = Math.ceil(rad * 2);
    const bx = Math.round(sp.x);
    const by = Math.round(sp.y);
    for (let dy = -ri; dy <= ri; dy++) {
      const yy = by + dy;
      if (yy < 0 || yy >= Ht) continue;
      for (let dx = -ri; dx <= ri; dx++) {
        const xx = bx + dx;
        if (xx < 0 || xx >= Wt) continue;
        const g = Math.exp(-(dx * dx + (dy / VY) * (dy / VY)) / sigma2) * inten;
        if (g < 0.01) continue;
        const i = (yy * Wt + xx) * 3;
        c[i] += FCOL.x * g;
        c[i + 1] += FCOL.y * g;
        c[i + 2] += FCOL.z * g;
      }
    }
  }
}

// --- helpers -----------------------------------------------------------------

// Average a few corner texels as the tile background, so the mark is "differs
// from background" rather than a hardcoded color.
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

// Small deterministic PRNG so ember motion is reproducible across snapshots.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
