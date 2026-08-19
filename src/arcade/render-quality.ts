import type { RenderMode } from './shell/bars.ts';

export const GLYPH_SUPERSAMPLE = 3;
export const PIXEL_SUPERSAMPLE = 2;

// Shape matching consumes a native 3x6 sample grid per terminal cell. Pixel mode
// is downsampled before presentation, so SS2 preserves antialiasing while avoiding
// the 2.25x extra raster work of rendering the same half-block output at SS3.
export function supersampleForMode(mode: RenderMode): number {
  return mode === 'pixels' ? PIXEL_SUPERSAMPLE : GLYPH_SUPERSAMPLE;
}
