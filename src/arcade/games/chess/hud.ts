// The chess-game UI overlay: a move-history panel (top-left) and a transient
// pre-move commentary toast (bottom-left, aligned with the bar's left inset),
// composited over the 3D board with
// the standard bottom bar. The move list reuses the ScrollBox component; the
// instance is module-level so its scroll state (and the history itself) survives
// the per-frame rebuild and collapsing (mount it once via mountChessHud).
//
// The panel collapses to just its "Moves" header (which reads as a button via the
// shared solid chrome fill — no line border), and expands back. It's left-anchored, so
// the "Moves" label keeps the same position in both states. Click it (or the ✕,
// shown when expanded) to toggle.
import { Box, Button, CloseButton, type Row, ScrollBox, Slot, Text, type LayoutBox, type Node, type Screen, type Style } from '../../../tui/index.ts';
import type { RGB } from '../../../engine/index.ts';
import { UI_CHROME_BG, UI_CHROME_PILL, uiChromeBg } from '../../theme.ts';
import type { ChessResult } from '../../../rules/chess/chess.ts';
import { WHITE } from '../../../rules/chess/types.ts';
import { CHAT_WIDTH, type ChatMessage, chatBox, mountChat } from './chat.ts';
import { RailPanel, RailTitleButton } from '../../shell/rail-panel.ts';
import { CHESS_PALETTE } from './palette.ts';

const HISTORY_HEIGHT = 18; // MAX visible move rows — the panel grows to this, then scrolls
const HISTORY_WIDTH = 22; // inner content width — header + list share it (fixed)
const ILLEGAL = CHESS_PALETTE.illegal; // a move played under the illegal-moves toggle

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

// Unicode chess glyphs by color, keyed by SAN piece letter (pawns implied). Filled
// (black) vs outline (white) sets so the mover's side reads at a glance in the chat.
const GLYPH_WHITE: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' };
const GLYPH_BLACK: Record<string, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };

// The moved piece's glyph for a SAN string, given the ply (0-based: even = White). A
// leading K/Q/R/B/N names the piece; castling (O-O / O-O-O) is the king; anything else
// (a file letter or capture like exd5) is a pawn.
function moveGlyph(san: string, ply: number): string {
  const set = ply % 2 === 0 ? GLYPH_WHITE : GLYPH_BLACK;
  if (san.startsWith('O-O')) return set.K;
  const c = san[0];
  return set[c] ?? set.P;
}

// A chess move rendered as a chat line: the mover's piece glyph + the SAN, grey for a
// legal move and red with an "(illegal)" tag for one played under the illegal-moves
// toggle — mirroring the move panel's red. `ply` is the 0-based half-move index.
export function chessMoveChat(san: string, ply: number, illegal: boolean): ChatMessage {
  const text = `${moveGlyph(san, ply)} ${san}${illegal ? ' (illegal)' : ''}`;
  return { text, model: '', event: true, error: illegal };
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
const EVAL_RAIL_W = 2; // slimmer rail; even width shares the label's exact center
const EVAL_LABEL_W = 4; // widest numeric label ("+1.2")
const EVAL_RIGHT_PAD = 2; // matches the top-right menu/chat control inset
const EVAL_COL_W = EVAL_LABEL_W + EVAL_RIGHT_PAD;
const EVAL_VPAD = 4; // rows of gap above and below the rail
const EVAL_LIGHT = CHESS_PALETTE.evalLight; // white side (ivory, matches the set)
const EVAL_DARK = CHESS_PALETTE.evalDark; // black side (charcoal)
const EVAL_LABEL_BG = uiChromeBg(0.9); // matches the move panel

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
  // between them is a single straight line across the rail. Label and rail share
  // the same four-cell content column, leaving a two-cell right inset aligned
  // with the top-right controls.
  const whiteRows = Math.max(0, Math.min(barH, Math.round(frac * barH)));
  const railRow = (color: RGB): Node =>
    Box({ width: EVAL_LABEL_W, height: 1, justifyContent: 'center' }, [Box({ width: EVAL_RAIL_W, height: 1, background: color })]);
  const rows: Node[] = [];
  for (let r = barH - 1; r >= 0; r--) rows.push(railRow(r < whiteRows ? EVAL_LIGHT : EVAL_DARK));

  return Box({ flexDirection: 'column', width: EVAL_COL_W, flexShrink: 0, height, alignItems: 'start' }, [
    Box({ flexGrow: 1 }), // top gap (balances the bottom — keeps the rail off the edge)
    Box({ width: EVAL_LABEL_W, height: 1, justifyContent: 'center', background: EVAL_LABEL_BG }, [
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
// The understated copy (↥) control just right of the "Moves" label — a muted glyph
// that brightens to white on hover, matching the shared CloseButton ✕ beside it.
const ICON_BTN: Style = {
  padding: [0, 0],
  color: 'muted',
  hover: { color: [255, 255, 255] },
};
const COPY_GLYPH = '↥'; // up-from-bar "export" mark (copies PGN)


// ── Match banner ────────────────────────────────────────────────────────────────
// A centered top-of-screen indicator of what's being played: "free play" when no AI
// match is running (a nudge that the board is yours to move a piece), or "<white> vs
// <black>" with each side's label in its color — a creator's brand hue for an AI, the
// piece tint for a human ("you"). Fed a resolved descriptor by main; presentation only.
export interface MatchSide {
  text: string;
  color: RGB;
}
function buildMatchBanner(matchup: { white: MatchSide; black: MatchSide } | null | undefined): Node {
  const body: Node[] = matchup
    ? [
        Text({ text: matchup.white.text, style: { color: matchup.white.color, bold: true } }),
        Text({ text: '  vs  ', style: { color: 'muted' } }),
        Text({ text: matchup.black.text, style: { color: matchup.black.color, bold: true } }),
      ]
    : [Text({ text: 'free play', style: { color: [200, 205, 220] } })];
  // No backing — the label reads directly over the board (bold + creator colors carry it).
  return Box({ flexDirection: 'row', alignItems: 'center', padding: [0, 2] }, body);
}

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
    onOpenMenu: () => void; // ☰ pill → the in-game menu popup (home / new game / mode / …)
    chatActive: boolean; // an AI match is in progress (suppresses the chat's empty placeholder)
    illegalOn?: boolean; // illegal-moves mode on → show an "(illegal)" tag beside the "moves" header
    matchup?: { white: MatchSide; black: MatchSide } | null; // top banner: the matchup, or free play (null)
  },
): Node {
  // Minimized: the header hugs just the "Moves" button (a tight button). Expanded:
  // a fixed-width header row with "Moves" at the left edge and a right group — the
  // copy-PGN button one space to the left of the ✕ minimize control — at the right
  // edge, aligned with the list below. The panel is left-anchored, so "Moves" keeps
  // the same screen position across states.
  // The "(illegal)" tag sits just right of the "moves" label whenever illegal-moves mode
  // is on, in the same red the illegal plies use in the list; it vanishes when off, leaving
  // the header exactly as it was. Grouped with "moves" so it rides at the left edge.
  const illegalTag = opts.illegalOn ? [Text({ text: '(illegal)', style: { color: ILLEGAL } })] : [];
  // The whole chip toggles the panel — not just the "moves" label. Hit-testing routes a
  // click to the deepest interactive node, so a bare "(illegal)" Text (and the gap) would
  // be dead space that the translucent panel swallows without collapsing. The wrapper Box
  // carries onClick to catch those cells; the inner button keeps its own hover.
  const movesLabel: Node = {
    kind: 'box',
    onClick: opts.onToggle,
    style: { flexDirection: 'row', alignItems: 'center', gap: 1 },
    children: [Button({ id: 'moves-toggle', label: 'moves', onClick: opts.onToggle, style: HEADER_BTN }), ...illegalTag],
  };
  let header: Node;
  if (opts.minimized) {
    header = movesLabel;
  } else {
    // Right padding gives the ✕ a 1-cell margin from the panel edge while the list
    // (and its scrollbar) below stays full-width / flush right.
    header = Box({ flexDirection: 'row', justifyContent: 'between', alignItems: 'center', width: HISTORY_WIDTH, padding: [0, 1, 0, 0] }, [
      movesLabel,
      // gap 1 (not 2) sits the copy (↥) one cell closer to the ✕, per the tighter header.
      Box({ flexDirection: 'row', alignItems: 'center', gap: 1 }, [
        Button({ id: 'moves-copy', label: COPY_GLYPH, onClick: opts.onCopy, style: ICON_BTN }),
        CloseButton({ id: 'moves-close', onClick: opts.onToggle }),
      ]),
    ]);
  }
  // The move-list Slot stays in the tree in BOTH states — when minimized it's
  // wrapped in a 0×0 clipped box (hidden, but still "referenced") so the Screen
  // doesn't auto-unmount the ScrollBox; otherwise re-expanding would find it
  // unmounted and render an empty panel. No drawn border — the solid chrome fill
  // separates the panel from the scene, so minimized it reads as a button.
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
    background: UI_CHROME_BG,
  }, children);

  const c = opts.commentary && opts.t < opts.commentary.until ? opts.commentary : null;
  const label = c ? (c.model ? `${shortModel(c.model)}:  ${c.text}` : c.text) : '';
  const toast = c
    ? Box({ padding: [0, 2], background: uiChromeBg(0.94) }, [Text({ text: label, style: { color: 'fg' } })])
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
    ...(opts.chatVisible ? [buildChatPanel(region.h, opts.onToggleChat, opts.chatActive)] : []),
  ]);
  // The ☰ menu pill lives to the LEFT of the chat (mirroring poker). Chat hidden → a
  // top-right cluster [☰ menu][chat]. Chat shown → the chat panel carries its own ✕, so
  // the cluster is just the menu pill, floated flush against the panel's left edge (past
  // the eval rail too, when it's showing).
  const railW = (opts.chatVisible ? CHAT_WIDTH : 0) + (opts.evalVisible ? EVAL_COL_W : 0);
  const cluster = Box({ position: 'absolute', top: 1, right: opts.chatVisible ? railW + 1 : 2, flexDirection: 'row', gap: 1 }, [
    Button({ id: 'chess-menu', label: '☰ menu', onClick: opts.onOpenMenu, style: UI_CHROME_PILL }),
    ...(opts.chatVisible ? [] : [Button({ id: 'chat-open', label: 'chat', onClick: opts.onToggleChat, style: UI_CHROME_PILL })]),
  ]);
  // The match banner floats at the top, centered in the space to the LEFT of the right
  // rail (chat + eval) rather than the full screen width — so it tracks the board area
  // and re-centers when chat or the eval bar toggles.
  const banner = Box({ position: 'absolute', top: 1, left: 0, width: Math.max(0, region.w - railW), flexDirection: 'row', justifyContent: 'center' }, [
    buildMatchBanner(opts.matchup),
  ]);
  return Box({ width: region.w, height: region.h }, [row, cluster, banner]);
}

// The right-edge chat panel: a "Chat" header (clickable → hide, plus a ✕) over the
// scrollable ChatBox Slot, full region height with a translucent fill matching the
// move panel. Sizes the ChatBox viewport from the available height each frame.
const CHAT_PAD_V = 1; // top/bottom inset
const CHAT_HEADER_H = 2; // header row + a gap row
function buildChatPanel(height: number, onToggle: () => void, active: boolean): Node {
  chatBox.setViewport(Math.max(1, height - 2 * CHAT_PAD_V - CHAT_HEADER_H));
  chatBox.setActive(active);
  // flexShrink 0: the wide chess-game bar in the main column overflows its row, so
  // without this the panel would be squeezed below CHAT_WIDTH and clip its bubbles.
  return RailPanel(
    {
      width: CHAT_WIDTH,
      height,
      flexShrink: 0,
      title: RailTitleButton('chat-toggle', 'chat', onToggle, HEADER_BTN),
      closeId: 'chat-close',
      onClose: onToggle,
    },
    [Slot('chess-chat')],
  );
}
