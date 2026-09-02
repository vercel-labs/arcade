import { cellWidth } from '../engine/width.ts';

export const ARCADE_UNICODE_VERSION = 'arcade';

export interface ArcadeUnicodeVersionProvider {
  readonly version: string;
  wcwidth(codepoint: number): 0 | 1 | 2;
  charProperties(codepoint: number, preceding: number): number;
}

/** Keep xterm's buffer geometry identical to Arcade's Surface model. */
export const arcadeUnicodeProvider: ArcadeUnicodeVersionProvider = {
  version: ARCADE_UNICODE_VERSION,
  wcwidth: (codepoint) => cellWidth(codepoint) as 0 | 1 | 2,
  charProperties(codepoint, preceding) {
    let width = cellWidth(codepoint);
    let shouldJoin = width === 0 && preceding !== 0;
    if (shouldJoin) {
      const precedingWidth = (preceding >> 1) & 0x3;
      if (precedingWidth === 0) shouldJoin = false;
      else width = Math.max(width, precedingWidth);
    }
    return ((width & 0x3) << 1) | (shouldJoin ? 1 : 0);
  },
};
