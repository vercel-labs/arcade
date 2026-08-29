// A continuous sandy apron around the 19-tile island plus broken animated surf at its outer
// edge. The coastline follows the topology's full 30-edge perimeter, so the beach connects
// neighboring tiles without turning into 19 disconnected hex outlines.

import { type Mesh, type Vec3 } from '../../../../engine/index.ts';
import { coastalEdgeRing, edgeNodes } from '../../../../rules/catan/board-topology.ts';
import { NODE_XZ } from '../scene/board-layout.ts';
import { build, faceQuadFlat, hash2, shade, smooth, UP, v, type RGB } from '../../../../game-visuals/catan/build.ts';

export const BEACH_DRY_WIDTH = 0.22;
export const BEACH_OUTER_WIDTH = 0.36;

const BEACH_INNER_Y = -0.025;
const BEACH_DRY_Y = -0.075;
const BEACH_WET_Y = -0.135;
const DRY_SAND: RGB = [232, 204, 142];
const WARM_SAND: RGB = [214, 174, 104];
const WET_SAND: RGB = [159, 133, 91];
const FOAM: RGB = [231, 245, 235];
const SWASH_Y = -0.105;

function shorelineNodeIds(): number[] {
  const first = edgeNodes[coastalEdgeRing[0]];
  const second = edgeNodes[coastalEdgeRing[1]];
  const secondHasB = second[0] === first[1] || second[1] === first[1];
  const ids = secondHasB ? [first[0], first[1]] : [first[1], first[0]];
  let current = ids[1];
  for (let i = 1; i < coastalEdgeRing.length; i++) {
    const [a, b] = edgeNodes[coastalEdgeRing[i]];
    const next = a === current ? b : b === current ? a : -1;
    if (next < 0) throw new Error('coastal edge ring is not contiguous');
    if (next !== ids[0]) ids.push(next);
    current = next;
  }
  return ids;
}

const SHORE = shorelineNodeIds().map((id) => NODE_XZ[id]);

function outerWidth(i: number): number {
  const p = SHORE[i % SHORE.length];
  return BEACH_OUTER_WIDTH + (hash2(p.x * 3.7 + 8.1, p.z * 3.7 - 2.4) - 0.5) * 0.11;
}

function offset(p: { x: number; z: number }, width: number, y: number): Vec3 {
  const radius = Math.hypot(p.x, p.z) || 1;
  return v(p.x + (p.x / radius) * width, y, p.z + (p.z / radius) * width);
}

function coastSample(i: number, t: number): { point: { x: number; z: number }; width: number; dryWidth: number } {
  const a = SHORE[i];
  const b = SHORE[(i + 1) % SHORE.length];
  // Endpoints stay shared with neighboring coastal edges; intermediate samples wobble enough
  // to avoid a ruler-straight shoreline without becoming a saw blade.
  const interior = Math.sin(Math.PI * t);
  const cell = Math.round(t * 6);
  const wobble = (hash2(i * 7.3 + cell * 2.1, i * -3.7 + cell * 5.9) - 0.5) * 0.2 * interior;
  const dryWobble = (hash2(i * 4.1 - cell * 1.7, i * 2.9 + cell * 3.3) - 0.5) * 0.055 * interior;
  return {
    point: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t },
    width: outerWidth(i) + (outerWidth(i + 1) - outerWidth(i)) * t + wobble,
    dryWidth: BEACH_DRY_WIDTH + dryWobble,
  };
}

export interface ShoreWaveField {
  energy: number;
  exposure: number;
  travel: { x: number; z: number };
}

function waveTravel(time: number): { x: number; z: number } {
  // One offshore swell direction governs the whole island. It drifts over minutes rather
  // than spinning around each tile, with two slow oscillations keeping the turn irregular.
  const angle = -0.9 + time * 0.008 + Math.sin(time * 0.021) * 0.45 + Math.sin(time * 0.0063 + 1.7) * 0.32;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}

function angularDistance(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

// A board-wide wave field rather than a shoreline-wide pulse. Waves arrive as a broad front,
// strike the windward coast first, wrap around both flanks with a delay, and leave a quieter
// (but not motionless) lee. Exported so tests can protect that geographic relationship without
// coupling themselves to the generated mesh's vertex order.
export function shoreWaveField(x: number, z: number, time: number): ShoreWaveField {
  const travel = waveTravel(time);
  const shoreAngle = Math.atan2(z, x);
  const windwardAngle = Math.atan2(-travel.z, -travel.x);
  const aroundIsland = angularDistance(shoreAngle, windwardAngle);

  // At this board scale the island creates a readable wave shadow while diffraction still
  // carries a fifth of the offshore energy to the opposite shore.
  const exposure = 0.08 + 0.92 * Math.exp(-aroundIsland * 0.62);
  const projectedDistance = x * travel.x + z * travel.z;
  const side = Math.sign(Math.sin(shoreAngle - windwardAngle));
  const wrapDelay = aroundIsland * 0.82 + side * Math.sin(aroundIsland) * 0.14;
  const carrier = 0.5 + 0.5 * Math.sin(time * 1.42 - projectedDistance * 1.18 - wrapDelay);

  // Sets arrive irregularly: several stronger crests, then a calmer interval. Fine chop is
  // deliberately subordinate to the shared swell so adjacent coast segments remain coherent.
  const setStrength = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(time * 0.19 + Math.sin(time * 0.047) * 1.2));
  const crest = smooth(Math.max(0, Math.min(1, (carrier - 0.27) / 0.73)));
  const chop = Math.sin(time * 2.31 + shoreAngle * 3.1) * 0.025 * exposure;
  const energy = Math.max(0, Math.min(1, 0.025 + exposure * (0.08 + crest * 0.89 * setStrength) + chop));
  return { energy, exposure, travel };
}

function waveEnergy(i: number, t: number, time: number): number {
  const sample = coastSample(i, t);
  return shoreWaveField(sample.point.x, sample.point.z, time).energy;
}

// Where the live water reaches across the beach. High energy moves inward over the wet sand;
// low energy retreats to the irregular outer edge and exposes most of that sand again.
function swashWidth(i: number, t: number, time: number): number {
  const sample = coastSample(i, t);
  const energy = waveEnergy(i, t, time);
  // Retreat almost to open water, but let a strong set wash halfway across the pale sand.
  // The larger range is intentional: at a full-board terminal scale a physically tiny swash
  // collapses to a single character and reads as a static outline.
  const retreat = sample.width + 0.045;
  const runup = sample.dryWidth * 0.52;
  return retreat + (runup - retreat) * energy;
}

let cachedCoast: Mesh | null = null;
export function coastMesh(progress = 1): Mesh {
  const growth = smooth(Math.max(0, Math.min(1, progress)));
  if (growth >= 1 && cachedCoast) return cachedCoast;
  const m = build();
  const subdivisions = 6;
  for (let i = 0; i < SHORE.length; i++) {
    for (let segment = 0; segment < subdivisions; segment++) {
      const a = coastSample(i, segment / subdivisions);
      const b = coastSample(i, (segment + 1) / subdivisions);
      const innerA = v(a.point.x, BEACH_INNER_Y, a.point.z);
      const innerB = v(b.point.x, BEACH_INNER_Y, b.point.z);
      const dryY = BEACH_INNER_Y + (BEACH_DRY_Y - BEACH_INNER_Y) * growth;
      const wetY = BEACH_INNER_Y + (BEACH_WET_Y - BEACH_INNER_Y) * growth;
      const dryA = offset(a.point, a.dryWidth * growth, dryY);
      const dryB = offset(b.point, b.dryWidth * growth, dryY);
      const wetA = offset(a.point, a.width * growth, wetY);
      const wetB = offset(b.point, b.width * growth, wetY);
      const warmth = 0.94 + hash2(i * 1.7 + segment * 3.1 + 4.2, i * -2.3 + segment) * 0.12;
      faceQuadFlat(m, innerA, innerB, dryB, dryA, shade((i + segment) % 4 === 0 ? WARM_SAND : DRY_SAND, warmth), UP);
      faceQuadFlat(m, dryA, dryB, wetB, wetA, shade(WET_SAND, 0.9 + ((i + segment) % 5) * 0.025), UP);
    }
  }
  if (growth >= 1) cachedCoast = m;
  return m;
}

// A shallow strip of the animated sea rendered over the outer beach. Unlike the main water
// plane, its landward boundary moves with the wave field, creating visible run-up/backwash.
export function swashMesh(time: number): Mesh {
  const m = build();
  const subdivisions = 6;
  for (let i = 0; i < SHORE.length; i++) {
    for (let segment = 0; segment < subdivisions; segment++) {
      const ta = segment / subdivisions;
      const tb = (segment + 1) / subdivisions;
      const a = coastSample(i, ta);
      const b = coastSample(i, tb);
      const innerA = offset(a.point, swashWidth(i, ta, time), SWASH_Y);
      const innerB = offset(b.point, swashWidth(i, tb, time), SWASH_Y);
      const outerA = offset(a.point, a.width + 0.12, SWASH_Y - 0.012);
      const outerB = offset(b.point, b.width + 0.12, SWASH_Y - 0.012);
      faceQuadFlat(m, innerA, innerB, outerB, outerA, [255, 255, 255], UP);
    }
  }
  return m;
}

// Three broken foam patches per coastal edge. Their swash position advances a little way up
// and down the wet sand rather than tracing one rigid white outline around the whole board.
export function surfMesh(time: number): Mesh {
  const m = build();
  const patches = 3;
  for (let i = 0; i < SHORE.length; i++) {
    for (let patch = 0; patch < patches; patch++) {
      const energy = waveEnergy(i, (patch + 0.5) / patches, time);
      const breakup = hash2(i * 5.1 + patch * 2.7, i * -1.9 + patch * 4.3);
      if (energy * 0.72 + breakup * 0.5 < 0.48) continue;
      const ta = (patch + 0.07 + breakup * 0.04) / patches;
      const tb = (patch + 0.86 - breakup * 0.07) / patches;
      const a = coastSample(i, ta);
      const b = coastSample(i, tb);
      const innerWidthA = swashWidth(i, ta, time) - 0.012;
      const innerWidthB = swashWidth(i, tb, time) - 0.012;
      const thickness = 0.052 + energy * 0.045;
      const innerA = offset(a.point, innerWidthA, SWASH_Y + 0.025);
      const innerB = offset(b.point, innerWidthB, SWASH_Y + 0.025);
      const outerA = offset(a.point, innerWidthA + thickness, SWASH_Y + 0.022);
      const outerB = offset(b.point, innerWidthB + thickness, SWASH_Y + 0.022);
      faceQuadFlat(m, innerA, innerB, outerB, outerA, shade(FOAM, 0.8 + energy * 0.2), UP);
    }
  }
  return m;
}
