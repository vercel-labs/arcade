// A cell grid the UI layer paints into, then serializes to one escape string.
// This is the sibling of present.ts: present.ts turns pixels into cells+SGR for
// the 3D scene; Surface turns explicit UI cells into cells+SGR for the overlay.
//
// Each cell is a glyph + truecolor fg/bg + a style bitfield, plus an `opaque`
// flag. `clear()` makes every cell transparent; only opaque cells emit anything,
// so wherever the UI doesn't paint, the scene drawn underneath shows through.
//
// Overlay-first (v1): serialize() emits absolute-positioned escape strings that
// overwrite scene cells — it never reads the scene. A later phase folds the
// scene into a Surface and diffs two grids for minimal output.

import type { RGB } from './color.ts';

import { stringWidth } from './width.ts';

// `style` bitfield. SGR: bold=1, dim=2, underline=4, reverse=7.
export const STYLE_BOLD = 1;
export const STYLE_DIM = 2;
export const STYLE_UNDERLINE = 4;
export const STYLE_REVERSE = 8;

// A wide glyph (CJK/emoji) paints in its cell and writes this sentinel into the
// next cell as a "continuation": serialize emits nothing for it, because the
// terminal cursor already advanced two columns past the wide glyph.
const CONTINUATION = '\0';

export interface Cell {
  ch: string;
  fg: RGB;
  bg: RGB;
  style: number;
  opaque: boolean;
}

export class Surface {
  cols: number;
  rows: number;
  private ch: string[];
  private fg: Uint8Array; // cols*rows*3
  private bg: Uint8Array; // cols*rows*3
  private style: Uint8Array;
  private opaque: Uint8Array;
  // 1 if the row has any opaque cell this frame; lets the runtime clear ghosts.
  private touched: Uint8Array;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.ch = new Array(n).fill(' ');
    this.fg = new Uint8Array(n * 3);
    this.bg = new Uint8Array(n * 3);
    this.style = new Uint8Array(n);
    this.opaque = new Uint8Array(n);
    this.touched = new Uint8Array(rows);
  }

  resize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.ch = new Array(n).fill(' ');
    this.fg = new Uint8Array(n * 3);
    this.bg = new Uint8Array(n * 3);
    this.style = new Uint8Array(n);
    this.opaque = new Uint8Array(n);
    this.touched = new Uint8Array(rows);
  }

  // Reset to fully transparent so the scene shows everywhere until repainted.
  clear(): void {
    this.opaque.fill(0);
    this.touched.fill(0);
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.cols && y >= 0 && y < this.rows;
  }

  // Paint one opaque cell. `ch` of '' clears the glyph to a space.
  setCell(x: number, y: number, ch: string, fg: RGB, bg: RGB, style = 0): void {
    if (!this.inBounds(x, y)) return;
    const i = y * this.cols + x;
    this.ch[i] = ch === '' ? ' ' : ch;
    this.fg[i * 3] = fg[0];
    this.fg[i * 3 + 1] = fg[1];
    this.fg[i * 3 + 2] = fg[2];
    this.bg[i * 3] = bg[0];
    this.bg[i * 3 + 1] = bg[1];
    this.bg[i * 3 + 2] = bg[2];
    this.style[i] = style;
    this.opaque[i] = 1;
    this.touched[y] = 1;
  }

  // Fill a rectangle with a background color (spaces). Clips to bounds.
  fillRect(x: number, y: number, w: number, h: number, bg: RGB, style = 0): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) this.setCell(xx, yy, ' ', bg, bg, style);
    }
  }

  // Draw text starting at (x, y), advancing by each glyph's display width. A
  // wide glyph occupies two cells (the second is a continuation sentinel).
  drawText(x: number, y: number, str: string, fg: RGB, bg: RGB, style = 0): void {
    let cx = x;
    for (const g of str) {
      const w = stringWidth(g);
      if (w === 0) continue; // combining mark / zero-width: no advance
      this.setCell(cx, y, g, fg, bg, style);
      if (w === 2 && this.inBounds(cx + 1, y)) {
        this.setCell(cx + 1, y, CONTINUATION, fg, bg, style);
      }
      cx += w;
    }
  }

  // Read a cell (for tooling that rasterizes the grid, e.g. the UI snapshot).
  getCell(x: number, y: number): Cell | null {
    if (!this.inBounds(x, y)) return null;
    const i = y * this.cols + x;
    return {
      ch: this.ch[i] === CONTINUATION ? '' : this.ch[i],
      fg: [this.fg[i * 3], this.fg[i * 3 + 1], this.fg[i * 3 + 2]],
      bg: [this.bg[i * 3], this.bg[i * 3 + 1], this.bg[i * 3 + 2]],
      style: this.style[i],
      opaque: this.opaque[i] === 1,
    };
  }

  // Rows with at least one opaque cell this frame (for ghost-clearing).
  rowsTouched(): number[] {
    const out: number[] = [];
    for (let r = 0; r < this.rows; r++) if (this.touched[r]) out.push(r);
    return out;
  }

  // Serialize opaque cells to cursor moves + SGR + glyphs. Transparent cells are
  // skipped (scene shows through). SGR is coalesced: re-emitted only when the
  // fg/bg/style of the next cell differs from the last emitted one.
  serialize(): string {
    let out = '';
    let lastSeq = '';
    for (let y = 0; y < this.rows; y++) {
      if (!this.touched[y]) continue;
      let runActive = false;
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x;
        if (!this.opaque[i]) {
          runActive = false; // a transparent cell breaks the cursor run
          continue;
        }
        if (!runActive) {
          out += `\x1b[${y + 1};${x + 1}H`;
          runActive = true;
          lastSeq = ''; // force an SGR at the start of each positioned run
        }
        if (this.ch[i] === CONTINUATION) continue; // wide-glyph tail: emit nothing
        const seq = this.sgr(i);
        if (seq !== lastSeq) {
          out += seq;
          lastSeq = seq;
        }
        out += this.ch[i];
      }
    }
    if (out) out += '\x1b[0m';
    return out;
  }

  // Build the SGR for cell i: reset, then style bits, then truecolor fg/bg.
  private sgr(i: number): string {
    let s = '\x1b[0';
    const st = this.style[i];
    if (st & STYLE_BOLD) s += ';1';
    if (st & STYLE_DIM) s += ';2';
    if (st & STYLE_UNDERLINE) s += ';4';
    if (st & STYLE_REVERSE) s += ';7';
    s += `;38;2;${this.fg[i * 3]};${this.fg[i * 3 + 1]};${this.fg[i * 3 + 2]}`;
    s += `;48;2;${this.bg[i * 3]};${this.bg[i * 3 + 1]};${this.bg[i * 3 + 2]}m`;
    return s;
  }
}
