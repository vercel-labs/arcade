import { normalize3, type Vec3 } from '../../engine/math.ts';

// The playable CLI scene owns this look; browser-safe renderers import it only when their host
// explicitly asks for CLI parity, so the website cinematic does not change implicitly.
export const CHESS_IVORY: Vec3 = { x: 232, y: 228, z: 216 };
export const CHESS_BROWN: Vec3 = { x: 150, y: 96, z: 52 };
export const CHESS_LIGHT_SQUARE: Vec3 = { x: 142, y: 138, z: 130 };
export const CHESS_DARK_SQUARE: Vec3 = { x: 78, y: 74, z: 70 };
export const CHESS_FRAME: Vec3 = { x: 46, y: 43, z: 40 };
export const CHESS_KEY_DIR: Vec3 = normalize3({ x: -0.4, y: 0.85, z: 0.5 });
export const CHESS_FILL_DIR: Vec3 = normalize3({ x: 0.6, y: 0.25, z: 0.35 });
export const CHESS_AMBIENT = 0.32;
export const CHESS_KEY_STRENGTH = 0.7;
export const CHESS_FILL_STRENGTH = 0.18;
