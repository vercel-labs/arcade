// The Catan tile test bed's HUD: a small control panel (top-left) whose dropdown switches
// which terrain tile the scene shows, plus the standard bottom bar. Mirrors the poker cards
// HUD's shape — persistent component instances mounted via Slot, rebuilt each frame.

import { Box, Button, Dropdown, type LayoutBox, type Node, type Screen, Slot, type Style, Text } from '../../../tui/index.ts';
import { type Terrain } from '../../../rules/catan/types.ts';
import { UI_CHROME_PILL } from '../../theme.ts';

// The six terrains, labeled by what they produce (desert produces nothing).
const TERRAINS: Terrain[] = ['forest', 'hills', 'pasture', 'fields', 'mountains', 'desert'];
const LABELS = ['Forest · lumber', 'Hills · brick', 'Pasture · wool', 'Fields · grain', 'Mountains · ore', 'Desert · —'];

export interface CatanTileHandlers {
  onTerrain(t: Terrain): void;
  onReroll(): void;
}
let H: CatanTileHandlers | null = null;
export function setCatanTileHandlers(h: CatanTileHandlers): void {
  H = h;
}

const terrainDropdown = new Dropdown({ id: 'catan-terrain', items: LABELS, width: 24, index: 0, onSelect: (i) => H?.onTerrain(TERRAINS[i]) });

export function mountCatanTileHud(ui: Screen): void {
  ui.mount(terrainDropdown);
}

// The terrain the dropdown currently shows (its committed selection).
export function catanTileTerrain(): Terrain {
  return TERRAINS[terrainDropdown.index < 0 ? 0 : terrainDropdown.index];
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

// The full-screen HUD: a translucent control panel (top-left) with the terrain dropdown + a
// "vary" button (new procedural variant), a ☰ menu button (top-right), and the standard bar
// beneath. `bar` is buildBar('catan-tiles', …) from main; `onOpenMenu` opens the game menu.
export function buildCatanTileRoot(region: LayoutBox, bar: Node, onOpenMenu: () => void): Node {
  const panel = Box({ flexDirection: 'column', gap: 1, padding: [1, 2], background: [16, 18, 26, 0.9] }, [
    labeled('Tile', Slot('catan-terrain')),
    Button({ id: 'catan-reroll', label: '⟳ vary', onClick: () => H?.onReroll(), style: REROLL_BTN }),
  ]);
  return Box({ width: region.w, height: region.h }, [
    Box({ width: region.w, height: region.h, flexDirection: 'column' }, [
      Box({ flexDirection: 'row', padding: [1, 0, 0, 2] }, [panel]),
      Box({ flexGrow: 1 }),
      bar,
      Box({ height: 1 }),
    ]),
    Box({ position: 'absolute', top: 1, right: 2 }, [Button({ id: 'catan-menu-button', label: '☰ menu', onClick: onOpenMenu, style: UI_CHROME_PILL })]),
  ]);
}
