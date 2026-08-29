// A single will-o'-wisp logo: a spectral brand-hued plasma flame holding a logo
// mark, shedding ember sparks, with an idle "breathing" pulse and a livelier
// "speaking" pulse it eases between. Extracted from the logos scene so it can be
// reused as a per-side HUD in the chess match. Two render paths share all the
// flame/ember/pulse math; only the mark differs:
//   • renderWorld — orbit scene: the mark is a camera-facing 3D billboard (vp).
//   • renderHud   — fixed screen anchor: the mark is a 2D blit (no camera/depth),
//     so the HUD stays pinned to a corner regardless of the board's camera.
import { readFileSync } from 'node:fs';
import {
  analyzeLogo,
  bakeMarkAlpha,
  FONT,
  type Mat4,
  mat4MulVec4,
  hash2,
  mulberry32,
  quad,
  rasterize,
  type RenderTarget,
  type Texture,
  type Vec3,
  wispMaterial,
} from '../../engine/index.ts';
import { decodePng } from '../../engine/texture.ts';
import { BRAND_HUE } from './logos.ts';
import { asset } from '../assets.ts';

// Billboard half-extent in world units (a bit bigger than a chess piece).
export const WISP_SIZE = 0.85;

const VY = 0.62; // vertical compression: 2 stacked pixels/char row → keep orbs round
const WISP_CAP = 1.15; // flame stays brand-hued (capped below white)
const EMBERS_PER = 24; // spark pool size; how many are alight scales with energy
const EMBER_RATE = 9; // respawn attempts/sec at full energy
// Vertical hover drift: the whole orb (flame, mark, embers) bobs on a slow,
// irregular curve so it floats like a will-o'-wisp instead of sitting pinned at a
// fixed height. Amplitude is a small fraction of the orb's size, and it's driven
// only by time + phase (not the pulse) — so each wisp drifts independently and a
// "speaking" spike never lurches it.
const BOB_AMP = 0.12; // peak drift as a fraction of the orb's world size

interface Ember {
  x: number; // world offset from the wisp center
  z: number;
  h: number; // height above center (world)
  vy: number; // world units/s
  life: number;
  max: number;
  size: number; // 0..1, skewed small
  heat: number; // 0..1 brightness/whiteness, baked when thrown
}

// Per-frame scalars derived from the pulse; everything visual rides these.
interface Frame {
  glow: number;
  accent: number;
  flameEnergy: number;
  markGain: number;
  markFlicker: number;
  emberEnergy: number;
}

// Projects a wisp-local point (world coords) to screen pixels — vp-based for the
// orbit scene, a fixed offset+scale for the HUD.
type Project = (x: number, y: number, z: number) => { x: number; y: number };

const MARK_TINT: Vec3 = { x: 0, y: 0, z: 0 }; // reused scratch (single-threaded)

export class Wisp {
  readonly tex: Texture;
  readonly tint: Vec3;
  speaking = false;
  level = 0; // eases 0..1 toward `speaking`
  private phase: number;
  private rng: () => number;
  private embers: Ember[] = [];
  private mesh = quad(WISP_SIZE); // corners rewritten per-frame to billboard

  constructor(opts: { tex: Texture; tint: Vec3; phase: number; rng: () => number }) {
    // Bake the mark mask into the texture's alpha once, up front: the material
    // then just tints by coverage (no per-frame, per-pixel bg comparison), and
    // multi-color marks keep every region regardless of the brand tint.
    this.tex = bakeMarkAlpha(opts.tex);
    this.tint = opts.tint;
    this.phase = opts.phase;
    this.rng = opts.rng;
    for (let e = 0; e < EMBERS_PER; e++) this.embers.push(this.spawnEmber(true, 0.6));
    // Pre-warm so a single (snapshot) frame already shows a settled ember column.
    for (let s = 0; s < 40; s++) this.updateEmbers(1 / 30, 0.6);
  }

  setSpeaking(b: boolean): void {
    this.speaking = b;
  }

  // Ease the speaking level and derive this frame's pulse scalars.
  private frame(t: number, dt: number): Frame {
    this.level += ((this.speaking ? 1 : 0) - this.level) * Math.min(1, dt * 4);
    const idle = 0.5 + 0.5 * Math.sin(t * 1.1 + this.phase);
    const voice = voiceEnergy(t, this.phase);
    const pulse = idle * (1 - this.level) + voice * this.level;
    const accent = Math.min(1, Math.max(0, (pulse - 0.55) / 0.45) * this.level);
    return {
      glow: (0.5 + 0.5 * this.level) * (0.55 + 0.95 * pulse),
      accent,
      flameEnergy: 0.32 + pulse * (0.35 + 0.65 * this.level),
      markGain: 1.5 + 1.4 * accent,
      markFlicker: Math.min(1.8, 0.8 + 0.5 * this.level + 0.45 * pulse),
      emberEnergy: (0.3 + 0.7 * this.level) * pulse,
    };
  }

  // World-anchored render: billboards the mark at world center `P` via the view-
  // projection, with the flame/embers in screen space sized to the projected
  // radius — so the wisp floats in 3D (e.g. above a chess king) and scales with
  // perspective. `scale` shrinks/grows it relative to the default WISP_SIZE.
  renderWorld(target: RenderTarget, vp: Mat4, right: Vec3, up: Vec3, P: Vec3, W: number, H: number, t: number, dt: number, scale = 1): void {
    const f = this.frame(t, dt);
    const size = WISP_SIZE * scale;
    // Slow, irregular vertical bob (two detuned sines, ~7s and ~4s, desynced by
    // phase) applied to the orb's anchor so flame, mark, and embers all hover as
    // one. Off the raw input `P` (which callers may reuse) → a local center.
    const bob = (Math.sin(t * 0.9 + this.phase) * 0.6 + Math.sin(t * 1.53 + this.phase * 2.1) * 0.4) * size * BOB_AMP;
    const Pb: Vec3 = { x: P.x, y: P.y + bob, z: P.z };
    const center = project(vp, Pb.x, Pb.y, Pb.z, W, H);
    const edge = project(vp, Pb.x + up.x * size, Pb.y + up.y * size, Pb.z + up.z * size, W, H);
    const R = Math.max(8, Math.hypot(edge.x - center.x, edge.y - center.y));
    drawWisp(target, center.x, center.y, R, this.tint, t, this.phase, f.glow, f.flameEnergy, f.accent);

    whiten(this.tint, 0.65 * f.accent, MARK_TINT);
    billboard(this.mesh.vertices, Pb, right, up, size);
    rasterize(target, this.mesh, wispMaterial, {
      mvp: vp,
      logo: this.tex,
      tint: MARK_TINT,
      gain: f.markGain,
      flicker: f.markFlicker,
    });

    this.updateEmbers(dt, f.emberEnergy);
    drawEmbers(target, Pb, this.embers, (x, y, z) => project(vp, x, y, z, W, H), R, t, f.glow, this.tint);
  }

  private spawnEmber(seeded: boolean, energy: number): Ember {
    const burst = 0.8 + 0.7 * Math.min(1, energy);
    const max = 1.1 + this.rng() * 1.5;
    const r = this.rng();
    return {
      x: (this.rng() - 0.5) * WISP_SIZE * 0.3,
      z: (this.rng() - 0.5) * WISP_SIZE * 0.3,
      h: 0,
      vy: WISP_SIZE * (1.15 + this.rng() * 1.0) * burst,
      life: seeded ? this.rng() * max : max,
      max,
      size: r * r,
      heat: Math.min(1, 0.45 + 0.5 * Math.min(1, energy) + 0.15 * this.rng()),
    };
  }

  private updateEmbers(dt: number, energy: number): void {
    const reignite = energy * EMBER_RATE * dt;
    for (const e of this.embers) {
      if (e.life <= 0) {
        if (this.rng() < reignite) Object.assign(e, this.spawnEmber(false, energy));
        continue;
      }
      e.life -= dt;
      e.h += e.vy * dt;
      e.x += (this.rng() - 0.5) * WISP_SIZE * 0.6 * dt;
      e.vy *= 1 + 0.18 * dt;
    }
  }
}

// Load a wisp from a logo PNG with a given brand tint, desync phase, and shared rng.
export function loadWisp(pngPath: string, tint: Vec3, phase: number, rng: () => number): Wisp {
  return new Wisp({ tex: decodePng(readFileSync(pngPath)), tint, phase, rng });
}

// Missing-logo fallback, matching Thinking Machines' neutral grey (#ACA4A5).
// The mark is generated in memory from the creator's first letter, so a newly
// discovered creator still gets a recognizable wisp without a baked asset.
export const FALLBACK_CREATOR_TINT: Vec3 = { x: 0xac, y: 0xa4, z: 0xa5 };
const initialTextureCache = new Map<string, Texture>();

// Anthropic is the one intentional exception to creator-logo wisps: Claude's
// sunburst is the recognizable model mark, while the Anthropic "AI" mark remains
// available to non-wisp logo consumers.
const WISP_LOGO_OVERRIDE: Readonly<Record<string, string>> = {
  anthropic: 'claude',
};

function initialTexture(creator: string): Texture {
  const letter = creator.trim().charAt(0).toUpperCase() || '?';
  const hit = initialTextureCache.get(letter);
  if (hit) return hit;
  const glyph = FONT[letter] ?? FONT['?'];
  const side = 128;
  const scale = 10;
  const ox = Math.floor((side - 8 * scale) / 2);
  const oy = Math.floor((side - 8 * scale) / 2);
  const data = new Uint8Array(side * side * 4);
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      if (glyph[gy][gx] !== '1') continue;
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) {
          const i = ((oy + gy * scale + py) * side + ox + gx * scale + px) * 4;
          data[i] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
          data[i + 3] = 255;
        }
      }
    }
  }
  const tex = { width: side, height: side, data };
  initialTextureCache.set(letter, tex);
  return tex;
}

// Prefer the baked creator logo; if it is absent or unreadable, render the first
// letter as a grey wisp. This keeps callers free of per-scene missing-logo logic.
export function loadCreatorWisp(creator: string, phase: number, rng: () => number): Wisp {
  const logo = WISP_LOGO_OVERRIDE[creator] ?? creator;
  try {
    return loadWisp(asset(`logos/${logo}.png`), creatorTint(creator), phase, rng);
  } catch {
    return new Wisp({ tex: initialTexture(creator), tint: { ...FALLBACK_CREATOR_TINT }, phase, rng });
  }
}

// A readable light silver for logos with no usable hue (monochrome marks on a
// neutral tile, e.g. a white "openai" mark on black).
const NEUTRAL_TINT: Vec3 = { x: 205, y: 210, z: 222 };

// Scale a color so its brightest channel is ~210 — dim brand colors read clearly
// and over-bright ones are eased down, preserving hue.
function normalizeTint(c: Vec3): Vec3 {
  const max = Math.max(c.x, c.y, c.z);
  if (max < 1) return { ...NEUTRAL_TINT };
  const s = 210 / max;
  return { x: Math.min(255, c.x * s), y: Math.min(255, c.y * s), z: Math.min(255, c.z * s) };
}

// Derive a creator's brand tint from its logo. Most gateway marks are brand-
// colored, so a saturation-weighted average of the "mark" pixels yields the hue.
// Mark membership uses the same robust masking as the wisp (analyzeLogo): a
// cut-out logo's mark is its opaque pixels (never filtered by a phantom corner
// color, which used to mis-tint ByteDance), while an opaque tile's mark is
// whatever differs from the solid background. For a monochrome mark on a colored
// tile (e.g. a white mark on DeepSeek's blue) fall back to the tile color; for a
// monochrome mark on a neutral tile (white/black on black/white) use NEUTRAL.
export function deriveTint(tex: Texture): Vec3 {
  const { bg, hasAlpha } = analyzeLogo(tex);
  const { width: W, height: H, data: d } = tex;
  let wr = 0;
  let wg = 0;
  let wb = 0;
  let wt = 0;
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (d[o + 3] < 128) continue; // transparent → not the mark
    const r = d[o];
    const g = d[o + 1];
    const b = d[o + 2];
    // Opaque tile: skip background-ish texels. Cut-out: every opaque texel is the
    // mark (there is no meaningful tile color to compare against).
    if (!hasAlpha && Math.hypot(r - bg.x, g - bg.y, b - bg.z) < 60) continue;
    n++;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    wr += r * chroma;
    wg += g * chroma;
    wb += b * chroma;
    wt += chroma;
  }
  if (n === 0) return { ...NEUTRAL_TINT };
  if (wt / n >= 22) return normalizeTint({ x: wr / wt, y: wg / wt, z: wb / wt }); // colored mark
  const bgChroma = Math.max(bg.x, bg.y, bg.z) - Math.min(bg.x, bg.y, bg.z);
  if (!hasAlpha && bgChroma >= 40) return normalizeTint(bg); // monochrome mark on a colored tile
  return { ...NEUTRAL_TINT };
}

// The wisp tint for a creator: a hand-tuned BRAND_HUE override when present, else
// derived from the baked logo. Cached (decodes each logo at most once).
const tintCache = new Map<string, Vec3>();
export function creatorTint(creator: string): Vec3 {
  const hit = tintCache.get(creator);
  if (hit) return hit;
  const hue = BRAND_HUE[creator];
  let tint: Vec3;
  if (hue) tint = { x: hue[0], y: hue[1], z: hue[2] };
  else {
    try {
      tint = deriveTint(decodePng(readFileSync(asset(`logos/${creator}.png`))));
    } catch {
      tint = { ...FALLBACK_CREATOR_TINT };
    }
  }
  tintCache.set(creator, tint);
  return tint;
}

// --- internals (shared by both render paths) ---------------------------------

interface P2 {
  x: number;
  y: number;
}

function project(vp: Mat4, x: number, y: number, z: number, W: number, H: number): P2 {
  const c = mat4MulVec4(vp, { x, y, z, w: 1 });
  const w = c.w || 1e-4;
  return { x: ((c.x / w) * 0.5 + 0.5) * W, y: (1 - ((c.y / w) * 0.5 + 0.5)) * H };
}

// Rewrite a quad's 4 corner positions to a camera-facing billboard at center `P`.
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

// --- flame palette + noise ---------------------------------------------------

const FCOL: Vec3 = { x: 0, y: 0, z: 0 };

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

function voiceEnergy(t: number, phase: number): number {
  const phrase = fbm(t * 0.85 + phase * 4.0, phase * 1.3);
  const syllable = vnoise(t * 3.6 + phase * 2.0, phase);
  const flutter = vnoise(t * 7.5 + phase * 0.7, phase * 3.0);
  let env = 0.52 * syllable + 0.26 * flutter + 0.22 * phrase;
  env = 0.5 + (env - 0.5) * 1.7;
  env += 0.4 * Math.pow(Math.max(0, env - 0.55) / 0.45, 1.5);
  return Math.max(0.08, Math.min(1.3, env));
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

function whiten(c: Vec3, f: number, out: Vec3): void {
  out.x = c.x + (255 - c.x) * f;
  out.y = c.y + (255 - c.y) * f;
  out.z = c.z + (255 - c.z) * f;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// One continuous will-o'-wisp flame: a rounded bulb (holding the logo) tapering
// into noise-carved tongues, brand-hued and capped below white.
function drawWisp(target: RenderTarget, cx: number, cy: number, R: number, hue: Vec3, t: number, phase: number, glow: number, energy: number, emphasis: number): void {
  const Wt = target.width;
  const Ht = target.height;
  const c = target.color;
  const bodyW = R * (1.45 + 0.5 * emphasis);
  const bottom = R * 1.7;
  const topH = R * (1.7 + 1.6 * Math.min(1.2, energy));
  const taperPow = 0.82 + 0.18 * Math.sin(phase * 2.7);
  const breathe = 0.9 + 0.12 * Math.sin(t * 5 + phase);
  const y0 = Math.max(0, Math.floor(cy - topH - 2));
  const y1 = Math.min(Ht - 1, Math.ceil(cy + bottom + 2));

  for (let y = y0; y <= y1; y++) {
    const up = cy - y;
    let hw: number;
    let vbright: number;
    let climb: number;
    if (up >= 0) {
      const f = up / topH;
      if (f > 1) continue;
      hw = bodyW * Math.pow(1 - f, taperPow);
      vbright = Math.pow(1 - f, 1.15);
      climb = f;
    } else {
      const f = -up / bottom;
      if (f > 1) continue;
      hw = bodyW * Math.sqrt(Math.max(0, 1 - f * f));
      vbright = Math.pow(1 - f, 0.7);
      climb = 0;
    }
    if (hw < 0.6) continue;
    const sway =
      (Math.sin(climb * 3.0 + t * 2.6 + phase) * 0.6 + Math.sin(climb * 6.0 - t * 1.8 + phase * 2.1) * 0.4) * R * 0.5 * climb;
    const weave = Math.sin(climb * 7.0 + t * 3.0 + phase * 4.0) * 0.3 * climb;
    const cxs = cx + sway;
    const xa = Math.max(0, Math.floor(cxs - hw - 2));
    const xb = Math.min(Wt - 1, Math.ceil(cxs + hw + 2));
    for (let x = xa; x <= xb; x++) {
      const du = (x - cxs) / hw - weave;
      if (du < -1 || du > 1) continue;
      const col = 1 - du * du;
      let tipFade = 1;
      if (climb > 0) {
        const lick = fbm(du * 2.6 + phase * 6 + t * 1.3, phase * 2.0);
        const localTop = 0.64 + 0.42 * lick;
        tipFade = 1 - smoothstep(localTop - 0.18, localTop + 0.04, climb);
        if (tipFade <= 0.02) continue;
      }
      const n = fbm(du * 2.0 + phase * 3 + t * 0.25, climb * 3.0 - t * 2.0 + phase);
      const inten = vbright * col * (0.3 + 0.85 * n) * tipFade * breathe * glow;
      if (inten <= 0.04) continue;
      const k = Math.min(WISP_CAP, inten * 1.2);
      const i = (y * Wt + x) * 3;
      c[i] += hue.x * k;
      c[i + 1] += hue.y * k;
      c[i + 2] += hue.z * k;
    }
  }
}

// Additive ember sparks rising from the wisp, projected to screen by `proj`.
function drawEmbers(target: RenderTarget, P: Vec3, embers: Ember[], proj: Project, R: number, t: number, glow: number, hue: Vec3): void {
  const Wt = target.width;
  const Ht = target.height;
  const c = target.color;
  for (const e of embers) {
    const frac = e.life / e.max;
    if (frac <= 0) continue;
    const sp = proj(P.x + e.x, P.y + e.h, P.z + e.z);
    if (sp.x < 0 || sp.x >= Wt || sp.y < 0 || sp.y >= Ht) continue;
    const fade = Math.min(1, frac * 4) * frac;
    const flick = 0.65 + 0.35 * Math.sin(t * 26 + e.x * 40);
    const inten = e.heat * (0.45 + 0.55 * frac) * fade * flick * glow;
    if (inten <= 0.02) continue;
    flameColor(0.35 + 0.85 * frac * e.heat, hue, FCOL);
    const rad = Math.max(0.6, R * (0.045 + 0.15 * e.size) * (0.18 + 0.82 * frac));
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
