// The per-terrain builder registry and the cached mesh entry points. Static terrain bakes into
// one cached mesh per tile; only the small time-varying overlays are rebuilt per frame.
//
// Tiles are being rebuilt from reference art one at a time: fields/ is done, and the other five
// still dress the shared thin base with their older props.

import { type Mesh } from '../../../../../engine/index.ts';
import { type Terrain } from '../../../../../rules/catan/types.ts';
import { type Build } from '../build.ts';
import { desertTile, placeRobber } from './desert.ts';
import { animatedFieldsTile, fieldsTile } from './fields/tile.ts';
import { forestTile } from './forest.ts';
import { hillsTile } from './hills.ts';
import { mountainsTile } from './mountains.ts';
import { animatedPastureTile, pastureTile } from './pasture.ts';

const BUILDERS: Record<Terrain, (seed: number) => Build> = {
  forest: forestTile,
  hills: hillsTile,
  pasture: pastureTile,
  fields: fieldsTile,
  mountains: mountainsTile,
  desert: desertTile,
};

// Cache one baked static mesh per (terrain, seed); animated props live in a separate overlay.
const cache = new Map<string, Mesh>();
// `robberOn` bakes the robber (seated on the tile's centre surface) into the returned mesh —
// the robber is available on every terrain and toggled from the HUD, never part of the tile.
export function tileMesh(terrain: Terrain, seed = 0, robberOn = false): Mesh {
  const key = `${terrain}:${seed}:${robberOn ? 1 : 0}`;
  let m = cache.get(key);
  if (!m) {
    const built = BUILDERS[terrain](seed);
    if (robberOn) placeRobber(built);
    m = built;
    cache.set(key, m);
  }
  return m;
}

// Small time-varying overlays for the two animated terrain types. The terrain, wheat canopy,
// vegetation, and tile slab stay in tileMesh's cache; only blades and sheep are rebuilt.
export function animatedTileMesh(terrain: Terrain, seed = 0, time = 0): Mesh | null {
  const t = Number.isFinite(time) ? time : 0;
  if (terrain === 'fields') return animatedFieldsTile(seed, t);
  if (terrain === 'pasture') return animatedPastureTile(seed, t, tileMesh('pasture', seed));
  return null;
}
