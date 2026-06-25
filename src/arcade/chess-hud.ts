// The chess-game UI overlay: a move-history panel (top-left) and a transient
// pre-move commentary toast (bottom-center), composited over the 3D board with
// the standard bottom bar. The move list reuses the ScrollBox component; the
// instance is module-level so its scroll state (and the history itself) survives
// the per-frame rebuild and collapsing (mount it once via mountChessHud).
//
// The panel collapses to just its "Moves" header (which reads as a button via the
// translucent fill — no line border), and expands back. It's left-anchored, so
// the "Moves" label keeps the same position in both states. Click it (or the ✕,
// shown when expanded) to toggle.
import { Box, Button, type Row, ScrollBox, Slot, Text, type LayoutBox, type Node, type Screen, type Style } from '../tui/index.ts';
import type { RGB } from '../engine/index.ts';

const HISTORY_HEIGHT = 18; // visible move rows in the panel viewport
const HISTORY_WIDTH = 22; // inner content width — header + list share it (fixed)
const ILLEGAL: RGB = [226, 92, 86]; // a move played under the illegal-moves toggle

// Long-lived so scroll position persists across frames/visits.
export const moveHistory = new ScrollBox({ id: 'chess-history', width: HISTORY_WIDTH, height: HISTORY_HEIGHT, rows: [] });

export function mountChessHud(ui: Screen): void {
  ui.mount(moveHistory);
}

// A commentary toast: a model's short rationale shown briefly before its move.
export interface Commentary {
  text: string;
  model: string; // model slug, or '' for app messages
  until: number; // seconds (`t`) after which it fades
}

// SAN log → PGN movetext ("1. e4 c5 2. Nf3 Nc6 … <result>"), pasteable into
// chess.com / any PGN reader. `result` is the PGN result token (1-0, 0-1,
// 1/2-1/2, or * for an unfinished game).
export function movesToPgn(sans: readonly string[], result = '*'): string {
  let out = '';
  for (let i = 0; i < sans.length; i += 2) {
    const black = sans[i + 1] ? ` ${sans[i + 1]}` : '';
    out += `${i / 2 + 1}. ${sans[i]}${black} `;
  }
  return `${out}${result}`.trim();
}

// One numbered move-pair row ("1. e4    e5"). White/black are independent Text
// segments so either can be tinted red (an illegal-toggle move) without affecting
// the other or the move number; the padding matches the old single-string layout.
function moveRow(n: number, white: string, black: string, whiteBad: boolean, blackBad: boolean): Node {
  return Box({ flexDirection: 'row', width: HISTORY_WIDTH }, [
    Text({ text: `${String(n).padStart(2)}. `, style: { color: 'fg' } }),
    Text({ text: white.padEnd(7), style: { color: whiteBad ? ILLEGAL : 'fg' } }),
    Text({ text: ' ', style: { color: 'fg' } }),
    Text({ text: black, style: { color: blackBad ? ILLEGAL : 'fg' } }),
  ]);
}

// SAN log → numbered move-pair rows ("1. e4    e5"), then refresh the panel.
// `illegal[i]` (parallel to `sans`) tints that ply's SAN red. Auto-follows the
// latest move ONLY when already scrolled to the bottom, so a manual scroll-up to
// review earlier moves isn't yanked back down every frame.
export function refreshMoveHistory(sans: readonly string[], illegal: readonly boolean[] = []): void {
  const rows: Row[] = [];
  for (let i = 0; i < sans.length; i += 2) {
    rows.push(moveRow(i / 2 + 1, sans[i] ?? '', sans[i + 1] ?? '', illegal[i] ?? false, illegal[i + 1] ?? false));
  }
  const prevMax = Math.max(0, moveHistory.rows.length - HISTORY_HEIGHT);
  const atBottom = moveHistory.scroll >= prevMax;
  moveHistory.rows = rows;
  const newMax = Math.max(0, rows.length - HISTORY_HEIGHT);
  moveHistory.scroll = atBottom ? newMax : Math.min(moveHistory.scroll, newMax);
}

// "anthropic/claude-opus-4.8" → "claude-opus-4.8" for compact labels.
export function shortModel(slug: string): string {
  const slash = slug.indexOf('/');
  return slash >= 0 ? slug.slice(slash + 1) : slug;
}

// "Moves" header text reads as a label, but is a clickable button (toggles the
// panel). No pill background so it looks like a heading, not a bar button.
const HEADER_BTN: Style = {
  padding: [0, 0],
  color: 'accent',
  bold: true,
  hover: { color: [255, 255, 255] },
};
// The ✕ minimize control in the expanded header's top-right corner; the copy
// control sits just right of the "Moves" label (same understated styling).
const CLOSE_BTN: Style = {
  padding: [0, 0],
  color: 'muted',
  hover: { color: [255, 255, 255] },
};
const COPY_GLYPH = '⧉'; // two overlapping squares — "copy"

// Build the full-screen chess-game overlay: the move panel pinned top-right
// (collapsible — see `minimized`/`onToggle`), a commentary toast above the bar
// (when active), then the bar.
export function buildChessGameRoot(
  region: LayoutBox,
  bar: Node,
  opts: { minimized: boolean; onToggle: () => void; onCopy: () => void; commentary: Commentary | null; t: number },
): Node {
  // Minimized: the header hugs just the "Moves" button (a tight button). Expanded:
  // a fixed-width header row with a left group — "Moves" + a copy-PGN button one
  // space to its right — and the ✕ minimize control at the right edge, aligned with
  // the list below. The panel is left-anchored, so "Moves" keeps the same screen
  // position across states.
  let header: Node;
  if (opts.minimized) {
    header = Box({ flexDirection: 'row', alignItems: 'center' }, [
      Button({ id: 'moves-toggle', label: 'Moves', onClick: opts.onToggle, style: HEADER_BTN }),
    ]);
  } else {
    header = Box({ flexDirection: 'row', justifyContent: 'between', alignItems: 'center', width: HISTORY_WIDTH }, [
      Box({ flexDirection: 'row', alignItems: 'center', gap: 1 }, [
        Button({ id: 'moves-toggle', label: 'Moves', onClick: opts.onToggle, style: HEADER_BTN }),
        Button({ id: 'moves-copy', label: COPY_GLYPH, onClick: opts.onCopy, style: CLOSE_BTN }),
      ]),
      Button({ id: 'moves-close', label: '✕', onClick: opts.onToggle, style: CLOSE_BTN }),
    ]);
  }
  // The move-list Slot stays in the tree in BOTH states — when minimized it's
  // wrapped in a 0×0 clipped box (hidden, but still "referenced") so the Screen
  // doesn't auto-unmount the ScrollBox; otherwise re-expanding would find it
  // unmounted and render an empty panel. Expanded, a one-row spacer separates the
  // header from the list so the panel doesn't feel cramped. No drawn border — the
  // translucent fill alone separates the panel from the scene, so minimized it
  // reads as a button.
  const children = opts.minimized
    ? [header, Box({ width: 0, height: 0, overflow: 'hidden' }, [Slot('chess-history')])]
    : [header, Box({ height: 1 }), Slot('chess-history')];
  const panel = Box({ flexDirection: 'column', padding: [0, 1], background: [16, 18, 26, 0.9] }, children);

  const c = opts.commentary && opts.t < opts.commentary.until ? opts.commentary : null;
  const label = c ? (c.model ? `${shortModel(c.model)}:  ${c.text}` : c.text) : '';
  const toast = c
    ? Box({ padding: [0, 2], background: [10, 12, 20, 0.94] }, [Text({ text: label, style: { color: 'fg' } })])
    : null;

  return Box({ width: region.w, height: region.h, flexDirection: 'column' }, [
    Box({ flexDirection: 'row', justifyContent: 'start', padding: [1, 2] }, [panel]),
    Box({ flexGrow: 1 }), // spacer pushes the toast + bar to the bottom
    ...(toast ? [Box({ flexDirection: 'row', justifyContent: 'center', padding: [0, 0, 1, 0] }, [toast])] : []),
    bar,
    Box({ height: 1 }), // lift the bar off the very bottom edge
  ]);
}
