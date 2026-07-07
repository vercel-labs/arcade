// The chess-game UI overlay: a move-history panel (top-left) and a transient
// pre-move commentary toast (bottom-left, aligned with the bar's left inset),
// composited over the 3D board with
// the standard bottom bar. The move list reuses the ScrollBox component; the
// instance is module-level so its scroll state (and the history itself) survives
// the per-frame rebuild and collapsing (mount it once via mountChessHud).
//
// The panel collapses to just its "Moves" header (which reads as a button via the
// translucent fill — no line border), and expands back. It's left-anchored, so
// the "Moves" label keeps the same position in both states. Click it (or the ✕,
// shown when expanded) to toggle.
import { Box, Button, type Row, ScrollBox, Slot, Text, type LayoutBox, type Node, type Screen, type Style } from '../../../tui/index.ts';
import type { RGB, RGBA } from '../../../engine/index.ts';
import type { ChessResult } from '../../../rules/chess/chess.ts';
import { WHITE } from '../../../rules/chess/types.ts';
import { CHAT_WIDTH, chatBox, mountChat, PANEL_PAD_L, PANEL_PAD_R } from './chat.ts';

const HISTORY_HEIGHT = 18; // MAX visible move rows — the panel grows to this, then scrolls
const HISTORY_WIDTH = 22; // inner content width — header + list share it (fixed)
const ILLEGAL: RGB = [226, 92, 86]; // a move played under the illegal-moves toggle

// Long-lived so scroll position persists across frames/visits. autoHeight: the
// panel is only as tall as the moves played (tiny/empty at game start) and grows
// until it hits HISTORY_HEIGHT, where the scrollbar takes over.
export const moveHistory = new ScrollBox({ id: 'chess-history', width: HISTORY_WIDTH, height: HISTORY_HEIGHT, rows: [], autoHeight: true });

export function mountChessHud(ui: Screen): void {
  ui.mount(moveHistory);
  mountChat(ui);
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

// ── Eval bar ──────────────────────────────────────────────────────────────────
// A chess.com-style vertical eval rail near the right edge. White fills from the
// bottom, black from the top; the divider — always a clean straight line across
// the full width — moves with the evaluation. Fed a white-POV centipawn score
// (see games/chess/eval.ts) — presentation only. The rail is thin and floats with
// a gap above and below (it doesn't run to the screen edges).
const EVAL_RAIL_W = 3; // rail thickness (cells) — odd, so it has a true center column
const EVAL_COL_W = 5; // column width, sized to hold the numeric label
const EVAL_VPAD = 4; // rows of gap above and below the rail
const EVAL_LIGHT: RGB = [232, 228, 216]; // white side (ivory, matches the set)
const EVAL_DARK: RGB = [48, 46, 52]; // black side (charcoal)
const EVAL_LABEL_BG: RGBA = [22, 24, 32, 0.9]; // matches the move panel

// White's share of the bar (0..1) from a centipawn score. tanh squashes so a huge
// material lead eases toward — but never pins — the end, like chess.com's curve.
export function scoreToBar(cp: number): number {
  return 0.5 + 0.5 * Math.tanh(cp / 400);
}

// White-POV pawn label, ≤4 chars so it fits the column ("+1.2", "−0.8", "+10").
function evalLabel(cp: number): string {
  const pawns = cp / 100;
  const sign = pawns > 0 ? '+' : pawns < 0 ? '−' : '';
  const mag = Math.abs(pawns);
  return `${sign}${mag >= 10 ? Math.round(mag).toString() : mag.toFixed(1)}`;
}

// The eval rail: a numeric label, then a thin vertical bar, vertically centered so
// equal gaps frame it top and bottom. The divider is a whole-cell boundary (never
// a partial/half cell), so it always reads as a straight horizontal line. `result`
// overrides the heuristic at game end: checkmate pins the bar to the winner ("#");
// a draw centers it ("½").
export function buildEvalBar(cp: number, result: ChessResult | null, height: number): Node {
  const barH = Math.max(1, height - 2 * EVAL_VPAD - 2); // leave room for the label row + gap row
  // Fill fraction + label, with terminal overrides.
  let frac: number;
  let label: string;
  if (result?.reason === 'checkmate') {
    frac = result.winner === WHITE ? 1 : 0;
    label = '#';
  } else if (result) {
    frac = 0.5;
    label = '½';
  } else {
    frac = scoreToBar(cp);
    label = evalLabel(cp);
  }

  // Whole-cell fill: the bottom `whiteRows` are white, the rest dark. The seam
  // between them is a single straight line across the rail. The rail is centered
  // in the column, so its middle column sits under the label's centered decimal
  // point (the "+X.Y" label is 4 chars → its '.' lands on the column's center).
  const whiteRows = Math.max(0, Math.min(barH, Math.round(frac * barH)));
  const railRow = (color: RGB): Node =>
    Box({ width: EVAL_COL_W, height: 1, justifyContent: 'center' }, [Box({ width: EVAL_RAIL_W, height: 1, background: color })]);
  const rows: Node[] = [];
  for (let r = barH - 1; r >= 0; r--) rows.push(railRow(r < whiteRows ? EVAL_LIGHT : EVAL_DARK));

  return Box({ flexDirection: 'column', width: EVAL_COL_W, flexShrink: 0, height, alignItems: 'center' }, [
    Box({ flexGrow: 1 }), // top gap (balances the bottom — keeps the rail off the edge)
    Box({ width: EVAL_COL_W, height: 1, justifyContent: 'center', background: EVAL_LABEL_BG }, [
      Text({ text: label, style: { color: [210, 212, 222], bold: true } }),
    ]),
    Box({ height: 1 }), // tiny gap between the number chip and the rail
    ...rows,
    Box({ flexGrow: 1 }), // bottom gap
  ]);
}

// "Moves" header text reads as a label, but is a clickable button (toggles the
// panel). No pill background so it looks like a heading, not a bar button.
const HEADER_BTN: Style = {
  padding: [0, 0],
  color: 'fg', // gray/white like the bar buttons (not a blue accent)
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
const COPY_GLYPH = '↥'; // up-from-bar "export" mark (copies PGN)

// The "open chat" affordance: a top-right pill (chat glyph + label), styled like
// the menu's settings gear, shown only while the chat panel is hidden. Clicking it
// reveals the panel; the panel's own ✕ (also top-right) hides it again.
const CHAT_ICON = '💬';
const CHAT_PILL: Style = {
  padding: [0, 1],
  background: [28, 30, 40],
  color: [200, 205, 220],
  hover: { background: [238, 240, 248], color: [16, 16, 24] },
  focus: { background: [86, 90, 108], color: [248, 248, 252] },
  pressed: { background: [255, 255, 255], color: [12, 12, 18] },
};

// Build the full-screen chess-game overlay: the move panel pinned top-right
// (collapsible — see `minimized`/`onToggle`), a commentary toast above the bar
// (when active), then the bar.
export function buildChessGameRoot(
  region: LayoutBox,
  bar: Node,
  opts: {
    minimized: boolean;
    onToggle: () => void;
    onCopy: () => void;
    commentary: Commentary | null;
    t: number;
    evalVisible: boolean;
    evalCp: number;
    evalResult: ChessResult | null;
    chatVisible: boolean;
    onToggleChat: () => void;
  },
): Node {
  // Minimized: the header hugs just the "Moves" button (a tight button). Expanded:
  // a fixed-width header row with "Moves" at the left edge and a right group — the
  // copy-PGN button one space to the left of the ✕ minimize control — at the right
  // edge, aligned with the list below. The panel is left-anchored, so "Moves" keeps
  // the same screen position across states.
  let header: Node;
  if (opts.minimized) {
    header = Box({ flexDirection: 'row', alignItems: 'center' }, [
      Button({ id: 'moves-toggle', label: 'Moves', onClick: opts.onToggle, style: HEADER_BTN }),
    ]);
  } else {
    // Right padding gives the ✕ a 1-cell margin from the panel edge while the list
    // (and its scrollbar) below stays full-width / flush right.
    header = Box({ flexDirection: 'row', justifyContent: 'between', alignItems: 'center', width: HISTORY_WIDTH, padding: [0, 1, 0, 0] }, [
      Button({ id: 'moves-toggle', label: 'Moves', onClick: opts.onToggle, style: HEADER_BTN }),
      Box({ flexDirection: 'row', alignItems: 'center', gap: 2 }, [
        Button({ id: 'moves-copy', label: COPY_GLYPH, onClick: opts.onCopy, style: CLOSE_BTN }),
        Button({ id: 'moves-close', label: '✕', onClick: opts.onToggle, style: CLOSE_BTN }),
      ]),
    ]);
  }
  // The move-list Slot stays in the tree in BOTH states — when minimized it's
  // wrapped in a 0×0 clipped box (hidden, but still "referenced") so the Screen
  // doesn't auto-unmount the ScrollBox; otherwise re-expanding would find it
  // unmounted and render an empty panel. No drawn border — the translucent fill
  // alone separates the panel from the scene, so minimized it reads as a button.
  // (The header sits directly above the list — no spacer row.)
  const children = opts.minimized
    ? [header, Box({ width: 0, height: 0, overflow: 'hidden' }, [Slot('chess-history')])]
    : [header, Slot('chess-history')];
  // Expanded: left padding indents the text, right padding 0 so the scrollbar sits
  // flush against the modal's right edge (the header carries its own right margin
  // for the ✕). Minimized: symmetric padding so the "Moves" chip has both margins.
  const panel = Box({
    flexDirection: 'column',
    padding: opts.minimized ? [0, 1] : [0, 0, 0, 1],
    background: [22, 24, 32, 0.9],
  }, children);

  const c = opts.commentary && opts.t < opts.commentary.until ? opts.commentary : null;
  const label = c ? (c.model ? `${shortModel(c.model)}:  ${c.text}` : c.text) : '';
  const toast = c
    ? Box({ padding: [0, 2], background: [22, 24, 32, 0.94] }, [Text({ text: label, style: { color: 'fg' } })])
    : null;

  // The main column (panel + toast + bar). The eval rail, when shown, sits to its
  // right at full height — clear of the top-left move panel.
  const main = Box({ flexGrow: 1, flexDirection: 'column', height: region.h }, [
    Box({ flexDirection: 'row', justifyContent: 'start', padding: [1, 2] }, [panel]),
    Box({ flexGrow: 1 }), // spacer pushes the toast + bar to the bottom
    ...(toast ? [Box({ flexDirection: 'row', justifyContent: 'start', padding: [0, 0, 1, 2] }, [toast])] : []),
    bar,
    Box({ height: 1 }), // lift the bar off the very bottom edge
  ]);
  const row = Box({ width: region.w, height: region.h, flexDirection: 'row' }, [
    main,
    ...(opts.evalVisible ? [buildEvalBar(opts.evalCp, opts.evalResult, region.h)] : []),
    ...(opts.chatVisible ? [buildChatPanel(region.h, opts.onToggleChat)] : []),
  ]);
  // Chat shown → the panel carries its own top-right ✕. Chat hidden → float the
  // "open chat" pill in the top-right corner (over the scene, like the menu gear).
  if (opts.chatVisible) return row;
  const opener = Box({ position: 'absolute', top: 1, right: 2 }, [
    Button({ id: 'chat-open', label: `${CHAT_ICON} chat`, onClick: opts.onToggleChat, style: CHAT_PILL }),
  ]);
  return Box({ width: region.w, height: region.h }, [row, opener]);
}

// The right-edge chat panel: a "Chat" header (clickable → hide, plus a ✕) over the
// scrollable ChatBox Slot, full region height with a translucent fill matching the
// move panel. Sizes the ChatBox viewport from the available height each frame.
const CHAT_PAD_V = 1; // top/bottom inset
const CHAT_HEADER_H = 2; // header row + a gap row
function buildChatPanel(height: number, onToggle: () => void): Node {
  chatBox.setViewport(Math.max(1, height - 2 * CHAT_PAD_V - CHAT_HEADER_H));
  const header = Box({ flexDirection: 'row', justifyContent: 'between', alignItems: 'center', width: CHAT_WIDTH - PANEL_PAD_L - PANEL_PAD_R, padding: [0, 2, 0, 0] }, [
    Button({ id: 'chat-toggle', label: `${CHAT_ICON} Chat`, onClick: onToggle, style: HEADER_BTN }),
    Button({ id: 'chat-close', label: '✕', onClick: onToggle, style: CLOSE_BTN }),
  ]);
  // flexShrink 0: the wide chess-game bar in the main column overflows its row, so
  // without this the panel would be squeezed below CHAT_WIDTH and clip its bubbles.
  return Box({ flexDirection: 'column', width: CHAT_WIDTH, flexShrink: 0, height, padding: [CHAT_PAD_V, PANEL_PAD_R, CHAT_PAD_V, PANEL_PAD_L], background: [22, 24, 32, 0.9] }, [
    header,
    Box({ height: 1 }), // gap between header and the thread
    Slot('chess-chat'),
  ]);
}
