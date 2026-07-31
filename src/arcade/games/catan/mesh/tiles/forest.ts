// The forest tile: pines on rolling ground, with felled trunks and a cut woodpile.

import { mulberry32 } from '../../../../scenes/wisp.ts';
import { surfaceY, tileBase } from '../base.ts';
import { build, type Build, type RGB } from '../build.ts';
import { pine, PINE_GREENS } from '../nature.ts';
import { felledTree, lumberStack, scatter } from '../props.ts';

export function forestTile(seed: number): Build {
  const m = build();
  const GRASS: RGB = [104, 152, 108]; // deep shady green — reads clearly darker than pasture mint from afar
  const amp = 0.12;
  const gseed = seed + 3.1;
  tileBase(m, { color: GRASS, amp, seed: gseed });
  const hAt = (x: number, z: number): number => surfaceY(x, z, amp, gseed);
  const rng = mulberry32((Math.abs(seed) * 2246822519 + 0x27d4eb2f) >>> 0 || 1);
  // A dense scatter, with the center kept clear for the (later) number chip. Lumber and the
  // felled tree are placed first (bigger footprint), then the rest of the spots become pines.
  const pts = scatter(rng, 34, 0.74, 0.12).filter((p) => Math.hypot(p.x, p.z) > 0.26);
  // Logs sit in an interior mid-radius band (like the reference) — never hugging the rim.
  const inner = pts.filter((p) => Math.hypot(p.x, p.z) < 0.5);
  const used = new Set<{ x: number; z: number }>();
  let ii = 0;
  const takeInner = (): { x: number; z: number } | undefined => {
    const p = inner[ii++];
    if (p) used.add(p);
    return p;
  };
  const felled = takeInner();
  if (felled) felledTree(m, felled.x, felled.z, hAt(felled.x, felled.z), rng() * Math.PI);
  for (let s = 0, n = 1 + Math.floor(rng() * 2); s < n; s++) {
    const p = takeInner();
    if (p) lumberStack(m, p.x, p.z, hAt(p.x, p.z), rng() * Math.PI, rng);
  }
  let i = 0;
  for (const p of pts) {
    if (used.has(p)) continue;
    pine(m, p.x, p.z, hAt(p.x, p.z), 0.68 + rng() * 0.26, PINE_GREENS[Math.floor(rng() * PINE_GREENS.length)], (seed * 31 + i++) | 0);
  }
  return m;
}

// BRICK — a raised, bumpy clay dome with a recessed hexagonal center pocket (where the number
// chip nestles). Height = broad dome + clay-clump bumps − a flat-bottomed hex indent.
