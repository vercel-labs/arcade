// Fetch an AI Gateway provider/creator logo, bake it to public/assets/logos/,
// decode it with the engine PNG decoder, and write a PPM preview by sampling the
// texture — so both the decode and the engine's sampleTexture can be eyeballed
// (convert the .ppm to PNG with `sips`, then view it). Run:
//
//   pnpm exec tsx src/tools/fetch-logo.ts <provider> [size]
//   pnpm exec tsx src/tools/fetch-logo.ts anthropic 200
//
// Logos are third-party brand assets; bake only what you use.
import { mkdirSync, writeFileSync } from 'node:fs';
import { blendOver, decodePng, sampleTexture, type RGB } from '../engine/index.ts';
import { logoUrl, LOGO_NAMES } from '../arcade/scenes/logos.ts';

const name = process.argv[2];
const size = Number(process.argv[3]) || 200;
if (!name) {
  console.error(`usage: fetch-logo <provider> [size]\nknown: ${LOGO_NAMES.join(', ')}`);
  process.exit(1);
}

const url = logoUrl(name);
if (!url) {
  console.error(`no logo for "${name}". known: ${LOGO_NAMES.join(', ')}`);
  process.exit(1);
}

const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const ASSET_DIR = 'public/assets/logos';
const pngPath = `${ASSET_DIR}/${slug}.png`;
const ppmPath = `.snapshots/logo-${slug}.ppm`;

const res = await fetch(url);
if (!res.ok) {
  console.error(`fetch failed: ${res.status} ${res.statusText} (${url})`);
  process.exit(1);
}
const bytes = new Uint8Array(await res.arrayBuffer());
mkdirSync(ASSET_DIR, { recursive: true });
writeFileSync(pngPath, bytes);

const tex = decodePng(bytes);

// Alpha coverage + tight bounding box of the visible mark — useful for the wisp
// silhouette (how much of the square is actually ink vs transparent padding).
let opaque = 0;
let minX = tex.width;
let minY = tex.height;
let maxX = 0;
let maxY = 0;
for (let y = 0; y < tex.height; y++) {
  for (let x = 0; x < tex.width; x++) {
    if (tex.data[(y * tex.width + x) * 4 + 3] > 8) {
      opaque++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
const coverage = ((100 * opaque) / (tex.width * tex.height)).toFixed(1);

// Preview: sample the texture per pixel and composite over a dark backdrop so
// transparent regions read as background — exactly how a wisp would key off alpha.
mkdirSync('.snapshots', { recursive: true });
const bg: RGB = [12, 12, 16];
const body = Buffer.alloc(size * size * 3);
for (let py = 0; py < size; py++) {
  for (let px = 0; px < size; px++) {
    const [r, g, b] = blendOver(bg, sampleTexture(tex, px / (size - 1), py / (size - 1)));
    const i = (py * size + px) * 3;
    body[i] = r;
    body[i + 1] = g;
    body[i + 2] = b;
  }
}
writeFileSync(ppmPath, Buffer.concat([Buffer.from(`P6\n${size} ${size}\n255\n`, 'ascii'), body]));

console.log(`logo: ${name} -> ${url}`);
console.log(`baked: ${pngPath} (${bytes.length} bytes)`);
console.log(`decoded: ${tex.width}x${tex.height} RGBA, ${coverage}% opaque`);
console.log(`ink bbox: x[${minX}..${maxX}] y[${minY}..${maxY}]`);
console.log(`preview: ${ppmPath} (${size}x${size}) — view with:`);
console.log(`  sips -s format png ${ppmPath} --out ${ppmPath.replace('.ppm', '.png')} -Z 1000`);
