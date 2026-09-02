import { cameraMatrices, type Camera, lambertMaterial, mat4Multiply, mat4RotX, mat4RotY, mat4RotZ, mat4Translate, normalize3, rasterize, RenderTarget } from '../../engine/index.ts';
import { coldInkTint, inkNoise } from '../../engine/ink-burn.ts';
import { dieMesh } from './dice.ts';
import { DICE_BOX, DICE_EYE, DICE_FOVY, DICE_LAND_TILT, DICE_POS, DICE_ROLL_DUR, DICE_STAGGER, DICE_TARGET, DIE_RIGHT, diceHeight, diceViewport, faceAngles, TAU, type Die } from './dice-choreography.ts';

const LIGHT = normalize3({ x: -0.45, y: 0.9, z: 0.36 });

export interface IslandersDiceOverlayOptions {
  /** Keep the prior scene depth for full-frame presenters; false creates a sparse foreground mask for the CLI HUD compositor. */
  preserveSceneDepth?: boolean;
  /** Erase the settled pair through the shared cold-ink treatment; 0 is intact and 1 is gone. */
  burnProgress?: number;
  /** Scale the complete screen-space pair around its authored center. */
  scale?: number;
}

/** Production screen-space dice pass shared by the terminal game and web film. */
export function drawIslandersDiceOverlay(target: RenderTarget, dice: readonly [Die, Die], elapsed: number, rolling: boolean, options: IslandersDiceOverlayOptions = {}): void {
  const burn = clamp01(options.burnProgress ?? 0);
  if (burn > 0) {
    const layer = diceLayerFor(target);
    layer.resize(target.width, target.height);
    layer.clear();
    drawDice(layer, dice, elapsed, rolling, options.scale);
    if (!options.preserveSceneDepth) target.depth.fill(Infinity);
    compositeBurningDice(target, layer, burn);
    return;
  }
  const previousDepth = options.preserveSceneDepth ? target.depth.slice() : null;
  target.depth.fill(Infinity);
  drawDice(target, dice, elapsed, rolling, options.scale);
  if (previousDepth) {
    for (let index = 0; index < target.depth.length; index++) {
      if (!Number.isFinite(target.depth[index])) target.depth[index] = previousDepth[index];
    }
  }
}

const DICE_LAYERS = new WeakMap<RenderTarget, RenderTarget>();
function diceLayerFor(target: RenderTarget): RenderTarget {
  let layer = DICE_LAYERS.get(target);
  if (!layer) { layer = new RenderTarget(target.width, target.height); DICE_LAYERS.set(target, layer); }
  return layer;
}

function drawDice(target: RenderTarget, dice: readonly [Die, Die], elapsed: number, rolling: boolean, scale = 1): void {
  const aspect = (DICE_BOX.sx / DICE_BOX.sy) * (target.width / target.height);
  const dist = Math.hypot(DICE_EYE.y - DICE_TARGET.y, DICE_EYE.z - DICE_TARGET.z);
  const halfW = dist * Math.tan(DICE_FOVY / 2) * aspect;
  const camX = DIE_RIGHT - halfW * 0.82;
  const camera: Camera = { eye: { x: camX, y: DICE_EYE.y, z: DICE_EYE.z }, target: { x: camX, y: DICE_TARGET.y, z: DICE_TARGET.z }, up: { x: 0, y: 1, z: 0 }, fovy: DICE_FOVY, near: 0.05, far: 100 };
  const vp = mat4Multiply(diceViewport(scale), cameraMatrices(camera, aspect).viewProjection);
  const forwardY = DICE_TARGET.y - DICE_EYE.y;
  const forwardZ = DICE_TARGET.z - DICE_EYE.z;
  const forwardLength = Math.hypot(forwardY, forwardZ) || 1;
  const upY = -forwardZ / forwardLength;
  const upZ = forwardY / forwardLength;
  for (let index = 0; index < 2; index++) {
    const die = dice[index];
    const progress = rolling ? clamp01((elapsed - index * DICE_STAGGER) / (DICE_ROLL_DUR * die.dur)) : 1;
    const drop = rolling ? diceHeight(progress) : 0;
    const decay = (1 - progress) ** 2;
    const settle = 1 - decay;
    const wobProgress = clamp01((progress - 0.68) / 0.32);
    const rock = rolling ? die.wob * Math.sin(wobProgress * Math.PI * 3) * (1 - wobProgress) : 0;
    const rockZ = rolling ? die.wob * 0.6 * Math.cos(wobProgress * Math.PI * 2) * (1 - wobProgress) : 0;
    const face = faceAngles(die.val);
    const model = mat4Multiply(mat4Translate(DICE_POS[index].x + die.jx, DICE_POS[index].y + upY * drop, DICE_POS[index].z + die.jz + upZ * drop), mat4Multiply(mat4RotX(DICE_LAND_TILT * settle), mat4Multiply(mat4RotY(die.yaw + die.yawSpin * TAU * decay), mat4Multiply(mat4RotZ(face.az + die.spinZ * TAU * decay + rockZ), mat4RotX(face.ax + die.spinX * TAU * decay + rock)))));
    rasterize(target, dieMesh(), lambertMaterial, { mvp: mat4Multiply(vp, model), model, lightDir: LIGHT, ambient: 0.36, wrap: 0.25 });
  }
}

function compositeBurningDice(target: RenderTarget, layer: RenderTarget, progress: number): void {
  const W = target.width, H = target.height;
  const columns = new Array<number>(W).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const pixel = y * W + x;
    if (!Number.isFinite(layer.depth[pixel])) continue;
    columns[x]++;
  }
  const groups = occupiedColumnGroups(columns).map(([minX, maxX], seed) => diceBurnGroup(layer, minX, maxX, seed));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const pixel = y * W + x;
    if (!Number.isFinite(layer.depth[pixel])) continue;
    const group = groups.find(({ minX, maxX }) => x >= minX && x <= maxX)!;
    const field = diceBurnField(x, y, group);
    const normalized = (field - group.minField) / Math.max(1e-6, group.maxField - group.minField);
    const handoff = progress <= 0 ? 0 : progress >= 1 ? 1 : smoothstep((progress - normalized + 0.08) / 0.16);
    if (handoff >= 0.5) continue;
    const seam = 1 - Math.min(1, Math.abs(handoff - 0.5) * 3.4);
    const colorIndex = pixel * 3;
    const color = coldInkTint([layer.color[colorIndex], layer.color[colorIndex + 1], layer.color[colorIndex + 2]], false, seam);
    target.color[colorIndex] = color[0]; target.color[colorIndex + 1] = color[1]; target.color[colorIndex + 2] = color[2];
    target.depth[pixel] = layer.depth[pixel];
  }
}

interface DiceBurnGroup { minX: number; maxX: number; minY: number; maxY: number; seed: number; minField: number; maxField: number }

function occupiedColumnGroups(columns: readonly number[]): Array<[number, number]> {
  const groups: Array<[number, number]> = [];
  let start = -1;
  for (let x = 0; x <= columns.length; x++) {
    if ((columns[x] ?? 0) > 0 && start < 0) start = x;
    if ((columns[x] ?? 0) === 0 && start >= 0) { groups.push([start, x - 1]); start = -1; }
  }
  return groups;
}

function diceBurnGroup(layer: RenderTarget, minX: number, maxX: number, seed: number): DiceBurnGroup {
  let minY = layer.height, maxY = 0;
  for (let y = 0; y < layer.height; y++) for (let x = minX; x <= maxX; x++) {
    if (!Number.isFinite(layer.depth[y * layer.width + x])) continue;
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const group: DiceBurnGroup = { minX, maxX, minY, maxY, seed, minField: Infinity, maxField: -Infinity };
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (!Number.isFinite(layer.depth[y * layer.width + x])) continue;
    const field = diceBurnField(x, y, group);
    group.minField = Math.min(group.minField, field); group.maxField = Math.max(group.maxField, field);
  }
  return group;
}

function diceBurnField(x: number, y: number, group: DiceBurnGroup): number {
  const u = (x - group.minX) / Math.max(1, group.maxX - group.minX);
  const v = (y - group.minY) / Math.max(1, group.maxY - group.minY);
  const seed = group.seed * 7.31;
  const coarse = inkNoise(u * 3.2 + seed, v * 3.2 - seed);
  const fibers = Math.sin((u * 0.72 - v * 0.58) * 34 + coarse * 9 + seed) * 0.055;
  return u * 0.34 + v * 0.24 + coarse * 0.52 + fibers;
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function smoothstep(value: number): number { const t = clamp01(value); return t * t * (3 - 2 * t); }
