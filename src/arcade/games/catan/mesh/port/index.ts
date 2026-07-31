// The harbour ship: hull and rig, plus the cargo for the resource it trades.

import { type Mesh } from '../../../../../engine/index.ts';
import { build } from '../build.ts';
import { boatCargo } from './cargo.ts';
import { boatHull, boatRig } from './hull.ts';
import { type PortKind } from './spec.ts';

const portCache = new Map<string, Mesh>();
export function portMesh(kind: PortKind, seed = 1): Mesh {
  const key = `${kind}:${seed}`;
  const cached = portCache.get(key);
  if (cached) return cached;
  const m = build();
  boatHull(m);
  boatRig(m);
  boatCargo(m, kind, seed);
  portCache.set(key, m);
  return m;
}

