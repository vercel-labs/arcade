// Generate the production island-game Cover Flow art from Arcade's own procedural
// terrain meshes. The six distinct tiles retain the old cover's compact 3-2-1
// silhouette without using any external board-game artwork.
//
//   pnpm exec tsx src/tools/make-islanders-cover.ts [size]
import { writeFileSync } from 'node:fs';
import {
  downsample,
  lambertMaterial,
  mat4Multiply,
  mat4RotY,
  mat4Scale,
  mat4Translate,
  MeshObject,
  normalize3,
  RenderTarget,
  Scene,
  SceneRenderer,
  type LambertUniforms,
  type Vec3,
  WorldMaterialInstance,
} from '../engine/index.ts';
import { encodePng } from '../engine/texture.ts';
import { asset } from '../arcade/assets.ts';
import { animatedTileMesh, tileMesh } from '../game-visuals/islanders/index.ts';
import type { Terrain } from '../rules/islanders/types.ts';

const size = Number(process.argv[2]) || 1024;
const SS = 2;
const LIGHT: Vec3 = normalize3({ x: 0.42, y: 0.86, z: 0.5 });
const material = new WorldMaterialInstance<LambertUniforms>(lambertMaterial, {
  lightDir: LIGHT,
  ambient: 0.52,
  wrap: 0.85,
});
// Separate the layout's subtle lean from the hex orientation. Arcade's authored
// tile is flat-top by default; the reference cover is pointy-top, so each mesh
// needs an additional 30 degree turn while its centre remains on a 3-2-1 grid.
const LAYOUT_ROTATION = 0.09;
const POINTY_TOP_ROTATION = Math.PI / 6;
const X_STEP = 2.18;
const Z_STEP = X_STEP * Math.sqrt(3) / 2;
const TILE_SCALE = 1.08;
const LAYOUT_OFFSET_X = 0.18;

// Rows are deliberately separated so each authored tile remains individually
// legible after Cover Flow projects this square texture onto its angled card.
const tiles: Array<{ terrain: Terrain; x: number; z: number; seed: number }> = [
  { terrain: 'desert', x: -X_STEP, z: -Z_STEP, seed: 4 },
  { terrain: 'fields', x: 0, z: -Z_STEP, seed: 3 },
  { terrain: 'mountains', x: X_STEP, z: -Z_STEP, seed: 2 },
  { terrain: 'hills', x: -X_STEP / 2, z: 0, seed: 5 },
  { terrain: 'forest', x: X_STEP / 2, z: 0, seed: 1 },
  { terrain: 'pasture', x: 0, z: Z_STEP, seed: 0 },
];

const scene = new Scene();
for (const tile of tiles) {
  const model = mat4Multiply(
    mat4Translate(LAYOUT_OFFSET_X, 0, 0),
    mat4Multiply(
      mat4RotY(LAYOUT_ROTATION),
      mat4Multiply(
        mat4Translate(tile.x, 0, tile.z),
        mat4Multiply(mat4RotY(POINTY_TOP_ROTATION), mat4Scale(TILE_SCALE, TILE_SCALE, TILE_SCALE)),
      ),
    ),
  );
  scene.add(new MeshObject(tileMesh(tile.terrain, tile.seed), material).setMatrix(model));
  const animated = animatedTileMesh(tile.terrain, tile.seed, 0.7, { x: tile.x, z: tile.z });
  if (animated) scene.add(new MeshObject(animated, material).setMatrix(model));
}

const target = new RenderTarget(size * SS, size * SS);
target.clear(11, 14, 21);
new SceneRenderer().render(target, scene, {
  eye: { x: 0, y: 82, z: 0 },
  target: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 0, z: -1 },
  fovy: 4.82 * Math.PI / 180,
  near: 0.05,
  far: 100,
});

const display = downsample(target, SS);
const clamp = (value: number): number => value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
const data = new Uint8Array(display.width * display.height * 4);
for (let pixel = 0; pixel < display.width * display.height; pixel++) {
  data[pixel * 4] = clamp(display.color[pixel * 3]);
  data[pixel * 4 + 1] = clamp(display.color[pixel * 3 + 1]);
  data[pixel * 4 + 2] = clamp(display.color[pixel * 3 + 2]);
  data[pixel * 4 + 3] = 255;
}

const out = asset('games/islanders.png');
writeFileSync(out, encodePng({ width: display.width, height: display.height, data }));
console.log(`wrote ${out} (${display.width}x${display.height}, six authored terrain meshes)`);
