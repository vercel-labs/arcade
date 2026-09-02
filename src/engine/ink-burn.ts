import type { RGB } from './color.ts';

export function inkNoise(x: number, y: number): number {
  return valueNoise(x, y) * 0.55
    + valueNoise(x * 2.07 + 11, y * 2.07 - 7) * 0.3
    + valueNoise(x * 4.13 - 5, y * 4.13 + 13) * 0.15;
}

export function coldInkTint(color: RGB, revealed: boolean, amount: number): RGB {
  const local = clamp01(amount);
  if (local <= 0) return color;
  const luminance = color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
  const ash: RGB = [luminance, luminance, luminance];
  const charcoal: RGB = [luminance * 0.12, luminance * 0.14, luminance * 0.17];
  const silver = Math.min(255, 176 + luminance * 0.34);
  const silverEdge: RGB = [silver * 0.96, silver, Math.min(255, silver * 1.035)];
  const crest = smoothstep(clamp01((local - 0.48) / 0.52));
  const shoulder = smoothstep(clamp01((local - 0.08) / 0.42)) * (1 - crest);
  let result = mix(color, ash, local * 0.9);
  result = mix(result, charcoal, shoulder * 0.74);
  result = mix(result, silverEdge, crest * 0.94);
  return mix(result, [92, 112, 158], revealed ? local * (1 - crest) * 0.16 : 0);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = smoothstep(xf), v = smoothstep(yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function mix(a: RGB, b: RGB, t: number): RGB { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
function hash(x: number, y: number): number { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
function smoothstep(value: number): number { const t = clamp01(value); return t * t * (3 - 2 * t); }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
