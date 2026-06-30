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
  decodePng,
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
} from '../engine/index.ts';
import { MENU_ITEMS } from './menu.ts';

const CARD_H = 0.55; // half the cover edge (square, so edge = 2·CARD_H)
const SCALE = 2 * CARD_H; // quad() is a unit square (±0.5); scale to the cover edge
const MAX_ANGLE = (60 * Math.PI) / 180; // a neighbour's turn away from head-on
const SIDE_GAP = 0.95; // sideways offset a cover reaches as the first neighbour
const SIDE_STEP = 0.62; // extra spacing for each slot further out
const SIDE_DEPTH = 0.95; // how far neighbours recede from the camera
const REFLECT = 0.4; // reflection brightness at the floor line
const VISIBLE = 3; // covers drawn on each side of the focus (the "fan of ~5")
const PAD = 0.07; // paper margin inside the bezel so the art doesn't hug the edge
const HOVER_BRIGHT = 1.3; // face multiplier when the focused cover is moused over

const PAPER: Vec3 = { x: 20, y: 22, z: 30 }; // card stock behind transparent art
const FRAME: Vec3 = { x: 70, y: 78, z: 100 }; // bezel
const FRAME_HOT: Vec3 = { x: 185, y: 200, z: 235 }; // bezel when hovered (lit up)
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

// Camera sits in front, near cover-centre height, looking slightly down so the
// floor (y=0) and the reflection below it stay in frame.
const camera: Camera = {
  eye: { x: 0, y: CARD_H * 1.15, z: 2.7 },
  target: { x: 0, y: CARD_H * 0.92, z: 0 },
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
    tex = decodePng(readFileSync(`public/assets/games/${id}.png`));
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

function drawCover(target: RenderTarget, vp: Mat4, model: Mat4, tex: Texture, brightness: number, reflect: boolean, hot: boolean): void {
  // The reflection is the cover mirrored through the floor plane (y=0).
  const m = reflect ? mat4Multiply(mat4Scale(1, -1, 1), model) : model;
  rasterize(target, CARD_MESH, coverMaterial, {
    mvp: mat4Multiply(vp, m),
    model: m,
    tex,
    paper: PAPER,
    lightDir: LIGHT,
    ambient: 0.32,
    brightness,
    frameWidth: 0.018,
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
      drawCover(target, viewProjection, model, tex, REFLECT, true, false);
      drawCover(target, viewProjection, model, tex, hot ? HOVER_BRIGHT : 1, false, hot);
    }
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
    const base = 6 + 16 * glow * glow;
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
