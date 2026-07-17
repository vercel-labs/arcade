// Terminal output color depth. The renderer works internally in RGB; this final
// output transform keeps truecolor as-is or quantizes both foreground and
// background SGR channels to the xterm 256-color palette.

export type TerminalColorMode = 'truecolor' | '256-color';

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;

function nearestCubeLevel(value: number): { index: number; value: number } {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < CUBE_LEVELS.length; i++) {
    const distance = Math.abs(value - CUBE_LEVELS[i]);
    if (distance < bestDistance) {
      bestIndex = i;
      bestDistance = distance;
    }
  }
  return { index: bestIndex, value: CUBE_LEVELS[bestIndex] };
}

// Green-weighted RGB distance. It is intentionally inexpensive: this runs on
// every changed foreground/background cell in animated terminal frames.
function colorDistance(r: number, g: number, b: number, pr: number, pg: number, pb: number): number {
  return 3 * (r - pr) ** 2 + 6 * (g - pg) ** 2 + (b - pb) ** 2;
}
const CHROMA_THRESHOLD = 24;
const SATURATED_DARK_MIN = 0.65;
const COLORED_MID_MIN = 0.42;
const COLORED_MID_PEAK = 90;

// Muted but intentional hues need special treatment. The xterm cube has no dark
// casino green/brown/purple between black and its first 95-valued color step, so
// strict nearest-color matching turns them gray. Preserve their hue by scaling
// the dominant channel to the available cube brightness and compressing weaker
// channels; the square reduces muddy secondary-channel spill.
function huePreservingCubeIndex(r: number, g: number, b: number): number {
  const peak = Math.max(r, g, b);
  const level = Math.max(1, Math.min(5, Math.round(peak / 51)));
  const channel = (value: number): number =>
    Math.max(0, Math.min(5, Math.round((value / peak) ** 2 * level)));
  return 16 + 36 * channel(r) + 6 * channel(g) + channel(b);
}


// RGB -> nearest xterm-256 index. Compare the real (non-uniform) 6x6x6 cube
// against the grayscale ramp instead of rounding each channel to sixths. The
// old rounding made near-black blue-gray jump to saturated navy and warm ivory
// jump to yellow; nearest-palette comparison keeps those colors neutral.
export function rgbToAnsi256(r: number, g: number, b: number): number {
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const peak = Math.max(r, g, b);
  const saturation = peak === 0 ? 0 : chroma / peak;
  const preserveHue =
    (peak >= 40 && saturation >= SATURATED_DARK_MIN) ||
    (peak >= COLORED_MID_PEAK && saturation >= COLORED_MID_MIN);
  if (chroma >= CHROMA_THRESHOLD && preserveHue) return huePreservingCubeIndex(r, g, b);

  const cr = nearestCubeLevel(r);
  const cg = nearestCubeLevel(g);
  const cb = nearestCubeLevel(b);
  const cubeIndex = 16 + 36 * cr.index + 6 * cg.index + cb.index;
  const cubeDistance = colorDistance(r, g, b, cr.value, cg.value, cb.value);

  // The weighted mean is the best neutral value for the distance metric above.
  const neutral = (3 * r + 6 * g + b) / 10;
  const grayStep = Math.max(0, Math.min(23, Math.round((neutral - 8) / 10)));
  const grayValue = 8 + 10 * grayStep;
  const grayDistance = colorDistance(r, g, b, grayValue, grayValue, grayValue);

  return grayDistance < cubeDistance ? 232 + grayStep : cubeIndex;
}

// Match truecolor channel payloads inside any SGR sequence. This handles both
// standalone scene escapes and Surface's combined style + fg + bg escapes.
const TRUECOLOR_CHANNEL = /([34]8);2;(\d+);(\d+);(\d+)/g;

export function applyTerminalColorMode(output: string, mode: TerminalColorMode): string {
  if (mode === 'truecolor') return output;
  return output.replace(
    TRUECOLOR_CHANNEL,
    (_match, channel: string, r: string, g: string, b: string) =>
      `${channel};5;${rgbToAnsi256(Number(r), Number(g), Number(b))}`,
  );
}
