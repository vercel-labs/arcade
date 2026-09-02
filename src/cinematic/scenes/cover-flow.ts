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

export interface CoverFlowItem { id: string; title: string; backTitle?: string; enabled: boolean; externalUrl?: string }
export type CoverTextureProvider = (id: string) => Texture | null;
export interface CoverFlowCinematicState { pos: number; launch: number }

const CARD_H = 0.55;
const SCALE = 2 * CARD_H;
const MAX_ANGLE = (60 * Math.PI) / 180;
const SIDE_GAP = 0.95;
const SIDE_STEP = 0.62;
const SIDE_DEPTH = 0.95;
const REFLECT = 0.46;
const COVER_BRIGHT = 1.1;
const VISIBLE = 3;
const PAD = 0.07;
const LAUNCH_FLIP = 1;
const LAUNCH_HOLD = 0.5;
export const COVER_FLOW_LAUNCH_TOTAL = LAUNCH_FLIP + LAUNCH_HOLD;
const LAUNCH_SCALE_END = 3.8;
const CINEMATIC_LAUNCH_SCALE_END = 1.9;
const LAUNCH_TITLE_PX = 12;
const BASE_FRAME_UV = 0.016;
const MIN_FRAME_PX = 7;
const MAX_FRAME_UV = 0.05;
const PAPER: Vec3 = { x: 28, y: 30, z: 40 };
const FRAME: Vec3 = { x: 92, y: 101, z: 128 };
const FRAME_HOT: Vec3 = { x: 245, y: 248, z: 255 };
const LIGHT: Vec3 = normalize3({ x: 0.18, y: 0.32, z: 1 });
const CARD_MESH = quad(0.5);
const CORNERS: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
const CAMERA: Camera = {
  eye: { x: 0, y: CARD_H, z: 2.7 },
  target: { x: 0, y: CARD_H, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fovy: (42 * Math.PI) / 180,
  near: 0.05,
  far: 100,
};

/** Resolve an unbounded virtual carousel slot to its canonical catalogue item. */
export function coverFlowIndex(slot: number, itemCount: number): number {
  if (itemCount <= 0) return -1;
  return ((Math.round(slot) % itemCount) + itemCount) % itemCount;
}

/** Authored launcher gesture: one complete loop back to Chess, settle, flip, hold. */
export function coverFlowCinematicState(progress: number, itemCount: number): CoverFlowCinematicState {
  const p = clamp01(progress);
  const pos = p < 0.58 ? lerp(0, Math.max(0, itemCount), smootherstep(p / 0.58)) : Math.max(0, itemCount);
  return { pos, launch: smoothstep((p - 0.7) / 0.14) };
}

/** Platform-neutral Cover Flow composition shared by terminal and browser hosts. */
export class CoverFlowRenderer {
  constructor(
    readonly items: readonly CoverFlowItem[],
    private readonly textureFor: CoverTextureProvider,
  ) {}

  renderScene(target: RenderTarget, pos: number, hoverSlot: number | null = null): void {
    drawBackdrop(target);
    const { viewProjection } = cameraMatrices(CAMERA, target.width / target.height);
    if (this.items.length === 0) return;
    const lo = Math.ceil(pos - VISIBLE);
    const hi = Math.floor(pos + VISIBLE);
    const order: number[] = [];
    for (let i = lo; i <= hi; i++) order.push(i);
    order.sort((a, b) => Math.abs(b - pos) - Math.abs(a - pos));
    for (const slot of order) {
      const index = coverFlowIndex(slot, this.items.length);
      const texture = this.textureFor(this.items[index].id);
      if (!texture) continue;
      const model = coverModel(slot - pos);
      drawCover(target, viewProjection, model, texture, REFLECT, true, false);
      drawCover(target, viewProjection, model, texture, COVER_BRIGHT, false, hoverSlot !== null && slot === hoverSlot);
    }
  }

  /** Website choreography: keep the surrounding fan while the selected cover flips. */
  renderCinematic(target: RenderTarget, pos: number, launchIndex: number, launchProgress: number, cameraDistanceScale = 1): void {
    drawBackdrop(target);
    const fittedCamera = cameraDistanceScale === 1 ? CAMERA : { ...CAMERA, eye: { ...CAMERA.eye, z: CAMERA.eye.z * cameraDistanceScale } };
    const { viewProjection } = cameraMatrices(fittedCamera, target.width / target.height);
    if (this.items.length === 0) return;
    const lo = Math.ceil(pos - VISIBLE);
    const hi = Math.floor(pos + VISIBLE);
    const order: number[] = [];
    for (let i = lo; i <= hi; i++) order.push(i);
    order.sort((a, b) => Math.abs(b - pos) - Math.abs(a - pos));
    const launch = smoothstep(launchProgress);
    for (const slot of order) {
      const index = coverFlowIndex(slot, this.items.length);
      // Once selection commits, clear the carousel fan behind the launched
      // cover. Otherwise ultrawide frames retain isolated neighbor slivers
      // around the title and make the handoff look fragmented.
      if (launch > 0.72 && slot !== launchIndex) continue;
      const item = this.items[index];
      const art = this.textureFor(item.id);
      if (!art) continue;
      const launching = launch > 0 && slot === launchIndex;
      const angle = Math.PI * launch;
      // The CLI launch deliberately pushes its bezel beyond the terminal. The
      // website keeps the complete title card in frame so an ultrawide canvas
      // never resolves the back face into disconnected vertical letter bands.
      const scale = SCALE + (CINEMATIC_LAUNCH_SCALE_END - SCALE) * launch;
      const model = launching
        ? mat4Multiply(mat4Translate(0, CARD_H, 0), mat4Multiply(mat4RotY(angle), mat4Scale(scale, scale, 1)))
        : coverModel(slot - pos);
      const backFacing = launching && Math.abs(angle) > Math.PI / 2;
      const texture = backFacing ? titleTexture(item.backTitle ?? item.title) : art;
      const paper = backFacing ? { x: 48, y: 51, z: 64 } : PAPER;
      const reflection = launching ? REFLECT * (1 - smoothstep(launch / 0.45)) : REFLECT;
      if (reflection > 0.01) drawCover(target, viewProjection, model, texture, reflection, true, false, launching ? 1 : 0.38, paper);
      drawCover(target, viewProjection, model, texture, launching ? 1 : COVER_BRIGHT, false, false, launching ? 0.85 : 0.38, paper);
    }
  }

  renderLaunchProgress(target: RenderTarget, index: number, progress: number): void {
    drawBackdrop(target);
    const item = this.items[coverFlowIndex(index, this.items.length)];
    const art = item && this.textureFor(item.id);
    if (!item || !art) return;
    const { viewProjection } = cameraMatrices(CAMERA, target.width / target.height);
    const p = smoothstep(progress);
    const angle = Math.PI * p;
    const scale = SCALE + (LAUNCH_SCALE_END - SCALE) * p;
    const model = mat4Multiply(mat4Translate(0, CARD_H, 0), mat4Multiply(mat4RotY(angle), mat4Scale(scale, scale, 1)));
    const mvp = mat4Multiply(viewProjection, model);
    rasterize(target, CARD_MESH, coverMaterial, {
      mvp, model, tex: Math.abs(angle) > Math.PI / 2 ? titleTexture(item.backTitle ?? item.title) : art,
      paper: PAPER, lightDir: LIGHT, ambient: 0.85, brightness: 1,
      frameWidth: bezelWidth(mvp, target.width, target.height), frameColor: FRAME,
      pad: PAD, fade: 0, fadeY0: 0, fadeY1: 0,
    });
  }

  renderLaunch(target: RenderTarget, index: number, seconds: number): void {
    this.renderLaunchProgress(target, index, Math.min(1, seconds / LAUNCH_FLIP));
  }

  coverScreenRect(distance: number, cols: number, rows: number): { x: number; y: number; w: number; h: number } {
    const { viewProjection } = cameraMatrices(CAMERA, cols / (2 * rows));
    const mvp = mat4Multiply(viewProjection, coverModel(distance));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [lx, ly] of CORNERS) {
      const point = mat4MulVec4(mvp, { x: lx, y: ly, z: 0, w: 1 });
      const w = point.w || 1e-4;
      const x = ((point.x / w) * 0.5 + 0.5) * cols;
      const y = (1 - ((point.y / w) * 0.5 + 0.5)) * rows;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
}

function coverModel(distance: number): Mat4 {
  const absolute = Math.abs(distance), sign = Math.sign(distance), eased = smoothstep(absolute);
  return mat4Multiply(
    mat4Translate(sign * (SIDE_GAP * eased + SIDE_STEP * Math.max(0, absolute - 1)), CARD_H, -SIDE_DEPTH * eased),
    mat4Multiply(mat4RotY(-sign * MAX_ANGLE * eased), mat4Scale(SCALE, SCALE, 1)),
  );
}

function quadPx(mvp: Mat4, x: number, y: number, width: number, height: number): { x: number; y: number } {
  const point = mat4MulVec4(mvp, { x, y, z: 0, w: 1 });
  const w = point.w || 1e-4;
  return { x: ((point.x / w) * 0.5 + 0.5) * width, y: (1 - ((point.y / w) * 0.5 + 0.5)) * height };
}

function bezelWidth(mvp: Mat4, width: number, height: number): number {
  const pixels = Math.abs(quadPx(mvp, 0, 0.5, width, height).y - quadPx(mvp, 0, -0.5, width, height).y) || 1;
  return Math.min(MAX_FRAME_UV, Math.max(BASE_FRAME_UV, MIN_FRAME_PX / pixels));
}

function drawCover(target: RenderTarget, vp: Mat4, model: Mat4, texture: Texture, brightness: number, reflect: boolean, hot: boolean, ambient = 0.38, paper = PAPER): void {
  const matrix = reflect ? mat4Multiply(mat4Scale(1, -1, 1), model) : model;
  const mvp = mat4Multiply(vp, matrix);
  rasterize(target, CARD_MESH, coverMaterial, {
    mvp, model: matrix, tex: texture, paper, lightDir: LIGHT, ambient,
    brightness, frameWidth: bezelWidth(mvp, target.width, target.height),
    frameColor: hot ? FRAME_HOT : FRAME, pad: PAD,
    fade: reflect ? 1 : 0, fadeY0: -2 * CARD_H, fadeY1: 0,
  });
}

const titleCache = new Map<string, Texture>();
function titleTexture(title: string): Texture {
  const cached = titleCache.get(title);
  if (cached) return cached;
  const lines = title.toUpperCase().split('\n').map((line) => {
    const columns: boolean[][] = [];
    for (const character of line) {
      const glyph = FONT[character] ?? FONT[' '];
      let lo = 8, hi = -1;
      for (let x = 0; x < 8; x++) if (glyph.some((row) => row[x] === '1')) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
      if (hi < 0) { lo = 0; hi = 1; }
      for (let x = lo; x <= hi; x++) columns.push(glyph.map((row) => row[x] === '1'));
      columns.push(Array<boolean>(8).fill(false));
    }
    columns.pop();
    return columns;
  });
  const lineGap = 3 * LAUNCH_TITLE_PX;
  const textWidth = Math.max(...lines.map((line) => line.length), 0) * LAUNCH_TITLE_PX;
  const textHeight = lines.length * 8 * LAUNCH_TITLE_PX + Math.max(0, lines.length - 1) * lineGap;
  const side = Math.max(textWidth, textHeight) + 12 * LAUNCH_TITLE_PX;
  const oy = Math.floor((side - textHeight) / 2);
  const data = new Uint8Array(side * side * 4);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const columns = lines[lineIndex];
    const lineWidth = columns.length * LAUNCH_TITLE_PX;
    const ox = Math.floor((side - lineWidth) / 2);
    const lineY = oy + lineIndex * (8 * LAUNCH_TITLE_PX + lineGap);
    for (let cx = 0; cx < columns.length; cx++) for (let row = 0; row < 8; row++) {
      if (!columns[cx][row]) continue;
      for (let py = 0; py < LAUNCH_TITLE_PX; py++) for (let px = 0; px < LAUNCH_TITLE_PX; px++) {
        const x = side - 1 - (ox + cx * LAUNCH_TITLE_PX + px);
        const y = lineY + row * LAUNCH_TITLE_PX + py;
        const i = (y * side + x) * 4;
        data[i] = 245; data[i + 1] = 248; data[i + 2] = 255; data[i + 3] = 255;
      }
    }
  }
  const texture = { width: side, height: side, data };
  titleCache.set(title, texture);
  return texture;
}

function drawBackdrop(target: RenderTarget): void {
  target.depth.fill(Infinity);
  for (let y = 0; y < target.height; y++) {
    const glow = Math.max(0, 1 - Math.abs(y / Math.max(1, target.height - 1) - 0.6) / 0.5);
    const base = 9 + 18 * glow * glow;
    for (let x = 0; x < target.width; x++) {
      const i = (y * target.width + x) * 3;
      target.color[i] = base * 0.9; target.color[i + 1] = base * 0.95; target.color[i + 2] = base * 1.3;
    }
  }
}

function smoothstep(value: number): number { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); }
function smootherstep(value: number): number { const t = Math.max(0, Math.min(1, value)); return t * t * t * (t * (t * 6 - 15) + 10); }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
