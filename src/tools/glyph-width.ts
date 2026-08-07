// Prints every glyph the UI uses against a column ruler, so a terminal that disagrees with our
// width table shows up immediately as a misaligned row.
//
// Our Surface reserves cells using engine/width.ts. If a terminal advances a different number of
// columns than we reserved, everything after that glyph on the row lands in the wrong cell, the
// row's last cells are never written, and the diff can never repair it — it compares our model
// against our model and concludes the screen is already correct. The debris then survives until a
// resize forces a full repaint.
//
//   pnpm exec tsx src/tools/glyph-width.ts
//
// Read the output: every '|' must line up in a single column. A row whose '|' sits left of the
// others means the terminal advanced FEWER columns than we reserved; right means MORE. Either way
// that glyph is unusable in the UI until width.ts agrees with the terminal.

import { stringWidth } from '../engine/width.ts';

interface Probe {
  glyph: string;
  note: string;
}

// Grouped by Unicode Emoji_Presentation, which is the property that predicts trouble. A glyph with
// Emoji_Presentation=No is a TEXT glyph by default and only becomes an emoji via a trailing U+FE0F
// selector — terminals are free to honour that for drawing while still advancing the text width.
const PRESENTATION_YES: Probe[] = [
  { glyph: '🌲', note: 'lumber card' },
  { glyph: '🧱', note: 'brick card' },
  { glyph: '🐑', note: 'wool card' },
  { glyph: '🌾', note: 'grain card' },
  { glyph: '🪨', note: 'ore card' },
  { glyph: '🤖', note: 'history: model actor' },
  { glyph: '👤', note: 'history: human actor' },
  { glyph: '🎲', note: 'history: roll' },
  { glyph: '💬', note: 'history: chat' },
  { glyph: '🏰', note: 'city' },
  { glyph: '🏠', note: 'house (settlement alt)' },
  { glyph: '🔨', note: 'hammer (dev alt)' },
  { glyph: '🚧', note: 'roadworks' },
  { glyph: '➖', note: 'longest road' },
  { glyph: '💂', note: 'guard (knight alt)' },
];

const PRESENTATION_NO: Probe[] = [
  { glyph: '🛠️', note: 'dev card — hammer and wrench' },
  { glyph: '🛡️', note: 'knights played — shield' },
  { glyph: '🏘️', note: 'settlement — houses' },
  { glyph: '⚔️', note: 'crossed swords (already retired)' },
  { glyph: '⚒️', note: 'hammer and pick (already retired)' },
  { glyph: '🛤️', note: 'railway track (already retired)' },
];

function row({ glyph, note }: Probe): string {
  const w = stringWidth(glyph);
  const codepoints = [...glyph].map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ');
  // Pad so the bar lands in the same column for every row IF the terminal agrees with us.
  return `${glyph}${' '.repeat(Math.max(0, 4 - w))}|  reserved ${w}  ${codepoints.padEnd(18)} ${note}`;
}

console.log('Every | below must line up. A stray one means that glyph desyncs the renderer.\n');
console.log('Emoji_Presentation = Yes  (expected safe)');
for (const p of PRESENTATION_YES) console.log('  ' + row(p));
console.log('\nEmoji_Presentation = No  (needs U+FE0F; terminals may still advance the text width)');
for (const p of PRESENTATION_NO) console.log('  ' + row(p));
console.log('\nRuler, one cell per dash:');
console.log('  ' + '----|'.repeat(4));
