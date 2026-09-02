import { type Mat4, mat4Identity, type Vec3 } from '../../engine/index.ts';

export type DicePhase = 'idle' | 'rolling' | 'hold' | 'burning';
export const DICE_ROLL_DUR = 1.8;
export const DICE_HOLD = 1.7;
export const DICE_BURN_DUR = 0.85;
export const DICE_STAGGER = 0.12;
export const DICE_CINEMATIC_START = 0.34;
export const DICE_CINEMATIC_ROLL_SPAN = 0.27;
export const DICE_CINEMATIC_BURN_START = 0.66;
export const DICE_CINEMATIC_BURN_END = 0.72;
export const DICE_FALL_H = 6.5;
export const DICE_BOUNCE_H = 1.3;
export const DICE_FALL_FRAC = 0.42;
export const DICE_EYE: Vec3 = { x: 0, y: 3, z: 2.5 };
export const DICE_TARGET: Vec3 = { x: 0, y: 1, z: 0 };
export const DIE_RIGHT = 1.15;
export const DICE_FOVY = (34 * Math.PI) / 180;
export const DICE_POS: Vec3[] = [{ x: -0.65, y: 0.5, z: 0 }, { x: 0.65, y: 0.5, z: 0 }];
export const DICE_LAND_TILT = 0.34;
export const DICE_BOX = { sx: 0.26, sy: 0.34, tx: 0.72, ty: -0.52 };
export const TAU = Math.PI * 2;

export function bounceArcs(b: number): number {
  const arc = (x: number): number => 4 * x * (1 - x);
  if (b < 0.5) return arc(b / 0.5);
  if (b < 0.8) return 0.32 * arc((b - 0.5) / 0.3);
  return 0.1 * arc((b - 0.8) / 0.2);
}

export function diceHeight(progress: number): number {
  if (progress >= 1) return 0;
  if (progress < DICE_FALL_FRAC) {
    const fall = progress / DICE_FALL_FRAC;
    return DICE_FALL_H * (1 - fall * fall);
  }
  return DICE_BOUNCE_H * bounceArcs((progress - DICE_FALL_FRAC) / (1 - DICE_FALL_FRAC));
}

export function faceAngles(value: number): { ax: number; az: number } {
  switch (value) {
    case 2: return { ax: -Math.PI / 2, az: 0 };
    case 3: return { ax: 0, az: Math.PI / 2 };
    case 4: return { ax: 0, az: -Math.PI / 2 };
    case 5: return { ax: Math.PI / 2, az: 0 };
    case 6: return { ax: Math.PI, az: 0 };
    default: return { ax: 0, az: 0 };
  }
}

export function diceViewport(): Mat4 {
  const viewport = mat4Identity();
  viewport[0] = DICE_BOX.sx;
  viewport[5] = DICE_BOX.sy;
  viewport[12] = DICE_BOX.tx;
  viewport[13] = DICE_BOX.ty;
  return viewport;
}

export interface Die { val: number; spinX: number; spinZ: number; yaw: number; yawSpin: number; jx: number; jz: number; wob: number; dur: number }
export const freshDie = (): Die => ({ val: 1, spinX: 0, spinZ: 0, yaw: 0, yawSpin: 0, jx: 0, jz: 0, wob: 0, dur: 1 });

export function cinematicDiceState(progress: number): { visible: boolean; elapsed: number; rolling: boolean; burn: number } {
  const p = clamp01(progress);
  const roll = clamp01((p - DICE_CINEMATIC_START) / DICE_CINEMATIC_ROLL_SPAN);
  const burn = clamp01((p - DICE_CINEMATIC_BURN_START) / (DICE_CINEMATIC_BURN_END - DICE_CINEMATIC_BURN_START));
  return { visible: p > DICE_CINEMATIC_START && burn < 1, elapsed: roll * 3.25, rolling: roll < 0.68, burn };
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
