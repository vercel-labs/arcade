// Repeatable visual audit of every selectable creator wisp — a contact sheet.
// Renders each creator's will-o'-wisp (the same Wisp used in-app) into its own
// labeled tile and writes one PPM grid, so the whole set can be eyeballed for
// pass/fail after a logo/material change and when new creators appear. Convert +
// view like any snapshot:
//
//   pnpm exec tsx src/tools/wisp-audit.ts [cols] [rows] [out.ppm]
//   sips -s format png .snapshots/wisp-audit.ppm --out .snapshots/wisp-audit.png -Z 2400
//   # then Read .snapshots/wisp-audit.png
//
// Creators come from the live catalog (match/models) so the audit tracks exactly
// what the picker offers; a creator with no baked logo shows its neutral-grey
// initial fallback, which is itself a valid audit result.
import { writeFileSync } from 'node:fs';
import { bloom, downsample, FONT, RenderTarget, type Camera, cameraMatrices } from '../engine/index.ts';
import { OrbitCamera } from '../arcade/orbit.ts';
import { loadCreatorWisp, mulberry32 } from '../arcade/scenes/wisp.ts';
import { creators } from '../arcade/match/models.ts';

const FOVY = (50 * Math.PI) / 180;
const SS = 3; // supersample factor, matching the other snapshots
const NCOL = 5; // tiles per row

// Each tile is a small half-block image (tileCols wide × tileRows*2 tall pixels),
// with a label band of `LABEL` char-rows (8px each) stamped above the wisp.
const TILE_COLS = 46;
const TILE_ROWS = 26; // half-block rows for the wisp render
const LABEL = 10; // pixels reserved at the top of each tile for the name

function renderWisp(slug: string): { r: ArrayLike<number>; w: number; h: number } {
  const scene = new OrbitCamera({ azimuth: 0.4, elevation: 0.14, distance: 4.0, target: { x: 0, y: 0, z: 0 } }, 2, 30);
  const wisp = loadCreatorWisp(slug, 0, mulberry32(0xa0d10));
  wisp.setSpeaking(true); // lively flame so the mark reads at full gain
  const W = TILE_COLS;
  const H = TILE_ROWS * 2;
  const target = new RenderTarget(W * SS, H * SS);
  const eye = scene.eye();
  const camera: Camera = { eye, target: scene.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 200 };
  const { viewProjection: vp } = cameraMatrices(camera, W / H);
  const { right, up } = scene.basis();
  // A couple of warm-up frames so the flame/embers settle, then the frame we keep.
  let t = 0;
  for (let i = 0; i < 8; i++) {
    target.clear(0, 0, 0);
    wisp.renderWorld(target, vp, right, up, { x: 0, y: 0, z: 0 }, W, H, t, 1 / 30);
    t += 1 / 30;
  }
  const display = downsample(target, SS);
  bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });
  return { r: display.color, w: display.width, h: display.height };
}

function main(): void {
  const slugs = creators().map((c) => c.slug);
  const nrow = Math.ceil(slugs.length / NCOL);
  const W = NCOL * TILE_COLS;
  const H = nrow * (TILE_ROWS * 2 + LABEL);
  const body = Buffer.alloc(W * H * 3);
  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = (y * W + x) * 3;
    body[i] = Math.max(0, Math.min(255, Math.round(r)));
    body[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
    body[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
  };
  // Stamp a string in the 8×8 bitmap font at 1px/font-px, clipped to the tile.
  const label = (text: string, ox: number, oy: number): void => {
    let cx = ox;
    for (const ch of text.toUpperCase()) {
      const glyph = FONT[ch] ?? FONT['?'];
      for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 8; gx++) if (glyph[gy][gx] === '1') put(cx + gx, oy + gy, 210, 214, 226);
      cx += 6; // proportional-ish spacing
    }
  };

  slugs.forEach((slug, idx) => {
    const col = idx % NCOL;
    const row = Math.floor(idx / NCOL);
    const x0 = col * TILE_COLS;
    const y0 = row * (TILE_ROWS * 2 + LABEL);
    label(slug.slice(0, 7), x0 + 1, y0 + 1);
    const { r, w, h } = renderWisp(slug);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      put(x0 + x, y0 + LABEL + y, r[i], r[i + 1], r[i + 2]);
    }
    console.log(`  ${slug}`);
  });

  const out = process.argv.find((a) => a.endsWith('.ppm')) ?? '.snapshots/wisp-audit.ppm';
  writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii'), body]));
  console.log(`wrote ${out} (${W}x${H}) — ${slugs.length} creators`);
}

main();
