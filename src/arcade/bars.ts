// The bottom button bar for each screen, expressed as a TUI tree. This replaces
// the old currentBar()/layoutButtons() — centering is now justifyContent, the
// pill padding is style padding, and hover colors are a style overlay. Per-button
// onClick closures replace the id→action if/else that used to live in onMouse.

import { Box, Button, Text, type Node, type Style } from '../tui/index.ts';
import { BISHOP, BLACK, type Color, KNIGHT, type PieceType, QUEEN, ROOK } from '../games/chess/types.ts';
import type { RGB } from '../engine/index.ts';

export type Mode = 'attract' | 'playing' | 'demo' | 'chess' | 'chess-game';
export type RenderMode = 'color' | 'ascii' | 'luminance';

export interface BarActions {
  start(): void;
  chessGame(): void;
  demo(): void;
  back(): void;
  reset(): void;
  mode(): void;
  quit(): void;
}

// A pill: muted slate normally, bright inverted on hover/press, with a distinct
// focus tint so keyboard focus is visible. Horizontal padding gives the label a
// little room; the pill is a single row so the label is vertically centered
// (text is cell-locked, so only odd heights center — 1 row here, 3 if more body
// is wanted). A centered 2-row pill needs half-block edges + scene compositing.
const PILL: Style = {
  padding: [0, 2],
  background: [44, 46, 56],
  color: [212, 214, 224],
  bold: true,
  hover: { background: [238, 240, 248], color: [16, 16, 24] },
  focus: { background: [86, 90, 108], color: [248, 248, 252] },
  pressed: { background: [255, 255, 255], color: [12, 12, 18] },
};

// Center a string within a fixed-width field. Keeps the mode button a stable
// width as the render-mode name changes, without the label drifting left (the
// old padEnd left-anchored the text inside the pill).
function centerField(s: string, width: number): string {
  const pad = Math.max(0, width - s.length);
  const left = Math.floor(pad / 2);
  return ' '.repeat(left) + s + ' '.repeat(pad - left);
}

export function buildBar(mode: Mode, renderMode: RenderMode, a: BarActions): Node {
  const modeLabel = `mode: ${centerField(renderMode, 9)}`;
  let buttons: Node[] = [];

  if (mode === 'attract') {
    buttons = [
      Button({ id: 'start', label: 'start', onClick: a.start, style: PILL }),
      Button({ id: 'chess-game', label: 'chess game', onClick: a.chessGame, style: PILL }),
      Button({ id: 'demo', label: 'demo', onClick: a.demo, style: PILL }),
      Button({ id: 'mode', label: modeLabel, onClick: a.mode, style: PILL }),
      Button({ id: 'quit', label: 'quit', onClick: a.quit, style: PILL }),
    ];
  } else if (mode === 'demo') {
    buttons = [
      Button({ id: 'back', label: 'back', onClick: a.back, style: PILL }),
      Button({ id: 'mode', label: modeLabel, onClick: a.mode, style: PILL }),
      Button({ id: 'quit', label: 'quit', onClick: a.quit, style: PILL }),
    ];
  } else if (mode === 'chess' || mode === 'chess-game') {
    buttons = [
      Button({ id: 'back', label: 'back', onClick: a.back, style: PILL }),
      Button({ id: 'reset', label: 'reset view', onClick: a.reset, style: PILL }),
      Button({ id: 'mode', label: modeLabel, onClick: a.mode, style: PILL }),
      Button({ id: 'quit', label: 'quit', onClick: a.quit, style: PILL }),
    ];
  }

  return Box({ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 2 }, buttons);
}

// Piece colors for the promotion popup — the side's set color, lifted a touch so
// brown stays legible on the dark popup background.
const IVORY: RGB = [232, 228, 216];
const BROWN: RGB = [184, 126, 74];

// Filled chess glyphs (outline glyphs read poorly at one cell); tinted to the
// promoting side's color via the button's fg.
const PROMO_OPTIONS: { type: PieceType; sym: string; name: string }[] = [
  { type: QUEEN, sym: '♛', name: 'Queen' },
  { type: ROOK, sym: '♜', name: 'Rook' },
  { type: BISHOP, sym: '♝', name: 'Bishop' },
  { type: KNIGHT, sym: '♞', name: 'Knight' },
];

// The promotion picker: a bordered popup centered on screen, listing the four
// promotion choices. Each row shows the piece's glyph + name in the pawn's
// color. `onPick` plays the chosen promotion. Built fresh each frame like the
// bar; the Screen keeps hover/focus by id. (Cancel is handled by the orchestrator
// via Escape.)
export function buildPromotion(color: Color, onPick: (t: PieceType) => void): Node {
  const tint = color === BLACK ? BROWN : IVORY;
  const options = PROMO_OPTIONS.map((o) =>
    Button({
      id: `promo-${o.name.toLowerCase()}`,
      label: `${o.sym}  ${o.name}`,
      onClick: () => onPick(o.type),
      style: {
        padding: [0, 2],
        background: [40, 42, 52],
        color: tint,
        bold: true,
        hover: { background: [72, 76, 92] },
        focus: { background: [72, 76, 92] },
        pressed: { background: [104, 108, 126] },
      },
    }),
  );

  // No line border: the solid background already reads as a panel against the
  // busy ASCII scene, so the extra frame is visual noise. Tight padding keeps it
  // compact.
  const popup = Box(
    {
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: 1,
      padding: [1, 2],
      background: [26, 28, 36],
    },
    [
      Box({ justifyContent: 'center' }, [Text({ text: 'Promote to', style: { color: [222, 224, 234], bold: true } })]),
      ...options,
    ],
  );

  // Full-screen transparent overlay that centers the popup over the scene.
  return Box({ flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }, [popup]);
}
