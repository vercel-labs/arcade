// The bottom button bar for each screen, expressed as a TUI tree. This replaces
// the old currentBar()/layoutButtons() — centering is now justifyContent, the
// pill padding is style padding, and hover colors are a style overlay. Per-button
// onClick closures replace the id→action if/else that used to live in onMouse.

import { Box, Button, Modal, Text, type Node, type Style } from '../tui/index.ts';
import { BISHOP, BLACK, type Color, KNIGHT, type PieceType, QUEEN, ROOK } from '../games/chess/types.ts';
import type { RGB } from '../engine/index.ts';

export type Mode = 'prism' | 'menu' | 'demo' | 'chess' | 'chess-game' | 'logos' | 'ui' | 'audio';
export type RenderMode = 'color' | 'ascii' | 'luminance';

export interface BarActions {
  chessGame(): void;
  demo(): void;
  logos(): void;
  ui(): void;
  back(): void;
  reset(): void;
  mode(): void;
  quit(): void;
  aiMatch(): void;
  resetGame(): void;
  illegalMoves(): void;
  evalBar(): void;
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
function centerField(s: string, width: number): string {
  const pad = Math.max(0, width - s.length);
  const left = Math.floor(pad / 2);
  return ' '.repeat(left) + s + ' '.repeat(pad - left);
}

export function buildBar(
  mode: Mode,
  renderMode: RenderMode,
  a: BarActions,
  ai: { label: string; active: boolean } = { label: 'play ai', active: false },
  illegalOn = false,
  evalOn = false,
): Node {
  const modeLabel = `mode: ${centerField(renderMode, 9)}`;
  let buttons: Node[] = [];

  if (mode === 'prism') {
    buttons = [
      Button({ id: 'chess-game', label: 'chess game', onClick: a.chessGame, style: PILL }),
      Button({ id: 'demo', label: 'demo', onClick: a.demo, style: PILL }),
      Button({ id: 'logos', label: 'logos', onClick: a.logos, style: PILL }),
      Button({ id: 'ui', label: 'ui', onClick: a.ui, style: PILL }),
      Button({ id: 'mode', label: modeLabel, onClick: a.mode, style: PILL }),
      Button({ id: 'quit', label: 'quit', onClick: a.quit, style: PILL }),
    ];
  } else if (mode === 'demo' || mode === 'ui') {
    buttons = [
      Button({ id: 'back', label: 'back', onClick: a.back, style: PILL }),
      Button({ id: 'mode', label: modeLabel, onClick: a.mode, style: PILL }),
      Button({ id: 'quit', label: 'quit', onClick: a.quit, style: PILL }),
    ];
  } else if (mode === 'logos') {
    buttons = [
      Button({ id: 'back', label: 'back', onClick: a.back, style: PILL }),
      Button({ id: 'reset', label: 'reset view', onClick: a.reset, style: PILL }),
      Button({ id: 'mode', label: modeLabel, onClick: a.mode, style: PILL }),
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
    const aiStyle = ai.active
      ? { ...PILL, background: [86, 64, 120] as RGB, color: [238, 230, 250] as RGB }
      : PILL;
    // The illegal-moves toggle: when on, AI moves bypass the rules. A warm red
    // highlight signals "no rules" is live.
    const illegalStyle = illegalOn
      ? { ...PILL, background: [150, 58, 58] as RGB, color: [250, 232, 230] as RGB }
      : PILL;
    // The eval-bar toggle: a cool slate highlight when the rail is shown.
    const evalStyle = evalOn
      ? { ...PILL, background: [60, 78, 112] as RGB, color: [230, 238, 250] as RGB }
      : PILL;
    buttons = [
      Button({ id: 'back', label: 'back', onClick: a.back, style: PILL }),
      Button({ id: 'ai', label: ai.label, onClick: a.aiMatch, style: aiStyle }),
      Button({ id: 'reset-game', label: 'reset game', onClick: a.resetGame, style: PILL }),
      Button({ id: 'illegal', label: `illegal: ${illegalOn ? 'on' : 'off'}`, onClick: a.illegalMoves, style: illegalStyle }),
      Button({ id: 'eval-bar', label: evalOn ? 'hide eval bar' : 'show eval bar', onClick: a.evalBar, style: evalStyle }),
      Button({ id: 'reset', label: 'reset view', onClick: a.reset, style: PILL }),
      Button({ id: 'mode', label: modeLabel, onClick: a.mode, style: PILL }),
      Button({ id: 'quit', label: 'quit', onClick: a.quit, style: PILL }),
    ];
  } else if (mode === 'chess') {
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
      background: [22, 24, 32], // unified popup/panel background
    },
    [
      Box({ justifyContent: 'center' }, [Text({ text: 'Promote to', style: { color: [222, 224, 234], bold: true } })]),
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
      btn('over-newgame', 'New game', onNewGame, true),
      btn('over-close', 'Close', onClose, false),
    ],
  );
  return Modal(card);
}
