// Display width of text in terminal cells. `String.length` counts UTF-16 code
// units, which is wrong for layout: a CJK glyph or emoji occupies 2 cells, and
// combining marks / zero-width joiners occupy 0. The button bar's centering and
// hit-testing depend on true cell width, so layout measures through here.
//
// This is a compact wcwidth-style table (no dep). It covers the common cases
// (East Asian Wide, the main emoji blocks, combining/zero-width); it is not a
// full Unicode UAX#11 implementation. If real emoji-heavy UI ever lands, swap
// this module for `@cto.af/string-width` behind the same two signatures.

// Codepoints that render with no advance: combining marks, ZW(N)J / ZWSP,
// variation selectors, and the BOM.
function isZeroWidth(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacritical marks
    (cp >= 0x0483 && cp <= 0x0489) || // combining Cyrillic
    (cp >= 0x200b && cp <= 0x200f) || // zero-width space / joiners / marks
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
    (cp >= 0x1ab0 && cp <= 0x1aff) || // combining diacritical marks extended
    (cp >= 0x1dc0 && cp <= 0x1dff) || // combining diacritical marks supplement
    cp === 0xfeff // zero-width no-break space (BOM)
  );
}

// Codepoints that occupy two cells: CJK, fullwidth forms, Hangul, and the main
// emoji blocks (which modern terminals render double-wide).
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, Kangxi, punctuation
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana .. CJK compat
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat ideographs
    (cp >= 0xfe10 && cp <= 0xfe19) || // vertical forms
    (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK compat forms / small forms
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) || // fullwidth signs
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji + symbols & pictographs
    (cp >= 0x2600 && cp <= 0x27bf) || // misc symbols + dingbats (commonly emoji)
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK ext B+
  );
}

// Width of a single codepoint in cells (0, 1, or 2).
export function cellWidth(cp: number): number {
  if (isZeroWidth(cp)) return 0;
  // Chess piece symbols (U+2654–265F) sit in the Misc-Symbols block that's
  // otherwise wide, but terminals render them in a single cell (no emoji
  // presentation). Treat them as narrow so glyph+label rows stay aligned.
  if (cp >= 0x2654 && cp <= 0x265f) return 1;
  if (isWide(cp)) return 2;
  return 1;
}

// Display width of a string in cells. Iterates by codepoint (`for...of`), so
// astral characters (emoji) are measured once, not per surrogate.
export function stringWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += cellWidth(ch.codePointAt(0)!);
  return w;
}
