// The 'ui' screen: a playground that mounts every TUI component over the chess
// scene so the components can be exercised live (Tab between them, type/arrow to
// interact). It's the working proof of the Phase 6/7 substrate — persistent
// component state, focus routing, alpha-composited panels, and the FrameBuffer
// draw hook, all over a real 3D backdrop.

import { hslToRgb } from '../../engine/index.ts';
import {
  ASCIIFont,
  Box,
  Combobox,
  FrameBuffer,
  Input,
  Select,
  ScrollBox,
  Slider,
  Slot,
  Text,
  type LayoutBox,
  type Node,
  type Screen,
} from '../../tui/index.ts';

// Long-lived component instances. Module-level so their state (caret, selection,
// slider value, scroll) persists across visits to the screen; mountShowcase
// re-registers the same objects each time the screen is entered.
const input = new Input({ id: 'sc-input', width: 22, placeholder: 'type here…' });
const select = new Select({ id: 'sc-select', width: 14, items: ['Queen', 'Rook', 'Bishop', 'Knight', 'Pawn', 'King'], height: 4 });
const slider = new Slider({ id: 'sc-slider', width: 20, value: 0.5 });
const scroll = new ScrollBox({
  id: 'sc-scroll',
  width: 22,
  height: 4,
  rows: Array.from({ length: 14 }, (_, i) => `  ${String(i + 1).padStart(2)}. move ${i + 1}`),
});

// A small, deliberately static catalog for the component prototype. The actual
// match catalog remains Arcade-owned; this scene only proves that one reusable
// combobox can drive another without importing setup-screen code into the TUI.
const showcaseModels: Record<string, string[]> = {
  OpenAI: ['GPT-5', 'GPT-5 Mini', 'o3', 'GPT-4.1'],
  Anthropic: ['Claude Opus 4.1', 'Claude Sonnet 4', 'Claude 3.7 Sonnet'],
  Google: ['Gemini 2.5 Pro', 'Gemini 2.5 Flash', 'Gemini 2.0 Flash'],
  xAI: ['Grok 4', 'Grok 3 Mini'],
  Mistral: ['Mistral Large', 'Codestral', 'Ministral 8B'],
};

const modelCombobox = new Combobox({
  id: 'sc-model-combobox',
  items: showcaseModels.OpenAI,
  width: 28,
  rows: 7,
  index: 0,
  placeholder: 'Search models…',
});
const creatorCombobox = new Combobox({
  id: 'sc-creator-combobox',
  items: Object.keys(showcaseModels),
  width: 28,
  rows: 6,
  index: 0,
  placeholder: 'Search creators…',
  onSelect: (_index, creator) => modelCombobox.setItems(showcaseModels[creator] ?? [], 0),
});

export function mountShowcase(ui: Screen): void {
  ui.mount(input);
  ui.mount(select);
  ui.mount(slider);
  ui.mount(scroll);
  ui.mount(creatorCombobox);
  ui.mount(modelCombobox);
}

// A labeled row: a muted fixed-width caption next to the component's Slot/node.
function row(label: string, node: Node): Node {
  return Box({ flexDirection: 'row', gap: 2, alignItems: 'start' }, [
    Text({ text: label, style: { color: 'muted', width: 9 } }),
    node,
  ]);
}

// A FrameBuffer demo: a hand-drawn horizontal hue gradient — the escape hatch
// from boxes-and-text into per-cell drawing.
const gradient = FrameBuffer({
  width: 22,
  height: 2,
  draw: (surf, box) => {
    for (let x = 0; x < box.w; x++) {
      const c = hslToRgb((x / Math.max(1, box.w - 1)) * 300, 0.7, 0.55);
      for (let y = 0; y < box.h; y++) surf.setCell(box.x + x, box.y + y, '█', c, [0, 0, 0]);
    }
  },
});

// Build the full-screen 'ui' tree: a centered translucent panel of components
// over the scene, with the standard bottom bar beneath it.
export function buildShowcase(region: LayoutBox, bar: Node): Node {
  const panel = Box(
    {
      flexDirection: 'column',
      gap: 1,
      padding: [1, 3],
      // No border — the translucent fill alone separates the panel from the scene
      // (the edge reads as a contrast boundary, not a drawn line).
      background: [16, 18, 26, 0.92],
    },
    [
      Box({ justifyContent: 'center' }, [ASCIIFont('UI', { color: 'accent' })]),
      row('Input', Slot('sc-input')),
      row('Select', Slot('sc-select')),
      row('Slider', Slot('sc-slider')),
      row('Scroll', Slot('sc-scroll')),
      row('Buffer', gradient),
      Text({ text: 'tab cycle · type / ↑↓ ←→ interact · b back', style: { color: 'muted' } }),
    ],
  );

  // Kept out of the centered component card on purpose: this is the intended
  // in-game placement, floating at the top-right directly over the 3D scene.
  const pickerPanel: Node = {
    ...Box(
      {
        position: 'absolute',
        top: 1,
        right: 2,
        width: 32,
        flexDirection: 'column',
        gap: 1,
        padding: [1, 2],
        background: [16, 18, 26, 0.9],
      },
      [
        Text({ text: 'MODEL SELECTOR', style: { bold: true, color: 'accent' } }),
        Text({ text: 'creator', style: { color: 'muted' } }),
        Slot('sc-creator-combobox'),
        Text({ text: 'model', style: { color: 'muted' } }),
        Slot('sc-model-combobox'),
        Text({ text: 'type to search · ↑↓ choose · enter select', style: { color: 'muted' } }),
      ],
    ),
    overlay: true,
  };

  return Box({ width: region.w, height: region.h, flexDirection: 'column' }, [
    Box({ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }, [panel]),
    bar,
    Box({ height: 1 }), // lift the bar off the very bottom edge
    pickerPanel,
  ]);
}
