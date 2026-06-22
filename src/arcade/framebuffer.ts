// A character grid with a per-cell depth buffer. The renderer plots into it,
// then `toFrameString` serializes the whole grid into a single escape-coded
// string for one `stdout.write` per frame (the key to flicker-free output).
//
// Color codes are coalesced: an SGR truecolor sequence is only emitted when the
// color actually changes between adjacent cells, since per-character color is
// dramatically slower for the terminal to parse than runs of one color.
export class Framebuffer {
  cols: number;
  rows: number;
  private chars: string[] = [];
  private depth: Float32Array = new Float32Array(0);
  private r: Uint8Array = new Uint8Array(0);
  private g: Uint8Array = new Uint8Array(0);
  private b: Uint8Array = new Uint8Array(0);

  constructor(cols: number, rows: number) {
    this.cols = 0;
    this.rows = 0;
    this.resize(cols, rows);
  }

  resize(cols: number, rows: number): void {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    const size = this.cols * this.rows;
    this.chars = new Array(size).fill(' ');
    this.depth = new Float32Array(size);
    this.r = new Uint8Array(size);
    this.g = new Uint8Array(size);
    this.b = new Uint8Array(size);
  }

  clear(): void {
    this.chars.fill(' ');
    this.depth.fill(Infinity);
    this.r.fill(0);
    this.g.fill(0);
    this.b.fill(0);
  }

  /** Depth-tested plot. Smaller `z` is nearer the camera and wins. */
  plot(x: number, y: number, z: number, char: string, r: number, g: number, b: number): void {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    const i = y * this.cols + x;
    if (z >= this.depth[i]) return;
    this.depth[i] = z;
    this.chars[i] = char;
    this.r[i] = r;
    this.g[i] = g;
    this.b[i] = b;
  }

  toFrameString(): string {
    let out = '';
    let lastColor = '';
    for (let y = 0; y < this.rows; y++) {
      out += `\x1b[${y + 1};1H`;
      for (let x = 0; x < this.cols; x++) {
        const i = y * this.cols + x;
        const ch = this.chars[i];
        if (ch === ' ') {
          // Blank cells carry no glyph, so their color is irrelevant — skip the
          // escape sequence entirely and let the previous run's color stand.
          out += ' ';
          continue;
        }
        const color = `\x1b[38;2;${this.r[i]};${this.g[i]};${this.b[i]}m`;
        if (color !== lastColor) {
          out += color;
          lastColor = color;
        }
        out += ch;
      }
    }
    return out + '\x1b[0m';
  }
}
