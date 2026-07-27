// The Catan tile test bed's HUD: a small control panel (top-left) whose dropdown switches
// which terrain tile the scene shows, plus the standard bottom bar. Mirrors the poker cards
// HUD's shape — persistent component instances mounted via Slot, rebuilt each frame.

import { Box, Button, Dropdown, type LayoutBox, type Node, type Screen, Slot, type Style, Text } from '../../../tui/index.ts';
import { type Terrain } from '../../../rules/catan/types.ts';
import { type BoardToken } from './tile-scene.ts';
import { UI_CHROME_PILL } from '../../theme.ts';

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

// The six terrains, labeled by what they produce (desert produces nothing).
const TERRAINS: Terrain[] = ['forest', 'hills', 'pasture', 'fields', 'mountains', 'desert'];
const LABELS = ['Forest · lumber', 'Hills · brick', 'Pasture · wool', 'Fields · grain', 'Mountains · ore', 'Desert · —'];

export interface CatanTileHandlers {
  onTerrain(t: Terrain): void;
  onReroll(): void;
  onToggleRobber(on: boolean): void;
  onMode(mode: 'tile' | 'board'): void;
  onRollDice(): void;
}
let H: CatanTileHandlers | null = null;
let robberOn = false; // whether the robber is currently shown (toggled from the panel)
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
export function buildCatanTileRoot(region: LayoutBox, bar: Node, onOpenMenu: () => void, tokens: BoardToken[] = [], boardMode = false): Node {
  const modeBtn = Button({
    id: 'catan-mode',
    label: boardMode ? '⬡ board' : '▢ tile',
    onClick: () => H?.onMode(boardMode ? 'tile' : 'board'),
    style: REROLL_BTN,
  });
  // Board mode: just a regenerate button. Tile mode: terrain picker + vary + robber toggle.
  const controls: Node[] = boardMode
    ? [Button({ id: 'catan-reroll', label: '⟳ regenerate', onClick: () => H?.onReroll(), style: REROLL_BTN })]
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
  const panel = Box({ flexDirection: 'column', gap: 1, padding: [1, 2], background: [16, 18, 26, 0.9] }, [labeled('Mode', modeBtn), ...controls]);
  return Box({ width: region.w, height: region.h }, [
    ...tokens.map(tokenChip), // number tokens over the board (bottom layer, under the chrome)
    Box({ width: region.w, height: region.h, flexDirection: 'column' }, [
      Box({ flexDirection: 'row', padding: [1, 0, 0, 2] }, [panel]),
      Box({ flexGrow: 1 }),
      bar,
      Box({ height: 1 }),
    ]),
    Box({ position: 'absolute', top: 1, right: 2 }, [Button({ id: 'catan-menu-button', label: '☰ menu', onClick: onOpenMenu, style: UI_CHROME_PILL })]),
    // Board mode: a roll button in the bottom-right; triggers the big dice overlay. Same
    // margin from the right as the ☰ menu button, same from the bottom as the bottom bar.
    ...(boardMode ? [Box({ position: 'absolute', bottom: 1, right: 2 }, [Button({ id: 'catan-roll', label: 'roll dice', onClick: () => H?.onRollDice(), style: REROLL_BTN })])] : []),
  ]);
}
