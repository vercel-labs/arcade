import { mat4Multiply, mat4RotX, mat4RotY, mat4Scale, mat4Translate, type RenderTarget } from '../engine/index.ts';
import { PLACE_Y, type PrismIntro, PrismScene, ROT_SPEED, TILT } from './prism.ts';

// The boot splash: a small white Vercel triangle that grows, extrudes into the
// glass pyramid, spins clean, then is struck by the beam — dispersion + rainbow
// blooming in — settling EXACTLY into the live prism. It's a parameterized intro
// of PrismScene (see PrismIntro): every ramp reaches its live value by SPLASH_END
// so the final frame is the first live frame (the handoff is invisible).
//
// Timeline (seconds of the shared scene clock, which starts at 0 on boot). The
// extrude OVERLAPS the grow's tail (MORPH_START < GROW_END) so the pyramid starts
// turning while it's still reaching full size — no dwell at max size before it
// rotates — and the morph window is short so the spin ramps in briskly:
//   A Hold    [0,    0.7)  small flat white triangle, still
//   B Grow    [0.7,  1.7)  triangle scales up to full size, still flat/white
//   C Extrude [1.3,  2.1)  flat→3D, white→glass, tilt + spin ease in (overlaps B)
//   D Spin    [2.1,  2.6)  clean glass pyramid rotating (no beam/disp/rainbow)
//   E Strike  [2.6,  3.6)  beam slides in from the left; on contact dispersion
//                          and the rainbow bloom up to their live strength
const HOLD_END = 0.7;
const GROW_END = 1.7;
const MORPH_START = 1.3;
const MORPH_END = 2.1;
const SPIN_END = 2.6;
export const SPLASH_END = 3.6;

const GROW_MIN = 0.5; // on-screen scale of the initial small triangle

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
// Smoothstep easing on a 0..1 progress.
function smooth(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

export class SplashScene {
  private prism = new PrismScene();

  renderScene(target: RenderTarget, t: number): void {
    this.prism.renderScene(target, t, this.buildIntro(t));
  }

  done(t: number): boolean {
    return t >= SPLASH_END;
  }

  // Map elapsed time to the prism intro for the current phase.
  private buildIntro(t: number): PrismIntro {
    // Geometry ramps. flatten 1→0 and white 1→0 over the extrude phase; grow
    // GROW_MIN→1 over the grow phase; spin/tilt ease onto the live values so by
    // MORPH_END the model matches the live one and stays on the live clock.
    const grow = GROW_MIN + (1 - GROW_MIN) * smooth((t - HOLD_END) / (GROW_END - HOLD_END));
    const morph = smooth((t - MORPH_START) / (MORPH_END - MORPH_START)); // 0 before, 1 after
    const flatten = 1 - morph;
    const white = 1 - morph;
    const tilt = TILT * morph;
    const spin = t >= MORPH_END ? t * ROT_SPEED : morph * (t * ROT_SPEED);

    const model = mat4Multiply(
      mat4Translate(0, PLACE_Y, 0),
      mat4Multiply(
        mat4Multiply(mat4RotY(spin), mat4RotX(tilt)),
        mat4Multiply(mat4Scale(1, 1, 1 - flatten), mat4Scale(grow, grow, grow)),
      ),
    );

    // Strike phase: beam leads, dispersion + rainbow bloom in slightly behind it.
    const strike = clamp01((t - SPIN_END) / (SPLASH_END - SPIN_END));
    const beam = smooth(strike / 0.55);
    const bloom = smooth((strike - 0.35) / 0.65);

    return { model, white, beam, disp: bloom, rainbow: bloom };
  }
}
