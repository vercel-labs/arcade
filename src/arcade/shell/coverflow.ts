// An Apple Cover Flow style carousel of game covers: square covers in a fanned
// arc, the focused one head-on (its highest-resolution, most legible pose) and
// the neighbours translated sideways, pushed back, and rotated about Y so their
// inner edge tips toward the camera. A single key light dims covers as they turn
// away (selling the rotation) and each cover casts a faded floor reflection.
//
// This is pure presentation: `renderScene` takes a continuous carousel `pos`
// (integer = that cover centred); main.ts owns selection + the snap-to-slot ease
// that drives `pos`, exactly as the prism scene takes a clock `t`.

import { readFileSync } from 'node:fs';
import {
  cameraMatrices,
  type Camera,
  coverMaterial,
  FONT,
  type Mat4,
  mat4Multiply,
  mat4MulVec4,
  mat4RotY,
  mat4Scale,
  mat4Translate,
  normalize3,
  quad,
  rasterize,
  type RenderTarget,
  type Texture,
  type Vec3,
} from '../../engine/index.ts';
import { decodePng } from '../../engine/texture.ts';
import { MENU_ITEMS } from './menu.ts';
import { asset } from '../assets.ts';

const CARD_H = 0.55; // half the cover edge (square, so edge = 2·CARD_H)
const SCALE = 2 * CARD_H; // quad() is a unit square (±0.5); scale to the cover edge
const MAX_ANGLE = (60 * Math.PI) / 180; // a neighbour's turn away from head-on
const SIDE_GAP = 0.95; // sideways offset a cover reaches as the first neighbour
const SIDE_STEP = 0.62; // extra spacing for each slot further out
const SIDE_DEPTH = 0.95; // how far neighbours recede from the camera
const REFLECT = 0.46; // reflection brightness at the floor line
const COVER_BRIGHT = 1.1; // overall lift on a cover's face content
const VISIBLE = 3; // covers drawn on each side of the focus (the "fan of ~5")
const PAD = 0.07; // paper margin inside the bezel so the art doesn't hug the edge
// Launch flip: clicking a cover flips the focused cover 0→180° about Y while
// scaling it up — front art → back title — zooming until the bezel leaves frame,
// then holding the full-screen title before the game opens.
const LAUNCH_FLIP = 1.0; // seconds for the flip + zoom-in
const LAUNCH_HOLD = 0.5; // seconds holding the full-screen title
export const LAUNCH_TOTAL = LAUNCH_FLIP + LAUNCH_HOLD;
const LAUNCH_SCALE_END = 3.8; // quad scale at full zoom (bezel pushed off-screen)
const LAUNCH_TITLE_PX = 12; // texels per font pixel in the back-face title texture
// Bezel thickness. A flat uv fraction goes sub-pixel on short covers and the
// top/bottom edges then vanish into the half-block rows (while the verticals
// survive), so we floor it to a minimum on-screen pixel thickness — applied to
// all four sides equally, so the top/bottom are as visible as the sides and
// never thicker, at any terminal height.
const BASE_FRAME_UV = 0.016;
const MIN_FRAME_PX = 7; // supersampled-pixel floor (>1 cell tall) so top/bottom edges fill a full row and read as bright as the sides
const MAX_FRAME_UV = 0.05; // cap (< PAD) so a tiny cover's bezel can't crowd the art

const PAPER: Vec3 = { x: 28, y: 30, z: 40 }; // card stock behind transparent art
const FRAME: Vec3 = { x: 92, y: 101, z: 128 }; // bezel (cool grey)
const FRAME_HOT: Vec3 = { x: 245, y: 248, z: 255 }; // bezel when hovered: bright white
const LIGHT: Vec3 = normalize3({ x: 0.18, y: 0.32, z: 1 }); // key: front + a little above

const CARD_MESH = quad(0.5);
// Local-space corners of CARD_MESH (a unit quad, ±0.5), for projecting a cover's
// on-screen rectangle in coverScreenRect.
const CORNERS: [number, number][] = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

// Camera sits in front at cover-centre height, looking dead level (eye.y ==
// target.y). The level look is load-bearing: any downward pitch puts the top and
// bottom of a head-on cover at different view-space depths, so its vertical edges
// project as a faint slant that stair-steps by ±1 cell after the half-block
// downsample. Level → constant screen-x along those edges → perfectly straight.
// The floor (y=0) and reflection still sit below centre and stay in frame.
const camera: Camera = {
  eye: { x: 0, y: CARD_H, z: 2.7 },
  target: { x: 0, y: CARD_H, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fovy: (42 * Math.PI) / 180,
  near: 0.05,
  far: 100,
};

const texCache = new Map<string, Texture | null>();
function coverTex(id: string): Texture | null {
  const hit = texCache.get(id);
  if (hit !== undefined) return hit;
  let tex: Texture | null = null;
  try {
    tex = decodePng(readFileSync(asset(`games/${id}.png`)));
  } catch {
    tex = null;
  }
  texCache.set(id, tex);
  return tex;
}

function smoothstep(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

// Rasterize a game title into a square RGBA texture for the cover's back face:
// white block letters (engine 8x8 font) centred on a transparent field, so the
// cover material composites them over the dark paper. Mirrored in x because the
// back face is viewed through a 180° Y flip (the mirror cancels, so it reads
// correctly). Cached per title.
const titleCache = new Map<string, Texture>();
function titleTexture(title: string): Texture {
  const hit = titleCache.get(title);
  if (hit) return hit;
  // Trim each glyph to its inked columns and lay them out with a 1-column gap.
  const cols: boolean[][] = [];
  for (const ch of title.toUpperCase()) {
    const g = FONT[ch] ?? FONT[' '];
    let lo = 8;
    let hi = -1;
    for (let x = 0; x < 8; x++) {
      if (g.some((row) => row[x] === '1')) {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    if (hi < 0) {
      lo = 0;
      hi = 1;
    } // space → a narrow gap
    for (let x = lo; x <= hi; x++) {
      const col: boolean[] = [];
      for (let r = 0; r < 8; r++) col.push(g[r][x] === '1');
      cols.push(col);
    }
    cols.push([false, false, false, false, false, false, false, false]); // inter-glyph gap
  }
  cols.pop(); // drop the trailing gap

  const PX = LAUNCH_TITLE_PX;
  const textW = cols.length * PX;
  const textH = 8 * PX;
  const side = Math.max(textW, textH) + 12 * PX; // square + generous margin, so letters keep aspect
  const ox = Math.floor((side - textW) / 2);
  const oy = Math.floor((side - textH) / 2);
  const data = new Uint8Array(side * side * 4); // transparent by default
  for (let cx = 0; cx < cols.length; cx++) {
    for (let r = 0; r < 8; r++) {
      if (!cols[cx][r]) continue;
      for (let py = 0; py < PX; py++) {
        for (let px = 0; px < PX; px++) {
          const X = side - 1 - (ox + cx * PX + px); // mirror x for the back face
          const Y = oy + r * PX + py;
          const i = (Y * side + X) * 4;
          data[i] = 245;
          data[i + 1] = 248;
          data[i + 2] = 255;
          data[i + 3] = 255;
        }
      }
    }
  }
  const tex: Texture = { width: side, height: side, data };
  titleCache.set(title, tex);
  return tex;
}

// Place a cover whose signed distance from the focus is `d` (0 = centred). The
// pose blends smoothly over the first slot (so the snap animation eases the focus
// in/out of the head-on pose) then translates linearly for covers further out.
function coverModel(d: number): Mat4 {
  const ad = Math.abs(d);
  const sgn = d < 0 ? -1 : d > 0 ? 1 : 0;
  const s = smoothstep(ad); // 0 centred → 1 first-neighbour-and-beyond
  const x = sgn * (SIDE_GAP * s + SIDE_STEP * Math.max(0, ad - 1));
  const z = -SIDE_DEPTH * s;
  const rot = -sgn * MAX_ANGLE * s;
  // Cover centred at y=CARD_H so its bottom edge rests on the floor (y=0).
  return mat4Multiply(mat4Translate(x, CARD_H, z), mat4Multiply(mat4RotY(rot), mat4Scale(SCALE, SCALE, 1)));
}

// Project a unit-quad local point (z=0) to render-target pixels.
function quadPx(mvp: Mat4, lx: number, ly: number, W: number, H: number): { x: number; y: number } {
  const p = mat4MulVec4(mvp, { x: lx, y: ly, z: 0, w: 1 });
  const w = p.w || 1e-4;
  return { x: ((p.x / w) * 0.5 + 0.5) * W, y: (1 - ((p.y / w) * 0.5 + 0.5)) * H };
}

// Bezel thickness (uv) that yields at least MIN_FRAME_PX on-screen pixels for the
// cover's current projected height, so short covers keep visible top/bottom edges;
// capped by MAX_FRAME_UV. Uses the vertical extent (the edges most at risk).
function bezelWidth(mvp: Mat4, W: number, H: number): number {
  const hpx = Math.abs(quadPx(mvp, 0, 0.5, W, H).y - quadPx(mvp, 0, -0.5, W, H).y) || 1;
  return Math.min(MAX_FRAME_UV, Math.max(BASE_FRAME_UV, MIN_FRAME_PX / hpx));
}

function drawCover(target: RenderTarget, vp: Mat4, model: Mat4, tex: Texture, brightness: number, reflect: boolean, hot: boolean): void {
  // The reflection is the cover mirrored through the floor plane (y=0).
  const m = reflect ? mat4Multiply(mat4Scale(1, -1, 1), model) : model;
  const mvp = mat4Multiply(vp, m);
  rasterize(target, CARD_MESH, coverMaterial, {
    mvp,
    model: m,
    tex,
    paper: PAPER,
    lightDir: LIGHT,
    ambient: 0.38,
    brightness,
    frameWidth: bezelWidth(mvp, target.width, target.height),
    frameColor: hot ? FRAME_HOT : FRAME,
    pad: PAD,
    fade: reflect ? 1 : 0,
    fadeY0: -2 * CARD_H, // reflection's far edge → fully faded
    fadeY1: 0, // floor line → full strength
  });
}

export class CoverFlowScene {
  // `hoverIndex` (a cover index, or -1) is brightened to give moused-over feedback.
  renderScene(target: RenderTarget, pos: number, hoverIndex = -1): void {
    drawBackdrop(target);
    const { viewProjection } = cameraMatrices(camera, target.width / target.height);

    const n = MENU_ITEMS.length;
    const lo = Math.max(0, Math.ceil(pos - VISIBLE));
    const hi = Math.min(n - 1, Math.floor(pos + VISIBLE));
    // Paint outermost → innermost so the focus lands on top. The depth buffer
    // makes this order-independent for the covers; it only matters for the
    // reflections, which all share the floor plane.
    const order: number[] = [];
    for (let i = lo; i <= hi; i++) order.push(i);
    order.sort((a, b) => Math.abs(b - pos) - Math.abs(a - pos));

    for (const i of order) {
      const tex = coverTex(MENU_ITEMS[i].id);
      if (!tex) continue;
      const model = coverModel(i - pos);
      const hot = i === hoverIndex;
      // Hover changes only the bezel (grey → bright white); the cover's content
      // keeps its normal lit brightness.
      drawCover(target, viewProjection, model, tex, REFLECT, true, false);
      drawCover(target, viewProjection, model, tex, COVER_BRIGHT, false, hot);
    }
  }

  // The launch transition for cover `index`: flip the focused cover about Y from
  // head-on (front art) through 180° (back title) while scaling it up, until the
  // bezel leaves frame and the full-screen title holds. `t` is seconds since the
  // click; frame 0 (t=0) matches the menu's focused cover for a seamless hand-off.
  renderLaunch(target: RenderTarget, index: number, t: number): void {
    drawBackdrop(target);
    const item = MENU_ITEMS[index];
    const art = coverTex(item.id);
    if (!art) return;
    const { viewProjection } = cameraMatrices(camera, target.width / target.height);

    const p = smoothstep(Math.min(1, t / LAUNCH_FLIP)); // 0→1 over the flip, then held at 1
    const angle = Math.PI * p; // flip about Y (left-to-right from the front)
    const s = SCALE + (LAUNCH_SCALE_END - SCALE) * p;
    const model = mat4Multiply(mat4Translate(0, CARD_H, 0), mat4Multiply(mat4RotY(angle), mat4Scale(s, s, 1)));
    const mvp = mat4Multiply(viewProjection, model);

    // Past 90° the back faces us: show the title instead of the art.
    const tex = Math.abs(angle) > Math.PI / 2 ? titleTexture(item.title) : art;
    rasterize(target, CARD_MESH, coverMaterial, {
      mvp,
      model,
      tex,
      paper: PAPER,
      lightDir: LIGHT,
      ambient: 0.85, // keep both faces readable through the flip (less orientation shading)
      brightness: 1,
      frameWidth: bezelWidth(mvp, target.width, target.height),
      frameColor: FRAME,
      pad: PAD,
      fade: 0,
      fadeY0: 0,
      fadeY1: 0,
    });
  }

  // The on-screen rectangle (0-based terminal cells) of the cover at signed
  // distance `d` from the focus — the axis-aligned bounds of its projected
  // corners. Used by main.ts to hit-test the focused cover's real border (rather
  // than guessing from screen regions). Mirrors the scene's camera + aspect
  // (cols/(2·rows), since a cell is two stacked half-block pixels).
  coverScreenRect(d: number, cols: number, rows: number): { x: number; y: number; w: number; h: number } {
    const { viewProjection } = cameraMatrices(camera, cols / (2 * rows));
    const mvp = mat4Multiply(viewProjection, coverModel(d));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [lx, ly] of CORNERS) {
      const c = mat4MulVec4(mvp, { x: lx, y: ly, z: 0, w: 1 });
      const w = c.w || 1e-4;
      const sx = ((c.x / w) * 0.5 + 0.5) * cols;
      const sy = (1 - ((c.y / w) * 0.5 + 0.5)) * rows;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
}

// A subtle cool gradient: darkest at the top, brightening into a faint horizon
// band around the floor so the covers and their reflections sit in a "room"
// rather than floating on flat black.
function drawBackdrop(target: RenderTarget): void {
  const W = target.width;
  const H = target.height;
  const c = target.color;
  target.depth.fill(Infinity); // reset depth for the frame (we fill color below, so we don't call clear())
  for (let y = 0; y < H; y++) {
    const ny = y / (H - 1);
    const glow = Math.max(0, 1 - Math.abs(ny - 0.6) / 0.5);
    const base = 9 + 18 * glow * glow;
    const r = base * 0.9;
    const g = base * 0.95;
    const b = base * 1.3;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      c[i] = r;
      c[i + 1] = g;
      c[i + 2] = b;
    }
  }
}
