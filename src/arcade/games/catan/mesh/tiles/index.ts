// The per-terrain builder registry and the cached mesh entry points. Static terrain bakes into
// one cached mesh per tile; only the small time-varying overlays are rebuilt per frame.
//
// Tiles are being rebuilt from reference art one at a time: fields/ is done, and the other five
// still dress the shared thin base with their older props.

import { type Mesh, ResourceCache } from '../../../../../engine/index.ts';
import { type Terrain } from '../../../../../rules/catan/types.ts';
import { type Build } from '../build.ts';
import { animatedDesertTile, desertTile, placeRobber } from './desert.ts';
import { animatedFieldsTile, fieldsTile } from './fields/tile.ts';
import { animatedForestTile, forestTile } from './forest.ts';
import { animatedHillsTile, hillsTile } from './hills.ts';
import { mountainsTile } from './mountains.ts';
import { animatedPastureTile, pastureTile } from './pasture.ts';
import { type WindOrigin } from './wind.ts';

const BUILDERS: Record<Terrain, (seed: number) => Build> = {
  forest: forestTile,
  hills: hillsTile,
  pasture: pastureTile,
  fields: fieldsTile,
  mountains: mountainsTile,
  desert: desertTile,
};

// Cache one baked static mesh per (terrain, seed); animated props live in a separate overlay.
const cache = new ResourceCache<string, Mesh>();
const cacheRecency = new Map<string, true>();
const MAX_CACHED_TILES = 24;

function touchCachedTile(key: string): void {
  cacheRecency.delete(key);
  cacheRecency.set(key, true);
  if (cacheRecency.size <= MAX_CACHED_TILES) return;
  const oldest = cacheRecency.keys().next().value;
  if (oldest === undefined) return;
  cacheRecency.delete(oldest);
  cache.delete(oldest);
}
// `robberOn` bakes the robber (seated on the tile's centre surface) into the returned mesh —
// the robber is available on every terrain and toggled from the HUD, never part of the tile.
export function tileMesh(terrain: Terrain, seed = 0, robberOn = false): Mesh {
  const key = `${terrain}:${seed}:${robberOn ? 1 : 0}`;
  const mesh = cache.getOrCreate(key, () => {
    const built = BUILDERS[terrain](seed);
    if (robberOn) placeRobber(built);
    return built;
  });
  touchCachedTile(key);
  return mesh;
}

// Small time-varying overlays. `origin` is the tile's board-space centre, allowing weather to
// move coherently across neighbouring hexes instead of restarting independently on each tile.
export function animatedTileMesh(terrain: Terrain, seed = 0, time = 0, origin: WindOrigin = { x: 0, z: 0 }): Mesh | null {
  const t = Number.isFinite(time) ? time : 0;
  if (terrain === 'fields') return animatedFieldsTile(seed, t, origin);
  if (terrain === 'forest') return animatedForestTile(seed, t, origin);
  if (terrain === 'desert') return animatedDesertTile(seed, t, origin);
  if (terrain === 'pasture') return animatedPastureTile(seed, t, tileMesh('pasture', seed));
  if (terrain === 'hills') return animatedHillsTile(seed, t);
  return null;
}
