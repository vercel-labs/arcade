// The paired wooden jetty arms that identify a harbor's two usable coastal intersections.
// These are world-space board geometry; the harbor boats themselves remain reusable local
// meshes rendered with their individual transforms.

import { type Mesh, type Vec3 } from '../../../../../engine/index.ts';
import { build, faceQuad, faceQuadFlat, norm, shade, sub, UP, v, type Build, type RGB } from '../../../../../game-visuals/catan/build.ts';
import { type HarborConnector } from '../../scene/harbors.ts';

const DECK: RGB = [202, 137, 55];
const EDGE: RGB = [126, 78, 35];
const SEAM: RGB = [111, 67, 31];
const SHORE_Y = -0.08;
const VESSEL_Y = -0.035;
const WALKWAY_WIDTH = 0.12;
const WALKWAY_THICKNESS = 0.045;

function pointAlong(a: Vec3, b: Vec3, t: number): Vec3 {
  return v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

function walkway(m: Build, shore: { x: number; z: number }, vessel: { x: number; z: number }): void {
  const a = v(shore.x, SHORE_Y, shore.z);
  const b = v(vessel.x, VESSEL_Y, vessel.z);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const px = (-dz / len) * WALKWAY_WIDTH * 0.5;
  const pz = (dx / len) * WALKWAY_WIDTH * 0.5;
  const down = v(0, -WALKWAY_THICKNESS, 0);
  const aL = v(a.x + px, a.y, a.z + pz);
  const aR = v(a.x - px, a.y, a.z - pz);
  const bL = v(b.x + px, b.y, b.z + pz);
  const bR = v(b.x - px, b.y, b.z - pz);
  const aLd = v(aL.x, aL.y + down.y, aL.z);
  const aRd = v(aR.x, aR.y + down.y, aR.z);
  const bLd = v(bL.x, bL.y + down.y, bL.z);
  const bRd = v(bR.x, bR.y + down.y, bR.z);

  faceQuadFlat(m, aL, bL, bR, aR, DECK, UP);
  faceQuad(m, aLd, bLd, bL, aL, EDGE, norm(v(px, 0, pz)));
  faceQuad(m, aR, bR, bRd, aRd, shade(EDGE, 0.86), norm(v(-px, 0, -pz)));
  faceQuad(m, aRd, bRd, bLd, aLd, shade(EDGE, 0.72), v(0, -1, 0));

  // Dark cross-seams split the warm deck into the broad boards used by the online harbor
  // reference. They read as actual planks instead of bright stripes painted onto one beam.
  for (let i = 1; i <= 6; i++) {
    const t = i / 7;
    const c = pointAlong(a, b, t);
    const along = v(dx / len, (b.y - a.y) / len, dz / len);
    const halfAlong = 0.009;
    faceQuadFlat(
      m,
      v(c.x + px - along.x * halfAlong, c.y + 0.004, c.z + pz - along.z * halfAlong),
      v(c.x + px + along.x * halfAlong, c.y + 0.004, c.z + pz + along.z * halfAlong),
      v(c.x - px + along.x * halfAlong, c.y + 0.004, c.z - pz + along.z * halfAlong),
      v(c.x - px - along.x * halfAlong, c.y + 0.004, c.z - pz - along.z * halfAlong),
      SEAM,
      UP,
    );
  }
}

export function harborPiersMesh(connectors: readonly HarborConnector[], progress = 1): Mesh {
  const m = build();
  const extension = Math.max(0, Math.min(1, progress));
  if (extension <= 0) return m;
  for (const connector of connectors) {
    walkway(m, connector.shoreA, pointAlong(v(connector.shoreA.x, SHORE_Y, connector.shoreA.z), v(connector.vesselA.x, VESSEL_Y, connector.vesselA.z), extension));
    walkway(m, connector.shoreB, pointAlong(v(connector.shoreB.x, SHORE_Y, connector.shoreB.z), v(connector.vesselB.x, VESSEL_Y, connector.vesselB.z), extension));
  }
  return m;
}
