// The Catan tile test bed's HUD: a small control panel (top-left) whose dropdown switches
// which terrain tile the scene shows, plus the standard bottom bar. Mirrors the poker cards
// HUD's shape — persistent component instances mounted via Slot, rebuilt each frame.

import { Box, Button, Dialog, Dropdown, type LayoutBox, Modal, type Node, RoundedButton, type Screen, Slot, type Style, Text } from '../../../tui/index.ts';
import { stringWidth } from '../../../engine/index.ts';
import { type PlayerColor, type Terrain } from '../../../rules/catan/types.ts';
import { type BoardToken, type CatanMode, type SailLabel } from './tile-scene.ts';
import { type PortKind } from './tile-mesh.ts';
import { UI_CHROME_BG, UI_CHROME_PILL } from '../../theme.ts';

const CHIP_BG: [number, number, number] = [12, 12, 16]; // black token
const CHIP_INK: [number, number, number] = [238, 236, 230]; // light number on black
const CHIP_RED: [number, number, number] = [232, 74, 74]; // 6 & 8 — the high-frequency reds
const CHIP_GOLD: [number, number, number] = [232, 190, 60]; // lit when it matches the dice roll
const CHIP_GOLD_INK: [number, number, number] = [40, 30, 8]; // dark number on the gold chip

// A number token centered over a hex: a black chip with just the number (red for 6/8), lit to
// gold when it matches the last dice roll. Absolutely positioned at the projected hex center.
function tokenChip(tk: BoardToken): Node {
  const label = `${tk.num}`;
  const bg = tk.hot ? CHIP_GOLD : CHIP_BG;
  const ink = tk.hot ? CHIP_GOLD_INK : tk.red ? CHIP_RED : CHIP_INK;
  return Box({ position: 'absolute', top: tk.row, left: tk.col - Math.floor((label.length + 2) / 2), background: bg, padding: [0, 1] }, [
    Text({ text: label, style: { color: ink, bold: true } }),
  ]);
}

// The trade-info chip on a port's sail: a one-row badge on a plain black chip — the same look as
// the hex number tokens, so it reads as a distinct label against the white sail without a border or
// fill. Reads as what it trades then the rate: "🐑 2:1". Absolutely positioned on the sail's
// projected center cell, centered horizontally on it — the label's width varies with the icon
// (a 2-cell emoji or a 1-cell '?'), hence the measure.
function sailChip(s: SailLabel): Node {
  const label = s.icon + ' ' + s.ratio;
  return Box({ position: 'absolute', top: s.row, left: s.col - Math.floor((stringWidth(label) + 2) / 2), background: CHIP_BG, padding: [0, 1] }, [
    Text({ text: label, style: { color: CHIP_INK, bold: true } }),
  ]);
}

// The six terrains, labeled by what they produce (desert produces nothing).
const TERRAINS: Terrain[] = ['forest', 'hills', 'pasture', 'fields', 'mountains', 'desert'];
const LABELS = ['Forest · lumber', 'Hills · brick', 'Pasture · wool', 'Fields · grain', 'Mountains · ore', 'Desert · —'];

// The player colors selectable in pieces mode / the piece editor.
const COLORS: PlayerColor[] = ['red', 'blue', 'white', 'orange'];
const COLOR_LABELS = ['Red', 'Blue', 'White', 'Orange'];
const SWATCH: Record<PlayerColor, [number, number, number]> = {
  red: [201, 58, 47],
  blue: [56, 106, 200],
  white: [232, 230, 222],
  orange: [227, 129, 42],
};
// The scene modes, chosen from the Mode dropdown.
const MODES: CatanMode[] = ['tile', 'board', 'pieces', 'port'];
const MODE_LABELS = ['Tile', 'Board', 'Pieces', 'Port'];

// The nine harbor types: one generic 3:1 (empty ship) + a 2:1 port per resource.
const PORT_KINDS: PortKind[] = ['generic', 'brick', 'grain', 'lumber', 'ore', 'wool'];
const PORT_LABELS = ['3:1 · any', '2:1 · brick', '2:1 · grain', '2:1 · lumber', '2:1 · ore', '2:1 · wool'];

export interface CatanTileHandlers {
  onTerrain(t: Terrain): void;
  onReroll(): void;
  onToggleRobber(on: boolean): void;
  onMode(mode: CatanMode): void;
  onRollDice(): void;
  onColor(c: PlayerColor): void;
  onPort(kind: PortKind): void;
}
let H: CatanTileHandlers | null = null;
let robberOn = false; // whether the robber is currently shown (toggled from the panel)
export function setCatanTileHandlers(h: CatanTileHandlers): void {
  H = h;
}

const modeDropdown = new Dropdown({ id: 'catan-mode', items: MODE_LABELS, width: 14, index: 0, onSelect: (i) => H?.onMode(MODES[i]) });
const terrainDropdown = new Dropdown({ id: 'catan-terrain', items: LABELS, width: 24, index: 0, onSelect: (i) => H?.onTerrain(TERRAINS[i]) });
const colorDropdown = new Dropdown({ id: 'catan-color', items: COLOR_LABELS, width: 14, index: 0, onSelect: (i) => H?.onColor(COLORS[i]) });
const portDropdown = new Dropdown({ id: 'catan-port', items: PORT_LABELS, width: 16, index: 0, onSelect: (i) => H?.onPort(PORT_KINDS[i]) });

export function mountCatanTileHud(ui: Screen): void {
  ui.mount(modeDropdown);
  ui.mount(terrainDropdown);
  ui.mount(colorDropdown);
  ui.mount(portDropdown);
}

// The terrain the dropdown currently shows (its committed selection).
export function catanTileTerrain(): Terrain {
  return TERRAINS[terrainDropdown.index < 0 ? 0 : terrainDropdown.index];
}
// Set the Mode dropdown's committed selection (keeps it in sync when the scene mode is set
// programmatically, e.g. defaulting to board on entry).
export function setCatanTileMode(mode: CatanMode): void {
  modeDropdown.pick(MODES.indexOf(mode));
}

function labeled(label: string, node: Node): Node {
  return Box({ flexDirection: 'column', gap: 0 }, [Text({ text: label, style: { color: 'muted' } }), node]);
}

const REROLL_BTN: Style = {
  padding: [0, 2],
  background: [44, 46, 56],
  color: [212, 214, 224],
  bold: true,
  hover: { background: [238, 240, 248], color: [16, 16, 24] },
  focus: { background: [86, 90, 108], color: [248, 248, 252] },
  pressed: { background: [255, 255, 255], color: [12, 12, 18] },
};

// The piece-edit modal: shown when a placed piece is clicked. A settlement can upgrade to a
// city; every piece can be removed or recolored. A dim scrim behind closes on click.
export interface PieceModalOpts {
  road: boolean;
  city: boolean;
  color: PlayerColor;
  onUpgrade: () => void;
  onRemove: () => void;
  onColor: (c: PlayerColor) => void;
  onClose: () => void;
}
export function buildCatanPieceModal(o: PieceModalOpts): Node {
  // Rounded outlined actions (same family as the game-menu items), stacked flush so their arc
  // borders read as one list.
  const actions: Node[] = [];
  if (!o.road && !o.city) actions.push(RoundedButton({ id: 'pm-upgrade', label: 'upgrade to city', onClick: o.onUpgrade, color: [212, 214, 224], borderColor: [88, 92, 110] }));
  actions.push(RoundedButton({ id: 'pm-remove', label: 'remove', onClick: o.onRemove, color: [212, 214, 224], borderColor: [88, 92, 110] }));
  // Borderless color swatches; the active color is marked with a check whose ink is picked for
  // contrast against the swatch.
  const swatches = Box(
    { flexDirection: 'row', gap: 1 },
    COLORS.map((c) => {
      const [r, g, b] = SWATCH[c];
      const ink: [number, number, number] = 0.299 * r + 0.587 * g + 0.114 * b > 150 ? [24, 24, 28] : [245, 245, 245];
      return Button({ id: `pm-col-${c}`, label: c === o.color ? ' ✓ ' : '   ', onClick: () => o.onColor(c), style: { padding: [0, 1], background: SWATCH[c], color: ink, bold: true } });
    }),
  );
  const card = Dialog({ title: o.road ? 'Road' : o.city ? 'City' : 'Settlement', onClose: o.onClose, closeId: 'pm-close', padding: [1, 2], background: UI_CHROME_BG }, [
    Box({ flexDirection: 'column', gap: 1 }, [Box({ flexDirection: 'column', alignItems: 'stretch', gap: 0 }, actions), labeled('Color', swatches)]),
  ]);
  // Menu-style overlay: a dim scrim behind the card that dismisses on an outside click.
  return Modal(card, { onDismiss: o.onClose });
}

// The full-screen HUD: a translucent control panel (top-left) with the per-mode controls and a
// ☰ menu button (top-right). No bottom bar — home/reset/display/etc. all live in the menu.
// `onOpenMenu` opens the game menu; `tokens` are the board number chips; `sail` is the port
// trade chip (both are 2D overlays projected onto the scene).
export function buildCatanTileRoot(region: LayoutBox, onOpenMenu: () => void, tokens: BoardToken[] = [], mode: CatanMode = 'tile', sail: SailLabel | null = null): Node {
  // Per-mode controls: board → regenerate; pieces → color picker; tile → terrain + vary + robber.
  const controls: Node[] =
    mode === 'board'
      ? [Button({ id: 'catan-reroll', label: '⟳ regenerate', onClick: () => H?.onReroll(), style: REROLL_BTN }), labeled('Color', Slot('catan-color'))]
      : mode === 'pieces'
        ? [labeled('Color', Slot('catan-color'))]
        : mode === 'port'
          ? [labeled('Port', Slot('catan-port'))]
          : [
            labeled('Tile', Slot('catan-terrain')),
            Button({ id: 'catan-reroll', label: '⟳ vary', onClick: () => H?.onReroll(), style: REROLL_BTN }),
            Button({
              id: 'catan-robber',
              label: robberOn ? '● robber: on' : '○ robber: off',
              onClick: () => {
                robberOn = !robberOn;
                H?.onToggleRobber(robberOn);
              },
              style: REROLL_BTN,
            }),
          ];
  const panel = Box({ flexDirection: 'column', gap: 1, padding: [1, 2], background: [16, 18, 26, 0.9] }, [labeled('Mode', Slot('catan-mode')), ...controls]);
  return Box({ width: region.w, height: region.h }, [
    ...tokens.map(tokenChip), // number tokens over the board (bottom layer, under the chrome)
    ...(sail ? [sailChip(sail)] : []), // port mode: the trade-info chip on the sail
    Box({ width: region.w, height: region.h, flexDirection: 'column' }, [Box({ flexDirection: 'row', padding: [1, 0, 0, 2] }, [panel])]),
    Box({ position: 'absolute', top: 1, right: 2 }, [Button({ id: 'catan-menu-button', label: '☰ menu', onClick: onOpenMenu, style: UI_CHROME_PILL })]),
    // Board mode: a roll button in the bottom-right; triggers the big dice overlay. Same
    // margin from the right as the ☰ menu button, same from the bottom as the bottom bar.
    ...(mode === 'board' ? [Box({ position: 'absolute', bottom: 1, right: 2 }, [Button({ id: 'catan-roll', label: 'roll dice', onClick: () => H?.onRollDice(), style: REROLL_BTN })])] : []),
  ]);
}
