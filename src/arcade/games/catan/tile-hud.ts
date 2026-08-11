// The Catan tile test bed's HUD: a small control panel (top-left) whose dropdown switches
// which terrain tile the scene shows, plus the standard bottom bar. Mirrors the poker cards
// HUD's shape — persistent component instances mounted via Slot, rebuilt each frame.

import { Box, Button, Dialog, Dropdown, Field, FilledButton, type LayoutBox, Modal, type Node, ProjectedAnchor, RoundedButton, type Screen, Slot, Text } from '../../../tui/index.ts';
import { stringWidth } from '../../../engine/index.ts';
import { type PlayerColor, type Terrain } from '../../../rules/catan/types.ts';
import { type BoardToken, type CatanMode, type SailLabel } from './tile-scene.ts';
import { type PortKind } from './mesh/index.ts';
import { UI_CHROME_BG, UI_CHROME_PILL, uiChromeBg } from '../../theme.ts';
import { buildCatanCardsOverlay, CATAN_RAIL_W, catanResourceFace, catanSidebarOpen, mountCatanCardsHud, toggleCatanSidebar } from './card-hud.ts';
import { type FlyingResource } from './scene/resource-flight.ts';

const CHIP_BG: [number, number, number] = [12, 12, 16]; // black token
const CHIP_INK: [number, number, number] = [238, 236, 230]; // light number on black
const CHIP_RED: [number, number, number] = [232, 74, 74]; // 6 & 8 — the high-frequency reds
const CHIP_GOLD: [number, number, number] = [232, 190, 60]; // lit when it matches the dice roll
const CHIP_GOLD_INK: [number, number, number] = [40, 30, 8]; // dark number on the gold chip
const CHIP_BLOCKED: [number, number, number] = [92, 98, 108]; // rolled, but suppressed by the robber
const CHIP_BLOCKED_INK: [number, number, number] = [226, 229, 235];

// Keep the production row deliberately simple and compact; adjacent bullets have no spaces.
function pipLabel(count: number): string {
  return '•'.repeat(count);
}

// A number token centered over a hex: the number plus its official production-probability
// pips. A detailed two-row token straddles the projected center (number above, pips on it),
// while the distant one-row form places the number directly on that center.
// A resource card in flight: its glyph on its own card's fill, so it stays readable over the
// board's ASCII and lands on an exact color match. Deliberately the smallest chip that reads as
// one — a single row, and one column of fill either side of the two-cell glyph. Any taller and
// it stops looking like a card skimming the board and starts looking like a panel.
const FLIGHT_PAD_X = 1;
const FLIGHT_SINK_GLYPH = '▄'; // lower half: what is left of the chip once its base is behind the panel
function flyingCard(f: FlyingResource): Node {
  const { emoji, fill } = catanResourceFace(f.resource);
  // Measured rather than assumed to be two: a glyph that turns out to advance one cell would
  // otherwise leave a column of fill hanging off the chip's edge.
  const width = stringWidth(emoji) + FLIGHT_PAD_X * 2;
  // Centered on the flight point, the way the number chips center on their hex.
  // Half behind the card: fill painted as a foreground half block rather than a cell background,
  // which is the only way to colour part of a cell. The glyph goes — there is no half-height emoji
  // — so the last thing seen is a thin bar of the card's own colour meeting its edge. The cell's
  // other half is given the panel's own field, since this row is always the padding strip just
  // above the cards; left unset it would inherit black and punch a notch in the panel.
  if (f.sinking) {
    return ProjectedAnchor({ col: f.col, row: f.row, width, style: { background: uiChromeBg(0.9) } }, [
      Text({ text: FLIGHT_SINK_GLYPH.repeat(width), style: { color: fill } }),
    ]);
  }
  return ProjectedAnchor({ col: f.col, row: f.row, width, style: { background: fill, padding: [0, FLIGHT_PAD_X] } }, [
    Text({ text: emoji }),
  ]);
}

function tokenChip(tk: BoardToken): Node {
  const label = `${tk.num}`;
  const pips = pipLabel(tk.pips);
  const showPips = tk.showPips && pips.length > 0;
  const labelWidth = stringWidth(label);
  const pipWidth = showPips ? stringWidth(pips) : 0;
  const contentWidth = Math.max(labelWidth, pipWidth);
  const chipWidth = contentWidth + 2;
  // Center each row as closely as whole terminal cells allow. floor() deliberately picks the
  // left-hand position whenever the ideal offset is a half cell.
  const labelOffset = Math.floor((contentWidth - labelWidth) / 2);
  const pipOffset = Math.floor((contentWidth - pipWidth) / 2);
  const bg = tk.blocked ? CHIP_BLOCKED : tk.hot ? CHIP_GOLD : CHIP_BG;
  const ink = tk.blocked ? CHIP_BLOCKED_INK : tk.hot ? CHIP_GOLD_INK : tk.red ? CHIP_RED : CHIP_INK;
  const chipHeight = showPips ? 2 : 1;
  return ProjectedAnchor({ col: tk.col, row: tk.row, width: chipWidth, height: chipHeight, alignY: 'end', style: { flexDirection: 'column', alignItems: 'start', gap: 0, background: bg, padding: [0, 1] } }, [
    Text({ text: label, style: { color: ink, bold: true, margin: [0, 0, 0, labelOffset] } }),
    ...(showPips ? [Text({ text: pips, style: { color: ink, margin: [0, 0, 0, pipOffset] } })] : []),
  ]);
}

// The trade-info chip on a port's sail: a one-row badge on a plain black chip — the same look as
// the hex number tokens, so it reads as a distinct label against the white sail without a border or
// fill. Resource ports read as what they trade then the rate ("🐑 2:1"); the generic port
// shows only "3:1". Absolutely positioned on the sail's projected center cell, centered
// horizontally on it — the label's width varies with the icon, hence the measure.
function sailChip(s: SailLabel): Node {
  const label = s.icon === '?' ? s.ratio : s.icon + ' ' + s.ratio;
  const width = stringWidth(label) + 2;
  return ProjectedAnchor({ col: s.col, row: s.row, width, style: { background: CHIP_BG, padding: [0, 1] } }, [
    Text({ text: label, style: { color: CHIP_INK, bold: true } }),
  ]);
}

// The six terrains, labeled by what they produce (desert produces nothing).
const TERRAINS: Terrain[] = ['forest', 'hills', 'pasture', 'fields', 'mountains', 'desert'];
const LABELS = ['Forest · lumber', 'Hills · brick', 'Pasture · wool', 'Fields · grain', 'Mountains · ore', 'Desert · —'];

// The player colors selectable in pieces mode / the piece editor.
const COLORS: PlayerColor[] = ['red', 'blue', 'purple', 'orange'];
const COLOR_LABELS = ['Red', 'Blue', 'Purple', 'Orange'];
// The chip previews the piece, so these match PLAYER_RGB exactly.
const SWATCH: Record<PlayerColor, [number, number, number]> = {
  red: [201, 58, 47],
  blue: [56, 106, 200],
  purple: [196, 158, 228],
  orange: [227, 129, 42],
};
// The scene modes, chosen from the Mode dropdown.
const MODES: CatanMode[] = ['tile', 'board', 'boardCards', 'pieces', 'port'];
const MODE_LABELS = ['Tile', 'Board', 'Board + cards', 'Pieces', 'Port'];

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
  onToggleSidebar(): void;
}
let H: CatanTileHandlers | null = null;
let robberOn = false; // whether the robber is currently shown (toggled from the panel)
export function setCatanTileHandlers(h: CatanTileHandlers): void {
  H = h;
}

const modeDropdown = new Dropdown({ id: 'catan-mode', items: MODE_LABELS, width: 18, index: 0, onSelect: (i) => H?.onMode(MODES[i]) });
const terrainDropdown = new Dropdown({ id: 'catan-terrain', items: LABELS, width: 24, index: 0, onSelect: (i) => H?.onTerrain(TERRAINS[i]) });
const colorDropdown = new Dropdown({ id: 'catan-color', items: COLOR_LABELS, width: 14, index: 0, onSelect: (i) => H?.onColor(COLORS[i]) });
const portDropdown = new Dropdown({ id: 'catan-port', items: PORT_LABELS, width: 16, index: 0, onSelect: (i) => H?.onPort(PORT_KINDS[i]) });

export function mountCatanTileHud(ui: Screen): void {
  ui.mount(modeDropdown);
  ui.mount(terrainDropdown);
  ui.mount(colorDropdown);
  ui.mount(portDropdown);
  mountCatanCardsHud(ui); // the card overlay's scrollable action history
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
    Box({ flexDirection: 'column', gap: 1 }, [Box({ flexDirection: 'column', alignItems: 'stretch', gap: 0 }, actions), Field({ label: 'Color', child: swatches })]),
  ]);
  // Menu-style overlay: a dim scrim behind the card that dismisses on an outside click.
  return Modal(card, { onDismiss: o.onClose });
}

// The full-screen HUD: a translucent control panel (top-left) with the per-mode controls and a
// ☰ menu button (top-right). No bottom bar — home/reset/display/etc. all live in the menu.
// `onOpenMenu` opens the game menu; `tokens` are the board number chips; `sails` are the port
// trade chips (both are 2D overlays projected onto the scene).
export function buildCatanTileRoot(region: LayoutBox, onOpenMenu: () => void, tokens: BoardToken[] = [], mode: CatanMode = 'tile', sails: SailLabel[] = [], flights: FlyingResource[] = [], movingRobber = false): Node {
  // Per-mode controls: board → regenerate; pieces → color picker; tile → terrain + vary + robber.
  const boardMode = mode === 'board' || mode === 'boardCards';
  const railOpen = mode === 'boardCards' && catanSidebarOpen();
  const toggleSidebar = (): void => {
    toggleCatanSidebar();
    H?.onToggleSidebar();
  };
  const controls: Node[] =
    boardMode
      ? [FilledButton({ id: 'catan-reroll', label: '⟳ regenerate', onClick: () => H?.onReroll() }), Field({ label: 'Color', child: Slot('catan-color') })]
      : mode === 'pieces'
        ? [Field({ label: 'Color', child: Slot('catan-color') })]
        : mode === 'port'
          ? [Field({ label: 'Port', child: Slot('catan-port') })]
          : [
            Field({ label: 'Tile', child: Slot('catan-terrain') }),
            FilledButton({ id: 'catan-reroll', label: '⟳ vary', onClick: () => H?.onReroll() }),
            FilledButton({
              id: 'catan-robber',
              label: robberOn ? '● robber: on' : '○ robber: off',
              onClick: () => {
                robberOn = !robberOn;
                H?.onToggleRobber(robberOn);
              },
            }),
          ];
  const panel = Box({ flexDirection: 'column', gap: 1, padding: [1, 2], background: [16, 18, 26, 0.9] }, [Field({ label: 'Mode', child: Slot('catan-mode') }), ...controls]);
  return Box({ width: region.w, height: region.h }, [
    ...tokens.map(tokenChip), // number tokens over the board (bottom layer, under the chrome)
    ...sails.map(sailChip), // board/port mode: trade-info chips projected onto the sails
    Box({ width: region.w, height: region.h, flexDirection: 'column' }, [Box({ flexDirection: 'row', padding: [1, 0, 0, 2] }, [panel])]),
    ...(mode === 'boardCards' ? [buildCatanCardsOverlay(region, toggleSidebar)] : []),
    // Cards in flight paint OVER the hand panel, not under it: they have to cross the panel's top
    // padding to reach the card's edge, and paint order alone would hide them a row too early.
    // What keeps them off the card faces is the clip in ResourceFlights — a chip is culled the
    // moment it reaches the card's first row, so the face is never covered. Above the panel but
    // below the chrome, so the menu and roll button stay clickable-looking on top.
    ...flights.map(flyingCard),
    ...(movingRobber
      ? [Box({ position: 'absolute', top: 1, left: 0, width: region.w - (railOpen ? CATAN_RAIL_W : 0), justifyContent: 'center' }, [
          Box({ flexDirection: 'column', alignItems: 'center', padding: [0, 2], background: UI_CHROME_BG }, [
            Text({ text: 'moving robber', style: { color: CHIP_BLOCKED_INK, bold: true } }),
            Text({ text: 'choose a different tile', style: { color: [154, 159, 170] } }),
          ]),
        ])]
      : []),
    // The rail owns the right strip while open, so the chrome shifts left by its width to stay
    // over the visible scene. Open, the reopen pill drops — the rail's own ✕ collapses it.
    Box({ position: 'absolute', top: 1, right: 2 + (railOpen ? CATAN_RAIL_W : 0), flexDirection: 'row', gap: 1 }, [
      Button({ id: 'catan-menu-button', label: '☰ menu', onClick: onOpenMenu, style: UI_CHROME_PILL }),
      ...(mode === 'boardCards' && !railOpen ? [Button({ id: 'catan-sidebar-open', label: 'sidebar', onClick: toggleSidebar, style: UI_CHROME_PILL })] : []),
    ]),
    // Either board mode: a roll button in the bottom-right; triggers the big dice overlay. Same
    // margin from the right as the ☰ menu button, same from the bottom as the bottom bar, and it
    // steps left by the rail's width alongside that chrome so it stays over the visible scene.
    // The hand panel hugs the bottom-LEFT corner, so the two never meet.
    ...(boardMode && !movingRobber
      ? [Box({ position: 'absolute', bottom: 1, right: 2 + (railOpen ? CATAN_RAIL_W : 0) }, [FilledButton({ id: 'catan-roll', label: 'roll dice', onClick: () => H?.onRollDice() })])]
      : []),
  ]);
}
