// The per-terrain builder registry and the cached mesh entry points. Static terrain bakes into
// one cached mesh per tile; only the small time-varying overlays are rebuilt per frame.
//
// Tiles are being rebuilt from reference art one at a time: fields/ is done, and the other five
// still dress the shared thin base with their older props.

import { BufferGeometry } from '../../../engine/buffer-geometry.ts';
import type { Mesh } from '../../../engine/mesh.ts';
import { ResourceCache } from '../../../engine/resources.ts';
import { type Terrain } from '../../../rules/islanders/types.ts';
import { type Build, type RGB } from '../build.ts';
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
const cache = new ResourceCache<string, Mesh>({ maxEntries: 24 });
const robberMarkerCache = new ResourceCache<string, Mesh>({ maxEntries: 24 });
// `robberOn` bakes the robber (seated on the tile's centre surface) into the returned mesh —
// the robber is available on every terrain and toggled from the HUD, never part of the tile.
export function tileMesh(terrain: Terrain, seed = 0, robberOn = false): Mesh {
  const key = `${terrain}:${seed}:${robberOn ? 1 : 0}`;
  return cache.getOrCreate(key, () => {
    const built = BUILDERS[terrain](seed);
    if (robberOn) placeRobber(built);
    return built;
  });
}

// The robber alone, seated using the same terrain/prop-aware placement as the robber baked into
// `tileMesh`. Robber movement draws this brighter marker over the hovered destination while the
// real, darker robber remains on its current tile until the click commits.
export function robberMarkerMesh(terrain: Terrain, seed = 0): Mesh {
  const key = `${terrain}:${seed}`;
  return robberMarkerCache.getOrCreate(key, () => {
    const built = BUILDERS[terrain](seed);
    const firstVertex = built.vertices.length;
    const firstIndex = built.indices.length;
    const preview: RGB = [210, 214, 224];
    placeRobber(built, preview);
    return new BufferGeometry(
      built.vertices.slice(firstVertex),
      built.indices.slice(firstIndex).map((index) => index - firstVertex),
    );
  });
}

// Small time-varying overlays. `origin` is the tile's board-space centre, allowing weather to
// move coherently across neighbouring hexes instead of restarting independently on each tile.
export class AnimatedTileMeshCache {
  private readonly meshes = new ResourceCache<string, BufferGeometry>({ maxEntries: 24 });

  mesh(terrain: Terrain, seed: number): BufferGeometry {
    const key = `${terrain}:${seed}`;
    return this.meshes.getOrCreate(key, () => new BufferGeometry());
  }
}

export function animatedTileMesh(
  terrain: Terrain,
  seed = 0,
  time = 0,
  origin: WindOrigin = { x: 0, z: 0 },
  cache?: AnimatedTileMeshCache,
): Mesh | null {
  const t = Number.isFinite(time) ? time : 0;
  const reuse = cache?.mesh(terrain, seed);
  const mesh = terrain === 'fields'
    ? animatedFieldsTile(seed, t, origin, reuse)
    : terrain === 'forest'
      ? animatedForestTile(seed, t, origin, reuse)
      : terrain === 'desert'
        ? animatedDesertTile(seed, t, origin, reuse)
        : terrain === 'pasture'
          ? animatedPastureTile(seed, t, tileMesh('pasture', seed), reuse)
          : terrain === 'hills'
            ? animatedHillsTile(seed, t, reuse)
            : null;
  if (mesh && reuse) mesh.markNeedsUpdate(0, mesh.vertices.length);
  return mesh;
}
