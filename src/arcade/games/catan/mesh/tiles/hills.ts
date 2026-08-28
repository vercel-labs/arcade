// The brick tile: a worked clay quarry with a broad low floor, faceted cut walls, timber
// access structures, brick stockpiles, and an ox cart. The centre remains clear for the number
// token; variation rotates and reshapes the quarry rather than changing its identity.

import { mulberry32, type Vec3 } from '../../../../../engine/index.ts';
import { EDGE_Y, hexCorners, R_RIM, rimAndWall } from '../base.ts';
import { build, type Build, faceTri, hash2, type RGB, shade, smooth, UP, v } from '../build.ts';
import { brickHeap, brickStack } from '../nature.ts';
import { angularRock, beam, blob, box } from '../props.ts';

// The worked floor sits slightly beneath the ordinary terrain surface, but remains above the
// tile frame. Most of the perceived depth still comes from the isolated cliff masses.
const FLOOR_Y = EDGE_Y - 0.024;
const TOKEN_CLEARANCE = 0.23;

interface CliffArc {
  center: number;
  halfWidth: number;
  innerQ: number;
  height: number;
}

// These are deliberately incomplete arcs rather than a closed crater. In local tile space they
// form a tall north-west cut, a separate northern shelf, an eastern trestle wall, and one short
// south-east ledge. The south and west approaches remain open at quarry-floor height.
const CLIFF_ARCS: readonly CliffArc[] = [
  { center: 2.48, halfWidth: 0.58, innerQ: 0.61, height: 1.08 },
  { center: 1.48, halfWidth: 0.52, innerQ: 0.71, height: 0.98 },
  { center: 0.42, halfWidth: 0.55, innerQ: 0.66, height: 1 },
  { center: -0.58, halfWidth: 0.32, innerQ: 0.8, height: 0.7 },
];

interface QuarryLayout {
  cx: number;
  cz: number;
  angle: number;
  rx: number;
  rz: number;
  shapePhase: number;
  rampAngle: number;
  trestleAngle: number;
}

function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function quarryLayout(seed: number): QuarryLayout {
  const rng = mulberry32((Math.abs(seed) * 2654435761 + 0x6d2b79f5) >>> 0 || 1);
  const angle = rng() * Math.PI * 2;
  const trestleAngle = angle + (rng() - 0.5) * 0.26;
  return {
    cx: (rng() - 0.5) * 0.075,
    cz: (rng() - 0.5) * 0.065,
    angle,
    rx: 0.62 + rng() * 0.035,
    rz: 0.48 + rng() * 0.035,
    shapePhase: rng() * Math.PI * 2,
    rampAngle: trestleAngle + Math.PI + (rng() - 0.5) * 0.38,
    trestleAngle,
  };
}

function variedCliffArc(layout: QuarryLayout, index: number): CliffArc {
  const base = CLIFF_ARCS[index];
  const phase = layout.shapePhase + index * 1.91;
  return {
    // Keep every mass in its original quadrant while breaking the repeated silhouette.
    center: base.center + Math.sin(phase * 1.37) * 0.045,
    halfWidth: base.halfWidth * (1 + Math.cos(phase * 1.73) * 0.055),
    innerQ: base.innerQ + Math.sin(phase * 2.11 + 0.8) * 0.024,
    height: base.height * (1 + Math.cos(phase * 1.29 - 0.5) * 0.055),
  };
}

function quarryCoordinates(layout: QuarryLayout, x: number, z: number): { q: number; angle: number } {
  const dx = x - layout.cx;
  const dz = z - layout.cz;
  const c = Math.cos(layout.angle);
  const s = Math.sin(layout.angle);
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;
  const angle = Math.atan2(lz / layout.rz, lx / layout.rx);
  // Deliberately avoid a regular elliptical crater: broad lobes establish the quarry's
  // asymmetry while the higher-frequency terms make individual cut faces step in and out.
  const irregular = 1
    + Math.sin(angle + layout.shapePhase * 0.43) * 0.075
    + Math.sin(angle * 3 + layout.shapePhase) * 0.085
    + Math.sin(angle * 5 - layout.shapePhase * 0.7) * 0.04;
  return { q: Math.hypot(lx / layout.rx, lz / layout.rz) / irregular, angle: Math.atan2(dz, dx) };
}

interface QuarryRelief {
  lift: number;
  wall: number;
  shelf: number;
}

function quarryRelief(layout: QuarryLayout, x: number, z: number, seed: number): QuarryRelief {
  const { q, angle } = quarryCoordinates(layout, x, z);
  const localAngle = angleDelta(angle, layout.angle);
  const upper = 0.158 + 0.016 * Math.sin(localAngle * 2.7 + seed * 0.31);
  let lift = 0;
  let wall = 0;
  let shelf = 0;

  for (let i = 0; i < CLIFF_ARCS.length; i++) {
    const arc = variedCliffArc(layout, i);
    const angular = smooth((arc.halfWidth - Math.abs(angleDelta(localAngle, arc.center))) / 0.13);
    if (angular <= 0) continue;
    const brokenEdge = Math.sin(localAngle * 5 + layout.shapePhase + i * 1.7) * 0.035
      + Math.sin(localAngle * 9 - layout.shapePhase * 0.6) * 0.018;
    const innerQ = arc.innerQ + brokenEdge;
    const innerFace = smooth((q - innerQ) / 0.11);
    const outerFace = smooth((q - innerQ - 0.19) / 0.13);
    const arcLift = angular * (0.052 * innerFace + (upper * arc.height - 0.052) * outerFace);
    lift = Math.max(lift, arcLift);
    wall = Math.max(wall, angular * innerFace * (1 - outerFace * 0.72));
    shelf = Math.max(shelf, angular * outerFace);
  }
  return { lift, wall, shelf };
}

function quarryHeight(layout: QuarryLayout, x: number, z: number, seed: number): number {
  const r = Math.hypot(x, z);
  const relief = quarryRelief(layout, x, z, seed);
  // Blend the recessed work floor back to the shared EDGE_Y only in a narrow outer strip.
  // The open south/west approaches therefore rise gently to the rim instead of gaining walls.
  const interior = smooth((R_RIM - r) / 0.16);
  const base = EDGE_Y + (FLOOR_Y - EDGE_Y) * interior;
  const floorGrain = (hash2(x * 13 + seed, z * 13 - seed) - 0.5) * 0.006 * interior * (1 - relief.wall);
  return base + floorGrain + relief.lift * interior;
}

const FLOOR: RGB = [190, 102, 61];
const CLIFF: RGB = [168, 76, 52];
const SHELF: RGB = [205, 121, 67];

function terrainColor(layout: QuarryLayout, x: number, z: number, seed: number): RGB {
  const relief = quarryRelief(layout, x, z, seed);
  const fleck = (hash2(x * 7.1 + seed, z * 7.1 - seed) - 0.5) * 0.11;
  if (relief.wall < 0.08 && relief.shelf < 0.08) return shade(FLOOR, 0.97 + fleck * 0.45);
  if (relief.shelf < 0.72) {
    const band = relief.shelf;
    const base: RGB = [
      CLIFF[0] + (SHELF[0] - CLIFF[0]) * band,
      CLIFF[1] + (SHELF[1] - CLIFF[1]) * band,
      CLIFF[2] + (SHELF[2] - CLIFF[2]) * band,
    ];
    return shade(base, 0.92 + fleck);
  }
  return shade(SHELF, 0.98 + fleck * 0.7);
}

function quarryTerrain(m: Build, layout: QuarryLayout, seed: number): void {
  const M = 10;
  const V = hexCorners(R_RIM, 0);
  const jitter = (R_RIM / M) * 0.18;
  const at = (b: Vec3, c: Vec3, i: number, j: number): Vec3 => {
    const ox = (i / M) * b.x + (j / M) * c.x;
    const oz = (i / M) * b.z + (j / M) * c.z;
    let x = ox;
    let z = oz;
    const { q } = quarryCoordinates(layout, ox, oz);
    if (i + j < M && (i > 0 || j > 0) && q > 0.7) {
      const amount = smooth((q - 0.7) / 0.5);
      x += (hash2(ox * 41 + seed, oz * 41 - seed) - 0.5) * 2 * jitter * amount;
      z += (hash2(ox * 23 - seed, oz * 23 + seed) - 0.5) * 2 * jitter * amount;
    }
    return v(x, quarryHeight(layout, x, z, seed), z);
  };
  const face = (a: Vec3, b: Vec3, c: Vec3): void => {
    const cx = (a.x + b.x + c.x) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    faceTri(m, a, b, c, terrainColor(layout, cx, cz, seed), UP);
  };

  for (let sector = 0; sector < 6; sector++) {
    const b = V[sector];
    const c = V[(sector + 1) % 6];
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
  rimAndWall(m, SHELF);
}

function pointAt(angle: number, radius: number): { x: number; z: number } {
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

function pointOnQuarryWall(layout: QuarryLayout, angle: number, qTarget: number): { x: number; z: number } {
  let lo = 0;
  let hi = 0.9;
  for (let i = 0; i < 10; i++) {
    const radius = (lo + hi) / 2;
    const x = layout.cx + Math.cos(angle) * radius;
    const z = layout.cz + Math.sin(angle) * radius;
    if (quarryCoordinates(layout, x, z).q < qTarget) lo = radius;
    else hi = radius;
  }
  const radius = (lo + hi) / 2;
  return { x: layout.cx + Math.cos(angle) * radius, z: layout.cz + Math.sin(angle) * radius };
}

function quarryCliffOutcrops(m: Build, layout: QuarryLayout, seed: number, hAt: (x: number, z: number) => number): void {
  const rng = mulberry32((Math.abs(seed) * 3266489917 + 0x85ebca6b) >>> 0 || 1);
  let rockIndex = 0;
  for (let arcIndex = 0; arcIndex < CLIFF_ARCS.length; arcIndex++) {
    const arc = variedCliffArc(layout, arcIndex);
    const extraCrag = (Math.abs(seed) + arcIndex * 11) % 5 === 0 ? 1 : 0;
    const pieces = arcIndex === CLIFF_ARCS.length - 1 ? 1 : 2 + extraCrag;
    for (let j = 0; j < pieces; j++) {
      const spread = pieces === 1 ? 0 : (j / (pieces - 1) - 0.5) * 0.56;
      const localAngle = arc.center + spread * arc.halfWidth + (rng() - 0.5) * 0.12;
      const angle = layout.angle + localAngle;
      // The trestle remains a deliberate break through the eastern wall.
      if (Math.abs(angleDelta(angle, layout.trestleAngle)) < 0.2) continue;
      const p = pointOnQuarryWall(layout, angle, arc.innerQ + 0.055 + rng() * 0.025);
      const profile = rockIndex % 3 === 0 ? 'crag' : 'wedge';
      angularRock(
        m,
        p.x,
        p.z,
        Math.min(hAt(p.x, p.z) - 0.008, FLOOR_Y + 0.022),
        0.075 + rng() * 0.04,
        0.105 + rng() * 0.065,
        0.045 + rng() * 0.028,
        shade(CLIFF, 0.9 + rng() * 0.18),
        seed * 97 + rockIndex,
        profile,
        angle + Math.PI / 2 + (rng() - 0.5) * 0.2,
      );
      rockIndex++;
    }
  }
}

function timberTrestle(m: Build, layout: QuarryLayout, hAt: (x: number, z: number) => number): void {
  const DECK: RGB = [132, 91, 55];
  const SUPPORT: RGB = [91, 65, 45];
  const reachWave = Math.sin(layout.shapePhase * 1.43 + 0.6);
  const widthWave = Math.cos(layout.shapePhase * 1.81 - 0.3);
  const outer = pointAt(layout.trestleAngle, 0.7 + reachWave * 0.025);
  const inner = pointAt(layout.trestleAngle, 0.33 - reachWave * 0.018);
  const deckWidth = 0.14 + widthWave * 0.012;
  const dx = inner.x - outer.x;
  const dz = inner.z - outer.z;
  const length = Math.hypot(dx, dz);
  const ux = dx / length;
  const uz = dz / length;
  const sx = -uz;
  const sz = ux;
  const yaw = Math.atan2(uz, ux);
  const outerY = hAt(outer.x, outer.z) + 0.045;
  const innerY = hAt(inner.x, inner.z) + 0.065;
  const deckY = (t: number): number => outerY + (innerY - outerY) * t;
  const center = (t: number): Vec3 => v(outer.x + dx * t, deckY(t), outer.z + dz * t);
  const segments = 6 + (Math.floor((layout.shapePhase / (Math.PI * 2)) * 11) % 3);

  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const t = (t0 + t1) / 2;
    const p = center(t);
    box(m, p.x, p.z, length / segments * 1.07, 0.018, deckWidth, shade(DECK, 0.94 + (i % 2) * 0.08), yaw, p.y - 0.009);
  }

  // Paired posts and diagonal braces make the descent read as a supported mining trestle.
  const supportTs = [0.08, 0.32, 0.56, 0.8, 0.98];
  for (let i = 0; i < supportTs.length; i++) {
    const t = supportTs[i];
    const p = center(t);
    for (const side of [-1, 1] as const) {
      const x = p.x + sx * side * deckWidth * 0.455;
      const z = p.z + sz * side * deckWidth * 0.455;
      const ground = hAt(x, z) + 0.004;
      beam(m, v(x, ground, z), v(x, p.y + 0.07, z), 0.009, SUPPORT);
      if (i < supportTs.length - 1) {
        const next = center(supportTs[i + 1]);
        const nx = next.x + sx * side * deckWidth * 0.455;
        const nz = next.z + sz * side * deckWidth * 0.455;
        beam(m, v(x, ground + 0.012, z), v(nx, next.y + 0.018, nz), 0.006, shade(SUPPORT, 1.06));
      }
    }
  }
  for (const side of [-1, 1] as const) {
    const a = center(0.03);
    const b = center(0.99);
    beam(m, v(a.x + sx * side * deckWidth * 0.475, a.y + 0.07, a.z + sz * side * deckWidth * 0.475), v(b.x + sx * side * deckWidth * 0.475, b.y + 0.07, b.z + sz * side * deckWidth * 0.475), 0.007, SUPPORT);
  }
}

interface RouteSample {
  x: number;
  z: number;
  dx: number;
  dz: number;
}

function quarryRouteSample(layout: QuarryLayout, phase: number): RouteSample {
  const basePoints = [
    { x: -0.45, z: -0.16 },
    { x: -0.31, z: -0.39 },
    { x: 0.08, z: -0.43 },
    { x: 0.18, z: -0.31 },
    { x: 0.14, z: -0.19 },
    { x: -0.06, z: -0.23 },
    { x: -0.34, z: -0.13 },
  ];
  const scaleX = 0.98 + Math.sin(layout.shapePhase * 1.17) * 0.035;
  const scaleZ = 0.98 + Math.cos(layout.shapePhase * 1.41) * 0.035;
  const shiftX = Math.sin(layout.shapePhase * 1.83) * 0.014;
  const shiftZ = Math.cos(layout.shapePhase * 1.59) * 0.012;
  const points = basePoints.map((point, index) => ({
    x: point.x * scaleX + shiftX + Math.sin(layout.shapePhase * 2.03 + index * 1.9) * 0.011,
    z: point.z * scaleZ + shiftZ + Math.cos(layout.shapePhase * 1.71 + index * 2.2) * 0.011,
  }));
  const wrapped = ((phase % 1) + 1) % 1;
  const scaled = wrapped * points.length;
  const index = Math.floor(scaled);
  const t = scaled - index;
  const point = (offset: number): { x: number; z: number } => points[(index + offset + points.length) % points.length];
  const p0 = point(-1);
  const p1 = point(0);
  const p2 = point(1);
  const p3 = point(2);
  const t2 = t * t;
  const t3 = t2 * t;
  const catmull = (a: number, b: number, c: number, d: number): number => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  const derivative = (a: number, b: number, c: number, d: number): number => 0.5 * ((-a + c) + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (-a + 3 * b - 3 * c + d) * t2);
  const lx = catmull(p0.x, p1.x, p2.x, p3.x);
  const lz = catmull(p0.z, p1.z, p2.z, p3.z);
  const ldx = derivative(p0.x, p1.x, p2.x, p3.x);
  const ldz = derivative(p0.z, p1.z, p2.z, p3.z);
  const c = Math.cos(layout.angle);
  const s = Math.sin(layout.angle);
  return {
    x: layout.cx + lx * c - lz * s,
    z: layout.cz + lx * s + lz * c,
    dx: ldx * c - ldz * s,
    dz: ldx * s + ldz * c,
  };
}

function wagonProgress(seed: number, time: number): { phase: number; moving: number; direction: -1 | 1 } {
  const cycle = 26 + (Math.abs(seed) % 5);
  const seededOffset = ((Math.abs(seed * 37) % 101) / 101) * 0.73;
  const absolute = time / cycle + seededOffset;
  const lap = Math.floor(absolute);
  const raw = ((absolute % 1) + 1) % 1;
  const stops = 3 + (Math.abs(seed) % 2);
  const stage = Math.min(stops - 1, Math.floor(raw * stops));
  const local = raw * stops - stage;
  const travelEnd = 0.77 + ((Math.abs(seed * 13) % 17) / 16) * 0.09;
  const travel = local < travelEnd ? smooth(local / travelEnd) : 1;
  const edge = local < travelEnd ? Math.min(local / 0.13, (travelEnd - local) / 0.13) : 0;
  const direction: -1 | 1 = Math.abs(seed) % 3 === 0 ? -1 : 1;
  return { phase: direction * (lap + (stage + travel) / stops), moving: smooth(edge), direction };
}

function oxCart(m: Build, layout: QuarryLayout, time: number, hAt: (x: number, z: number) => number, seed: number): void {
  const OX: RGB = [170, 137, 91];
  const OX_DARK: RGB = [99, 72, 47];
  const WOOD: RGB = [105, 72, 47];
  const WHEEL: RGB = [68, 54, 42];
  const BRICK: RGB = [202, 91, 61];
  const progress = wagonProgress(seed, time);
  const cattle = quarryRouteSample(layout, progress.phase);
  // A reverse traversal also reverses the tangent and which side of the path is "behind".
  // Applying only the signed phase makes the wagon lead the cattle while they face backwards.
  const wagon = quarryRouteSample(layout, progress.phase - progress.direction * 0.105);
  const yaw = Math.atan2(cattle.dz * progress.direction, cattle.dx * progress.direction);
  const wagonYaw = Math.atan2(cattle.z - wagon.z, cattle.x - wagon.x);
  const fx = Math.cos(yaw);
  const fz = Math.sin(yaw);
  const sx = -fz;
  const sz = fx;
  const at = (along: number, side = 0): { x: number; z: number } => ({ x: cattle.x + fx * along + sx * side, z: cattle.z + fz * along + sz * side });
  const routeDistance = progress.phase * 2.45;
  const gaitAngle = (routeDistance / 0.115) * Math.PI * 2;

  for (const lane of [-1, 1] as const) {
    const lateral = lane * 0.052;
    const ox = at(0, lateral);
    const oxY = hAt(ox.x, ox.z);
    blob(m, ox.x, oxY + 0.066, ox.z, 0.074, 0.047, 0.035, shade(OX, lane > 0 ? 1.03 : 0.94), seed + lane * 7, 0.05, 3, 6, OX_DARK, yaw);
    for (const longitudinal of [-1, 1] as const) {
      for (const side of [-1, 1] as const) {
        const phaseOffset = longitudinal === side ? 0 : Math.PI;
        const legPhase = gaitAngle + phaseOffset + lane * 0.24;
        const stride = Math.sin(legPhase) * 0.022 * progress.moving;
        const swing = Math.max(0, Math.cos(legPhase)) * 0.019 * progress.moving;
        const along = longitudinal * 0.036;
        const across = lateral + side * 0.023;
        const top = at(along * 0.72, lateral + side * 0.016);
        const hoof = at(along + stride, across);
        const ground = hAt(hoof.x, hoof.z) + 0.006;
        const knee = at(along * 0.84 + stride * 0.45, lateral + side * 0.021);
        beam(m, v(top.x, oxY + 0.058, top.z), v(knee.x, ground + 0.027 + swing * 0.45, knee.z), 0.006, OX_DARK);
        beam(m, v(knee.x, ground + 0.027 + swing * 0.45, knee.z), v(hoof.x, ground + swing, hoof.z), 0.0055, OX_DARK);
      }
    }
    const head = at(0.082, lateral);
    const headY = hAt(head.x, head.z) + 0.068;
    blob(m, head.x, headY, head.z, 0.04, 0.038, 0.032, OX_DARK, seed + 12 + lane, 0.035, 3, 5, undefined, yaw);
    for (const hornSide of [-1, 1] as const) {
      const hornBase = v(head.x + sx * hornSide * 0.021, headY + 0.022, head.z + sz * hornSide * 0.021);
      const hornTip = v(head.x + fx * 0.016 + sx * hornSide * 0.047, headY + 0.036, head.z + fz * 0.016 + sz * hornSide * 0.047);
      beam(m, hornBase, hornTip, 0.0035, [224, 211, 168]);
    }
  }
  const yoke = at(0.05);
  beam(m, v(yoke.x - sx * 0.095, hAt(yoke.x, yoke.z) + 0.078, yoke.z - sz * 0.095), v(yoke.x + sx * 0.095, hAt(yoke.x, yoke.z) + 0.078, yoke.z + sz * 0.095), 0.006, WOOD);

  const wfx = Math.cos(wagonYaw);
  const wfz = Math.sin(wagonYaw);
  const wsx = -wfz;
  const wsz = wfx;
  const cartAt = (along: number, side = 0): { x: number; z: number } => ({ x: wagon.x + wfx * along + wsx * side, z: wagon.z + wfz * along + wsz * side });
  const cart = cartAt(0);
  const cartY = hAt(cart.x, cart.z) + 0.04;
  box(m, cart.x, cart.z, 0.16, 0.034, 0.145, WOOD, wagonYaw, cartY);
  const wheelSpin = routeDistance / 0.041;
  for (const side of [-1, 1] as const) {
    const wheel = cartAt(-0.01, side * 0.082);
    const wheelY = hAt(wheel.x, wheel.z) + 0.045;
    blob(m, wheel.x, wheelY, wheel.z, 0.041, 0.041, 0.012, WHEEL, seed + 20 + side, 0.02, 3, 8, undefined, wagonYaw);
    for (let spoke = 0; spoke < 4; spoke++) {
      const a = wheelSpin + (spoke * Math.PI) / 2;
      beam(m, v(wheel.x, wheelY, wheel.z), v(wheel.x + wfx * Math.cos(a) * 0.034, wheelY + Math.sin(a) * 0.034, wheel.z + wfz * Math.cos(a) * 0.034), 0.003, shade(WOOD, 1.15));
    }
  }
  const axleA = cartAt(-0.01, -0.086);
  const axleB = cartAt(-0.01, 0.086);
  beam(m, v(axleA.x, cartY + 0.01, axleA.z), v(axleB.x, cartY + 0.01, axleB.z), 0.005, WOOD);
  const hitch = cartAt(0.085);
  beam(m, v(hitch.x, cartY + 0.035, hitch.z), v(yoke.x, hAt(yoke.x, yoke.z) + 0.071, yoke.z), 0.006, WOOD);
  for (const [along, side, turn] of [[-0.13, -0.027, -0.08], [-0.09, 0.027, 0.06], [-0.055, -0.025, 0.03]] as const) {
    const p = cartAt(along + 0.1, side);
    box(m, p.x, p.z, 0.052, 0.025, 0.034, shade(BRICK, 0.94 + (side > 0 ? 0.08 : 0)), wagonYaw + turn, cartY + 0.032);
  }
}

function dressQuarry(m: Build, layout: QuarryLayout, seed: number, hAt: (x: number, z: number) => number): void {
  const rng = mulberry32((Math.abs(seed) * 2246822519 + 0x165667b1) >>> 0 || 1);
  timberTrestle(m, layout, hAt);

  const BRICK: RGB = [207, 91, 61];
  const stackAngle = layout.trestleAngle - 1.35 + (rng() - 0.5) * 0.28;
  const stack = pointAt(stackAngle, 0.58 + rng() * 0.08);
  brickStack(m, stack.x, stack.z, hAt(stack.x, stack.z) + 0.004, stackAngle + Math.PI / 2, BRICK, rng);
  const floorPileAngle = layout.trestleAngle + 1.35 + rng() * 0.3;
  const floorPile = pointAt(floorPileAngle, 0.46 + rng() * 0.08);
  if (Math.hypot(floorPile.x, floorPile.z) > TOKEN_CLEARANCE + 0.08) {
    brickHeap(m, floorPile.x, floorPile.z, hAt(floorPile.x, floorPile.z) + 0.004, floorPileAngle, shade(BRICK, 0.96), rng);
  }

  // A few pale quarry stones break up the clay shelf without crowding the excavation.
  const looseRockCount = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < looseRockCount; i++) {
    const a = layout.rampAngle + 0.72 + i * 0.42 + (rng() - 0.5) * 0.18;
    const p = pointAt(a, 0.61 + rng() * 0.08);
    angularRock(m, p.x, p.z, hAt(p.x, p.z), 0.045 + rng() * 0.025, 0.05 + rng() * 0.035, 0.04 + rng() * 0.02, [173, 150, 119], seed * 31 + i, i === 1 ? 'slab' : 'wedge', rng() * Math.PI);
  }
}

export function hillsTile(seed: number): Build {
  const m = build();
  const hseed = seed + 5.7;
  const layout = quarryLayout(seed);
  quarryTerrain(m, layout, hseed);
  const hAt = (x: number, z: number): number => quarryHeight(layout, x, z, hseed);
  quarryCliffOutcrops(m, layout, seed, hAt);
  dressQuarry(m, layout, seed, hAt);
  return m;
}

export function animatedHillsTile(seed: number, time: number): Build {
  const m = build();
  const hseed = seed + 5.7;
  const layout = quarryLayout(seed);
  const hAt = (x: number, z: number): number => quarryHeight(layout, x, z, hseed);
  oxCart(m, layout, time, hAt, seed * 71 + 9);
  return m;
}
