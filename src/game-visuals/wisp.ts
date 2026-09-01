import { hash2, type RenderTarget, type Vec3 } from '../engine/index.ts';

const WISP_CAP = 1.15;

/** The production Arcade plasma-flame body, independent of logos and filesystem assets. */
export function drawWispFlame(
  target: RenderTarget,
  cx: number,
  cy: number,
  radius: number,
  hue: Vec3,
  time: number,
  phase: number,
  options: { glow?: number; energy?: number; emphasis?: number } = {},
): void {
  const glow = options.glow ?? 0.82;
  const energy = options.energy ?? 0.62;
  const emphasis = options.emphasis ?? 0;
  const W = target.width;
  const H = target.height;
  const colors = target.color;
  const bodyW = radius * (1.45 + 0.5 * emphasis);
  const bottom = radius * 1.7;
  const topH = radius * (1.7 + 1.6 * Math.min(1.2, energy));
  const taperPow = 0.82 + 0.18 * Math.sin(phase * 2.7);
  const breathe = 0.9 + 0.12 * Math.sin(time * 5 + phase);
  const y0 = Math.max(0, Math.floor(cy - topH - 2));
  const y1 = Math.min(H - 1, Math.ceil(cy + bottom + 2));
  for (let y = y0; y <= y1; y++) {
    const up = cy - y;
    let halfWidth: number;
    let brightness: number;
    let climb: number;
    if (up >= 0) {
      const f = up / topH;
      if (f > 1) continue;
      halfWidth = bodyW * Math.pow(1 - f, taperPow);
      brightness = Math.pow(1 - f, 1.15);
      climb = f;
    } else {
      const f = -up / bottom;
      if (f > 1) continue;
      halfWidth = bodyW * Math.sqrt(Math.max(0, 1 - f * f));
      brightness = Math.pow(1 - f, 0.7);
      climb = 0;
    }
    if (halfWidth < 0.6) continue;
    const sway = (Math.sin(climb * 3 + time * 2.6 + phase) * 0.6 + Math.sin(climb * 6 - time * 1.8 + phase * 2.1) * 0.4) * radius * 0.5 * climb;
    const weave = Math.sin(climb * 7 + time * 3 + phase * 4) * 0.3 * climb;
    const center = cx + sway;
    for (let x = Math.max(0, Math.floor(center - halfWidth - 2)); x <= Math.min(W - 1, Math.ceil(center + halfWidth + 2)); x++) {
      const du = (x - center) / halfWidth - weave;
      if (du < -1 || du > 1) continue;
      const column = 1 - du * du;
      let tipFade = 1;
      if (climb > 0) {
        const lick = fbm(du * 2.6 + phase * 6 + time * 1.3, phase * 2);
        const localTop = 0.64 + 0.42 * lick;
        tipFade = 1 - rangeSmoothstep(localTop - 0.18, localTop + 0.04, climb);
        if (tipFade <= 0.02) continue;
      }
      const noise = fbm(du * 2 + phase * 3 + time * 0.25, climb * 3 - time * 2 + phase);
      const intensity = brightness * column * (0.3 + 0.85 * noise) * tipFade * breathe * glow;
      if (intensity <= 0.04) continue;
      const gain = Math.min(WISP_CAP, intensity * 1.2);
      const i = (y * W + x) * 3;
      colors[i] += hue.x * gain;
      colors[i + 1] += hue.y * gain;
      colors[i + 2] += hue.z * gain;
    }
  }
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number): number { return 0.6 * valueNoise(x, y) + 0.3 * valueNoise(x * 2.1 + 5.2, y * 2.1 + 1.3) + 0.15 * valueNoise(x * 4.3 + 9.1, y * 4.3); }
function rangeSmoothstep(a: number, b: number, x: number): number { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
