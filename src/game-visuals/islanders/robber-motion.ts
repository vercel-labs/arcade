import { smoothstep, travelPoint, type Vec3 } from '../../engine/index.ts';

export const ROBBER_MOVE_DURATION = 0.9;
export const ROBBER_MOVE_ARC_HEIGHT = 1.45;

export function robberFlightPoint(from: { x: number; z: number }, to: { x: number; z: number }, progress: number): Vec3 {
  return travelPoint(
    { x: from.x, y: 0, z: from.z },
    { x: to.x, y: 0, z: to.z },
    smoothstep(progress),
    ROBBER_MOVE_ARC_HEIGHT,
  );
}
