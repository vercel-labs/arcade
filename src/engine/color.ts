export type RGB = [number, number, number];

// Hue-based spectrum stays vivid across its whole range, which sidesteps the
// muddy-gray middle you get from lerping between RGB stops in gamma space.
export function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g] = [c, x];
  else if (hp < 2) [r, g] = [x, c];
  else if (hp < 3) [g, b] = [c, x];
  else if (hp < 4) [g, b] = [x, c];
  else if (hp < 5) [r, b] = [x, c];
  else [r, b] = [c, x];
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// RGB plus an alpha (0..1). The superset of RGB used wherever translucency is
// needed (UI panels composited over the scene). RGB tuples remain valid inputs.
export type RGBA = [number, number, number, number];

// A small hardcoded CSS color table (zero-dep). Extend as the UI needs names.
const CSS_NAMES: Record<string, RGB> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  lime: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  maroon: [128, 0, 0],
  navy: [0, 0, 128],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  rebeccapurple: [102, 51, 153],
  teal: [0, 128, 128],
  olive: [128, 128, 0],
};

const hexByte = (h: string, a: number, b: number): number => parseInt(h.slice(a, b), 16);

// Normalize any color input to RGBA: an RGB/RGBA tuple, '#rgb'/'#rrggbb'/
// '#rrggbbaa', a CSS color name, or 'transparent'. Unknown strings fall back to
// opaque black so a typo can't crash a frame.
export function parseColor(c: string | RGB | RGBA): RGBA {
  if (Array.isArray(c)) return c.length === 4 ? [c[0], c[1], c[2], (c as RGBA)[3]] : [c[0], c[1], c[2], 1];
  const s = c.trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  if (s[0] === '#') {
    const h = s.slice(1);
    if (h.length === 3) {
      return [hexByte(h[0] + h[0], 0, 2), hexByte(h[1] + h[1], 0, 2), hexByte(h[2] + h[2], 0, 2), 1];
    }
    if (h.length === 6) return [hexByte(h, 0, 2), hexByte(h, 2, 4), hexByte(h, 4, 6), 1];
    if (h.length === 8) return [hexByte(h, 0, 2), hexByte(h, 2, 4), hexByte(h, 4, 6), hexByte(h, 6, 8) / 255];
  }
  const named = CSS_NAMES[s];
  if (named) return [named[0], named[1], named[2], 1];
  return [0, 0, 0, 1];
}

// Composite `src` over `dst` (alpha "over"), returning an opaque RGB. a>=1 keeps
// src; a<=0 keeps dst; otherwise linear per-channel blend.
export function blendOver(dst: RGB, src: RGBA): RGB {
  const a = src[3];
  if (a >= 1) return [src[0], src[1], src[2]];
  if (a <= 0) return [dst[0], dst[1], dst[2]];
  return [src[0] * a + dst[0] * (1 - a), src[1] * a + dst[1] * (1 - a), src[2] * a + dst[2] * (1 - a)];
}
