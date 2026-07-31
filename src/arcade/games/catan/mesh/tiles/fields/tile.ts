// The wheat (fields) tile, plus the small overlay that animates its windmill rotor.

import { mulberry32 } from '../../../../../scenes/wisp.ts';
import { irregularGround, rimAndWall, surfaceY } from '../../base.ts';
import { build, type Build, type RGB, shade } from '../../build.ts';
import { harvestedRows, standingCanopy, standingWheat } from './crop.ts';
import { farmParcelPatch, fieldLayout, fieldToWorld, scaleFarmPolygon } from './layout.ts';
import { farmBush, farmShack, farmWindmillBody, farmWindmillRotor } from './props.ts';

export function fieldsTile(seed: number): Build {
  const m = build();
  const FIELD_GROUND: RGB = [220, 169, 60];
  const GRASS_BLEND: RGB = [194, 163, 69];
  const GRASS: RGB = [124, 143, 78];
  const STUBBLE_ROW: RGB = [235, 183, 66];
  const WHEAT_CANOPY: RGB = [255, 221, 63];
  const amp = 0.025;
  const groundSeed = seed + 4.2;
  const rng = mulberry32((Math.abs(seed) * 2246822519 + 0x85ebca6b) >>> 0 || 1);
  const layout = fieldLayout(rng, seed);
  const soilY = (x: number, z: number): number => surfaceY(x, z, amp, groundSeed);

  irregularGround(m, { color: FIELD_GROUND, amp, seed: groundSeed, facet: 0.065 });
  farmParcelPatch(m, layout, scaleFarmPolygon(layout.grassParcel, 1.16), soilY, GRASS_BLEND, 0.007);
  farmParcelPatch(m, layout, layout.grassParcel, soilY, GRASS, 0.011);
  harvestedRows(m, layout, soilY, STUBBLE_ROW, seed);
  standingCanopy(m, layout, soilY, WHEAT_CANOPY);
  standingWheat(m, layout, soilY, seed);

  const windmill = fieldToWorld(layout.angle, layout.windmillPosition[0], layout.windmillPosition[1]);
  const shack = fieldToWorld(layout.angle, layout.shackPosition[0], layout.shackPosition[1]);
  const shrub = fieldToWorld(layout.angle, layout.bushPosition[0], layout.bushPosition[1]);
  farmWindmillBody(m, windmill.x, windmill.z, soilY(windmill.x, windmill.z) + 0.014, layout.angle, seed * 101 + 7);
  farmShack(m, shack.x, shack.z, soilY(shack.x, shack.z) + 0.014, layout.angle + 0.1 + (rng() - 0.5) * 0.24, seed * 107 + 11);
  farmBush(m, shrub.x, shrub.z, soilY(shrub.x, shrub.z) + 0.01, 0.78 + rng() * 0.08, seed * 109 + 13);

  rimAndWall(m, shade(FIELD_GROUND, 1.03));
  return m;
}

export function animatedFieldsTile(seed: number, time: number): Build {
  const m = build();
  const amp = 0.025;
  const groundSeed = seed + 4.2;
  const rng = mulberry32((Math.abs(seed) * 2246822519 + 0x85ebca6b) >>> 0 || 1);
  const layout = fieldLayout(rng, seed);
  const windmill = fieldToWorld(layout.angle, layout.windmillPosition[0], layout.windmillPosition[1]);
  const y0 = surfaceY(windmill.x, windmill.z, amp, groundSeed) + 0.014;
  farmWindmillRotor(m, windmill.x, windmill.z, y0, layout.angle, seed * 101 + 7, time);
  return m;
}

