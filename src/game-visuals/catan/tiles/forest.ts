// The forest tile: pines on rolling ground, with felled trunks and a cut woodpile.

import { mulberry32 } from '../../../engine/random.ts';
import { ResourceCache } from '../../../engine/resources.ts';
import { surfaceY, tileBase } from '../base.ts';
import { build, type Build, type RGB } from '../build.ts';
import { pine, PINE_GREENS } from '../nature.ts';
import { felledTree, lumberStack, scatter } from '../props.ts';
import { sampleWind, type WindOrigin } from './wind.ts';

interface ForestPineSpec {
  x: number;
  z: number;
  y: number;
  scale: number;
  green: RGB;
  treeSeed: number;
}

const animationLayouts = new ResourceCache<number, readonly ForestPineSpec[]>({ maxEntries: 24 });

function rememberAnimationLayout(seed: number, pines: readonly ForestPineSpec[]): readonly ForestPineSpec[] {
  animationLayouts.set(seed, pines);
  return pines;
}

function forestLayout(
  seed: number,
  hAt: (x: number, z: number) => number,
  propTarget: Build | null,
): ForestPineSpec[] {
  const rng = mulberry32((Math.abs(seed) * 2246822519 + 0x27d4eb2f) >>> 0 || 1);
  const pts = scatter(rng, 34, 0.74, 0.12).filter((p) => Math.hypot(p.x, p.z) > 0.26);
  const inner = pts.filter((p) => Math.hypot(p.x, p.z) < 0.5);
  const used = new Set<{ x: number; z: number }>();
  let ii = 0;
  const takeInner = (): { x: number; z: number } | undefined => {
    const p = inner[ii++];
    if (p) used.add(p);
    return p;
  };

  // Replaying the tiny log builders into a scratch mesh when only the animated pines are
  // requested preserves the original RNG sequence. Static props and moving trees therefore
  // agree on exactly which scattered points belong to each object.
  const props = propTarget ?? build();
  const felled = takeInner();
  if (felled) felledTree(props, felled.x, felled.z, hAt(felled.x, felled.z), rng() * Math.PI);
  for (let s = 0, n = 1 + Math.floor(rng() * 2); s < n; s++) {
    const p = takeInner();
    if (p) lumberStack(props, p.x, p.z, hAt(p.x, p.z), rng() * Math.PI, rng);
  }

  const pines: ForestPineSpec[] = [];
  let i = 0;
  for (const p of pts) {
    if (used.has(p)) continue;
    const scale = 0.68 + rng() * 0.26;
    const green = PINE_GREENS[Math.floor(rng() * PINE_GREENS.length)];
    const treeSeed = (seed * 31 + i++) | 0;
    pines.push({ x: p.x, z: p.z, y: hAt(p.x, p.z), scale, green, treeSeed });
  }
  return pines;
}

function animatedPines(target: Build, pines: readonly ForestPineSpec[], time: number, origin: WindOrigin): void {
  for (const spec of pines) {
    const wind = sampleWind(time, origin.x + spec.x, origin.z + spec.z);
    const wave = Math.sin(time * 1.18 + spec.treeSeed * 1.91 + spec.x * 2.4 + spec.z * 1.7);
    const response = 0.72 + 0.28 * wave;
    const flutter = Math.sin(time * 1.53 + spec.treeSeed * 0.73) * 0.13 * wind.strength;
    const windX = wind.x - wind.z * flutter;
    const windZ = wind.z + wind.x * flutter;
    pine(target, spec.x, spec.z, spec.y, spec.scale, spec.green, spec.treeSeed, {
      windX,
      windZ,
      strength: wind.strength * (0.84 + response * 0.34),
    });
  }
}

export function forestTile(seed: number): Build {
  const m = build();
  const GRASS: RGB = [104, 152, 108]; // deep shady green — reads clearly darker than pasture mint from afar
  const amp = 0.12;
  const gseed = seed + 3.1;
  tileBase(m, { color: GRASS, amp, seed: gseed });
  const hAt = (x: number, z: number): number => surfaceY(x, z, amp, gseed);
  rememberAnimationLayout(seed, forestLayout(seed, hAt, m));
  return m;
}

export function animatedForestTile(seed: number, time: number, origin: WindOrigin): Build {
  const m = build();
  const amp = 0.12;
  const gseed = seed + 3.1;
  const hAt = (x: number, z: number): number => surfaceY(x, z, amp, gseed);
  const cached = animationLayouts.get(seed);
  const pines = rememberAnimationLayout(seed, cached ?? forestLayout(seed, hAt, null));
  animatedPines(m, pines, time, origin);
  return m;
}

// BRICK — a raised, bumpy clay dome with a recessed hexagonal center pocket (where the number
// chip nestles). Height = broad dome + clay-clump bumps − a flat-bottomed hex indent.
