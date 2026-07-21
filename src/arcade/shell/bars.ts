// The bottom button bar for each screen, expressed as a TUI tree. This replaces
// the old currentBar()/layoutButtons() — centering is now justifyContent, the
// pill padding is style padding, and hover colors are a style overlay. Per-button
// onClick closures replace the id→action if/else that used to live in onMouse.

import { Box, Button, Dialog, Modal, RoundedButton, Text, type Node, type Style } from '../../tui/index.ts';
import { BISHOP, BLACK, type Color, KNIGHT, type PieceType, QUEEN, ROOK } from '../../rules/chess/types.ts';
import type { RGB } from '../../engine/index.ts';
import { UI_CHROME_BG } from '../theme.ts';

export type Mode = 'prism' | 'menu' | 'chess-game' | 'logos' | 'ui' | 'audio' | 'cards' | 'poker';
export type RenderMode = 'ascii' | 'pixels';

export interface BarActions {
  back(): void;
  reset(): void;
  mode(): void;
  quit(): void;
  aiMatch(): void;
  newGame(): void;
  audioModel(): void;
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

// Center a string within a fixed-width field. Keeps the display button a stable
// width as the render-style name changes, without the label drifting left (the
// old padEnd left-anchored the text inside the pill).
export function centerField(s: string, width: number): string {
  const pad = Math.max(0, width - s.length);
  const left = Math.floor(pad / 2);
  return ' '.repeat(left) + s + ' '.repeat(pad - left);
}

// The display-cycle button label ("display: ascii "), centered so the pill stays a
// stable width as the render-style name changes.
export function displayLabel(renderMode: RenderMode): string {
  return `display: ${centerField(renderMode, 6)}`;
}

export function buildBar(
  mode: Mode,
  renderMode: RenderMode,
  a: BarActions,
  ai: { label: string; active: boolean } = { label: 'new match', active: false },
): Node {
  let buttons: Node[] = [];

  if (mode === 'ui') {
    buttons = [
      Button({ id: 'back', label: 'back', onClick: a.back, style: PILL }),
      Button({ id: 'mode', label: displayLabel(renderMode), onClick: a.mode, style: PILL }),
      Button({ id: 'quit', label: 'quit', onClick: a.quit, style: PILL }),
    ];
  } else if (mode === 'logos') {
    buttons = [
      Button({ id: 'back', label: 'back', onClick: a.back, style: PILL }),
      Button({ id: 'reset', label: 'reset view', onClick: a.reset, style: PILL }),
      Button({ id: 'mode', label: displayLabel(renderMode), onClick: a.mode, style: PILL }),
      Button({ id: 'quit', label: 'quit', onClick: a.quit, style: PILL }),
    ];
  } else if (mode === 'audio') {
    // The realtime voice screen: pick the speech-to-speech model (cycles; the
    // current one shows in the scene overlay), reset the wisp camera, back, quit.
    buttons = [
      Button({ id: 'back', label: 'back', onClick: a.back, style: PILL }),
      Button({ id: 'audio-model', label: 'model ›', onClick: a.audioModel, style: PILL }),
      Button({ id: 'reset', label: 'reset view', onClick: a.reset, style: PILL }),
      Button({ id: 'quit', label: 'quit', onClick: a.quit, style: PILL }),
    ];
  } else if (mode === 'chess-game') {
    // The playable board: the AI button plays (idle) → pauses (running) → resumes
    // (paused). Highlighted whenever a match exists (running or paused).
    // Like poker: the felt keeps only the in-flow control — play/pause AI. Everything
    // system-level (home / reset board / reset view / display / eval bar / illegal / quit)
    // lives in the ☰ menu popup (top-right, see hud.ts buildChessGameRoot), and the
    // chat panel is a top-right pill — so the bar is a single button.
    // Rounded (outlined) control: 3 rows tall, arc border, a little horizontal padding,
    // transparent interior (the 2D scene shows through). Active (match running) tints
    // the outline + label purple; hover/focus whiten the border + label + bold.
    const aiActive = ai.active ? { color: [200, 206, 236] as RGB, borderColor: [112, 122, 188] as RGB } : {};
    buttons = [RoundedButton({ id: 'ai', label: ai.label, onClick: a.aiMatch, ...aiActive })];
    // A "reset board" control only sits beside play/pause while a match exists — idle
    // already reads "new match", so it would be redundant there. Same "reset board"
    // the ☰ menu offers, surfaced on the felt for one-click reset.
    if (ai.active) buttons.push(RoundedButton({ id: 'new-game', label: 'reset board', onClick: a.newGame }));
  } else if (mode === 'cards') {
    // The cards screen: the mode picker + per-mode controls live in the poker HUD
    // panel; the bar just carries nav / camera reset / display style / quit.
    buttons = [
      Button({ id: 'back', label: 'back', onClick: a.back, style: PILL }),
      Button({ id: 'reset', label: 'reset view', onClick: a.reset, style: PILL }),
      Button({ id: 'mode', label: displayLabel(renderMode), onClick: a.mode, style: PILL }),
      Button({ id: 'quit', label: 'quit', onClick: a.quit, style: PILL }),
    ];
  } else if (mode === 'poker') {
    // The poker table has NO bottom bar: everything system-level (home / new game /
    // reset camera / display / quit) lives in the menu popup; play/pause is 'p', and betting
    // lives in the HUD — so the felt stays a clean broadcast overlay, not a toolbar.
    buttons = [];
  }

  // Left-anchored with a 2-cell inset so the row lines up with the move panel's
  // left edge (chess-hud's panel wrapper uses padding [1, 2]) — and so the wide
  // chess-game bar, which overflows and can't center, still starts at that same
  // margin instead of hugging x=0. Every screen's bar flows through here, so they
  // all share the inset.
  return Box({ flexDirection: 'row', justifyContent: 'start', alignItems: 'center', gap: 2, padding: [0, 0, 0, 2] }, buttons);
}

// Piece colors for the promotion popup — the side's set color, lifted a touch so
// brown stays legible on the dark popup background.
const IVORY: RGB = [232, 228, 216];
const BROWN: RGB = [184, 126, 74];

// Filled chess glyphs (outline glyphs read poorly at one cell); tinted to the
// promoting side's color via the button's fg.
const PROMO_OPTIONS: { type: PieceType; sym: string; name: string }[] = [
  { type: QUEEN, sym: '♛', name: 'queen' },
  { type: ROOK, sym: '♜', name: 'rook' },
  { type: BISHOP, sym: '♝', name: 'bishop' },
  { type: KNIGHT, sym: '♞', name: 'knight' },
];

// The promotion picker: a bordered popup centered on screen, listing the four
// promotion choices. Each row shows the piece's glyph + name in the pawn's
// color. `onPick` plays the chosen promotion. Built fresh each frame like the
// bar; the Screen keeps hover/focus by id. (Cancel is handled by the orchestrator
// via Escape.)
export function buildPromotion(color: Color, onPick: (t: PieceType) => void, onCancel: () => void): Node {
  const tint = color === BLACK ? BROWN : IVORY;
  // Rounded (outlined) choices tinted to the promoting side; hover/focus whiten border +
  // label. They stack flush (gap 0) so their arc borders read as one continuous list.
  const options = PROMO_OPTIONS.map((o) =>
    RoundedButton({
      id: `promo-${o.name.toLowerCase()}`,
      label: `${o.sym}  ${o.name}`,
      onClick: () => onPick(o.type),
      color: tint,
      borderColor: tint,
    }),
  );

  // The card's fill reads as a panel against the busy ASCII scene; the rounded choices
  // sit over it with transparent interiors. Tight padding keeps it compact.
  const popup = Box(
    {
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: 1, // one row between the "promote to" header and the choices (the choices stay flush)
      padding: [1, 2],
      background: UI_CHROME_BG,
    },
    [
      Box({ justifyContent: 'center' }, [Text({ text: 'promote to', style: { color: [222, 224, 234], bold: true } })]),
      Box({ flexDirection: 'column', alignItems: 'stretch', gap: 0 }, options),
    ],
  );

  // Centered modal: a translucent scrim dims the scene behind the popup (real
  // dim under the unified renderer's alpha compositing).
  return Modal(popup, { onDismiss: onCancel });
}

// Rounded-button treatments shared by the modal family (confirm / game-over): a purple
// outline for the affirmative/primary action, neutral grey for cancel/close. Hover/focus
// whiten the border + label (see tui/button.ts). Matches the chess bar's purple ai control.
const MODAL_PRIMARY = { color: [200, 206, 236] as RGB, borderColor: [112, 122, 188] as RGB };
const MODAL_NEUTRAL = { color: [212, 214, 224] as RGB, borderColor: [88, 92, 110] as RGB };

// The game-over result popup (chess.com style): a centered card with the outcome
// ("White wins" / "Draw") tinted to the winner's set color, the reason beneath
// ("by checkmate"), and New game / Close buttons. Same Modal + card styling as the
// promotion picker. `title`/`subtitle` are supplied by the orchestrator (which
// knows the chess result), keeping this presentation-only.
export function buildGameOver(
  opts: { title: string; subtitle: string; tint: RGB },
  onNewGame: () => void,
  onClose: () => void,
): Node {
  const btn = (id: string, label: string, onClick: () => void, primary: boolean): Node =>
    RoundedButton({ id, label, onClick, ...(primary ? MODAL_PRIMARY : MODAL_NEUTRAL) });

  // Centered title/subtitle, then a centered row of content-sized buttons (same layout as
  // buildConfirm) — the buttons size to their labels + padding rather than stretching to
  // the card width.
  const card = Box(
    { flexDirection: 'column', alignItems: 'stretch', gap: 1, padding: [1, 3], background: UI_CHROME_BG },
    [
      Box({ flexDirection: 'column', alignItems: 'stretch', gap: 1 }, [
        Box({ justifyContent: 'center' }, [Text({ text: opts.title, style: { color: opts.tint, bold: true } })]),
        Box({ justifyContent: 'center' }, [Text({ text: opts.subtitle, style: { color: [170, 174, 188] } })]),
      ]),
      Box({ flexDirection: 'row', justifyContent: 'center', gap: 2 }, [
        btn('over-newgame', 'new game', onNewGame, true),
        btn('over-close', 'close', onClose, false),
      ]),
    ],
  );
  return Modal(card, { onDismiss: onClose });
}

// A yes/cancel confirm popup for destructive/irreversible actions — leaving a game to the
// home screen (esc in a game) and quitting the app (the 'q' key). `confirmLabel` is the
// primary (default-focused) action; "cancel" backs out. Buttons sit side by side. `idPrefix`
// namespaces the button ids so the caller can default-focus `${idPrefix}-yes`. Same Modal +
// card styling as buildGameOver, so every popup reads as one family.
export function buildConfirm(opts: {
  prompt: string;
  confirmLabel: string;
  idPrefix: string;
  onConfirm: () => void;
  onCancel: () => void;
}): Node {
  const btn = (id: string, label: string, onClick: () => void, primary: boolean): Node =>
    RoundedButton({ id, label, onClick, ...(primary ? MODAL_PRIMARY : MODAL_NEUTRAL) });

  // One row between the prompt and the buttons (the middle ground — no double spacer);
  // the two buttons keep a horizontal gap so they read as separate actions.
  const card = Box(
    { flexDirection: 'column', alignItems: 'stretch', gap: 1, padding: [1, 3], background: UI_CHROME_BG },
    [
      Box({ justifyContent: 'center' }, [Text({ text: opts.prompt, style: { color: [222, 224, 234], bold: true } })]),
      Box({ flexDirection: 'row', justifyContent: 'center', gap: 2 }, [
        btn(`${opts.idPrefix}-yes`, opts.confirmLabel, opts.onConfirm, true),
        btn(`${opts.idPrefix}-cancel`, 'cancel', opts.onCancel, false),
      ]),
    ],
  );
  return Modal(card, { onDismiss: opts.onCancel });
}

// The startup "update available" popup: the version bump, the exact upgrade command on
// its own tinted line (so it stands out and is easy to select-and-copy), and a row of
// actions — "quit to update" (primary), "copy command" (copies to the clipboard, with a
// "copied ✓" confirmation), and "not now". Same Dialog + Modal family as the game menu;
// the ✕ and Escape also dismiss. `command` is chosen by the caller to match how the
// arcade was installed (npx / npm -g / pnpm / yarn).
export function buildUpdateModal(opts: {
  current: string;
  latest: string;
  command: string;
  copied: boolean;
  onQuit: () => void;
  onCopy: () => void;
  onClose: () => void;
}): Node {
  const btn = (id: string, label: string, onClick: () => void, primary: boolean): Node =>
    RoundedButton({ id, label, onClick, ...(primary ? MODAL_PRIMARY : MODAL_NEUTRAL) });

  return Modal(
    Dialog({ title: 'update available', onClose: opts.onClose, closeId: 'update-dialog-close', padding: [1, 3], closeInset: 1, background: UI_CHROME_BG }, [
      Box({ flexDirection: 'column', alignItems: 'stretch', gap: 1 }, [
        Box({ justifyContent: 'center' }, [
          Text({ text: `v${opts.current}`, style: { color: [150, 154, 168] } }),
          Text({ text: ' → ', style: { color: [150, 154, 168] } }),
          Text({ text: `v${opts.latest}`, style: { color: [150, 220, 180], bold: true } }),
        ]),
        // The command sits on its own inset, tinted line — a copy target, not a button.
        Box({ justifyContent: 'center', padding: [0, 2], background: [30, 34, 46] }, [
          Text({ text: opts.command, style: { color: [150, 220, 180], bold: true } }),
        ]),
        Box({ flexDirection: 'row', justifyContent: 'center', gap: 2 }, [
          btn('update-quit', 'quit to update', opts.onQuit, true),
          btn('update-copy', opts.copied ? 'copied ✓' : 'copy command', opts.onCopy, false),
          btn('update-close', 'not now', opts.onClose, false),
        ]),
      ]),
    ]),
    { onDismiss: opts.onClose },
  );
}

export interface MenuItem {
  id: string;
  label: string;
  value?: string; // a toggle/cycle state (e.g. "ascii", "off") — right-aligned into a column
  onClick: () => void;
}

// The in-game menu popup (Wii + / PS-button style): a "menu" title + ✕, then a stack of
// uniform slate buttons — hover is the only lit state (no highlighted primary). Generic
// over the `items` the caller supplies, so poker and chess share it (each passes its own
// home / new game / display / … list). Same Modal + card styling as buildGameOver.
export function buildGameMenu(opts: { groups: MenuItem[][]; onClose: () => void; valueColW?: number }): Node {
  // Right-align the values of toggle/cycle items into a column, so "display / eval bar / illegal"
  // read as label + state; plain actions (home, quit, …) keep just their left label. Widths are
  // measured across every group so the value column lines up throughout the menu. `valueColW`
  // reserves a minimum value-column width (e.g. the longest render-mode name) so the popup does
  // NOT resize when a value cycles to a longer string (ascii to pixels).
  const withVal = opts.groups.flat().filter((i) => i.value != null);
  const labelW = withVal.length ? Math.max(...withVal.map((i) => i.label.length)) : 0;
  const valW = Math.max(opts.valueColW ?? 0, ...(withVal.length ? withVal.map((i) => (i.value as string).length) : [0]));
  const labelOf = (i: MenuItem): string => (i.value != null ? `${i.label.padEnd(labelW + 3)}${i.value.padStart(valW)}` : i.label);
  // Sleek outlined items: a rounded arc border (3 rows tall) with a dim resting
  // border + readable label; hover/focus whitens the border + label and bolds. No
  // fill, so box-drawing corners stay seam-free over the Dialog card.
  const btn = (item: MenuItem): Node =>
    RoundedButton({ id: item.id, label: labelOf(item), onClick: item.onClick, color: [212, 214, 224], borderColor: [88, 92, 110] });

  // The outlined items stack flush (gap 0): each button's own arc border is the
  // divider, so adjacent bottom/top borders read as one continuous list — no empty
  // rows between them. Groups are flattened (the border stacking separates rows).
  const body = opts.groups.flat().map(btn);

  // The card's [1,3] horizontal padding insets the buttons so the 'menu' title lines up
  // with their left border; `closeInset: 1` nudges the ✕ one cell right. Buttons keep
  // gap 0 so their arc borders read as one continuous list.
  return Modal(
    Dialog({ title: 'menu', onClose: opts.onClose, closeId: 'game-menu-close', padding: [1, 3], closeInset: 1, background: UI_CHROME_BG }, [
      Box({ flexDirection: 'column', alignItems: 'stretch', gap: 0 }, body),
    ]),
    { onDismiss: opts.onClose },
  );
}

// Friendlier display for a chord than the raw binding string.
const SHORTCUT_KEY_LABELS: Record<string, string> = {
  escape: 'esc',
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  space: 'space',
  enter: 'enter',
};
function prettyChord(k: string): string {
  return SHORTCUT_KEY_LABELS[k] ?? k.replace('ctrl+', '^');
}

// The in-app shortcuts overlay: the keys live on the CURRENT screen, grouped into
// "this screen" + "general" (global), generated from keymap.activeBindings() so it can
// never drift from the real bindings. Keys that trigger the same action collapse into one
// row (e.g. "= / +"). Same Modal + card family as the game menu.
// The mouse controls documented in the controls overlay, per screen. Orbit screens
// share drag/pan/zoom; the menu browses covers + launches; chess adds click-to-select/
// move on top of orbit. Screens absent here (e.g. the prism) have no mouse row.
const ORBIT_MODES: Mode[] = ['chess-game', 'poker', 'logos', 'audio', 'cards', 'ui'];
export function mouseControlsFor(mode: Mode): { keys: string; label: string }[] {
  if (mode === 'menu') return [{ keys: 'scroll', label: 'prev / next' }, { keys: 'click', label: 'launch' }];
  const rows: { keys: string; label: string }[] = [];
  if (ORBIT_MODES.includes(mode)) rows.push({ keys: 'drag', label: 'rotate' }, { keys: 'right-drag', label: 'pan' }, { keys: 'scroll', label: 'zoom' });
  if (mode === 'chess-game') rows.push({ keys: 'click', label: 'select / move' });
  // Poker: hover a hole card to peek (bends it up), click to lift it fully face-on.
  if (mode === 'poker') rows.push({ keys: 'hover', label: 'peek at card' }, { keys: 'click', label: 'lift card' });
  return rows;
}

export function buildShortcuts(
  bindings: { key: string; title: string; layer: string; id: string }[],
  onClose: () => void,
  opts: { mouse?: { keys: string; label: string }[] } = {},
): Node {
  const groups = new Map<string, { keys: string[]; general: boolean; pan: boolean }>();
  for (const b of bindings) {
    const pan = b.id.startsWith('camera.pan'); // the 4 arrow pans collapse into one row
    // "general" = keys that mean the same on every screen: the global layer, plus esc (a
    // universal "back"), which is bound per-screen only because its target differs.
    const general = b.layer === 'global' || b.id === 'nav.escBack';
    // The panel is already screen-scoped, so drop the "Poker:"/"Chess:" prefix, and lowercase
    // for consistency with the app's lowercase chrome (buttons, the confirm popup, etc.).
    const label = (pan ? 'pan camera' : b.title.replace(/^(Poker|Chess|Menu): /, '')).toLowerCase();
    const g = groups.get(label) ?? { keys: [], general, pan };
    g.keys.push(prettyChord(b.key));
    groups.set(label, g);
  }
  const all = [...groups.entries()].map(([label, g]) => ({ label, keys: g.pan ? '↑ ↓ ← →' : g.keys.join(' / '), general: g.general }));
  const mouseRows = opts.mouse ?? [];
  // Each column sizes its own key gutter (left holds single-key chords; right holds the
  // wider "right-drag"), so neither pads to the other's widest key.
  const keyWidth = (rows: { keys: string }[]): number => Math.max(3, ...rows.map((r) => r.keys.length));
  const mkRow = (keyColW: number) => (r: { label: string; keys: string }): Node =>
    Box({ flexDirection: 'row', gap: 2 }, [
      Text({ text: r.keys.padEnd(keyColW), style: { color: [140, 190, 255], bold: true } }),
      Text({ text: r.label, style: { color: [212, 214, 224] } }),
    ]);
  const section = (label: string, rows: { label: string; keys: string }[], keyColW: number): Node[] =>
    rows.length === 0 ? [] : [Text({ text: label, style: { color: [130, 134, 148], bold: true } }), ...rows.map(mkRow(keyColW))];
  const column = (children: Node[]): Node => Box({ flexDirection: 'column', alignItems: 'stretch', gap: 1 }, children);

  const screenRows = all.filter((r) => !r.general);
  const generalRows = all.filter((r) => r.general);
  const leftW = keyWidth(screenRows);
  const rightW = keyWidth([...mouseRows, ...generalRows]);
  // Two columns so the in-game list doesn't run too tall: this-game keys on the left, the
  // (shared) mouse + general blocks stacked on the right.
  // Same header treatment as the game menu: the card's [1,3] padding insets the body so
  // the title lines up with it; `closeInset: 1` nudges the ✕ one cell right.
  return Modal(
    Dialog({ title: 'controls', onClose, closeId: 'shortcuts-close', padding: [1, 3], closeInset: 1 }, [
      Box({ flexDirection: 'row', alignItems: 'start', gap: 5 }, [
        column(section('this screen', screenRows, leftW)),
        column([...section('mouse', mouseRows, rightW), ...section('general', generalRows, rightW)]),
      ]),
    ]),
    { onDismiss: onClose },
  );
}
