// The bottom button bar for each screen, expressed as a TUI tree. This replaces
// the old currentBar()/layoutButtons() — centering is now justifyContent, the
// pill padding is style padding, and hover colors are a style overlay. Per-button
// onClick closures replace the id→action if/else that used to live in onMouse.

import { Box, Button, type Node, type Style } from '../tui/index.ts';

export type Mode = 'attract' | 'playing' | 'demo' | 'chess' | 'chess-game';
export type RenderMode = 'color' | 'ascii' | 'luminance';

export interface BarActions {
  start(): void;
  chess(): void;
  chessGame(): void;
  demo(): void;
  back(): void;
  reset(): void;
  mode(): void;
  quit(): void;
}

// A pill: dim on near-black normally, bright inverted on hover/press, with a
// distinct focus tint so keyboard focus is visible.
const PILL: Style = {
  padding: [0, 2],
  background: [28, 28, 34],
  color: [180, 180, 190],
  bold: true,
  hover: { background: [235, 235, 240], color: [0, 0, 0] },
  focus: { background: [70, 70, 84], color: [245, 245, 250] },
  pressed: { background: [235, 235, 240], color: [0, 0, 0] },
};

export function buildBar(mode: Mode, renderMode: RenderMode, a: BarActions): Node {
  const modeLabel = `mode: ${renderMode.padEnd(9)}`;
  let buttons: Node[] = [];

  if (mode === 'attract') {
    buttons = [
      Button({ id: 'start', label: 'Start', onClick: a.start, style: PILL }),
      Button({ id: 'chess', label: 'Chess', onClick: a.chess, style: PILL }),
      Button({ id: 'chess-game', label: 'Chess Game', onClick: a.chessGame, style: PILL }),
      Button({ id: 'demo', label: 'Demo', onClick: a.demo, style: PILL }),
      Button({ id: 'mode', label: modeLabel, onClick: a.mode, style: PILL }),
      Button({ id: 'quit', label: 'Quit', onClick: a.quit, style: PILL }),
    ];
  } else if (mode === 'demo') {
    buttons = [
      Button({ id: 'back', label: 'Back', onClick: a.back, style: PILL }),
      Button({ id: 'mode', label: modeLabel, onClick: a.mode, style: PILL }),
      Button({ id: 'quit', label: 'Quit', onClick: a.quit, style: PILL }),
    ];
  } else if (mode === 'chess' || mode === 'chess-game') {
    buttons = [
      Button({ id: 'back', label: 'Back', onClick: a.back, style: PILL }),
      Button({ id: 'reset', label: 'Reset View', onClick: a.reset, style: PILL }),
      Button({ id: 'mode', label: modeLabel, onClick: a.mode, style: PILL }),
      Button({ id: 'quit', label: 'Quit', onClick: a.quit, style: PILL }),
    ];
  }

  return Box({ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 3 }, buttons);
}
