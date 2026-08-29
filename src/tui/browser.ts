// Browser-safe public API of the retained TUI library. The terminal render loop
// is intentionally excluded because it flushes ANSI through process.stdout;
// Node/terminal consumers can import Renderer from @vercel/arcade/tui.
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
export {
  resolveColumns,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  type CellOpts,
  type ColumnDef,
  type RowOpts,
  type TableOpts,
} from './components/table.ts';
export {
  Sidebar,
  SIDEBAR_HEADER_H,
  SIDEBAR_PAD_L,
  SIDEBAR_PAD_R,
  SIDEBAR_PAD_V,
  type SidebarOpts,
} from './components/sidebar.ts';
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
export { Tooltip, type TooltipOpts } from './components/tooltip.ts';
export { type Component, Registry } from './component.ts';
export { Screen } from './screen.ts';
export { Keymap, eventToChord, type Command, type Binding } from './keymap.ts';
export {
  insetSceneViewport,
  pointerNdcInSceneViewport,
  type ScenePointer,
  type SceneViewportInsets,
} from './scene-viewport.ts';
export { clipText, truncate, wrapText, type WrapOpts } from './text.ts';
export { layout } from './layout.ts';
export { paint, paintWithForeground, type ForegroundPainter, type PaintState } from './paint.ts';
export { createTheme, defaultTheme, resolveColor, type Theme, type ColorToken } from './theme.ts';
export type {
  Node,
  Style,
  Dimension,
  LayoutBox,
  BorderStyle,
  PointerHit,
  TextOverflow,
  TooltipContent,
  TooltipPlacement,
  TooltipSpec,
  TooltipText,
} from './types.ts';
