import type { RGB } from '../engine/color.ts';
import { Surface } from '../engine/surface.ts';

const BLACK: RGB = [0, 0, 0];
export type CinematicDisplayMode = 'ascii' | 'hybrid' | 'pixel';
export interface DisplayModeTransition { from: CinematicDisplayMode; to: CinematicDisplayMode; mix: number }

export function islandersDisplaySequence(progress: number): DisplayModeTransition {
  const p = clamp01(progress);
  if (p < 0.72) return { from: 'ascii', to: 'ascii', mix: 0 };
  if (p < 0.78) return { from: 'ascii', to: 'hybrid', mix: (p - 0.72) / 0.06 };
  if (p < 0.84) return { from: 'hybrid', to: 'pixel', mix: (p - 0.78) / 0.06 };
  if (p < 0.9) return { from: 'pixel', to: 'hybrid', mix: (p - 0.84) / 0.06 };
  if (p < 0.96) return { from: 'hybrid', to: 'ascii', mix: (p - 0.9) / 0.06 };
  return { from: 'ascii', to: 'ascii', mix: 0 };
}

export function displayModeWave(from: Surface, to: Surface, progress: number): Surface {
  if (from.cols !== to.cols || from.rows !== to.rows) throw new Error('Display-mode surfaces must have matching dimensions');
  const out = new Surface(from.cols, from.rows);
  out.fillRect(0, 0, out.cols, out.rows, BLACK);
  for (let y = 0; y < out.rows; y++) for (let x = 0; x < out.cols; x++) {
    const delay = (1 - x / Math.max(1, out.cols - 1)) * 0.72 + (cellHash(x, y) - 0.5) * 0.1;
    const changed = smoothstep(clamp01((progress - delay) / 0.28));
    const cell = (changed >= 0.5 ? to : from).getCell(x, y);
    if (cell?.opaque) out.setCell(x, y, cell.ch, cell.fg, cell.bg, cell.style);
  }
  return out;
}

function cellHash(x: number, y: number): number { const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return value - Math.floor(value); }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function smoothstep(value: number): number { const t = clamp01(value); return t * t * (3 - 2 * t); }
