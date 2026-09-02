// The ship's hull and decks, and the mast with its billowing sail and pennant.

import { type Vec3 } from '../../../engine/index.ts';
import { type Build, cross, DOWN, faceQuad, faceQuadFlat, norm, sub, UP, v } from '../build.ts';
import { box } from '../props.ts';
import { AFT_Y, BOW, DECK, DECK_INSET, FLOOR_Y, HULL, HULL_DK, LIP, LIPW, MASTC, SAIL_TAN, SAIL_WHITE, ST_BW, ST_BY, ST_TW, ST_TY, ST_X, STEP } from './spec.ts';

function smoothWall(m: Build, s: number): void {
  const N = ST_X.length;
  const top = ST_X.map((x, i) => v(x, ST_TY[i], s * ST_TW[i]));
  const bot = ST_X.map((x, i) => v(x, ST_BY[i], s * ST_BW[i]));
  const nt = top.map(() => v(0, 0, 0));
  const nb = bot.map(() => v(0, 0, 0));
  const out = v(0, 0.25, s);
  for (let i = 0; i < N - 1; i++) {
    let n = norm(cross(sub(top[i + 1], top[i]), sub(bot[i], top[i])));
    if (n.x * out.x + n.y * out.y + n.z * out.z < 0) n = v(-n.x, -n.y, -n.z);
    for (const acc of [nt[i], nt[i + 1], nb[i], nb[i + 1]]) {
      acc.x += n.x;
      acc.y += n.y;
      acc.z += n.z;
    }
  }
  const col = { x: HULL[0], y: HULL[1], z: HULL[2] };
  const push = (p: Vec3, nn: Vec3): void => void m.vertices.push({ position: { ...p }, normal: norm(nn), uv: [0, 0], color: col });
  for (let i = 0; i < N - 1; i++) {
    const base = m.vertices.length;
    push(top[i], nt[i]);
    push(top[i + 1], nt[i + 1]);
    push(bot[i + 1], nb[i + 1]);
    push(bot[i], nb[i]);
    m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

export function boatHull(m: Build): void {
  const N = ST_X.length;
  const IW = ST_TW.map((w) => Math.max(0.02, w - LIPW)); // inner (deck-opening) half-width
  // The outer wall narrows linearly from the sheer to the keel at each station. A floor lower
  // in the hull must use the width at that height—not the much wider opening at the rim—or its
  // edge pierces the side wall and renders as a horizontal shelf outside the boat.
  const deckWidth = (i: number, y: number): number => {
    const t = Math.max(0, Math.min(1, (y - ST_BY[i]) / (ST_TY[i] - ST_BY[i])));
    const outerAtY = ST_BW[i] + (ST_TW[i] - ST_BW[i]) * t;
    return Math.max(0.02, Math.min(IW[i], outerAtY - DECK_INSET));
  };
  // Outer side walls (smooth-shaded) + the lip band on top, both sides.
  smoothWall(m, 1);
  smoothWall(m, -1);
  for (let i = 0; i < N - 1; i++) {
    for (const s of [1, -1]) {
      faceQuadFlat(m, v(ST_X[i], ST_TY[i], s * ST_TW[i]), v(ST_X[i + 1], ST_TY[i + 1], s * ST_TW[i + 1]), v(ST_X[i + 1], ST_TY[i + 1], s * IW[i + 1]), v(ST_X[i], ST_TY[i], s * IW[i]), LIP, UP);
    }
  }
  // Stern gunwale: bridge the two side lips with a real fore-aft surface. The former end
  // "lip" varied only in Z, so all four points were collinear and rendered as a paper edge.
  const sternLipT = Math.min(1, LIPW / (ST_X[1] - ST_X[0]));
  const sternLipX = ST_X[0] + (ST_X[1] - ST_X[0]) * sternLipT;
  const sternLipY = ST_TY[0] + (ST_TY[1] - ST_TY[0]) * sternLipT;
  const sternLipW = ST_TW[0] + (ST_TW[1] - ST_TW[0]) * sternLipT;
  faceQuadFlat(
    m,
    v(ST_X[0], ST_TY[0], ST_TW[0]),
    v(sternLipX, sternLipY, sternLipW),
    v(sternLipX, sternLipY, -sternLipW),
    v(ST_X[0], ST_TY[0], -ST_TW[0]),
    LIP,
    UP,
  );
  // Keel underside.
  for (let i = 0; i < N - 1; i++) {
    faceQuadFlat(m, v(ST_X[i], ST_BY[i], ST_BW[i]), v(ST_X[i + 1], ST_BY[i + 1], ST_BW[i + 1]), v(ST_X[i + 1], ST_BY[i + 1], -ST_BW[i + 1]), v(ST_X[i], ST_BY[i], -ST_BW[i]), HULL_DK, DOWN);
  }
  // Bow & stern end caps.
  for (const e of [0, N - 1]) {
    const nx = e === 0 ? -1 : 1;
    faceQuadFlat(m, v(ST_X[e], ST_TY[e], ST_TW[e]), v(ST_X[e], ST_BY[e], ST_BW[e]), v(ST_X[e], ST_BY[e], -ST_BW[e]), v(ST_X[e], ST_TY[e], -ST_TW[e]), HULL, v(nx, 0.25, 0));
  }
  // Helper: a lofted deck floor between two stations at height `y`, plus the short inner
  // bulwark walls from that floor up to the rim on both sides.
  // Inner bulwark walls use the lit DECK tone (not the dark keel color): they face inward/away
  // from the key, so a dark color made them read as a black gouge across the open deck.
  const deckSeg = (i: number, y: number): void => {
    const wi = deckWidth(i, y);
    const wj = deckWidth(i + 1, y);
    faceQuadFlat(m, v(ST_X[i], y, wi), v(ST_X[i + 1], y, wj), v(ST_X[i + 1], y, -wj), v(ST_X[i], y, -wi), DECK, UP);
    for (const s of [1, -1]) {
      faceQuadFlat(m, v(ST_X[i], ST_TY[i], s * IW[i]), v(ST_X[i + 1], ST_TY[i + 1], s * IW[i + 1]), v(ST_X[i + 1], y, s * wj), v(ST_X[i], y, s * wi), DECK, v(0, 0.2, -s));
    }
  };
  // Raised aft deck (poop) from the stern to the step — a solid deck flush inside the hull.
  for (let i = 0; i < STEP; i++) deckSeg(i, AFT_Y);
  // Step riser: the front face of the poop deck, down to the well.
  const stepAftW = deckWidth(STEP, AFT_Y);
  const stepFloorW = deckWidth(STEP, FLOOR_Y);
  faceQuadFlat(m, v(ST_X[STEP], AFT_Y, stepAftW), v(ST_X[STEP], AFT_Y, -stepAftW), v(ST_X[STEP], FLOOR_Y, -stepFloorW), v(ST_X[STEP], FLOOR_Y, stepFloorW), DECK, v(1, 0.2, 0));
  // Open cargo well from the step to the bow.
  for (let i = STEP; i < BOW; i++) deckSeg(i, FLOOR_Y);
  // Bow bulkhead + a small solid foredeck capping the prow (so there's no hole at the tip).
  const bowFloorW = deckWidth(BOW, FLOOR_Y);
  faceQuadFlat(m, v(ST_X[BOW], ST_TY[BOW], IW[BOW]), v(ST_X[BOW], ST_TY[BOW], -IW[BOW]), v(ST_X[BOW], FLOOR_Y, -bowFloorW), v(ST_X[BOW], FLOOR_Y, bowFloorW), DECK, v(-1, 0.2, 0));
  for (let i = BOW; i < N - 1; i++) {
    faceQuadFlat(m, v(ST_X[i], ST_TY[i], IW[i]), v(ST_X[i + 1], ST_TY[i + 1], IW[i + 1]), v(ST_X[i + 1], ST_TY[i + 1], -IW[i + 1]), v(ST_X[i], ST_TY[i], -IW[i]), DECK, UP);
  }
}

// Mast + billowing sail + masthead pennant, stepped on the raised aft deck so the open bow
// well ahead of it carries the cargo, as in the reference ships.
const MAST_X = -0.3;
const MAST_BASE = 0.34;
const MAST_H = 1.14;
// Sail: a wide, fairly flat billboard (it carries the projected trade-info chip). PORT_SAIL_CENTER
// is the world-space anchor the chip projects onto. Its Y sits a touch above the geometric midpoint:
// the sail billows more at the foot than the head, so the closer, larger lower half eats more screen
// rows in perspective and drags the visible center down — biasing the anchor up re-centers the chip.
const SAIL_HALFW = 0.44;
const SAIL_BOT = 0.64;
const SAIL_TOP = 1.3;
const SAIL_BILLOW = 0.14;
export const PORT_SAIL_CENTER = { x: MAST_X + SAIL_BILLOW * 0.775, y: SAIL_BOT + (SAIL_TOP - SAIL_BOT) * 0.6, z: 0 };
export function boatRig(m: Build): void {
  const topY = MAST_BASE + MAST_H;
  box(m, MAST_X, 0, 0.045, MAST_H, 0.045, MASTC, 0, MAST_BASE);
  // Sail: a grid in the Y–Z plane hanging from the upper mast, bulging toward the bow (+x) —
  // more at the foot than the head — so it reads as wind-filled fabric. One consistent color.
  const halfW = SAIL_HALFW;
  const botY = SAIL_BOT;
  const topSailY = SAIL_TOP;
  const nz = 4;
  const ny = 3;
  const billow = SAIL_BILLOW;
  const P: Vec3[][] = [];
  for (let iy = 0; iy <= ny; iy++) {
    const ty = iy / ny;
    const y = botY + (topSailY - botY) * ty;
    const row: Vec3[] = [];
    for (let iz = 0; iz <= nz; iz++) {
      const tz = iz / nz;
      const hump = Math.sin(Math.PI * tz); // 0 at the luff/leech edges, 1 in the belly
      const x = MAST_X + billow * hump * (0.55 + 0.45 * (1 - ty));
      row.push(v(x, y, -halfW + 2 * halfW * tz));
    }
    P.push(row);
  }
  for (let iy = 0; iy < ny; iy++) {
    for (let iz = 0; iz < nz; iz++) {
      faceQuadFlat(m, P[iy][iz], P[iy][iz + 1], P[iy + 1][iz + 1], P[iy + 1][iz], SAIL_WHITE, v(1, 0, 0));
    }
  }
  // A thin spar across the head of the sail, and a small swallowtail pennant above it.
  box(m, MAST_X, 0, 0.03, 0.03, 2 * halfW + 0.04, MASTC, 0, topSailY - 0.02);
  const fy = topY;
  faceQuad(m, v(MAST_X, fy, 0), v(MAST_X - 0.22, fy - 0.02, 0), v(MAST_X - 0.16, fy - 0.09, 0), v(MAST_X, fy - 0.13, 0), SAIL_TAN, v(0, 0, 1));
}

// An octagonal capped log between arbitrary 3D endpoints. The ordinary `logBeam` rests
// horizontally on a surface; this variant lets a felled tree pitch upward as it leans across
// other cargo while keeping its trunk exactly aligned with the foliage axis.
