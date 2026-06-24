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

// Will-o'-wisp logos: each AI Gateway provider mark floats in 3D as a glowing,
// brand-hued sigil wrapped in a procedural flame — rising tongues with a
// dark→brand→white-hot brightness ramp, plus drifting ember sparks. The mark is
// a textured quad (wispMaterial); the flame + embers are additive screen-space
// passes around it, so bloom turns the hot cores into a halo. Every wisp shares
// one uniform flame envelope so the four read as a consistent set.

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
const GAIN = 1.45; // mark emissive multiplier (>1 so the core blooms)

// Flame envelope, in multiples of the mark's projected pixel radius R (uniform
// across logos → uniform wisps). The flame rises, so it's much taller than wide.
const FLAME_UP = 3.0; // tongues reach this * R above the mark center
const FLAME_DOWN = 0.7; // flame skirt below center
const FLAME_HALF = 1.05; // flame half-width at the base
const EMBERS_PER = 12;

interface Ember {
  x: number; // horizontal offset from mark center (px)
  h: number; // height above center (px, grows as it rises)
  vx: number; // px/s
  vy: number; // px/s (upward)
  life: number; // seconds remaining
  max: number; // lifespan
}

interface Wisp {
  tex: Texture;
  bg: Vec3; // tile background (mark = whatever differs from it)
  tint: Vec3; // brand hue
  x: number; // world column
  phase: number; // desync bob/flicker/flame per logo
  embers: Ember[];
}

export class LogosScene {
  private wisps: Wisp[];
  private mesh = quad(HALF);
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
    // Pre-warm so a single (snapshot) frame already shows a full ember column.
    for (let s = 0; s < 40; s++) for (const w of this.wisps) this.updateEmbers(w, 1 / 30);
  }

  private spawnEmber(seeded = false): Ember {
    const max = 1.2 + this.rng() * 1.1;
    return {
      x: (this.rng() - 0.5) * 0.7, // scaled by R at draw time
      h: 0,
      vx: (this.rng() - 0.5) * 0.5,
      vy: 1.25 + this.rng() * 0.9,
      // Seeded embers start partway through life so the first frame isn't empty.
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
      e.x += e.vx * dt;
      e.vx += (this.rng() - 0.5) * 1.6 * dt; // gentle wander
      e.vy *= 1 + 0.25 * dt; // accelerate upward slightly
    }
  }

  renderScene(target: RenderTarget, t: number): void {
    target.clear(0, 0, 0);
    const W = target.width;
    const H = target.height;
    const dt = this.lastT < 0 ? 1 / 30 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const { viewProjection } = cameraMatrices(camera, W / H);

    for (const w of this.wisps) {
      const bob = Math.sin(t * 0.9 + w.phase) * BOB_AMP;
      const model = mat4Translate(w.x, bob, 0);
      const mvp = mat4Multiply(viewProjection, model);

      // Uniform pixel radius from the projected quad half-height (same for all).
      const center = project(mvp, 0, 0, W, H);
      const top = project(mvp, 0, HALF, W, H);
      const R = Math.max(10, Math.abs(top.y - center.y));

      drawFlame(target, center.x, center.y, R, w.tint, t, w.phase);

      rasterize(target, this.mesh, wispMaterial, {
        mvp,
        logo: w.tex,
        bg: w.bg,
        tint: w.tint,
        gain: GAIN,
        flicker: 0.88 + 0.12 * Math.sin(t * 7 + w.phase),
        edge0: 0.22,
        edge1: 0.5,
      });

      this.updateEmbers(w, dt);
      drawEmbers(target, center.x, center.y, R, w.tint, w.embers, t, w.phase);
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

// --- flame palette -----------------------------------------------------------

// Map a 0..~1.3 intensity to a flame color in `out` (0..255). Cool/dim values
// are a dark brand tint; mid values are the full brand hue; hot values blow out
// toward white — the spread of brightness that makes the flame read as fire.
function flameColor(i: number, hue: Vec3, out: Vec3): void {
  if (i <= 0) {
    out.x = out.y = out.z = 0;
    return;
  }
  if (i < 0.8) {
    const k = i / 0.8; // black → brand (most of the flame lives here)
    out.x = hue.x * k;
    out.y = hue.y * k;
    out.z = hue.z * k;
  } else {
    const k = Math.min(1, (i - 0.8) / 0.5); // brand → near-white hot core (rare)
    out.x = hue.x + (255 - hue.x) * k;
    out.y = hue.y + (255 - hue.y) * k;
    out.z = hue.z + (255 - hue.z) * k;
  }
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
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

// --- flame + ember rendering -------------------------------------------------

const FCOL: Vec3 = { x: 0, y: 0, z: 0 };

// Additive procedural flame around (cx,cy). A rising, swaying teardrop: width
// tapers with height, brightness falls off upward, and two-octave noise scrolling
// upward carves the turbulent tongues. Worked in pixel space; the flame is built
// tall so it survives the glyph grid's vertical squish and reads as fire.
function drawFlame(target: RenderTarget, cx: number, cy: number, R: number, hue: Vec3, t: number, phase: number): void {
  const Wt = target.width;
  const Ht = target.height;
  const c = target.color;
  const halfW = R * FLAME_HALF;
  const upPx = R * FLAME_UP;
  const downPx = R * FLAME_DOWN;

  // Pass 1: a soft ambient halo around the mark (dim brand glow), slightly tall
  // so it reads round through the glyph grid's vertical squish.
  addGlow(target, cx, cy, hue, R * 1.25, R * 1.7, 0.32);

  // Pass 2: rising tongues. Brightness peaks just ABOVE the mark and fades to the
  // tips, so the logo itself stays legible in the cooler base.
  const x0 = Math.max(0, Math.floor(cx - halfW - 2));
  const x1 = Math.min(Wt - 1, Math.ceil(cx + halfW + 2));
  const y0 = Math.max(0, Math.floor(cy - upPx - 2));
  const y1 = Math.min(Ht - 1, Math.ceil(cy + downPx + 2));

  for (let y = y0; y <= y1; y++) {
    const ny = (cy - y) / upPx; // 0 at center, 1 at the tongue tips
    // Bump profile: ramp in above the mark, taper to the tips.
    const vfall = smooth(-0.05, 0.32, ny) * Math.pow(Math.max(0, 1 - ny), 1.4);
    if (vfall <= 0.002) continue;
    const width = halfW * (1 - 0.78 * Math.max(0, ny)) * (0.85 + 0.15 * Math.sin(t * 6 + phase + ny * 4));
    if (width <= 1) continue;
    const sway = Math.sin(ny * 3.1 + t * 2.3 + phase) * R * 0.22 * Math.max(0, ny);

    for (let x = x0; x <= x1; x++) {
      const dx = x - cx - sway;
      const nx = dx / width;
      if (nx < -1 || nx > 1) continue;
      const column = 1 - nx * nx; // bright core, soft sides
      const n = fbm((dx / R) * 1.6 + phase * 3, ny * 2.4 - t * 1.9 + phase);
      const inten = vfall * column * (0.3 + 0.85 * n);
      if (inten <= 0.03) continue;
      flameColor(inten, hue, FCOL);
      const w = 0.6;
      const i = (y * Wt + x) * 3;
      c[i] += FCOL.x * w;
      c[i + 1] += FCOL.y * w;
      c[i + 2] += FCOL.z * w;
    }
  }
}

// Additive radial splat with independent x/y radii (ry>rx counters the glyph
// grid's vertical squish so the halo reads round). Strength scales the peak.
function addGlow(target: RenderTarget, px: number, py: number, hue: Vec3, rx: number, ry: number, strength: number): void {
  const Wt = target.width;
  const Ht = target.height;
  const c = target.color;
  const cx = Math.round(px);
  const cy = Math.round(py);
  const radX = Math.ceil(rx * 2);
  const radY = Math.ceil(ry * 2);
  const sx2 = 2 * (rx / 2) ** 2;
  const sy2 = 2 * (ry / 2) ** 2;
  for (let dy = -radY; dy <= radY; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= Ht) continue;
    for (let dx = -radX; dx <= radX; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= Wt) continue;
      const f = Math.exp(-((dx * dx) / sx2 + (dy * dy) / sy2)) * strength;
      if (f < 0.004) continue;
      const i = (y * Wt + x) * 3;
      c[i] += hue.x * f;
      c[i + 1] += hue.y * f;
      c[i + 2] += hue.z * f;
    }
  }
}

// Additive ember sparks: small bright dots rising from the mark, fading over
// life, hottest (whitest) when young, shrinking as they climb.
function drawEmbers(
  target: RenderTarget,
  cx: number,
  cy: number,
  R: number,
  hue: Vec3,
  embers: Ember[],
  t: number,
  phase: number,
): void {
  const Wt = target.width;
  const Ht = target.height;
  const c = target.color;
  for (const e of embers) {
    const frac = e.life / e.max; // 1 fresh → 0 dead
    const px = cx + e.x * R;
    const py = cy - e.h * R; // h is in units of R
    if (py < 0 || py >= Ht || px < 0 || px >= Wt) continue;
    // Fade in fast, out slow; flicker; brighter (whiter) when young.
    const fade = Math.min(1, frac * 4) * frac;
    const flick = 0.7 + 0.3 * Math.sin(t * 22 + e.x * 30 + phase);
    const inten = (0.7 + 0.5 * frac) * fade * flick;
    if (inten <= 0.02) continue;
    flameColor(0.6 + 0.6 * frac, hue, FCOL); // young = closer to white-hot
    const rad = Math.max(1, R * 0.16 * (0.5 + 0.5 * frac));
    const sigma2 = 2 * (rad * 0.6) ** 2;
    const ri = Math.ceil(rad * 2);
    const bx = Math.round(px);
    const by = Math.round(py);
    for (let dy = -ri; dy <= ri; dy++) {
      const yy = by + dy;
      if (yy < 0 || yy >= Ht) continue;
      for (let dx = -ri; dx <= ri; dx++) {
        const xx = bx + dx;
        if (xx < 0 || xx >= Wt) continue;
        const g = Math.exp(-(dx * dx + dy * dy) / sigma2) * inten;
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
