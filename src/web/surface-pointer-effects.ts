import type { PointerBurstParticle, PointerFieldSnapshot, PointerTrailSample } from '../engine/pointer-field.ts';
import { STYLE_BOLD, Surface } from '../engine/surface.ts';

export type SurfacePointerMode = 'trail' | 'off';
export interface SurfacePointerEffectOptions { protectedTop?: number }

const VOCABULARY = 'VERCEL';
const TRAIL_LIFETIME = 1.05;

/** Ramp-style smoke: particles stamp light; stationary VERCEL cells sample it. */
export function applySurfacePointerTrail(source: Surface, pointer: PointerFieldSnapshot | null, options: SurfacePointerEffectOptions = {}): Surface {
  if (!pointer || (pointer.trail.length === 0 && pointer.bursts.length === 0)) return source;
  const protectedTop = options.protectedTop ?? 0;
  const width = source.cols, height = source.rows;
  const field = new Float32Array(width * height);
  for (const particle of pointer.trail) stampTrailParticle(field, width, height, protectedTop, particle);
  for (const particle of pointer.bursts) stampBurstParticle(field, width, height, protectedTop, particle);
  const out = new Surface(width, height); source.copyInto(out);
  for (let y = protectedTop; y < height; y++) for (let x = 0; x < width; x++) {
    const energy = Math.min(1, field[y * width + x]);
    if (energy < 0.035) continue;
    const brightness = Math.round(lerp(24, 255, Math.pow(Math.min(1, (energy - 0.035) / 0.65), 1.18)));
    const cell = source.getCell(x, y);
    const sampled = cell && cell.ch.trim() ? cell.fg : cell?.bg ?? [0, 0, 0];
    // The VERCEL lattice is translucent terminal light: retain the scene's hue
    // and exact background, then lift it toward silver according to field energy.
    const silverMix = 0.28 + energy * 0.18;
    const foreground: [number, number, number] = [
      lerp(sampled[0], brightness, silverMix),
      lerp(sampled[1], brightness, silverMix),
      lerp(sampled[2], brightness, silverMix),
    ];
    out.setCell(x, y, VOCABULARY[x % VOCABULARY.length], foreground, cell?.bg ?? [0, 0, 0], energy > 0.7 ? STYLE_BOLD : 0);
  }
  return out;
}

export function applySurfacePointerEffect(source: Surface, pointer: PointerFieldSnapshot | null, mode: SurfacePointerMode, options: SurfacePointerEffectOptions = {}): Surface {
  return mode === 'trail' ? applySurfacePointerTrail(source, pointer, options) : source;
}

function stampTrailParticle(field: Float32Array, width: number, height: number, protectedTop: number, particle: PointerTrailSample): void {
  const age = Math.min(1, particle.age / TRAIL_LIFETIME);
  // Ramp washes its particle buffer with black every frame. A fourth-power
  // envelope approximates that short luminous memory: the cursor head stays
  // hot, while the travelled centerline quickly breaks into smoke islands.
  const life = Math.pow(1 - age, 4);
  if (life <= 0.01) return;
  const drag = Math.pow(0.965 + hash(particle.id, 13) * 0.015, particle.age * 60);
  const x = particle.x - particle.vx * 0.16 * particle.age * drag;
  const y = particle.y - particle.vy * 0.09 * particle.age * drag - particle.age * 0.022;
  const speed = Math.min(1, Math.hypot(particle.vx, particle.vy) * 0.14);
  const gain = life * (0.3 + particle.strength * 0.72);
  // A compact head follows the cursor; older center stamps lose dominance so
  // they cannot join into a constant-width snake.
  stamp(field, width, height, protectedTop, x * (width - 1), y * (height - 1), 1.65 + age * 3.2 + speed, 1.05 + age * 1.9, gain, particle.id);
  if (particle.id % 4 === 0) for (let index = 0; index < 7; index++) {
    const angle = hash(particle.id * 17 + index, 41) * Math.PI * 2;
    const distance = (2.5 + hash(particle.id * 23 + index, 59) * 8.8) * (0.45 + age);
    const plumeGain = gain * (0.28 + hash(particle.id + index, 83) * 0.28);
    stamp(field, width, height, protectedTop, x * (width - 1) + Math.cos(angle) * distance, y * (height - 1) + Math.sin(angle) * distance * 0.62, 2.1 + age * 4.5, 1.25 + age * 2.8, plumeGain, particle.id + index * 97);
  }
}

function stampBurstParticle(field: Float32Array, width: number, height: number, protectedTop: number, particle: PointerBurstParticle): void {
  const life = Math.max(0, 1 - particle.age / particle.lifetime);
  if (life <= 0.01) return;
  const speed = Math.min(1, Math.hypot(particle.vx, particle.vy) * 2.8);
  const age = 1 - life;
  const sizeNoise = 0.72 + hash(particle.id, 101) * 0.52;
  const fade = Math.pow(life, 1.35);
  const x = particle.x * (width - 1), y = particle.y * (height - 1);
  // Small anisotropic wisps keep the ring porous; sparse secondary puffs peel
  // away from the perimeter without merging into one large blob.
  stamp(field, width, height, protectedTop, x, y, (0.68 + age * 0.72) * sizeNoise, (0.78 + age * 0.95) * sizeNoise, fade * (0.26 + speed * 0.3), particle.id);
  if (particle.id % 5 === 0) {
    const angle = hash(particle.id, 109) * Math.PI * 2;
    const drift = 1.2 + age * (1.5 + hash(particle.id, 113) * 2.2);
    stamp(field, width, height, protectedTop, x + Math.cos(angle) * drift, y + Math.sin(angle) * drift * 0.65, 0.62 + age * 0.8, 0.72 + age, fade * 0.18, particle.id + 211);
  }
}

function stamp(field: Float32Array, width: number, height: number, protectedTop: number, cx: number, cy: number, radiusX: number, radiusY: number, gain: number, seed: number): void {
  const minX = Math.max(0, Math.floor(cx - radiusX * 2)), maxX = Math.min(width - 1, Math.ceil(cx + radiusX * 2));
  const minY = Math.max(protectedTop, Math.floor(cy - radiusY * 2)), maxY = Math.min(height - 1, Math.ceil(cy + radiusY * 2));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const dx = (x - cx) / radiusX, dy = (y - cy) / radiusY, d2 = dx * dx + dy * dy;
    if (d2 > 4) continue;
    const noise = 0.7 + hash(Math.floor(x * 0.7) + seed, Math.floor(y * 1.3) - seed) * 0.55;
    field[y * width + x] += Math.exp(-d2 * 1.15) * gain * noise;
  }
}

function hash(x: number, y: number): number { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
