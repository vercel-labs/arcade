import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stringWidth } from '../engine/width.ts';

test('menu keeps one shared label with no ambiguous-width glyph', async () => {
  const { MENU_BUTTON_LABEL } = await import('./theme.ts');
  assert.equal(MENU_BUTTON_LABEL, 'menu');
  // main.ts sizes the pill's neighbours with `MENU_BUTTON_LABEL.length`, so the
  // rendered width has to equal the code-unit count or that math drifts.
  assert.equal(stringWidth(MENU_BUTTON_LABEL), MENU_BUTTON_LABEL.length);
  // AGENTS.md: only Emoji_Presentation=Yes glyphs are safe here. A text-presentation
  // pictograph (☰ was one) is rendered 1 or 2 cells depending on terminal and font,
  // which desyncs the diff and leaves a stale cell beside the pill.
  assert.doesNotMatch(MENU_BUTTON_LABEL, /\p{Extended_Pictographic}/u);
});
