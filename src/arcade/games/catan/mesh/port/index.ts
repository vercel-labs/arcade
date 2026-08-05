// The harbour ship: hull and rig, plus the cargo for the resource it trades.

import { type Mesh, ResourceCache } from '../../../../../engine/index.ts';
import { build } from '../build.ts';
import { boatCargo } from './cargo.ts';
import { boatHull, boatRig } from './hull.ts';
import { type PortKind } from './spec.ts';

const portCache = new ResourceCache<string, Mesh>();
const portRecency = new Map<string, true>();
const MAX_CACHED_PORTS = 12;

function touchCachedPort(key: string): void {
  portRecency.delete(key);
  portRecency.set(key, true);
  if (portRecency.size <= MAX_CACHED_PORTS) return;
  const oldest = portRecency.keys().next().value;
  if (oldest === undefined) return;
  portRecency.delete(oldest);
  portCache.delete(oldest);
}

export function portMesh(kind: PortKind, seed = 1): Mesh {
  const key = `${kind}:${seed}`;
  const mesh = portCache.getOrCreate(key, () => {
    const m = build();
    boatHull(m);
    boatRig(m);
    boatCargo(m, kind, seed);
    return m;
  });
  touchCachedPort(key);
  return mesh;
}
