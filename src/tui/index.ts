// Public API of the TUI overlay library. App code (arcade/) imports from here;
// modules inside tui import each other directly. tui consumes engine (Surface,
// width, color) and platform (input types); nothing imports app code.
export { Box, Text, Button, Slot } from './nodes.ts';
export {
  RoundedButton,
  FilledButton,
  roundedButtonStyle,
  filledButtonStyle,
  type RoundedButtonStyleOpts,
  type FilledButtonStyleOpts,
} from './button.ts';
export { Modal } from './components/modal.ts';
export { Dialog, CloseButton, type DialogOpts } from './components/dialog.ts';
export { ASCIIFont, asciiFontLines } from './components/asciifont.ts';
export { FrameBuffer, type FrameDraw } from './components/framebuffer.ts';
export {
  ProjectedAnchor,
  type AnchorAlignment,
  type ProjectedAnchorOptions,
} from './components/projected-anchor.ts';
export { Field, type FieldOpts } from './components/field.ts';
export { Dropdown, type DropdownOpts } from './components/dropdown.ts';
export { Input, type InputOpts } from './components/input.ts';
export { Select, type SelectOpts } from './components/select.ts';
export { type Row, ScrollBox, type ScrollBoxOpts } from './components/scrollbox.ts';
export { Slider, type SliderOpts } from './components/slider.ts';
export { type Component, Registry } from './component.ts';
export { Screen } from './screen.ts';
export { Keymap, eventToChord, type Command, type Binding } from './keymap.ts';
export { Renderer, type FrameFn, type RendererOpts } from './renderer.ts';
export {
  insetSceneViewport,
  pointerNdcInSceneViewport,
  type ScenePointer,
  type SceneViewportInsets,
} from './scene-viewport.ts';
export { layout } from './layout.ts';
export { paint, type PaintState } from './paint.ts';
export { defaultTheme, resolveColor, type Theme, type ColorToken } from './theme.ts';
export type { Node, Style, Dimension, LayoutBox, BorderStyle, PointerHit } from './types.ts';
