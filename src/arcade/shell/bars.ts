// The bottom button bar for each screen, expressed as a TUI tree. This replaces
// the old currentBar()/layoutButtons() — centering is now justifyContent, the
// pill padding is style padding, and hover colors are a style overlay. Per-button
// onClick closures replace the id→action if/else that used to live in onMouse.

import { Box, Button, Dialog, Modal, Text, type Node, type Style } from '../../tui/index.ts';
import { BISHOP, BLACK, type Color, KNIGHT, type PieceType, QUEEN, ROOK } from '../../rules/chess/types.ts';
import type { RGB } from '../../engine/index.ts';

export type Mode = 'prism' | 'menu' | 'chess-game' | 'logos' | 'ui' | 'audio' | 'cards' | 'poker';
export type RenderMode = 'color' | 'ascii' | 'luminance';

export interface BarActions {
  back(): void;
  reset(): void;
  mode(): void;
  quit(): void;
  aiMatch(): void;
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

// Center a string within a fixed-width field. Keeps the mode button a stable
// width as the render-mode name changes, without the label drifting left (the
// old padEnd left-anchored the text inside the pill).
export function centerField(s: string, width: number): string {
  const pad = Math.max(0, width - s.length);
  const left = Math.floor(pad / 2);
  return ' '.repeat(left) + s + ' '.repeat(pad - left);
}

// The mode-cycle button label ("mode:  ascii"), centered so the pill/menu row keeps a
// stable width as the render-mode name changes. Shared by the bar and the game menu.
export function modeLabel(renderMode: RenderMode): string {
  return `mode: ${centerField(renderMode, 9)}`;
}

export function buildBar(
  mode: Mode,
  renderMode: RenderMode,
  a: BarActions,
  ai: { label: string; active: boolean } = { label: 'play ai', active: false },
): Node {
  let buttons: Node[] = [];

  if (mode === 'ui') {
    buttons = [
      Button({ id: 'back', label: 'back', onClick: a.back, style: PILL }),
      Button({ id: 'mode', label: modeLabel(renderMode), onClick: a.mode, style: PILL }),
      Button({ id: 'quit', label: 'quit', onClick: a.quit, style: PILL }),
    ];
  } else if (mode === 'logos') {
    buttons = [
      Button({ id: 'back', label: 'back', onClick: a.back, style: PILL }),
      Button({ id: 'reset', label: 'reset view', onClick: a.reset, style: PILL }),
      Button({ id: 'mode', label: modeLabel(renderMode), onClick: a.mode, style: PILL }),
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
    // Like poker: the felt keeps only the two in-flow controls — play/pause AI and
    // reset view. Everything system-level (home / new game / mode / eval bar / illegal /
    // quit) lives in the ☰ menu popup (top-right, see hud.ts buildChessGameRoot), and
    // the chat panel is a top-right pill — so the bar stays two buttons, not eight.
    const aiStyle = ai.active
      ? { ...PILL, background: [86, 64, 120] as RGB, color: [238, 230, 250] as RGB }
      : PILL;
    buttons = [
      Button({ id: 'ai', label: ai.label, onClick: a.aiMatch, style: aiStyle }),
      Button({ id: 'reset', label: 'reset view', onClick: a.reset, style: PILL }),
    ];
  } else if (mode === 'cards') {
    // The cards screen: the mode picker + per-mode controls live in the poker HUD
    // panel; the bar just carries nav / camera reset / render mode / quit.
    buttons = [
      Button({ id: 'back', label: 'back', onClick: a.back, style: PILL }),
      Button({ id: 'reset', label: 'reset view', onClick: a.reset, style: PILL }),
      Button({ id: 'mode', label: modeLabel(renderMode), onClick: a.mode, style: PILL }),
      Button({ id: 'quit', label: 'quit', onClick: a.quit, style: PILL }),
    ];
  } else if (mode === 'poker') {
    // The poker table has NO bottom bar: everything system-level (home / restart / mode /
    // quit) lives in the ☰ menu popup (top-right), play/pause is the 'p' key, and betting
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
      background: [22, 24, 32], // unified popup/panel background
    },
    [
      Box({ justifyContent: 'center' }, [Text({ text: 'promote to', style: { color: [222, 224, 234], bold: true } })]),
      ...options,
    ],
  );

  // Centered modal: a translucent scrim dims the scene behind the popup (real
  // dim under the unified renderer's alpha compositing).
  return Modal(popup);
}

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
    Button({
      id,
      label,
      onClick,
      style: {
        padding: [0, 2],
        background: primary ? [86, 64, 120] : [40, 42, 52],
        color: primary ? [238, 230, 250] : [212, 214, 224],
        bold: true,
        hover: { background: primary ? [110, 84, 150] : [72, 76, 92] },
        focus: { background: primary ? [110, 84, 150] : [72, 76, 92] },
        pressed: { background: [120, 124, 142] },
      },
    });

  const card = Box(
    { flexDirection: 'column', alignItems: 'stretch', gap: 1, padding: [1, 3], background: [22, 24, 32] }, // unified popup background
    [
      Box({ justifyContent: 'center' }, [Text({ text: opts.title, style: { color: opts.tint, bold: true } })]),
      Box({ justifyContent: 'center' }, [Text({ text: opts.subtitle, style: { color: [170, 174, 188] } })]),
      Box({ height: 0 }), // small gap before the actions
      btn('over-newgame', 'new game', onNewGame, true),
      btn('over-close', 'close', onClose, false),
    ],
  );
  return Modal(card);
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
    Button({
      id,
      label,
      onClick,
      style: {
        padding: [0, 2],
        background: primary ? [86, 64, 120] : [40, 42, 52],
        color: primary ? [238, 230, 250] : [212, 214, 224],
        bold: true,
        hover: { background: primary ? [110, 84, 150] : [72, 76, 92] },
        focus: { background: primary ? [110, 84, 150] : [72, 76, 92] },
        pressed: { background: [120, 124, 142] },
      },
    });

  const card = Box(
    { flexDirection: 'column', alignItems: 'stretch', gap: 1, padding: [1, 3], background: [22, 24, 32] },
    [
      Box({ justifyContent: 'center' }, [Text({ text: opts.prompt, style: { color: [222, 224, 234], bold: true } })]),
      Box({ height: 0 }),
      Box({ flexDirection: 'row', justifyContent: 'center', gap: 2 }, [
        btn(`${opts.idPrefix}-yes`, opts.confirmLabel, opts.onConfirm, true),
        btn(`${opts.idPrefix}-cancel`, 'cancel', opts.onCancel, false),
      ]),
    ],
  );
  return Modal(card);
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
// home / new game / mode / … list). Same Modal + card styling as buildGameOver.
export function buildGameMenu(opts: { groups: MenuItem[][]; onClose: () => void; valueColW?: number }): Node {
  // Right-align the values of toggle/cycle items into a column, so "mode / eval bar / illegal"
  // read as label + state; plain actions (home, quit, …) keep just their left label. Widths are
  // measured across every group so the value column lines up throughout the menu. `valueColW`
  // reserves a minimum value-column width (e.g. the longest render-mode name) so the popup does
  // NOT resize when a value cycles to a longer string (ascii → luminance).
  const withVal = opts.groups.flat().filter((i) => i.value != null);
  const labelW = withVal.length ? Math.max(...withVal.map((i) => i.label.length)) : 0;
  const valW = Math.max(opts.valueColW ?? 0, ...(withVal.length ? withVal.map((i) => (i.value as string).length) : [0]));
  const labelOf = (i: MenuItem): string => (i.value != null ? `${i.label.padEnd(labelW + 3)}${i.value.padStart(valW)}` : i.label);
  const btn = (item: MenuItem): Node =>
    Button({
      id: item.id,
      label: labelOf(item),
      onClick: item.onClick,
      style: {
        padding: [0, 2],
        background: [40, 42, 52],
        color: [212, 214, 224],
        bold: true,
        hover: { background: [72, 76, 92] },
        focus: { background: [72, 76, 92] },
        pressed: { background: [120, 124, 142] },
      },
    });

  // Groups (session / view toggles / system) are separated by a blank row — a touch more space
  // than the 1-row gap within a group.
  const body: Node[] = [];
  opts.groups.forEach((group, gi) => {
    if (gi > 0) body.push(Box({ height: 0 }));
    for (const item of group) body.push(btn(item));
  });

  // Dialog supplies the card + 'menu' title + corner ✕; the body keeps its own [0,2] indent
  // so the buttons sit in from the tight card padding.
  return Modal(
    Dialog({ title: 'menu', onClose: opts.onClose, closeId: 'game-menu-close' }, [
      Box({ flexDirection: 'column', alignItems: 'stretch', gap: 1, padding: [0, 2] }, body),
    ]),
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
export function buildShortcuts(bindings: { key: string; title: string; layer: string; id: string }[], onClose: () => void): Node {
  const groups = new Map<string, { keys: string[]; general: boolean; pan: boolean }>();
  for (const b of bindings) {
    const pan = b.id.startsWith('camera.pan'); // the 4 arrow pans collapse into one row
    // "general" = keys that mean the same on every screen: the global layer, plus esc (a
    // universal "back"), which is bound per-screen only because its target differs.
    const general = b.layer === 'global' || b.id === 'nav.escBack';
    // The panel is already screen-scoped, so drop the "Poker:"/"Chess:" prefix, and lowercase
    // for consistency with the app's lowercase chrome (buttons, the confirm popup, etc.).
    const label = (pan ? 'pan camera' : b.title.replace(/^(Poker|Chess): /, '')).toLowerCase();
    const g = groups.get(label) ?? { keys: [], general, pan };
    g.keys.push(prettyChord(b.key));
    groups.set(label, g);
  }
  const all = [...groups.entries()].map(([label, g]) => ({ label, keys: g.pan ? '↑ ↓ ← →' : g.keys.join(' / '), general: g.general }));
  const keyColW = Math.max(3, ...all.map((r) => r.keys.length));

  const row = (r: { label: string; keys: string }): Node =>
    Box({ flexDirection: 'row', gap: 2 }, [
      Text({ text: r.keys.padEnd(keyColW), style: { color: [140, 190, 255], bold: true } }),
      Text({ text: r.label, style: { color: [212, 214, 224] } }),
    ]);
  const section = (label: string, rows: typeof all): Node[] =>
    rows.length === 0 ? [] : [Text({ text: label, style: { color: [130, 134, 148], bold: true } }), ...rows.map(row)];

  const screenRows = all.filter((r) => !r.general);
  const generalRows = all.filter((r) => r.general);
  return Modal(
    Dialog({ title: 'shortcuts', onClose, closeId: 'shortcuts-close' }, [
      Box({ flexDirection: 'column', alignItems: 'stretch', gap: 1, padding: [0, 2] }, [
        ...section('this game', screenRows),
        ...section('general', generalRows),
      ]),
    ]),
  );
}
