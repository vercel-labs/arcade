// A float-RGB pixel buffer rendered with the upper half-block ▀: each terminal
// cell holds two stacked pixels (foreground = top, background = bottom), giving
// square-ish pixels and double the vertical resolution. Colors are accumulated
// additively (light adds toward white) and quantized once, on emit.
export class PixelCanvas {
  cols: number;
  rows: number;
  w: number;
  h: number;
  private r: Float32Array = new Float32Array(0);
  private g: Float32Array = new Float32Array(0);
  private b: Float32Array = new Float32Array(0);

  constructor(cols: number, rows: number) {
    this.cols = 0;
    this.rows = 0;
    this.w = 0;
    this.h = 0;
    this.resize(cols, rows);
  }

  resize(cols: number, rows: number): void {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    this.w = this.cols;
    this.h = this.rows * 2;
    const size = this.w * this.h;
    this.r = new Float32Array(size);
    this.g = new Float32Array(size);
    this.b = new Float32Array(size);
  }

  clear(): void {
    this.r.fill(0);
    this.g.fill(0);
    this.b.fill(0);
  }

  add(px: number, py: number, r: number, g: number, b: number): void {
    const x = px | 0;
    const y = py | 0;
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    const i = y * this.w + x;
    this.r[i] += r;
    this.g[i] += g;
    this.b[i] += b;
  }

  // A soft round dab: a bright center with a falloff skirt, used for beams and
  // edges so lines read as glowing light rather than hard pixels.
  addGlow(px: number, py: number, r: number, g: number, b: number, radius: number): void {
    const cx = Math.round(px);
    const cy = Math.round(py);
    const rad = Math.max(1, Math.ceil(radius));
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const falloff = Math.exp(-(d * d) / (2 * (radius / 2) ** 2));
        this.add(cx + dx, cy + dy, r * falloff, g * falloff, b * falloff);
      }
    }
  }

  // `skipTopRows` leaves the top rows untouched so another layer (the wordmark)
  // can own them exclusively — writing a cell twice per frame causes flicker.
  toFrameString(skipTopRows = 0): string {
    let out = '';
    let last = '';
    for (let cy = Math.max(0, skipTopRows); cy < this.rows; cy++) {
      out += `\x1b[${cy + 1};1H`;
      const topRow = 2 * cy * this.w;
      const botRow = (2 * cy + 1) * this.w;
      for (let cx = 0; cx < this.cols; cx++) {
        const ti = topRow + cx;
        const bi = botRow + cx;
        const seq =
          `\x1b[38;2;${byte(this.r[ti])};${byte(this.g[ti])};${byte(this.b[ti])};` +
          `48;2;${byte(this.r[bi])};${byte(this.g[bi])};${byte(this.b[bi])}m`;
        if (seq !== last) {
          out += seq;
          last = seq;
        }
        out += '▀';
      }
    }
    return out + '\x1b[0m';
  }
}

function byte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}
