import { Surface } from '../engine/surface.ts';
import {
  STYLE_BOLD,
  STYLE_DIM,
  STYLE_UNDERLINE,
} from '../engine/surface.ts';

// Arcade's renderer projects terminal scenes at cols / (rows * 2): one cell is
// exactly half as wide as it is tall. Browser hosts use the same geometry so a
// camera composition does not change shape when it leaves the TUI.
export const TERMINAL_CELL_ASPECT_RATIO = 0.5;

export interface CanvasSurfaceHostOptions {
  fontFamily?: string;
  background?: string;
  devicePixelRatio?: number;
  /** Width divided by height for one terminal cell. Omit to stretch to fill. */
  cellAspectRatio?: number;
  /** Glyph height relative to a cell. Terminals commonly overfill slightly. */
  fontScale?: number;
  /** Let layout own the CSS box while this host updates only backing pixels. */
  manageCssSize?: boolean;
}

export interface Canvas2DContextLike {
  fillStyle: string;
  font: string;
  globalAlpha: number;
  textAlign: string;
  textBaseline: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
}

export interface CanvasLike {
  width: number;
  height: number;
  style: { width: string; height: string };
  getContext(contextId: '2d', options?: { alpha?: boolean }): Canvas2DContextLike | null;
  getBoundingClientRect(): { left: number; top: number };
}

/**
 * Browser presentation adapter for Arcade's canonical cell grid.
 *
 * The terminal host serializes a Surface into ANSI. This host draws the same
 * cells onto a canvas and deliberately knows nothing about games, scenes, or
 * React. Keeping it framework-free makes it usable by the site, examples, and
 * third-party browser shells.
 */
export class CanvasSurfaceHost {
  private readonly context: Canvas2DContextLike;
  private readonly fontFamily: string;
  private readonly background: string;
  private readonly dpr: number;
  private readonly cellAspectRatio?: number;
  private readonly fontScale: number;
  private readonly manageCssSize: boolean;
  private cellWidth = 9;
  private cellHeight = 18;
  private originX = 0;
  private originY = 0;
  private previous: Surface | null = null;
  private lastCssWidth = -1;
  private lastCssHeight = -1;
  private lastCols = -1;
  private lastRows = -1;
  private normalFont = '';
  private boldFont = '';
  private readonly colorCache = new Map<number, string>();

  constructor(
    private readonly canvas: CanvasLike,
    options: CanvasSurfaceHostOptions = {},
  ) {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Arcade browser host requires a 2D canvas context');
    this.context = context;
    this.fontFamily = options.fontFamily ?? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    this.background = options.background ?? '#000000';
    this.dpr = options.devicePixelRatio ?? 1;
    this.cellAspectRatio = options.cellAspectRatio;
    this.fontScale = options.fontScale ?? 0.92;
    this.manageCssSize = options.manageCssSize ?? true;
  }

  /** Resize the backing store and return the cell metrics used for input mapping. */
  resize(cssWidth: number, cssHeight: number, cols: number, rows: number): { cellWidth: number; cellHeight: number } {
    if (cssWidth === this.lastCssWidth && cssHeight === this.lastCssHeight && cols === this.lastCols && rows === this.lastRows) {
      return { cellWidth: this.cellWidth / this.dpr, cellHeight: this.cellHeight / this.dpr };
    }
    const width = Math.max(1, Math.floor(cssWidth * this.dpr));
    const height = Math.max(1, Math.floor(cssHeight * this.dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    if (this.manageCssSize && cssWidth !== this.lastCssWidth) this.canvas.style.width = `${cssWidth}px`;
    if (this.manageCssSize && cssHeight !== this.lastCssHeight) this.canvas.style.height = `${cssHeight}px`;
    if (this.cellAspectRatio) {
      this.cellHeight = Math.min(
        height / Math.max(1, rows),
        width / Math.max(1, cols * this.cellAspectRatio),
      );
      this.cellWidth = this.cellHeight * this.cellAspectRatio;
      this.originX = (width - this.cellWidth * cols) / 2;
      this.originY = (height - this.cellHeight * rows) / 2;
    } else {
      this.cellWidth = width / Math.max(1, cols);
      this.cellHeight = height / Math.max(1, rows);
      this.originX = 0;
      this.originY = 0;
    }
    const baseFontSize = this.cellHeight * this.fontScale;
    this.normalFont = `500 ${baseFontSize}px ${this.fontFamily}`;
    this.boldFont = `700 ${baseFontSize}px ${this.fontFamily}`;
    this.lastCssWidth = cssWidth; this.lastCssHeight = cssHeight; this.lastCols = cols; this.lastRows = rows;
    this.previous = null;
    return { cellWidth: this.cellWidth / this.dpr, cellHeight: this.cellHeight / this.dpr };
  }

  draw(surface: Surface, options: { forceFull?: boolean } = {}): void {
    const ctx = this.context;
    const total = surface.cols * surface.rows;
    const changed: number[] = [];
    if (this.previous && this.previous.cols === surface.cols && this.previous.rows === surface.rows) {
      for (let y = 0; y < surface.rows; y++) for (let x = 0; x < surface.cols; x++) {
        if (!surface.cellEqualsAt(this.previous, x, y)) changed.push(y * surface.cols + x);
      }
    }
    // Canvas glyphs intentionally overfill their terminal cell slightly. Repaint
    // the 8 neighboring cells too, otherwise anti-aliased glyph edges survive in
    // semantically unchanged cells and accumulate as trails during animation.
    const dirty = changed.length ? expandedDirtyCells(changed, surface.cols, surface.rows) : changed;
    const partial = !options.forceFull && !!this.previous && dirty.length <= total * 0.38;
    if (!partial) {
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    } else if (dirty.length === 0) {
      return;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    let lastFont = '';
    let lastFill = this.background;
    if (partial) ctx.fillStyle = this.background;
    const paint = (x: number, y: number) => {
        const cell = surface.getCell(x, y);
        if (!cell?.opaque) return;
        const px = this.originX + x * this.cellWidth;
        const py = this.originY + y * this.cellHeight;
        // The backing clear already painted black. ASCII scenes overwhelmingly
        // use black cell backgrounds, so avoid thousands of redundant fills.
        if (cell.bg[0] || cell.bg[1] || cell.bg[2]) {
          const background = this.rgb(cell.bg);
          if (background !== lastFill) { ctx.fillStyle = background; lastFill = background; }
          ctx.fillRect(px, py, Math.ceil(this.cellWidth), Math.ceil(this.cellHeight));
        }
        if (!cell.ch || cell.ch === ' ') return;
        ctx.globalAlpha = cell.style & STYLE_DIM ? 0.58 : 1;
        const font = cell.style & STYLE_BOLD ? this.boldFont : this.normalFont;
        if (font !== lastFont) { ctx.font = font; lastFont = font; }
        const foreground = this.rgb(cell.fg);
        if (foreground !== lastFill) { ctx.fillStyle = foreground; lastFill = foreground; }
        ctx.fillText(cell.ch, px + this.cellWidth / 2, py + this.cellHeight * 0.84, this.cellWidth * 1.12);
        if (cell.style & STYLE_UNDERLINE) {
          ctx.fillRect(px, py + this.cellHeight - Math.max(1, this.dpr), this.cellWidth, Math.max(1, this.dpr));
        }
        ctx.globalAlpha = 1;
    };
    if (partial) {
      // Clear the complete dirty region before redrawing any glyph. Interleaving
      // clear/draw lets a later neighboring clear slice through the overhang of
      // an earlier W/M, producing regular vertical seams during transitions.
      for (const index of dirty) {
        const x = index % surface.cols, y = Math.floor(index / surface.cols);
        ctx.fillRect(this.originX + x * this.cellWidth, this.originY + y * this.cellHeight, Math.ceil(this.cellWidth), Math.ceil(this.cellHeight));
      }
      for (const index of dirty) paint(index % surface.cols, Math.floor(index / surface.cols));
    } else {
      for (let y = 0; y < surface.rows; y++) for (let x = 0; x < surface.cols; x++) paint(x, y);
    }
    this.previous ??= new Surface(surface.cols, surface.rows);
    surface.copyInto(this.previous);
  }

  private rgb(color: readonly number[]): string {
    const key = (Math.round(color[0]) << 16) | (Math.round(color[1]) << 8) | Math.round(color[2]);
    let value = this.colorCache.get(key);
    if (!value) { value = `rgb(${Math.round(color[0])} ${Math.round(color[1])} ${Math.round(color[2])})`; this.colorCache.set(key, value); }
    return value;
  }

  cellAt(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: Math.floor((clientX - rect.left - this.originX / this.dpr) / (this.cellWidth / this.dpr)),
      y: Math.floor((clientY - rect.top - this.originY / this.dpr) / (this.cellHeight / this.dpr)),
    };
  }
}

function expandedDirtyCells(changed: readonly number[], cols: number, rows: number): number[] {
  const dirty = new Set<number>();
  for (const index of changed) {
    const x = index % cols, y = Math.floor(index / cols);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) dirty.add(ny * cols + nx);
    }
  }
  return [...dirty];
}
