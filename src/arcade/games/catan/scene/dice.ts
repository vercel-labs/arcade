// The board's dice roll: tuning constants, the tumble/bounce profile, and the per-die state the
// scene animates. Self-contained — it carries its own camera framing (an NDC box in the corner
// of the frame) rather than sharing the board camera.

import { type Mat4, mat4Identity, type Vec3 } from '../../../../engine/index.ts';

// Triggered by the HUD "roll" button: BIG dice appear over the board, tumble, land, the
// matching chips light, then the dice vanish. Drawn on top of everything (depth cleared first)
// and large, so the pips are unmistakable even in ASCII.
export type DicePhase = 'idle' | 'rolling' | 'hold';
export const DICE_ROLL_DUR = 1.8; // fall + tumble, spread out for a natural roll
export const DICE_HOLD = 1.7; // linger on the landed result (while the chips light) before vanishing
export const DICE_STAGGER = 0.12; // the second die drops a beat after the first
// Vertical profile: an accelerating free-fall from well above the window, then a few decaying
// on-screen bounces before rest. The entry height and the bounce height are decoupled so the
// dice can enter from above the terminal without the bounces flinging back off-screen.
export const DICE_FALL_H = 6.5; // entry height along the camera-up axis (starts above the window)
export const DICE_BOUNCE_H = 1.3; // peak of the first post-contact bounce (world units)
export const DICE_FALL_FRAC = 0.42; // fraction of the roll spent in the entry fall before bouncing
// A raised, ~45°-elevation eye: the result (top) face tilts toward the viewer (readable, not a
// flat top-down plane) while the front faces keep the 3D form. The x is computed per-frame in
// renderDice so the right die's edge lands near the box's right edge at any aspect (DIE_RIGHT).
export const DICE_EYE: Vec3 = { x: 0, y: 3.0, z: 2.5 };
export const DICE_TARGET: Vec3 = { x: 0, y: 1.0, z: 0 }; // aimed above the landing so the drop is visible, landing near the frame bottom
export const DIE_RIGHT = 0.65 + 0.5; // the right die's outer x (DICE_POS[1].x + half-size)
export const DICE_FOVY = (34 * Math.PI) / 180;
export const DICE_POS: Vec3[] = [
  { x: -0.65, y: 0.5, z: 0 },
  { x: 0.65, y: 0.5, z: 0 },
];
// As a die settles, tip its top (the result) toward the camera so that face reads bigger and
// more legibly than the one pointing into the screen. Eases in with the spin settle.
export const DICE_LAND_TILT = 0.34; // radians (~19°)
// NDC box the dice render into — right-aligned with (and directly above) the roll button in
// the bottom-right. Tall enough for the more front-on framing without squashing the pair.
export const DICE_BOX = { sx: 0.26, sy: 0.34, tx: 0.72, ty: -0.52 };
export const TAU = Math.PI * 2;
// Post-contact bounce profile: three decaying parabolic arcs (each 0→peak→0), so a die that
// has hit the surface hops a few times with shrinking height before coming to rest.
export function bounceArcs(b: number): number {
  const arc = (x: number): number => 4 * x * (1 - x); // a 0→1→0 hump
  if (b < 0.5) return arc(b / 0.5);
  if (b < 0.8) return 0.32 * arc((b - 0.5) / 0.3);
  return 0.1 * arc((b - 0.8) / 0.2);
}
// A die's height above its resting spot at roll progress `pd`: an accelerating free-fall from
// DICE_FALL_H for the first DICE_FALL_FRAC of the roll (so it visibly drops in from above the
// window), then the decaying bounces.
export function diceHeight(pd: number): number {
  if (pd >= 1) return 0;
  if (pd < DICE_FALL_FRAC) {
    const f = pd / DICE_FALL_FRAC;
    return DICE_FALL_H * (1 - f * f);
  }
  return DICE_BOUNCE_H * bounceArcs((pd - DICE_FALL_FRAC) / (1 - DICE_FALL_FRAC));
}
// (ax, az) that, applied as rotZ(az)·rotX(ax), bring each face value to the top.
export function faceAngles(val: number): { ax: number; az: number } {
  switch (val) {
    case 2:
      return { ax: -Math.PI / 2, az: 0 };
    case 3:
      return { ax: 0, az: Math.PI / 2 };
    case 4:
      return { ax: 0, az: -Math.PI / 2 };
    case 5:
      return { ax: Math.PI / 2, az: 0 };
    case 6:
      return { ax: Math.PI, az: 0 };
    default:
      return { ax: 0, az: 0 }; // 1
  }
}
// Clip-space remap that squeezes the dice's full-frame render into the right-side NDC box.
export function diceViewport(): Mat4 {
  const s = mat4Identity();
  s[0] = DICE_BOX.sx;
  s[5] = DICE_BOX.sy;
  s[12] = DICE_BOX.tx;
  s[13] = DICE_BOX.ty;
  return s;
}
export interface Die {
  val: number;
  spinX: number; // gross tumble turns about its X axis
  spinZ: number; // gross tumble turns about its Z axis
  yaw: number; // resting yaw about vertical (variety; the result stays on top regardless)
  yawSpin: number; // gross yaw turns during the tumble
  jx: number; // lateral landing offset (entropy in the spacing)
  jz: number; // depth landing offset
  wob: number; // amplitude of the settle-rock as it comes to rest
  dur: number; // per-die duration scale (desyncs the two dice)
}
export const freshDie = (): Die => ({ val: 1, spinX: 0, spinZ: 0, yaw: 0, yawSpin: 0, jx: 0, jz: 0, wob: 0, dur: 1 });
