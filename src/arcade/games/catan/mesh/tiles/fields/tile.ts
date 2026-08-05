// The wheat (fields) tile, plus the small overlay that animates its windmill rotor.

import { mulberry32 } from '../../../../../scenes/wisp.ts';
import { irregularGround, rimAndWall, surfaceY } from '../../base.ts';
import { build, type Build, type RGB, shade } from '../../build.ts';
import { harvestedRows, prepareStandingCanopy, standingCanopy, standingWheat, type StandingCanopyCell } from './crop.ts';
import { farmParcelPatch, type FieldLayout, fieldLayout, fieldToWorld, scaleFarmPolygon } from './layout.ts';
import { farmBush, farmShack, farmWindmillBody, farmWindmillRotor } from './props.ts';
import { sampleWind, type WindOrigin } from '../wind.ts';

const WHEAT_CANOPY: RGB = [255, 221, 63];
const MAX_ANIMATION_RECIPES = 24;

interface FieldsAnimationRecipe {
  layout: FieldLayout;
  canopy: readonly StandingCanopyCell[];
  windmill: { x: number; z: number; y: number };
}

const animationRecipes = new Map<number, FieldsAnimationRecipe>();

function rememberAnimationRecipe(
  seed: number,
  layout: FieldLayout,
  soilY: (x: number, z: number) => number,
): FieldsAnimationRecipe {
  const windmill = fieldToWorld(layout.angle, layout.windmillPosition[0], layout.windmillPosition[1]);
  const recipe = {
    layout,
    canopy: prepareStandingCanopy(layout, soilY),
    windmill: { ...windmill, y: soilY(windmill.x, windmill.z) + 0.014 },
  };
  if (!animationRecipes.has(seed) && animationRecipes.size >= MAX_ANIMATION_RECIPES) {
    const oldest = animationRecipes.keys().next().value;
    if (oldest !== undefined) animationRecipes.delete(oldest);
  }
  animationRecipes.delete(seed);
  animationRecipes.set(seed, recipe);
  return recipe;
}

export function fieldsTile(seed: number): Build {
  const m = build();
  const FIELD_GROUND: RGB = [220, 169, 60];
  const GRASS_BLEND: RGB = [194, 163, 69];
  const GRASS: RGB = [124, 143, 78];
  const STUBBLE_ROW: RGB = [235, 183, 66];
  const amp = 0.025;
  const groundSeed = seed + 4.2;
  const rng = mulberry32((Math.abs(seed) * 2246822519 + 0x85ebca6b) >>> 0 || 1);
  const layout = fieldLayout(rng, seed);
  const soilY = (x: number, z: number): number => surfaceY(x, z, amp, groundSeed);
  rememberAnimationRecipe(seed, layout, soilY);

  irregularGround(m, { color: FIELD_GROUND, amp, seed: groundSeed, facet: 0.065 });
  farmParcelPatch(m, layout, scaleFarmPolygon(layout.grassParcel, 1.16), soilY, GRASS_BLEND, 0.007);
  farmParcelPatch(m, layout, layout.grassParcel, soilY, GRASS, 0.011);
  harvestedRows(m, layout, soilY, STUBBLE_ROW, seed);
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

export function animatedFieldsTile(seed: number, time: number, origin: WindOrigin): Build {
  const m = build();
  const amp = 0.025;
  const groundSeed = seed + 4.2;
  const soilY = (x: number, z: number): number => surfaceY(x, z, amp, groundSeed);
  const recipe = animationRecipes.get(seed) ?? (() => {
    const rng = mulberry32((Math.abs(seed) * 2246822519 + 0x85ebca6b) >>> 0 || 1);
    return rememberAnimationRecipe(seed, fieldLayout(rng, seed), soilY);
  })();
  const { layout } = recipe;
  standingCanopy(
    m,
    layout,
    soilY,
    WHEAT_CANOPY,
    (x, z) => {
      const wind = sampleWind(time, origin.x + x, origin.z + z);
      // A travelling ripple makes the grain heads nod within the broader geographic gust.
      // Direction and overall energy still come from the shared board-space weather.
      const ripple = Math.sin(time * 1.42 - (origin.x + x) * wind.x * 2.1 - (origin.z + z) * wind.z * 2.1 + seed * 0.37);
      const turn = ripple * 0.16 * wind.strength;
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      return {
        x: wind.x * c - wind.z * s,
        z: wind.x * s + wind.z * c,
        strength: Math.min(1, wind.strength * (0.88 + ripple * 0.2)),
      };
    },
    recipe.canopy,
  );
  farmWindmillRotor(m, recipe.windmill.x, recipe.windmill.z, recipe.windmill.y, layout.angle, seed * 101 + 7, time);
  return m;
}
