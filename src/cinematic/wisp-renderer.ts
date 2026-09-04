import type { Camera } from '../engine/camera.ts';
import type { RenderTarget } from '../engine/framebuffer.ts';
import { mat4MulVec4, type Mat4, type Vec3 } from '../engine/math.ts';

export type CinematicCreator = 'xai' | 'openai' | 'anthropic' | 'google' | 'deepseek';

export interface CinematicWispRenderer {
  prepare(creators: readonly CinematicCreator[]): Promise<void>;
  reset?(): void;
  draw(target: RenderTarget, vp: Mat4, camera: Camera, creator: CinematicCreator, anchor: Vec3, time: number, phase: number, scale?: number): void;
}

export function cinematicWispVisible(vp: Mat4, anchor: Vec3, scale: number): boolean {
  return mat4MulVec4(vp, { ...anchor, w: 1 }).w > scale * 3.5;
}
