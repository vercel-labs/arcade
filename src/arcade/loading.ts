import figlet from 'figlet';
import { hslToRgb } from '../engine/color.ts';
import type { PixelCanvas } from './pixel-canvas.ts';
import { cross, dot, normalize, rotateX, rotateY, sub, type Vec3 } from './math.ts';

// --- A triangular pyramid (tetrahedron): apex up, triangular base. ---
const VERTS: Vec3[] = [
  { x: 0, y: 0.85, z: 0 }, // 0 apex
  { x: -0.78, y: -0.4, z: 0.45 }, // 1 base
  { x: 0.78, y: -0.4, z: 0.45 }, // 2 base
  { x: 0, y: -0.4, z: -0.9 }, // 3 base
];
const EDGES: [number, number][] = [
  [0, 1], [0, 2], [0, 3], // apex to base
  [1, 2], [2, 3], [3, 1], // base triangle
];
const FACES: [number, number, number][] = [
  [0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 2, 3],
];

const ROT_SPEED = 0.4;
const TILT = -0.22;
const FOCAL = 1.7;
const Z_CAMERA = 4.0;

// Spectrum spans red (outer) to violet (inner), per real dispersion order.
const HUE_SPAN = 280;

interface P2 {
  x: number;
  y: number;
}

export class LoadingScreen {
  private banner: string[];
  private bannerW: number;

  constructor() {
    this.banner = buildBanner();
    this.bannerW = this.banner.reduce((m, l) => Math.max(m, l.length), 0);
  }

  get bannerHeight(): number {
    return this.banner.length;
  }

  renderScene(canvas: PixelCanvas, t: number): void {
    const topReserve = this.banner.length + 2;
    const ox = canvas.w / 2;
    const oy = ((topReserve + canvas.rows) / 2) * 2;
    const avail = Math.max(6, canvas.rows - topReserve);
    const scale = avail * 1.5;

    const project = (v: Vec3): P2 => {
      const z = v.z + Z_CAMERA;
      return { x: ox + (v.x / z) * FOCAL * scale, y: oy - (v.y / z) * FOCAL * scale };
    };

    const tv = VERTS.map((v) => rotateX(rotateY(v, t * ROT_SPEED), TILT));
    const pts = tv.map(project);
    const center: Vec3 = {
      x: (tv[0].x + tv[1].x + tv[2].x + tv[3].x) / 4,
      y: (tv[0].y + tv[1].y + tv[2].y + tv[3].y) / 4,
      z: (tv[0].z + tv[1].z + tv[2].z + tv[3].z) / 4,
    };
    const centroid = project(center);

    // Outward face normals of the live (rotated) pyramid.
    const normals = FACES.map(([a, b, c]) => {
      let n = normalize(cross(sub(tv[b], tv[a]), sub(tv[c], tv[a])));
      const faceCenter: Vec3 = {
        x: (tv[a].x + tv[b].x + tv[c].x) / 3,
        y: (tv[a].y + tv[b].y + tv[c].y) / 3,
        z: (tv[a].z + tv[b].z + tv[c].z) / 3,
      };
      if (dot(n, faceCenter) < 0) n = { x: -n.x, y: -n.y, z: -n.z };
      return n;
    });

    // A smoothly-varying "effective" surface normal in screen space, weighted
    // toward faces pointing left (entry) or right (exit). This makes the beam
    // and rainbow track the pyramid's rotation without snapping between faces.
    const effNormal = (sign: number): P2 => {
      let sx = 0;
      let sy = 0;
      let w = 0;
      for (const n of normals) {
        const facing = sign > 0 ? Math.max(0, n.x) : Math.max(0, -n.x);
        const ww = facing * facing;
        sx += ww * n.x;
        sy += ww * -n.y; // screen y is inverted
        w += ww;
      }
      if (w < 1e-4) return { x: sign > 0 ? 1 : -1, y: 0 };
      const l = Math.hypot(sx, sy) || 1;
      return { x: sx / l, y: sy / l };
    };

    const exitN = effNormal(1);
    const entryN = effNormal(-1);
    const surf = scale * 0.45;
    const exitPoint: P2 = { x: centroid.x + exitN.x * surf, y: centroid.y + exitN.y * surf };
    const entryPoint: P2 = { x: centroid.x + entryN.x * surf, y: centroid.y + entryN.y * surf };

    // The rainbow leaves bent toward the exit face's normal — the more oblique
    // the face, the wider the spectral fan.
    const k = 0.7;
    let bx = (1 - k) * 1 + k * exitN.x;
    let by = k * exitN.y;
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl;
    by /= bl;
    const centralAngle = Math.atan2(by, bx);
    const oblique = 1 - Math.max(0, exitN.x);
    const spread = 0.24 + 0.18 * oblique;
    const length = canvas.w;
    const hwEnd = Math.min(canvas.h * 0.48, length * Math.tan(spread));
    const hwStart = Math.max(2, scale * 0.06);

    drawRainbow(canvas, exitPoint, centralAngle, length, hwStart, hwEnd, 0.78);
    drawInternal(canvas, entryPoint, exitPoint);
    drawBeam(canvas, { x: 0, y: entryPoint.y }, entryPoint, 0.85);
    drawPyramid(canvas, pts);
  }

  // The wordmark + prompt own their rows exclusively (the pixel canvas skips
  // them), so each cell is written exactly once per frame — no flicker.
  overlay(cols: number, rows: number): string {
    const band = this.banner.length;
    const startCol = Math.max(0, Math.floor((cols - this.bannerW) / 2));
    let out = '\x1b[48;2;0;0;0m';

    for (let r = 0; r < band; r++) {
      const rowIdx = 1 + r;
      if (rowIdx >= rows) break;
      const line = this.banner[r] ?? '';
      out += `\x1b[${rowIdx};1H`;
      let lastFg = '';
      for (let c = 0; c < cols; c++) {
        const ch = c >= startCol && c - startCol < line.length ? line[c - startCol] : ' ';
        if (ch === ' ') {
          out += ' ';
          continue;
        }
        // Monochrome: solid faces fade white→grey top to bottom, edges darker.
        const grad = band > 1 ? r / (band - 1) : 0;
        const v = Math.round(235 - grad * 110);
        const fg = ch === '█' ? `\x1b[38;2;${v};${v};${v}m` : '\x1b[38;2;72;72;78m';
        if (fg !== lastFg) {
          out += fg;
          lastFg = fg;
        }
        out += ch;
      }
    }

    const prompt = 'PRESS ANY KEY TO START';
    const pc = Math.max(1, Math.floor((cols - prompt.length) / 2) + 1);
    out += `\x1b[${rows};${pc}H\x1b[38;2;105;105;115m${prompt}`;
    return out + '\x1b[0m';
  }
}

function drawPyramid(canvas: PixelCanvas, pts: P2[]): void {
  for (const [i, j] of EDGES) drawEdge(canvas, pts[i], pts[j]);
}

// A clean white glass edge with a faint red/blue dispersion fringe — kept
// subtle so the pyramid reads as monochrome glass.
function drawEdge(canvas: PixelCanvas, a: P2, b: P2): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const off = 0.7;
  const steps = Math.max(1, Math.ceil(len));
  for (let i = 0; i <= steps; i++) {
    const tt = i / steps;
    const x = a.x + dx * tt;
    const y = a.y + dy * tt;
    canvas.addGlow(x, y, 150, 156, 168, 0.85);
    canvas.add(x + nx * off, y + ny * off, 55, 8, 8);
    canvas.add(x - nx * off, y - ny * off, 8, 20, 60);
  }
}

function drawBeam(canvas: PixelCanvas, a: P2, b: P2, intensity: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const steps = Math.max(1, Math.ceil(len));
  const v = 235 * intensity;
  for (let i = 0; i <= steps; i++) {
    const tt = i / steps;
    canvas.addGlow(a.x + dx * tt, a.y + dy * tt, v, v, v, 1.0);
  }
}

// A faint trace of the beam continuing through the glass.
function drawInternal(canvas: PixelCanvas, a: P2, b: P2): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  for (let i = 0; i <= steps; i++) {
    const tt = i / steps;
    canvas.add(a.x + dx * tt, a.y + dy * tt, 38, 40, 46);
  }
}

// Inverse-mapped rainbow wedge: for each pixel, find its position along (s) and
// across (u) the fan, color by across-position, fade at the transverse edges.
function drawRainbow(
  canvas: PixelCanvas,
  origin: P2,
  angle: number,
  length: number,
  halfWidthStart: number,
  halfWidthEnd: number,
  intensity: number,
): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  for (let y = 0; y < canvas.h; y++) {
    for (let x = 0; x < canvas.w; x++) {
      const rx = x - origin.x;
      const ry = y - origin.y;
      const s = rx * dx + ry * dy;
      if (s < 0 || s > length) continue;
      const u = rx * px + ry * py;
      const hw = halfWidthStart + (halfWidthEnd - halfWidthStart) * (s / length);
      const e = u / hw;
      if (Math.abs(e) > 1) continue;
      const across = (e + 1) / 2;
      const [r, g, b] = hslToRgb(across * HUE_SPAN, 1, 0.5);
      const cov = Math.abs(e) < 0.8 ? 1 : Math.max(0, (1 - Math.abs(e)) / 0.2);
      const along = 1 - 0.12 * (s / length);
      const bright = intensity * cov * along;
      canvas.add(x, y, r * bright, g * bright, b * bright);
    }
  }
}

function buildBanner(): string[] {
  try {
    const top = trimBlank(figlet.textSync('VERCEL', { font: 'ANSI Shadow' }).split('\n'));
    const bottom = trimBlank(figlet.textSync('ARCADE', { font: 'ANSI Shadow' }).split('\n'));
    return [...top, ...bottom];
  } catch {
    return ['VERCEL', 'ARCADE'];
  }
}

function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end);
}
