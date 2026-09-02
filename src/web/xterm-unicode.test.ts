import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARCADE_UNICODE_VERSION, arcadeUnicodeProvider } from './xterm-unicode.ts';

test('xterm provider uses Arcade widths for symbols and modern emoji', () => {
  assert.equal(arcadeUnicodeProvider.version, ARCADE_UNICODE_VERSION);
  for (const glyph of ['☰', '🪵', '🧱', '🐑', '🌾', '🪨', '🔨', '🏠', '🏆']) {
    assert.equal(arcadeUnicodeProvider.wcwidth(glyph.codePointAt(0)!), 2, `${glyph} should reserve two xterm cells`);
  }
  for (const glyph of ['≡', '⚄', '✕', '♠']) {
    assert.equal(arcadeUnicodeProvider.wcwidth(glyph.codePointAt(0)!), 1, `${glyph} should reserve one xterm cell`);
  }
  const base = arcadeUnicodeProvider.charProperties('🪵'.codePointAt(0)!, 0);
  const selector = arcadeUnicodeProvider.charProperties(0xfe0f, base);
  assert.equal((selector >> 1) & 0x3, 2);
  assert.equal(selector & 1, 1);
});
