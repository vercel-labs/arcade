// The desert tile: dunes and sun-bleached bones, plus the robber that can stand on it.

import { type Vec3 } from '../../../../../engine/index.ts';
import { mulberry32 } from '../../../../scenes/wisp.ts';
import { EDGE_Y, hexCorners, R_RIM, rimAndWall } from '../base.ts';
import { build, type Build, DOWN, faceQuad, faceTri, faceTriWithNormal, hash2, norm, type RGB, shade, smooth, sub, UP, v } from '../build.ts';
import { blob, scatter } from '../props.ts';
import { sampleWind, type WindOrigin } from './wind.ts';

// ── Desert props: bones (inherent) + the robber (toggle-only) ──────────────────

const BONE: RGB = [232, 230, 216];

// A tapered curved blade that rises from the sand and arcs toward one side (`curve` bends it
// within its broad plane; `tilt` leans the base). The shared primitive for the skeleton's ribs
// and the skull's horns. Cross-section is a thin rectangle (wBroad × wThick) shrinking to a tip.
function curvedBone(m: Build, bx: number, by: number, bz: number, yaw: number, length: number, curve: number, wBroad: number, wThick: number, color: RGB, tilt: number): void {
  const N = 4;
  const Fx = Math.cos(yaw);
  const Fz = Math.sin(yaw);
  const Tx = -Math.sin(yaw);
  const Tz = Math.cos(yaw);
  const rings: Vec3[][] = [];
  const axis: Vec3[] = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const s = 1 - t * 0.82; // taper toward the tip
    const px = bx + Fx * (curve * t * t + tilt * t);
    const pz = bz + Fz * (curve * t * t + tilt * t);
    const py = by + length * t;
    axis.push(v(px, py, pz));
    const hb = wBroad * 0.5 * s;
    const ht = wThick * 0.5 * s;
    rings.push([
      v(px + Fx * hb + Tx * ht, py, pz + Fz * hb + Tz * ht),
      v(px - Fx * hb + Tx * ht, py, pz - Fz * hb + Tz * ht),
      v(px - Fx * hb - Tx * ht, py, pz - Fz * hb - Tz * ht),
      v(px + Fx * hb - Tx * ht, py, pz + Fz * hb - Tz * ht),
    ]);
  }
  for (let k = 0; k < N; k++) {
    const a = rings[k];
    const b = rings[k + 1];
    const ctr = v((axis[k].x + axis[k + 1].x) / 2, (axis[k].y + axis[k + 1].y) / 2, (axis[k].z + axis[k + 1].z) / 2);
    for (let e = 0; e < 4; e++) {
      const f = (e + 1) % 4;
      const mid = v((a[e].x + a[f].x + b[f].x + b[e].x) / 4, (a[e].y + a[f].y + b[f].y + b[e].y) / 4, (a[e].z + a[f].z + b[f].z + b[e].z) / 4);
      faceQuad(m, a[e], a[f], b[f], b[e], color, norm(sub(mid, ctr)));
    }
  }
  faceQuad(m, rings[0][0], rings[0][1], rings[0][2], rings[0][3], color, DOWN);
  const tp = rings[N];
  faceQuad(m, tp[0], tp[3], tp[2], tp[1], color, UP);
}

// A row of 3-4 curved ribs standing in a slight fan — the exposed ribcage of the reference.
function ribRow(m: Build, cx: number, cz: number, y0: number, baseYaw: number, rng: () => number): void {
  const n = 3 + Math.floor(rng() * 2);
  const Lx = Math.cos(baseYaw + Math.PI / 2);
  const Lz = Math.sin(baseYaw + Math.PI / 2);
  const bend = rng() < 0.5 ? 1 : -1; // whole cage curves the same way
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2) * 0.055;
    const yaw = baseYaw + (rng() - 0.5) * 0.5;
    curvedBone(m, cx + Lx * off, y0, cz + Lz * off, yaw, 0.15 + rng() * 0.07, bend * (0.05 + rng() * 0.06), 0.05, 0.02, BONE, bend * rng() * 0.03);
  }
}

// A bleached horned skull: a rounded cranium + a shorter snout, two dark eye hollows, and two
// horns sweeping out and up from the back corners.
function boneSkull(m: Build, cx: number, cz: number, y0: number, yaw: number, rng: () => number): void {
  const DARK: RGB = [44, 42, 44];
  const fx = Math.cos(yaw);
  const fz = Math.sin(yaw);
  const px = -Math.sin(yaw);
  const pz = Math.cos(yaw);
  const cy = y0 + 0.055;
  const sd = (rng() * 1000) | 0;
  blob(m, cx, cy, cz, 0.12, 0.072, 0.092, BONE, sd, 0.07, 3, 6, undefined, yaw); // cranium
  blob(m, cx + fx * 0.1, cy - 0.012, cz + fz * 0.1, 0.058, 0.05, 0.055, BONE, sd + 7, 0.07, 3, 5, undefined, yaw); // snout
  for (const s of [1, -1] as const) {
    blob(m, cx + fx * 0.04 + px * s * 0.05, cy + 0.05, cz + fz * 0.04 + pz * s * 0.05, 0.022, 0.02, 0.022, DARK, sd + 20 + s, 0.1, 2, 5); // eye hollow
    const hy = Math.atan2(pz * s, px * s);
    curvedBone(m, cx - fx * 0.05 + px * s * 0.06, cy + 0.04, cz - fz * 0.05 + pz * s * 0.06, hy, 0.13, 0.07, 0.032, 0.03, BONE, 0.03); // horn
  }
}

// The robber: a dark charcoal pawn — a solid of revolution (flared base → pinched waist →
// rounded body → neck → domed head). NOT terrain; baked in only when the toggle is on.
function robber(m: Build, cx: number, cz: number, y0: number): void {
  const GREY: RGB = [130, 134, 144]; // medium charcoal — stays legible even in ASCII
  const sides = 8;
  const S = 1.2; // scale relative to the tile
  // Skittle profile [radius, height] matched to the real piece: a thin foot disk on a narrow
  // stem, a big dominant egg body, a pinched neck, then a distinctly smaller ball head.
  const prof: [number, number][] = [
    [0.115, 0.0], // foot disk (wide, ~⅘ of the belly)
    [0.12, 0.04],
    [0.065, 0.07], // narrow stem
    [0.1, 0.12], // egg widening
    [0.14, 0.22], // egg belly (widest point)
    [0.115, 0.3],
    [0.06, 0.36], // neck pinch
    [0.085, 0.42], // head
    [0.095, 0.47], // head widest (~⅔ of the belly)
    [0.06, 0.52],
    [0.0, 0.55], // crown
  ];
  const ring = (r: number, y: number): Vec3[] => {
    const pts: Vec3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (2 * Math.PI * i) / sides + Math.PI / 8;
      pts.push(v(cx + Math.cos(a) * r * S, y0 + y * S, cz + Math.sin(a) * r * S));
    }
    return pts;
  };
  let prev = ring(prof[0][0], prof[0][1]);
  const cbot = v(cx, y0 + prof[0][1], cz);
  for (let i = 0; i < sides; i++) faceTri(m, cbot, prev[(i + 1) % sides], prev[i], shade(GREY, 0.75), DOWN);
  for (let sIdx = 1; sIdx < prof.length; sIdx++) {
    const [r, y] = prof[sIdx];
    if (r === 0) {
      const apex = v(cx, y0 + y * S, cz);
      for (let i = 0; i < sides; i++) faceTri(m, apex, prev[i], prev[(i + 1) % sides], shade(GREY, 1.12), UP);
      break;
    }
    const cur = ring(r, y);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const mx = (prev[i].x + prev[j].x + cur[j].x + cur[i].x) / 4;
      const mz = (prev[i].z + prev[j].z + cur[j].z + cur[i].z) / 4;
      faceQuad(m, prev[i], prev[j], cur[j], cur[i], GREY, norm(v(mx - cx, 0, mz - cz)));
    }
    prev = cur;
  }
}

// Ground height at (x,z): the LOWEST surface vertex within a small radius (props rise ABOVE
// the ground, so the minimum tracks the terrain even directly under a prop). Skips the wall
// undersides (negative y).
function groundYAt(m: Build, x: number, z: number, r: number): number {
  const r2 = r * r;
  let best = Infinity;
  for (const vert of m.vertices) {
    const p = vert.position;
    if (p.y < -0.02) continue;
    if ((p.x - x) ** 2 + (p.z - z) ** 2 <= r2 && p.y < best) best = p.y;
  }
  return best === Infinity ? EDGE_Y : best;
}
// Whether a prop stands in a spot: any vertex within `r` sitting well above the local ground.
// The threshold is high enough that gentle terrain slope doesn't count, but a sheep/tree/bone/
// brick does.
function spotBlocked(m: Build, x: number, z: number, r: number, aboveY: number): boolean {
  const r2 = r * r;
  for (const vert of m.vertices) {
    const p = vert.position;
    if (p.y > aboveY && (p.x - x) ** 2 + (p.z - z) ** 2 <= r2) return true;
  }
  return false;
}
// Seat the robber flush on the ground at the spot nearest the centre whose base area is clear
// of props — so it never perches on top of a piece or floats. Falls back to the centre.
export function placeRobber(m: Build): void {
  const cands: { x: number; z: number }[] = [{ x: 0, z: 0 }];
  for (const rr of [0.22, 0.34, 0.46]) for (let k = 0; k < 8; k++) cands.push({ x: Math.cos((k * Math.PI) / 4) * rr, z: Math.sin((k * Math.PI) / 4) * rr });
  for (const c of cands) {
    const gy = groundYAt(m, c.x, c.z, 0.07);
    if (!spotBlocked(m, c.x, c.z, 0.17, gy + 0.1)) {
      robber(m, c.x, c.z, gy);
      return;
    }
  }
  robber(m, 0, 0, groundYAt(m, 0, 0, 0.07));
}

// DESERT dunes: pale wind-blown sand shaped as long, gently-meandering RIDGE LINES (not
// peaks). A directional sine field along `dir` makes one or two crests run across the tile.
function duneHeight(x: number, z: number, seed: number, dir: number): number {
  const r = Math.hypot(x, z);
  const rimFade = smooth((R_RIM - r) / 0.22);
  const cosD = Math.cos(dir);
  const sinD = Math.sin(dir);
  const u = x * cosD + z * sinD; // across the ridges
  const vv = -x * sinD + z * cosD; // along the ridges
  const um = u + 0.34 * Math.sin(vv * 1.5 + seed); // meander so the crest curves
  let h = 0.12 * (0.5 + 0.5 * Math.sin(um * 2.2 + seed * 0.7)); // the long dune ridge(s)
  h += 0.035 * Math.sin(vv * 0.85 + seed * 1.7); // gentle rise/fall along a crest
  h += (hash2(x * 6 + seed, z * 6 - seed) - 0.5) * 0.02; // faint grain
  return EDGE_Y + Math.max(0, h) * rimFade;
}

// DESERT: pale ridged dunes strewn with bleached bones (a horned skull + a rib row). The
// robber is NOT part of the tile — it's added by tileMesh only when toggled on.
export function desertTile(seed: number): Build {
  const m = build();
  // Warm golden tan against the frame's paler, creamier buff. It is light enough to read as
  // sunlit dune sand without becoming muddy, while the stronger amber saturation and modest
  // value gap keep the terrain distinct from the tile ledge in both color and ASCII modes.
  const SAND: RGB = [214, 179, 96];
  const dseed = seed + 2.7;
  const rng = mulberry32((Math.abs(seed) * 2246822519 + 0x68e31da4) >>> 0 || 1);
  const dir = rng() * Math.PI; // wind direction → ridge orientation
  const M = 5;
  const V = hexCorners(R_RIM, 0);
  const jit = (R_RIM / M) * 0.32;
  const hAt = (x: number, z: number): number => duneHeight(x, z, dseed, dir);
  const at = (b: Vec3, c: Vec3, i: number, j: number): Vec3 => {
    const ox = (i / M) * b.x + (j / M) * c.x;
    const oz = (i / M) * b.z + (j / M) * c.z;
    let x = ox;
    let z = oz;
    if (i + j < M && (i > 0 || j > 0)) {
      x = ox + (hash2(ox * 41 + dseed, oz * 41 - dseed) - 0.5) * 2 * jit;
      z = oz + (hash2(ox * 23 - dseed, oz * 23 + dseed) - 0.5) * 2 * jit;
    }
    return v(x, hAt(x, z), z);
  };
  const face = (p0: Vec3, p1: Vec3, p2: Vec3): void => {
    const cy = (p0.y + p1.y + p2.y) / 3;
    // Wider value travel makes the dune ridges legible from afar: sheltered troughs stay
    // ochre while wind-facing crests approach the lighter shoreline color.
    const k = 0.91 + smooth((cy - EDGE_Y) / 0.16) * 0.13 + (hash2(p0.x + p1.z, p0.z - p1.x) - 0.5) * 0.08;
    faceTri(m, p0, p1, p2, shade(SAND, k), UP);
  };
  for (let s = 0; s < 6; s++) {
    const b = V[s];
    const c = V[(s + 1) % 6];
    for (let i = 0; i < M; i++) {
      for (let j = 0; j < M - i; j++) {
        const p00 = at(b, c, i, j);
        const p10 = at(b, c, i + 1, j);
        const p01 = at(b, c, i, j + 1);
        face(p00, p10, p01);
        if (j < M - i - 1) face(p10, at(b, c, i + 1, j + 1), p01);
      }
    }
  }
  rimAndWall(m, SAND);
  // Bones scatter off-centre so they never clash with the robber's centre spot.
  const spots = scatter(rng, 4, 0.58, 0.26).filter((p) => Math.hypot(p.x, p.z) > 0.3);
  let bi = 0;
  const sp = spots[bi++];
  if (sp) boneSkull(m, sp.x, sp.z, hAt(sp.x, sp.z), rng() * Math.PI * 2, rng);
  const rp = spots[bi++];
  if (rp) ribRow(m, rp.x, rp.z, hAt(rp.x, rp.z), rng() * Math.PI * 2, rng);
  const rp2 = spots[bi++];
  if (rp2 && rng() < 0.6) ribRow(m, rp2.x, rp2.z, hAt(rp2.x, rp2.z), rng() * Math.PI * 2, rng);
  return m;
}

export function animatedDesertTile(seed: number, time: number, origin: WindOrigin): Build {
  const m = build();
  const wind = sampleWind(time, origin.x, origin.z);
  if (wind.strength < 0.05) return m;
  const SAND: RGB = [255, 240, 174];
  const CREST: RGB = [255, 248, 205];
  const dseed = seed + 2.7;
  const rng = mulberry32((Math.abs(seed) * 2246822519 + 0x68e31da4) >>> 0 || 1);
  const duneDir = rng() * Math.PI;
  const hAt = (x: number, z: number): number => duneHeight(x, z, dseed, duneDir);
  const sideX = -wind.z;
  const sideZ = wind.x;

  // Fine saltating grains travel in loose fronts, hugging the dune surface and making short
  // hops. Dozens of tiny tapered flecks read as airborne sand rather than the broad triangular
  // bars used by the first pass. Long calm weather states still produce no overlay at all.
  for (let i = 0; i < 48; i++) {
    const phaseOffset = rng();
    const cross = (rng() - 0.5) * 1.34;
    const speed = 0.11 + rng() * 0.08;
    const turbulence = (rng() - 0.5) * 0.22;
    const phase = (time * speed * (0.72 + wind.strength * 0.62) + phaseOffset) % 1;
    const hop = Math.sin(phase * Math.PI);
    const along = -0.82 + phase * 1.64;
    const curl = Math.sin(phase * Math.PI * 2 + i * 1.7) * 0.025 * wind.strength;
    const x = wind.x * along + sideX * (cross + curl);
    const z = wind.z * along + sideZ * (cross + curl);
    if (Math.hypot(x, z) > R_RIM - 0.055 || hop < 0.045) continue;
    const localWind = sampleWind(time, origin.x + x, origin.z + z);
    const tc = Math.cos(turbulence);
    const ts = Math.sin(turbulence);
    const grainX = wind.x * tc - wind.z * ts;
    const grainZ = wind.x * ts + wind.z * tc;
    const grainSideX = -grainZ;
    const grainSideZ = grainX;
    const length = (0.019 + localWind.strength * 0.034) * (0.72 + rng() * 0.7);
    const width = (0.004 + localWind.strength * 0.0032) * (0.7 + rng() * 0.65);
    const y = hAt(x, z) + 0.008 + hop * hop * (0.009 + localWind.strength * 0.026);
    const ax = grainX * length * 0.5;
    const az = grainZ * length * 0.5;
    const wx = grainSideX * width;
    const wz = grainSideZ * width;
    faceTriWithNormal(
      m,
      v(x - ax - wx, y, z - az - wz),
      v(x - ax + wx, y, z - az + wz),
      v(x + ax, y + 0.0015 + hop * 0.002, z + az),
      shade(i % 5 === 0 ? CREST : SAND, 0.94 + (i % 4) * 0.025),
      UP,
    );
  }

  // A few broken, shallow ripple crests advect over the terrain like wavelets on water. They
  // stay narrow and segmented so they enhance the dune flow without becoming painted stripes.
  for (let band = 0; band < 3; band++) {
    const phase = (time * (0.055 + band * 0.009) * (0.7 + wind.strength * 0.65) + rng()) % 1;
    const along = -0.72 + phase * 1.44;
    const bandCenter = (rng() - 0.5) * 0.7;
    for (let segment = -3; segment <= 3; segment++) {
      if ((segment + band) % 4 === 0) continue;
      const s0 = bandCenter + segment * 0.055;
      const s1 = s0 + 0.037;
      const arc0 = 0.024 * Math.cos(s0 * 5.4 + band);
      const arc1 = 0.024 * Math.cos(s1 * 5.4 + band);
      const x0 = wind.x * (along + arc0) + sideX * s0;
      const z0 = wind.z * (along + arc0) + sideZ * s0;
      const x1 = wind.x * (along + arc1) + sideX * s1;
      const z1 = wind.z * (along + arc1) + sideZ * s1;
      if (Math.hypot(x0, z0) > R_RIM - 0.05 || Math.hypot(x1, z1) > R_RIM - 0.05) continue;
      const half = 0.0024 + wind.strength * 0.0015;
      faceQuad(
        m,
        v(x0 - wind.x * half, hAt(x0, z0) + 0.009, z0 - wind.z * half),
        v(x1 - wind.x * half, hAt(x1, z1) + 0.009, z1 - wind.z * half),
        v(x1 + wind.x * half, hAt(x1, z1) + 0.01, z1 + wind.z * half),
        v(x0 + wind.x * half, hAt(x0, z0) + 0.01, z0 + wind.z * half),
        shade(CREST, 0.95 + band * 0.025),
        UP,
      );
    }
  }
  return m;
}

// Builders take a per-tile `seed` (ore varies with it; the others ignore it for now — a
// parameterless builder is assignable, so only mountainsTile declares the param).
