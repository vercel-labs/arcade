import {
  STYLE_BOLD,
  STYLE_DIM,
  STYLE_UNDERLINE,
  type Surface,
} from '../engine/index.ts';

export interface CanvasSurfaceHostOptions {
  fontFamily?: string;
  background?: string;
  devicePixelRatio?: number;
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
  private cellWidth = 9;
  private cellHeight = 18;

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
  }

  /** Resize the backing store and return the cell metrics used for input mapping. */
  resize(cssWidth: number, cssHeight: number, cols: number, rows: number): { cellWidth: number; cellHeight: number } {
    const width = Math.max(1, Math.floor(cssWidth * this.dpr));
    const height = Math.max(1, Math.floor(cssHeight * this.dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.cellWidth = width / Math.max(1, cols);
    this.cellHeight = height / Math.max(1, rows);
    return { cellWidth: this.cellWidth / this.dpr, cellHeight: this.cellHeight / this.dpr };
  }

  draw(surface: Surface): void {
    const ctx = this.context;
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const baseFontSize = this.cellHeight * 0.84;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    for (let y = 0; y < surface.rows; y++) {
      for (let x = 0; x < surface.cols; x++) {
        const cell = surface.getCell(x, y);
        if (!cell?.opaque) continue;
        const px = x * this.cellWidth;
        const py = y * this.cellHeight;
        ctx.fillStyle = rgb(cell.bg);
        ctx.fillRect(px, py, Math.ceil(this.cellWidth), Math.ceil(this.cellHeight));
        if (!cell.ch || cell.ch === ' ') continue;
        const weight = cell.style & STYLE_BOLD ? 700 : 500;
        ctx.globalAlpha = cell.style & STYLE_DIM ? 0.58 : 1;
        ctx.font = `${weight} ${baseFontSize}px ${this.fontFamily}`;
        ctx.fillStyle = rgb(cell.fg);
        ctx.fillText(cell.ch, px, py + this.cellHeight * 0.82, this.cellWidth * 2);
        if (cell.style & STYLE_UNDERLINE) {
          ctx.fillRect(px, py + this.cellHeight - Math.max(1, this.dpr), this.cellWidth, Math.max(1, this.dpr));
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  cellAt(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: Math.floor((clientX - rect.left) / (this.cellWidth / this.dpr)),
      y: Math.floor((clientY - rect.top) / (this.cellHeight / this.dpr)),
    };
  }
}

function rgb(color: readonly number[]): string {
  return `rgb(${Math.round(color[0])} ${Math.round(color[1])} ${Math.round(color[2])})`;
}
