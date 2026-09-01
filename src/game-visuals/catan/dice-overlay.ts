import { cameraMatrices, type Camera, lambertMaterial, mat4Multiply, mat4RotX, mat4RotY, mat4RotZ, mat4Translate, normalize3, rasterize, type RenderTarget } from '../../engine/index.ts';
import { dieMesh } from './dice.ts';
import { DICE_BOX, DICE_EYE, DICE_FOVY, DICE_LAND_TILT, DICE_POS, DICE_ROLL_DUR, DICE_STAGGER, DICE_TARGET, DIE_RIGHT, diceHeight, diceViewport, faceAngles, TAU, type Die } from './dice-choreography.ts';

const LIGHT = normalize3({ x: -0.45, y: 0.9, z: 0.36 });

export interface CatanDiceOverlayOptions {
  /** Keep the prior scene depth for full-frame presenters; false creates a sparse foreground mask for the CLI HUD compositor. */
  preserveSceneDepth?: boolean;
}

/** Production screen-space dice pass shared by the terminal game and web film. */
export function drawCatanDiceOverlay(target: RenderTarget, dice: readonly [Die, Die], elapsed: number, rolling: boolean, options: CatanDiceOverlayOptions = {}): void {
  const previousDepth = options.preserveSceneDepth ? target.depth.slice() : null;
  target.depth.fill(Infinity);
  const aspect = (DICE_BOX.sx / DICE_BOX.sy) * (target.width / target.height);
  const dist = Math.hypot(DICE_EYE.y - DICE_TARGET.y, DICE_EYE.z - DICE_TARGET.z);
  const halfW = dist * Math.tan(DICE_FOVY / 2) * aspect;
  const camX = DIE_RIGHT - halfW * 0.82;
  const camera: Camera = { eye: { x: camX, y: DICE_EYE.y, z: DICE_EYE.z }, target: { x: camX, y: DICE_TARGET.y, z: DICE_TARGET.z }, up: { x: 0, y: 1, z: 0 }, fovy: DICE_FOVY, near: 0.05, far: 100 };
  const vp = mat4Multiply(diceViewport(), cameraMatrices(camera, aspect).viewProjection);
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
  if (previousDepth) {
    for (let index = 0; index < target.depth.length; index++) {
      if (!Number.isFinite(target.depth[index])) target.depth[index] = previousDepth[index];
    }
  }
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
