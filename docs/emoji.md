# Emoji in the terminal UI

**Rule: only use emoji whose Unicode `Emoji_Presentation` is `Yes`.** Check before adopting one:

```bash
pnpm exec tsx src/tools/glyph-width.ts
```

Every `|` must line up in a single column. A stray one is a glyph that will corrupt the screen.

## Why it matters here more than elsewhere

Emoji come in two classes:

| | `Emoji_Presentation=Yes` | `Emoji_Presentation=No` |
|---|---|---|
| Default look | colour emoji | monochrome text glyph |
| `East_Asian_Width` | Wide | Neutral |
| Terminal advances | **2 cells** | **1 cell** |
| Examples | 🪵 🧱 🐑 🎲 🤖 🏰 🔨 💂 | 🛡 🛠 🏘 ⚔ ⚒ ⚙ 🗺 |

A text-default emoji only *looks* like an emoji when followed by U+FE0F (variation selector-16):
`🛡️` is `U+1F6E1 U+FE0F`. The catch is that **the selector changes how it is drawn but not how it
is measured** — terminal width tables key off the base codepoint and predate VS16. So the terminal
paints a two-cell colour shield and then moves its cursor one column.

That inconsistency is a well-known, still-unresolved mess across terminal emulators (it is the
reason the "mode 2027" grapheme-clustering escape was proposed). Newer emulators increasingly do
honour VS16; older ones do not. It is not something this repo can fix.

**It hurts this renderer more than most.** A program that repaints everything each frame papers
over a width disagreement — the next repaint corrects it. Ours emits only cells that changed since
its own last model ([src/engine/surface.ts](../src/engine/surface.ts) `diff`). Once the model and
the terminal disagree about a column, the renderer cannot notice: it is comparing its model against
its model and concluding the screen is already right. The damage freezes until `ESC[2J` on resize.

Symptom to recognise: **stale blocks at the right edge of exactly the rows containing a particular
glyph**, surviving board rotation, clearing only on resize. Text after the glyph may also shift or
duplicate.

## What the engine does about it

[src/engine/width.ts](../src/engine/width.ts) `cellWidth` returns **1** for any codepoint that is
`Extended_Pictographic` but not `Emoji_Presentation`, using the JS engine's own Unicode tables
(`/\p{Extended_Pictographic}/u` and `/\p{Emoji_Presentation}/u`, memoised). This is deliberately a
property query rather than a hand-maintained list — model chat can contain any emoji at all, so an
allowlist of the ones we happened to notice would keep springing leaks.

That keeps the *measurement* honest, but a text-default emoji written with its selector may still
be *drawn* two cells wide over its neighbour. Measurement and drawing can only both be right if the
glyph is emoji-by-default — hence the rule at the top.

Two related pieces, same file/area:

- `drawText` keeps zero-width codepoints (U+FE0F, combining marks) in the **same cell** as the
  glyph they modify. Dropping them silently changes what the terminal draws.
- A double-width glyph occupies a cell plus a `CONTINUATION` marker. The pair is indivisible;
  `setCell` blanks one half if the other is overwritten, and `diff` ends its cursor run at a
  continuation rather than assuming the tail advanced the cursor.

## Picking a glyph

Rough heuristic: the text-default ones are largely the batch Unicode 7.0 absorbed from legacy
Wingdings/Webdings — tools, shields, maps, buildings, office objects, mostly in `U+1F3Dx`,
`U+1F5xx`, `U+1F6Ex`, plus most of the old misc-symbols block `U+2600–27BF`. Characters *designed*
as emoji (Unicode 6.0, and 8.0 onward) are emoji-by-default and safe.

Do not trust the heuristic — run the tool. It tests the terminal you are actually in, and emulators
disagree.

Some meanings have no safe glyph. There is no `Emoji_Presentation=Yes` hammer-and-wrench, so the
Catan dev card uses 🔨 rather than 🛠️. Prefer a safe glyph with a slightly different meaning, or a
short text label, over a correct-looking one that corrupts the screen.

### Also treat as suspect

Same measure-vs-draw split, usually worse:

- **ZWJ sequences** — 👨‍👩‍👧, 🏳️‍🌈. Several codepoints joined with U+200D; emulators vary on whether
  that is 2 cells or 6.
- **Skin-tone modifiers** — 👍🏽 (base + `U+1F3FB–1F3FF`).
- **Flags** — regional indicator pairs, 🇺🇸.
- **Keycaps** — 1️⃣ (digit + U+FE0F + U+20E3).

None are used in the UI today. Run them through the tool first if you want one.

## Current state of the codebase

Audited with `\p{Emoji_Presentation}`; the five Catan resource glyphs (🪵 🧱 🐑 🌾 🪨) and every
other emoji rendered through the TUI are emoji-by-default. The text-default characters that remain
in `src/` are card suits and chess pieces (already special-cased narrow in `width.ts`), strings in
CLI tools that print straight to stdout rather than through a `Surface`, and the width tables and
tests themselves.
