// The harbour ship: hull and rig, plus the cargo for the resource it trades.

import { type Mesh, ResourceCache } from '../../../../../engine/index.ts';
import { build } from '../../../../../game-visuals/catan/build.ts';
import { boatCargo } from './cargo.ts';
import { boatHull, boatRig } from './hull.ts';
import { type PortKind } from './spec.ts';

const portCache = new ResourceCache<string, Mesh>({ maxEntries: 12 });

export function portMesh(kind: PortKind, seed = 1): Mesh {
  const key = `${kind}:${seed}`;
  return portCache.getOrCreate(key, () => {
    const m = build();
    boatHull(m);
    boatRig(m);
    boatCargo(m, kind, seed);
    return m;
  });
}
