// A minimal, mouse-aware button bar shared across screens. Geometry is computed
// once and used for both rendering and hit-testing so they can't drift.
export interface ButtonDef {
  id: string;
  label: string;
}

export interface ButtonRect extends ButtonDef {
  col: number;
  width: number;
  row: number;
}

export function layoutButtons(defs: ButtonDef[], cols: number, row: number, gap = 3): ButtonRect[] {
  const total = defs.reduce((s, d) => s + d.label.length, 0) + gap * Math.max(0, defs.length - 1);
  let col = Math.max(1, Math.floor((cols - total) / 2) + 1);
  return defs.map((d) => {
    const rect: ButtonRect = { id: d.id, label: d.label, col, width: d.label.length, row };
    col += d.label.length + gap;
    return rect;
  });
}

// Returns the id of the button under the (1-based) mouse cell, or null.
export function hitButtons(buttons: ButtonRect[], mx: number, my: number): string | null {
  for (const b of buttons) {
    if (my === b.row && mx >= b.col && mx < b.col + b.width) return b.id;
  }
  return null;
}

export function renderButtons(buttons: ButtonRect[], hovered: string | null): string {
  if (buttons.length === 0) return '';
  // Clear the whole bar row first: the buttons are centered, so on a width
  // change they re-center and the previous cells on this row (which nothing else
  // repaints) would otherwise persist as ghosts. ESC[2K + rewrite in one frame
  // is atomic to the terminal, so there's no flicker.
  let out = `\x1b[${buttons[0].row};1H\x1b[2K`;
  for (const b of buttons) {
    const h = b.id === hovered;
    // Minimal pill: dim on near-black normally, bright inverted on hover.
    const fg = h ? '0;0;0' : '180;180;190';
    const bg = h ? '235;235;240' : '28;28;34';
    out += `\x1b[${b.row};${b.col}H\x1b[1;38;2;${fg};48;2;${bg}m${b.label}\x1b[0m`;
  }
  return out;
}
