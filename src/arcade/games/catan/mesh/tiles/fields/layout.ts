// Wheat field layout: the curved harvested lanes, farm parcel polygons, and the mapping
// between field space (rows across the crop) and world space.

import { clampToHex, R_RIM } from '../../base.ts';
import { type Build, faceTriWithNormal, type RGB, shade, smooth, UP, v } from '../../build.ts';

interface HarvestLane {
  p0: { x: number; z: number };
  p1: { x: number; z: number };
  p2: { x: number; z: number };
  p3: { x: number; z: number };
  startWidth: number;
  endWidth: number;
  phase: number;
}

type FarmPoint = readonly [u: number, w: number];
type FarmPolygon = readonly FarmPoint[];

export interface FieldLayout {
  angle: number;
  rowAngle: number;
  spacing: number;
  phase: number;
  bend: number;
  wave: number;
  harvestLanes: readonly HarvestLane[];
  grassParcel: FarmPolygon;
  windmillPosition: FarmPoint;
  shackPosition: FarmPoint;
  bushPosition: FarmPoint;
}

export const fieldToWorld = (angle: number, u: number, w: number): { x: number; z: number } => ({
  x: Math.cos(angle) * u - Math.sin(angle) * w,
  z: Math.sin(angle) * u + Math.cos(angle) * w,
});

export function fieldLayout(rng: () => number, seed: number): FieldLayout {
  // Coordinates use screen-right (u) and screen-down (w), matching the reference photograph.
  // Every seed keeps the same farm topology while moving the dividers, grass boundary, and props.
  // Rotate the WHOLE composition in 60-degree steps so adjacent board tiles do not all pin the
  // pasture to the same corner or send their harvested pass between the same pair of edges.
  const orientation = ((Math.trunc(seed) % 6) + 6) % 6;
  const angle = -0.62 + orientation * (Math.PI / 3) + (rng() - 0.5) * 0.05;
  const laneStart = -0.09 + (rng() - 0.5) * 0.16;
  const laneEnd = 0.37 + (rng() - 0.5) * 0.2;
  const laneBend = (rng() - 0.5) * 0.24;
  const grassRight = -0.12 + (rng() - 0.5) * 0.32;
  const grassBottom = -0.14 + (rng() - 0.5) * 0.26;
  const grassShoulder = -0.43 + (rng() - 0.5) * 0.24;
  const swapFarmProps = rng() < 0.5;
  const toLane = (
    points: readonly [FarmPoint, FarmPoint, FarmPoint, FarmPoint],
    width: number,
    phase: number,
    endWidth = width * 0.94,
  ): HarvestLane => {
    const p = points.map(([u, w]) => fieldToWorld(angle, u, w)) as [
      { x: number; z: number },
      { x: number; z: number },
      { x: number; z: number },
      { x: number; z: number },
    ];
    return { p0: p[0], p1: p[1], p2: p[2], p3: p[3], startWidth: width, endWidth, phase };
  };
  // Cycle three clearly different but compatible combine passes: almost straight, one broad
  // curve, and the same broad curve with a short fork. This is shape variation, not a return to
  // the unrelated full-tile pattern families that previously made the wheat incoherent.
  const harvestStyle = ((Math.trunc(seed) % 3) + 3) % 3;
  // A little broader than the first reference-derived pass: still narrow close up, but legible
  // as a band of cut stalks when all nineteen tiles are viewed together.
  const laneWidth = 0.059 + rng() * 0.018;
  const deltaW = laneEnd - laneStart;
  const mainPoints: [FarmPoint, FarmPoint, FarmPoint, FarmPoint] = harvestStyle === 0
    ? [
        [-1.03, laneStart],
        [-0.35, laneStart + deltaW / 3 + (rng() - 0.5) * 0.025],
        [0.35, laneStart + (deltaW * 2) / 3 + (rng() - 0.5) * 0.025],
        [1.03, laneEnd],
      ]
    : [
        [-1.03, laneStart],
        [-0.56 + (rng() - 0.5) * 0.18, laneStart - 0.03 - laneBend],
        [0.02 + (rng() - 0.5) * 0.18, laneEnd - 0.09 + laneBend],
        [1.03, laneEnd],
      ];
  const mainLane = toLane(mainPoints, laneWidth, seed * 0.31);
  const harvestLanes: HarvestLane[] = [mainLane];
  if (harvestStyle === 2) {
    const join = cubicCurvePoint(mainLane, 0.54 + (rng() - 0.5) * 0.08);
    const middleW = laneStart + deltaW * 0.55;
    const p1 = fieldToWorld(angle, 0.18, middleW - 0.035);
    const p2 = fieldToWorld(angle, 0.38 + (rng() - 0.5) * 0.06, middleW - 0.18 + (rng() - 0.5) * 0.06);
    const p3 = fieldToWorld(angle, 0.57 + (rng() - 0.5) * 0.08, middleW - 0.34 + (rng() - 0.5) * 0.08);
    harvestLanes.push({
      p0: join,
      p1,
      p2,
      p3,
      startWidth: laneWidth * 1.05,
      endWidth: laneWidth * 0.72,
      phase: seed * 0.53 + 2.1,
    });
  }
  return {
    angle,
    rowAngle: angle + (rng() - 0.5) * 0.09,
    spacing: 0.05 + rng() * 0.005,
    phase: (rng() - 0.5) * 0.05,
    bend: (rng() - 0.5) * 0.035,
    wave: 0.006 + rng() * 0.008,
    harvestLanes,
    // The outer points deliberately extend past the inner hex and are clipped onto its edge.
    grassParcel: [
      [-1.04, -0.86],
      [grassRight, -0.84],
      [grassRight + (rng() - 0.5) * 0.045, grassBottom],
      [grassShoulder, grassBottom + 0.04 + (rng() - 0.5) * 0.05],
      [-1.04, -0.18 + (rng() - 0.5) * 0.09],
    ],
    windmillPosition: [-0.47 + (rng() - 0.5) * 0.08, -0.48 + (rng() - 0.5) * 0.08],
    shackPosition: swapFarmProps
      ? [Math.max(-0.34, grassRight - 0.09) + (rng() - 0.5) * 0.04, -0.27 + (rng() - 0.5) * 0.06]
      : [-0.62 + (rng() - 0.5) * 0.05, -0.29 + (rng() - 0.5) * 0.06],
    bushPosition: [grassRight - 0.07 - rng() * 0.04, grassBottom - 0.015 - rng() * 0.035],
  };
}

function cubicCurvePoint(lane: HarvestLane, t: number): { x: number; z: number } {
  const inv = 1 - t;
  const a = inv * inv * inv;
  const b = 3 * inv * inv * t;
  const c = 3 * inv * t * t;
  const d = t * t * t;
  return {
    x: lane.p0.x * a + lane.p1.x * b + lane.p2.x * c + lane.p3.x * d,
    z: lane.p0.z * a + lane.p1.z * b + lane.p2.z * c + lane.p3.z * d,
  };
}

function harvestedWeight(lane: HarvestLane, x: number, z: number): number {
  const segments = 14;
  let best = 0;
  let a = lane.p0;
  for (let i = 1; i <= segments; i++) {
    const b = cubicCurvePoint(lane, i / segments);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz || 1;
    const q = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSq));
    const nearestX = a.x + dx * q;
    const nearestZ = a.z + dz * q;
    const distance = Math.hypot(x - nearestX, z - nearestZ);
    const t = (i - 1 + q) / segments;
    const baseWidth = lane.startWidth + (lane.endWidth - lane.startWidth) * t;
    const width = baseWidth * (1 + Math.sin(t * Math.PI * 4 + lane.phase) * 0.055);
    best = Math.max(best, smooth((width + 0.045 - distance) / 0.09));
    a = b;
  }
  return best;
}

function polygonCoverage(x: number, z: number, polygon: FarmPolygon): number {
  let inside = false;
  let minDistance = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const dx = xi - xj;
    const dz = zi - zj;
    const lengthSq = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - xj) * dx + (z - zj) * dz) / lengthSq));
    minDistance = Math.min(minDistance, Math.hypot(x - (xj + dx * t), z - (zj + dz * t)));
  }
  const signedDistance = inside ? -minDistance : minDistance;
  return smooth((0.055 - signedDistance) / 0.11);
}

export function scaleFarmPolygon(polygon: FarmPolygon, scale: number): FarmPolygon {
  const centerU = polygon.reduce((sum, [u]) => sum + u, 0) / polygon.length;
  const centerW = polygon.reduce((sum, [, w]) => sum + w, 0) / polygon.length;
  return polygon.map(([u, w]) => [centerU + (u - centerU) * scale, centerW + (w - centerW) * scale] as const);
}

function worldToField(layout: FieldLayout, x: number, z: number): { u: number; w: number } {
  const c = Math.cos(layout.angle);
  const s = Math.sin(layout.angle);
  return { u: x * c + z * s, w: -x * s + z * c };
}

export function fieldCoverage(layout: FieldLayout, x: number, z: number): number {
  const { u, w } = worldToField(layout, x, z);
  const grass = polygonCoverage(u, w, layout.grassParcel);
  let harvested = 0;
  for (const lane of layout.harvestLanes) harvested = Math.max(harvested, harvestedWeight(lane, x, z));
  return (1 - grass) * (1 - harvested);
}

export function harvestedFieldCoverage(layout: FieldLayout, x: number, z: number): number {
  const { u, w } = worldToField(layout, x, z);
  const grass = polygonCoverage(u, w, layout.grassParcel);
  let harvested = 0;
  for (const lane of layout.harvestLanes) harvested = Math.max(harvested, harvestedWeight(lane, x, z));
  return harvested * (1 - grass);
}

export function farmParcelPatch(
  m: Build,
  layout: FieldLayout,
  polygon: FarmPolygon,
  yAt: (x: number, z: number) => number,
  color: RGB,
  lift = 0.006,
): void {
  const points = polygon.map(([u, w]) => {
    const p = fieldToWorld(layout.angle, u, w);
    const q = clampToHex(p.x, p.z, R_RIM - 0.018);
    return v(q.x, yAt(q.x, q.z) + lift, q.z);
  });
  const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const centerZ = points.reduce((sum, p) => sum + p.z, 0) / points.length;
  const center = v(centerX, yAt(centerX, centerZ) + lift, centerZ);
  for (let i = 0; i < points.length; i++) {
    faceTriWithNormal(m, center, points[i], points[(i + 1) % points.length], shade(color, 0.97 + (i % 3) * 0.025), UP);
  }
}

export function insideFieldHex(x: number, z: number): boolean {
  const c = clampToHex(x, z, R_RIM - 0.025);
  return Math.hypot(c.x - x, c.z - z) < 1e-5;
}

export function fieldRowPoint(layout: FieldLayout, row: number, u: number): { x: number; z: number } {
  const baseW = row * layout.spacing + layout.phase;
  const w = baseW + layout.bend * (u * u - 0.35) + layout.wave * Math.sin(u * 3.2 + row * 0.43);
  return fieldToWorld(layout.rowAngle, u, w);
}

// A harvested row is genuinely raised: two sloping faces meet along its crest, and short cut
// stems protrude from that crest. These rows only exist in the combine lanes, rather than being
// flat lines painted across the soil.
