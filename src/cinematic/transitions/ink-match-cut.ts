import type { RGB } from '../../engine/color.ts';
import { Surface } from '../../engine/surface.ts';

const BLACK: RGB = [0, 0, 0];

export interface InkMatchCut {
  from: { x: number; y: number };
  to: { x: number; y: number };
  direction: { x: number; y: number };
}

/** Platform-neutral Surface compositor used identically by Canvas and ANSI hosts. */
export function anchoredInkMatchCut(from: Surface, to: Surface, cols: number, rows: number, progress: number, cut: InkMatchCut, pointer: { x: number; y: number } | null = null, movingFrom: Surface | null = null): Surface {
  const p = clamp01(progress);
  const out = new Surface(cols, rows);
  out.fillRect(0, 0, cols, rows, BLACK);
  const anticipation = smoothstep(clamp01(p / 0.5));
  const resolve = smoothstep(clamp01((p - 0.42) / 0.58));
  const length = Math.hypot(cut.direction.x, cut.direction.y) || 1;
  const dx = cut.direction.x / length, dy = cut.direction.y / length;
  const portrait = cols / Math.max(1, rows * 2) < 0.78;

  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const u = x / Math.max(1, cols - 1), v = y / Math.max(1, rows - 1);
    const protectedCopy = portrait ? v < 0.34 : u < 0.32 && v < 0.4;
    const coarse = inkNoise(u * 3.6, v * 3.6);
    const projection = (u - 0.5) * dx + (v - 0.5) * dy;
    const fibers = Math.sin((u * dy - v * dx) * 42 + coarse * 8) * 0.022;
    const field = projection * 0.72 + coarse * 0.2 + fibers + Math.hypot((u - 0.5) * 0.8, (v - 0.5) * 1.15) * 0.08;
    const front = lerp(-0.62, 0.66, p);
    const handoff = p <= 0 ? 0 : p >= 1 ? 1 : rangeSmoothstep(field - 0.11, field + 0.11, front);
    const seam = 1 - Math.min(1, Math.abs(handoff - 0.5) * 3.4);
    const displacement = protectedCopy ? 0 : seam * (0.6 + coarse * 1.9);
    const cross = Math.sin((u + v) * 19 + coarse * 7) * displacement * 0.45;
    let su = u - dx * displacement / cols - dy * cross / cols;
    let sv = v - dy * displacement / rows + dx * cross / rows;
    if (pointer && !protectedCopy) {
      const distance = Math.hypot(u - pointer.x, v - pointer.y);
      const influence = Math.max(0, 1 - distance / 0.2) * seam * 0.012;
      su += (u - pointer.x) * influence; sv += (v - pointer.y) * influence;
    }
    const sourceFrame = movingFrom && hash(x + y * cols, 419) < anticipation ? movingFrom : from;
    // Both plates remain in their authored coordinate systems. Only cells at the
    // ink seam receive a tiny local fiber displacement; there is no whole-scene
    // zoom, pan, or anchor interpolation to snap back after the cut.
    const a = sample(sourceFrame, su, sv);
    const b = sample(to, su, sv);
    const cell = handoff >= 0.5 ? b : a;
    if (!cell?.opaque || cell.ch === ' ') continue;
    const blue = handoff >= 0.5 ? Math.max(seam * 0.85, (1 - resolve) * 0.48) : Math.max(seam * 0.9, anticipation * 0.32);
    let glyph = cell.ch;
    if (!protectedCopy && seam > 0.58 && hash(x + y * cols, 211) > 0.76) glyph = ['·', ':', '/', '~'][Math.floor(hash(x + y * cols, 307) * 4)];
    out.setCell(x, y, glyph, inkTint(cell.fg, protectedCopy ? blue * 0.25 : blue), BLACK, cell.style);
  }
  return out;
}

function sample(surface: Surface, u: number, v: number) { return surface.getCell(Math.round(clamp01(u) * (surface.cols - 1)), Math.round(clamp01(v) * (surface.rows - 1))); }
function inkTint(color: RGB, amount: number): RGB { const l = Math.max(...color); return mix(color, [24 + l * 0.16, 82 + l * 0.34, 142 + l * 0.44], clamp01(amount)); }
function inkNoise(x: number, y: number): number { return hash(Math.floor(x), Math.floor(y)) * 0.55 + hash(Math.floor(x * 2.07 + 11), Math.floor(y * 2.07 - 7)) * 0.3 + hash(Math.floor(x * 4.13 - 5), Math.floor(y * 4.13 + 13)) * 0.15; }
function mix(a: RGB, b: RGB, t: number): RGB { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
function hash(x: number, y: number): number { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
function smoothstep(value: number): number { const t = clamp01(value); return t * t * (3 - 2 * t); }
function rangeSmoothstep(a: number, b: number, value: number): number { return smoothstep((value - a) / (b - a)); }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
