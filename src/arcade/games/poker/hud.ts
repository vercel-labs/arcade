// The cards-screen HUD: a small control panel over the 3D scene plus the standard
// bottom bar. The mode dropdown switches Single / Hand / Deck; the panel then shows
// mode-specific controls — a suit + rank picker (single) or a players count with
// Shuffle / Deal (deck). Mirrors the chess HUD's shape: persistent component
// instances mounted via Slot, rebuilt into a full-screen tree each frame.

import { Box, Dropdown, Field, FilledButton, type LayoutBox, type Node, type Screen, Slot } from '../../../tui/index.ts';
import { type Card, RANK_LABELS, type Suit, SUIT_NAMES } from '../../../rules/poker/cards.ts';
import type { CardsMode } from './cards-scene.ts';

const MODES: CardsMode[] = ['single', 'hand', 'deck'];
const MODE_LABELS = ['Single card', 'Poker hand', 'Deck'];

// Handlers the orchestrator wires in (main owns the scene; this module owns the
// controls). Set once via setPokerHandlers; the dropdowns/buttons call into them.
export interface PokerHandlers {
  onMode(m: CardsMode): void;
  onCard(card: Card): void;
  onShuffle(): void;
  onDeal(): void;
  onPlayers(n: number): void;
}
let H: PokerHandlers | null = null;
export function setPokerHandlers(h: PokerHandlers): void {
  H = h;
}

// Emit the currently-picked card (suit + rank) to the scene.
function emitCard(): void {
  const suit = (suitDropdown.index < 0 ? 0 : suitDropdown.index) as Suit;
  const rank = rankDropdown.index < 0 ? 0 : rankDropdown.index;
  H?.onCard({ rank, suit });
}

const modeDropdown = new Dropdown({ id: 'poker-mode', items: MODE_LABELS, width: 15, index: 0, onSelect: (i) => H?.onMode(MODES[i]) });
const suitDropdown = new Dropdown({ id: 'poker-suit', items: [...SUIT_NAMES], width: 13, index: 0, onSelect: emitCard });
const rankDropdown = new Dropdown({ id: 'poker-rank', items: [...RANK_LABELS], width: 8, rows: 7, index: 0, onSelect: emitCard });
const playersDropdown = new Dropdown({ id: 'poker-players', items: ['2', '3', '4', '5', '6', '7', '8'], width: 8, index: 2, onSelect: (i) => H?.onPlayers(i + 2) });

export function mountPokerHud(ui: Screen): void {
  ui.mount(modeDropdown);
  ui.mount(suitDropdown);
  ui.mount(rankDropdown);
  ui.mount(playersDropdown);
}

// The mode the dropdown currently shows (its committed selection).
export function pokerMode(): CardsMode {
  return MODES[modeDropdown.index < 0 ? 0 : modeDropdown.index];
}

// The mode-specific control cluster inside the panel.
function controls(mode: CardsMode): Node[] {
  if (mode === 'single') {
    return [Field({ label: 'Suit', child: Slot('poker-suit') }), Field({ label: 'Rank', child: Slot('poker-rank') })];
  }
  if (mode === 'deck') {
    return [
      Field({ label: 'Players', child: Slot('poker-players') }),
      Box({ flexDirection: 'row', gap: 2 }, [
        FilledButton({ id: 'poker-shuffle', label: 'shuffle', onClick: () => H?.onShuffle() }),
        FilledButton({ id: 'poker-deal', label: 'deal', onClick: () => H?.onDeal() }),
      ]),
    ];
  }
  return [];
}

// Build the full-screen cards HUD: a translucent control panel (top-left) over the
// scene, with the standard bar beneath. `bar` is buildBar('cards', …) from main.
export function buildPokerRoot(region: LayoutBox, bar: Node): Node {
  const mode = pokerMode();
  const panel = Box(
    { flexDirection: 'column', gap: 1, padding: [1, 2], background: [16, 18, 26, 0.9] },
    [Field({ label: 'Mode', child: Slot('poker-mode') }), ...controls(mode)],
  );
  return Box({ width: region.w, height: region.h, flexDirection: 'column' }, [
    Box({ flexDirection: 'row', padding: [1, 0, 0, 2] }, [panel]),
    Box({ flexGrow: 1 }),
    bar,
    Box({ height: 1 }), // lift the bar off the bottom edge
  ]);
}
