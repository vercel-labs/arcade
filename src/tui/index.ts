// Public API of the TUI overlay library. App code (arcade/) imports from here;
// modules inside tui import each other directly. tui consumes engine (Surface,
// width, color) and platform (input types); nothing imports app code.
export { Box, Text, Button } from './nodes.ts';
export { Modal } from './components/modal.ts';
export { Screen } from './screen.ts';
export { Keymap, eventToChord, type Command, type Binding } from './keymap.ts';
export { Renderer, type FrameFn, type RendererOpts } from './renderer.ts';
export { layout } from './layout.ts';
export { paint, type PaintState } from './paint.ts';
export { defaultTheme, resolveColor, type Theme, type ColorToken } from './theme.ts';
export type { Node, Style, Dimension, LayoutBox, BorderStyle } from './types.ts';
