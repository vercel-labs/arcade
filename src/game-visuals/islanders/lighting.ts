import { normalize3, type Vec3 } from '../../engine/math.ts';

// Renderer-neutral Islanders lighting shared by the playable CLI scene and hosts that opt into
// exact CLI parity (the terminal Trailer). Browser cinematics keep their established defaults.
export const ISLANDERS_TERRAIN_LIGHT: Vec3 = normalize3({ x: 0.42, y: 0.86, z: 0.5 });
export const ISLANDERS_TERRAIN_AMBIENT = 0.52;
export const ISLANDERS_TERRAIN_WRAP = 0.85;

export const ISLANDERS_PIECE_LIGHT: Vec3 = normalize3({ x: 0.5, y: 0.72, z: 0.48 });
export const ISLANDERS_PIECE_AMBIENT = 0.62;
export const ISLANDERS_PIECE_WRAP = 1;

export const ISLANDERS_PORT_LIGHT: Vec3 = normalize3({ x: 0.62, y: 0.4, z: 0.52 });
export const ISLANDERS_PORT_WRAP = 0.95;
