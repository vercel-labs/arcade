// A board-space wind field shared by every animated terrain. Wind is weather, not a per-tile
// prop: neighbouring hexes sample nearly the same direction and gust strength, while broad
// travelling bands let one side of the island catch a gust shortly before the other.

import { smooth } from '../build.ts';

export interface WindOrigin {
  x: number;
  z: number;
}

export interface WindSample {
  x: number;
  z: number;
  strength: number;
}

const WEATHER_SECONDS = 9.5;

const fract = (x: number): number => x - Math.floor(x);
const hash = (n: number): number => fract(Math.sin(n * 91.733 + 17.17) * 43758.5453123);

interface WeatherState {
  angle: number;
  strength: number;
}

function weatherState(index: number): WeatherState {
  const direction = hash(index * 1.731 + 3.7);
  const energy = hash(index * 2.417 - 8.3);
  // Roughly two fifths of the weather states are genuinely calm. The others range from a
  // light breeze to a strong gust, with powerful wind deliberately uncommon.
  const strength = energy < 0.4 ? 0 : 0.16 + 0.84 * smooth((energy - 0.4) / 0.6) ** 1.35;
  return { angle: direction * Math.PI * 2, strength };
}

function interpolateDirection(a: number, b: number, amount: number): { x: number; z: number } {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  const angle = a + delta * amount;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}

export function sampleWind(time: number, worldX: number, worldZ: number): WindSample {
  const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
  const epoch = safeTime / WEATHER_SECONDS;
  const index = Math.floor(epoch);
  const blend = smooth(epoch - index);
  const current = weatherState(index);
  const next = weatherState(index + 1);
  const baseDirection = interpolateDirection(current.angle, next.angle, blend);
  const baseStrength = current.strength + (next.strength - current.strength) * blend;

  // Direction changes are broad and spatially smooth: adjacent hexes lean together rather
  // than choosing independent headings. The perturbation is intentionally much smaller than
  // the global weather shift.
  const localTurn = Math.sin(worldX * 0.18 + worldZ * 0.14 + safeTime * 0.075) * 0.13 * baseStrength;
  const c = Math.cos(localTurn);
  const s = Math.sin(localTurn);
  const x = baseDirection.x * c - baseDirection.z * s;
  const z = baseDirection.x * s + baseDirection.z * c;

  // A wide, slowly-advecting gust front. Its wavelength spans several hexes, creating visible
  // geographic clusters without hard cell boundaries. It can modulate active wind, but never
  // manufactures motion during a globally calm weather state.
  const along = worldX * x + worldZ * z;
  const across = -worldX * z + worldZ * x;
  const front = 0.5 + 0.5 * Math.sin(along * 0.58 - safeTime * 0.46 + Math.sin(across * 0.24 + safeTime * 0.09) * 0.8);
  const gust = 0.42 + 0.58 * smooth(front);
  return { x, z, strength: Math.max(0, Math.min(1, baseStrength * gust)) };
}
