// Chess-only semantic colors. Shared panel, text, scrollbar, and interaction
// chrome comes from the Arcade/TUI themes; these colors communicate chess state.

import type { RGB } from '../../../engine/index.ts';

export const CHESS_PALETTE = {
  illegal: [226, 92, 86] as RGB,
  lightPiece: [232, 228, 216] as RGB,
  darkPiece: [184, 126, 74] as RGB,
  evalLight: [232, 228, 216] as RGB,
  evalDark: [48, 46, 52] as RGB,
};
