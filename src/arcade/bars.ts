// The bottom button bar for each screen, expressed as a TUI tree. This replaces
// the old currentBar()/layoutButtons() — centering is now justifyContent, the
// pill padding is style padding, and hover colors are a style overlay. Per-button
// onClick closures replace the id→action if/else that used to live in onMouse.

import { Box, Button, type Node, type Style } from '../tui/index.ts';

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
