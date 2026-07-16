// Extract a brand "mark" from a logo image, robust to how the logo is packaged.
// Gateway/creator logos come in several shapes: a cut-out (alpha transparency),
// an opaque dark tile, an opaque light tile, monochrome, or multi-color. A wisp
// paints the mark as a single-hue glow, so the ONLY thing that matters here is
// *which texels belong to the mark* — the coverage. Getting that wrong drops
// regions of multi-color marks (Cohere's pale purple lobe, ByteDance's mint bar).
//
// The failure the old per-pixel shader had: it always measured color distance
// from a sampled "background", so (a) a mark color near the tile bg was discarded,
// and (b) for a TRANSPARENT logo the corners are transparent-but-nonzero-RGB, so
// the sampled bg was a phantom color the real mark then sat close to. This module
// separates MASKING from any recoloring and picks the right signal per logo:
//   • cut-out (has real transparency) → coverage IS the alpha; color is ignored,
//     so a phantom tile color can't erode the mark.
//   • opaque tile → coverage is "differs from the solid background", with a low
//     floor so a lighter/greyer mark region still counts as full mark.
import type { RGB } from './color.ts';
import type { Vec3 } from './math.ts';
import type { Texture } from './texture.ts';

// Normalize an RGB Euclidean distance (0..441.7) to 0..1 (black↔white == 1).
const NORM = 1 / Math.sqrt(3 * 255 * 255);

// A logo is treated as a cut-out once this fraction of texels are ~transparent —
// enough to mean "the artwork was cut out of its background", not a stray edge.
const CUTOUT_FRAC = 0.06;
const ALPHA_CUT = 32; // alpha (0..255) below this is "transparent" for detection

// Opaque-tile coverage ramp, in normalized color distance from the tile bg. The
// floor is deliberately low: brand tiles are flat, so real mark pixels sit well
// above the tiny bg/anti-alias spread (empirically a clear gap up to ~0.18),
// while a pale mark region (e.g. Cohere's lavender at ~0.25) must read as solid,
// not fade out. LO..HI only anti-aliases the mark silhouette.
const OPAQUE_LO = 0.06;
const OPAQUE_HI = 0.18;

export interface MarkAnalysis {
  /** Detected solid background (0..255). Meaningless when `hasAlpha` is true. */
  bg: Vec3;
  /** True → cut-out logo: mask by alpha, never by color distance. */
  hasAlpha: boolean;
}

// Median of a numeric list (mutates a copy). Robust to a mark touching an edge —
// a few stray mark pixels in the border ring don't drag the background estimate.
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

// Detect the background color + whether the logo is a cut-out. The background is
// the median of the OPAQUE border ring (transparent border texels are skipped so
// a phantom under-color can't leak in); a logo with a mostly-transparent border
// has no meaningful tile bg, which `hasAlpha` signals to callers.
export function analyzeLogo(tex: Texture): MarkAnalysis {
  const { width: W, height: H, data: d } = tex;
  let transparent = 0;
  for (let i = 0; i < W * H; i++) if (d[i * 4 + 3] < ALPHA_CUT) transparent++;
  const hasAlpha = transparent / (W * H) > CUTOUT_FRAC;

  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const ring = 3; // sample a 3px border ring on all four sides
  const push = (x: number, y: number): void => {
    const o = (y * W + x) * 4;
    if (d[o + 3] < ALPHA_CUT) return; // skip transparent border texels
    rs.push(d[o]);
    gs.push(d[o + 1]);
    bs.push(d[o + 2]);
  };
  for (let x = 0; x < W; x++) {
    for (let k = 0; k < ring; k++) {
      push(x, k);
      push(x, H - 1 - k);
    }
  }
  for (let y = 0; y < H; y++) {
    for (let k = 0; k < ring; k++) {
      push(k, y);
      push(W - 1 - k, y);
    }
  }
  const bg: Vec3 = { x: median(rs), y: median(gs), z: median(bs) };
  return { bg, hasAlpha };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Per-texel mark coverage in 0..1 (row-major, matching the texture). For a
// cut-out this is the alpha; for an opaque tile it's how far the texel sits from
// the background, ramped LO..HI. Multi-color safe: every color that differs from
// the bg survives, regardless of hue, because coverage never depends on matching
// a single mark color.
export function markCoverage(tex: Texture, analysis: MarkAnalysis = analyzeLogo(tex)): Float32Array {
  const { width: W, height: H, data: d } = tex;
  const cov = new Float32Array(W * H);
  const { bg, hasAlpha } = analysis;
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const a = d[o + 3] / 255;
    if (hasAlpha) {
      cov[i] = a;
      continue;
    }
    const dr = d[o] - bg.x;
    const dg = d[o + 1] - bg.y;
    const db = d[o + 2] - bg.z;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db) * NORM;
    cov[i] = smoothstep(OPAQUE_LO, OPAQUE_HI, dist) * a;
  }
  return cov;
}

// Bake mark coverage into the texture's alpha channel (in place), so a downstream
// material can mask by alpha alone — masking is decided once here, decoupled from
// any recoloring. RGB is left intact for callers that still derive a tint from it.
// Returns the same texture for chaining.
export function bakeMarkAlpha(tex: Texture, analysis: MarkAnalysis = analyzeLogo(tex)): Texture {
  const cov = markCoverage(tex, analysis);
  for (let i = 0; i < cov.length; i++) tex.data[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, cov[i])) * 255);
  return tex;
}

// Convenience for callers that want a plain RGB background tuple.
export function backgroundRgb(tex: Texture): RGB {
  const { bg } = analyzeLogo(tex);
  return [bg.x, bg.y, bg.z];
}
