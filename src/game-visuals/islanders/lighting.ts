import { normalize3, type Vec3 } from '../../engine/math.ts';

// Renderer-neutral Islanders lighting shared by the playable CLI scene and hosts that opt into
// exact CLI parity (the terminal Trailer). Browser cinematics keep their established defaults.
export const ISLANDERS_TERRAIN_LIGHT: Vec3 = normalize3({ x: 0.42, y: 0.86, z: 0.5 });
export const ISLANDERS_TERRAIN_AMBIENT = 0.52;
export const ISLANDERS_TERRAIN_WRAP = 0.85;
export const ISLANDERS_SCENE_BACKGROUND: Vec3 = { x: 14, y: 16, z: 22 };
export const ISLANDERS_WATER_DEEP: Vec3 = { x: 6, y: 40, z: 66 };
export const ISLANDERS_WATER_SURFACE: Vec3 = { x: 20, y: 119, z: 157 };
export const ISLANDERS_WATER_SKY: Vec3 = { x: 94, y: 152, z: 174 };
export const ISLANDERS_WATER_HORIZON: Vec3 = { x: 205, y: 185, z: 146 };
export const ISLANDERS_WATER_CURRENT: Vec3 = { x: 183, y: 229, z: 225 };
export const ISLANDERS_WATER_FLOW_SPEED = 0.22;

export const ISLANDERS_PIECE_LIGHT: Vec3 = normalize3({ x: 0.5, y: 0.72, z: 0.48 });
export const ISLANDERS_PIECE_AMBIENT = 0.62;
export const ISLANDERS_PIECE_WRAP = 1;

export const ISLANDERS_PORT_LIGHT: Vec3 = normalize3({ x: 0.62, y: 0.4, z: 0.52 });
export const ISLANDERS_PORT_WRAP = 0.95;
