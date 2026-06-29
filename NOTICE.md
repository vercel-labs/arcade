# Credits

The terminal rendering approach in `src/engine` was informed by
[`sinclairzx81/zero`](https://github.com/sinclairzx81/zero) (MIT License) —
specifically the half-block truecolor blitter and the JS-object-as-shader
material pattern. The implementations here are original; no source was copied
verbatim.

The shape-matched glyph mode (`src/engine/glyph.ts`, `toShapeGlyph`) follows the
technique described in Alex Harri's article
["ASCII rendering"](https://alexharri.com/blog/ascii-rendering) — per-character
coverage shape vectors matched by nearest neighbor.

`src/engine/font8x8.ts` is generated (via `src/tools/gen-font.ts`) from the
**font8x8** bitmap font by Daniel Hepper / Marcel Sondaar / IBM (Public Domain).

The menu game-tile art in `public/assets/games/` is baked (via
`src/tools/fetch-games.ts`) from **Noto Emoji** by Google
([googlefonts/noto-emoji](https://github.com/googlefonts/noto-emoji),
Apache-2.0 / OFL).

The chess static evaluation (`src/games/chess/eval.ts`) uses the **PeSTO**
piece-square tables by Ronald Friederich (RofChade), via the
[Chess Programming Wiki](https://www.chessprogramming.org/PeSTO's_Evaluation_Function)
(content CC BY-SA 3.0). The table values are reproduced; the evaluator code is original.
