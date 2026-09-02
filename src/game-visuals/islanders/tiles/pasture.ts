// The pasture tile: fenced meadow with trees and bushes, plus the overlay that walks its
// sheep across the baked terrain surface.

import type { Mesh } from '../../../engine/mesh.ts';
import { mulberry32 } from '../../../engine/random.ts';
import { surfaceY, tileBase } from '../base.ts';
import { build, type Build, type RGB, smooth } from '../build.ts';
import { bush, roundTree, sheep } from '../nature.ts';
import { scatter } from '../props.ts';

interface PastureSheepSpec {
  x: number;
  z: number;
  seed: number;
  pathAngle: number;
  amplitude: number;
  phase: number;
  cycle: number;
}

interface PastureTreeSpec {
  x: number;
  z: number;
  scale: number;
  seed: number;
}

interface PastureBushSpec extends PastureTreeSpec {}

interface PastureLayout {
  sheep: PastureSheepSpec[];
  trees: PastureTreeSpec[];
  bushes: PastureBushSpec[];
}

function pastureLayout(seed: number): PastureLayout {
  const rng = mulberry32((Math.abs(seed) * 374761393 + 0x9e3779b9) >>> 0 || 1);
  const sheepCount = 3 + Math.floor(rng() * 2);
  const treeCount = 2 + Math.floor(rng() * 2);
  const bushCount = 3 + Math.floor(rng() * 3);
  const pts = scatter(rng, sheepCount + treeCount + bushCount, 0.68, 0.28, (x, z) => Math.hypot(x, z) > 0.22);
  let i = 0;
  const take = (): { x: number; z: number } | undefined => pts[i++];
  const sheepSpecs: PastureSheepSpec[] = [];
  for (let s = 0; s < sheepCount; s++) {
    const p = take();
    if (!p) break;
    sheepSpecs.push({
      ...p,
      seed: (seed * 23 + i) | 0,
      pathAngle: rng() * Math.PI * 2,
      amplitude: 0.068 + rng() * 0.022,
      phase: rng(),
      cycle: 11.5 + rng() * 4.5,
    });
  }
  const trees: PastureTreeSpec[] = [];
  for (let t = 0; t < treeCount; t++) {
    const p = take();
    if (!p) break;
    trees.push({ ...p, scale: 0.36 + rng() * 0.12, seed: (seed * 13 + i) | 0 });
  }
  const bushes: PastureBushSpec[] = [];
  for (let b = 0; b < bushCount; b++) {
    const p = take();
    if (!p) break;
    bushes.push({ ...p, scale: 0.48 + rng() * 0.32, seed: (seed * 17 + i) | 0 });
  }
  return { sheep: sheepSpecs, trees, bushes };
}

interface MovingSheep {
  x: number;
  z: number;
  yaw: number;
  gait: number;
  headDip: number;
  moving: number;
}

function sheepMotion(spec: PastureSheepSpec, time: number): MovingSheep {
  const forward = { x: Math.cos(spec.pathAngle), z: Math.sin(spec.pathAngle) };
  const side = { x: -forward.z, z: forward.x };
  const point = (f: number, s: number): { x: number; z: number } => ({
    x: spec.x + (forward.x * f + side.x * s) * spec.amplitude,
    z: spec.z + (forward.z * f + side.z * s) * spec.amplitude,
  });
  const points = [point(-0.62, -0.12), point(0.62, 0.2), point(-0.08, 0.72)] as const;
  const p = (((time / spec.cycle + spec.phase) % 1) + 1) % 1;
  let from = points[0];
  let to = points[1];
  let progress = 0;
  let moving = 0;
  let headDip = 0;
  if (p < 0.27) {
    progress = p / 0.27;
    moving = 1;
  } else if (p < 0.39) {
    from = points[1];
    to = points[1];
  } else if (p < 0.58) {
    from = points[1];
    to = points[2];
    progress = (p - 0.39) / 0.19;
    moving = 1;
  } else if (p < 0.78) {
    from = points[2];
    to = points[2];
    const graze = (p - 0.58) / 0.2;
    headDip = smooth(Math.min(graze / 0.2, (1 - graze) / 0.2));
  } else if (p < 0.94) {
    from = points[2];
    to = points[0];
    progress = (p - 0.78) / 0.16;
    moving = 1;
  } else {
    from = points[0];
    to = points[0];
  }
  const eased = smooth(progress);
  const x = from.x + (to.x - from.x) * eased;
  const z = from.z + (to.z - from.z) * eased;
  // Hold the just-travelled heading through a pause or grazing stop; do not snap back to the
  // seed angle merely because the current segment has zero length.
  const heading = (fromPoint: { x: number; z: number }, toPoint: { x: number; z: number }): number => Math.atan2(toPoint.z - fromPoint.z, toPoint.x - fromPoint.x);
  const h01 = heading(points[0], points[1]);
  const h12 = heading(points[1], points[2]);
  const h20 = heading(points[2], points[0]);
  const turn = (a: number, b: number, amount: number): number => {
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + delta * smooth(amount);
  };
  const yaw = p < 0.27
    ? h01
    : p < 0.39
      ? turn(h01, h12, (p - 0.27) / 0.12)
      : p < 0.68
        ? h12
        : p < 0.78
          ? turn(h12, h20, (p - 0.68) / 0.1)
          : p < 0.94
            ? h20
            : turn(h20, h01, (p - 0.94) / 0.06);
  const gaitEnvelope = moving ? Math.sin(progress * Math.PI) : 0;
  const gait = gaitEnvelope * Math.sin((time / spec.cycle) * Math.PI * 18 + spec.phase * Math.PI * 2);
  return { x, z, yaw, gait, headDip, moving };
}

function sheepBodyRadius(seed: number): number {
  const rng = mulberry32(seed | 0 || 1);
  return (0.437 + rng() * 0.138) * 0.225;
}

// Intersect a vertical probe with the already-baked meadow triangles. This follows the actual
// piecewise-planar surface the player sees, rather than resampling the procedural vertex noise
// at a moving coordinate (which made a walking sheep jump between unrelated noise values).
function meshSurfaceYAt(mesh: Mesh, x: number, z: number, fallback: number): number {
  let best = Infinity;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.vertices[mesh.indices[i]];
    const b = mesh.vertices[mesh.indices[i + 1]];
    const c = mesh.vertices[mesh.indices[i + 2]];
    if (a.normal.y < 0.45 || b.normal.y < 0.45 || c.normal.y < 0.45) continue;
    const ax = a.position.x;
    const az = a.position.z;
    const bx = b.position.x;
    const bz = b.position.z;
    const cx = c.position.x;
    const cz = c.position.z;
    const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(denominator) < 1e-9) continue;
    const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
    const wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator;
    const wc = 1 - wa - wb;
    if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
    const y = wa * a.position.y + wb * b.position.y + wc * c.position.y;
    if (y < best) best = y;
  }
  return best === Infinity ? fallback : best;
}

// `meadow` is this tile's baked static mesh, passed in by the caller that owns the tile cache:
// the sheep walk on the terrain surface, which is read back off those triangles.
export function animatedPastureTile(seed: number, time: number, meadow: Mesh, reuse?: Build): Build {
  const m = build(reuse);
  const layout = pastureLayout(seed);
  const amp = 0.15;
  const gseed = seed + 1.9;
  const hAt = (x: number, z: number): number => meshSurfaceYAt(meadow, x, z, surfaceY(x, z, amp, gseed));
  const obstacles = [
    ...layout.trees.map((tree) => ({ x: tree.x, z: tree.z, radius: 0.26 * tree.scale + 0.025 })),
    ...layout.bushes.map((bushSpec) => ({ x: bushSpec.x, z: bushSpec.z, radius: 0.16 * bushSpec.scale + 0.025 })),
  ];
  const placed: { x: number; z: number; radius: number }[] = [];
  for (const spec of layout.sheep) {
    const target = sheepMotion(spec, time);
    const radius = sheepBodyRadius(spec.seed);
    const reserved = layout.sheep
      .filter((other) => other !== spec)
      .map((other) => ({ x: other.x, z: other.z, radius: sheepBodyRadius(other.seed) }));
    const clear = (x: number, z: number): boolean => [...obstacles, ...reserved, ...placed].every((disc) => Math.hypot(x - disc.x, z - disc.z) >= radius + disc.radius);
    let factor = 0;
    // Each sheep owns a small motion cell around a pre-spaced anchor. If a long body or nearby
    // shrub narrows that cell, shorten this step toward the guaranteed-clear anchor instead of
    // allowing bodies to phase through one another or scenery.
    for (let step = 0; step <= 20; step++) {
      const candidate = 1 - step / 20;
      const x = spec.x + (target.x - spec.x) * candidate;
      const z = spec.z + (target.z - spec.z) * candidate;
      if (clear(x, z)) {
        factor = candidate;
        break;
      }
    }
    const x = spec.x + (target.x - spec.x) * factor;
    const z = spec.z + (target.z - spec.z) * factor;
    placed.push({ x, z, radius });
    sheep(m, x, z, hAt(x, z), target.yaw, spec.seed, 1, {
      gait: target.gait * factor,
      headDip: target.headDip,
      groundY: hAt,
    });
  }
  return m;
}

export function pastureTile(seed: number): Build {
  const m = build();
  const GRASS: RGB = [150, 200, 148];
  const CANOPY: RGB = [116, 158, 104];
  const BUSH: RGB = [86, 132, 78]; // darker + smaller than tree canopies, so clearly distinct
  const amp = 0.15; // clearly rolling meadow (was too flat)
  const gseed = seed + 1.9;
  tileBase(m, { color: GRASS, amp, seed: gseed });
  const hAt = (x: number, z: number): number => surfaceY(x, z, amp, gseed);
  const layout = pastureLayout(seed);
  // Sheep are a small dynamic overlay; the rolling ground and vegetation remain cached.
  // Small trees — only a bit taller than a sheep, like the reference (canopy ~0.1 radius).
  for (const tree of layout.trees) {
    roundTree(m, tree.x, tree.z, hAt(tree.x, tree.z), tree.scale, CANOPY, tree.seed);
  }
  for (const bushSpec of layout.bushes) {
    bush(m, bushSpec.x, bushSpec.z, hAt(bushSpec.x, bushSpec.z), bushSpec.scale, BUSH, bushSpec.seed);
  }
  return m;
}

// ORE — the whole tile is ONE raised rocky massif (not flat ground + spikes): a plateau that
// rises from the rim, several summit bumps, strong per-vertex jitter for angular rock facets,
// flat-shaded grey, with the highest facets capped in snow.
// Several distinct ROUNDED rock mounds (local maxima) spread across the tile, fused above a
// modest base lift into one massif — a bit shorter and more varied than a single dome. Snow
// only reaches the tallest one or two.
// Generate the mound set from a seeded RNG so every ore tile shares the STYLE but differs:
// an irregular, clustered group of VARIED width/height mounds — one big broad mound, a couple
// of taller narrow peaks (which catch the snow), and a few smaller bumps, scattered with a
// minimum gap. On a real board each ore hex would seed this from its position.
