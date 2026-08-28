import type { RenderMode } from './shell/bars.ts';

export const GLYPH_SUPERSAMPLE = 3;
export const PIXEL_SUPERSAMPLE = 2;
export const PIXEL_SSAA_MAX_CELLS = 140_000;

// Shape matching consumes a native 3x6 sample grid per terminal cell. Pixel mode
// is downsampled before presentation, so SS2 preserves antialiasing while avoiding
// the 2.25x extra raster work of rendering the same half-block output at SS3.
export function supersampleForMode(mode: RenderMode): number {
  return mode === 'pixels' ? PIXEL_SUPERSAMPLE : GLYPH_SUPERSAMPLE;
}

// At very high terminal resolutions a single terminal cell is already represented by two
// physical output pixels. Keeping SS2 beyond this point quadruples raster and downsample work
// for antialiasing that is no longer perceptible at ordinary viewing size. Cap that internal
// drawing-buffer cost while retaining SS2 on normal-sized terminals.
export function supersampleForViewport(mode: RenderMode, cols: number, rows: number): number {
  if (mode === 'pixels' && cols * rows > PIXEL_SSAA_MAX_CELLS) return 1;
  return supersampleForMode(mode);
}
