// Generate the Cover Flow art for the Catan-Test sandbox: render a 3D hex tile to a square
// PNG at assets/games/catan-test.png (the id the coverflow looks up). Regenerate after
// tweaking the tile look.
//
//   pnpm exec tsx src/tools/make-catan-cover.ts [terrain] [size]
import { writeFileSync } from 'node:fs';
import { downsample, RenderTarget } from '../engine/index.ts';
import { encodePng } from '../engine/texture.ts';
import { TileScene } from '../arcade/games/catan/tile-scene.ts';
import { asset } from '../arcade/assets.ts';
import { TERRAINS, type Terrain } from '../rules/catan/types.ts';

const terrain = ((TERRAINS as readonly string[]).includes(process.argv[2]) ? process.argv[2] : 'forest') as Terrain;
const size = Number(process.argv[3]) || 512;
const SS = 3;

const scene = new TileScene();
scene.setTerrain(terrain);
scene.zoomBy(0.84); // pull in a touch so the tile fills the cover

const target = new RenderTarget(size * SS, size * SS);
let t = 0;
for (let i = 0; i < 22; i++) {
  scene.renderScene(target, t); // spin the turntable to a flattering 3/4 angle
  t += 1 / 30;
}

const disp = downsample(target, SS);
const clamp = (x: number): number => (x <= 0 ? 0 : x >= 255 ? 255 : Math.round(x));
const data = new Uint8Array(disp.width * disp.height * 4);
for (let p = 0; p < disp.width * disp.height; p++) {
  data[p * 4] = clamp(disp.color[p * 3]);
  data[p * 4 + 1] = clamp(disp.color[p * 3 + 1]);
  data[p * 4 + 2] = clamp(disp.color[p * 3 + 2]);
  data[p * 4 + 3] = 255;
}
const out = asset('games/catan-test.png');
writeFileSync(out, encodePng({ width: disp.width, height: disp.height, data }));
console.log(`wrote ${out} (${disp.width}x${disp.height}, ${terrain})`);
