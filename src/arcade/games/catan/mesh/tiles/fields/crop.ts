// The wheat crop surface: harvested rows, the standing canopy, and individual stalks.

import { type Build, faceQuadFlat, faceQuadWithNormal, hash2, type RGB, shade, smooth, UP, v } from '../../build.ts';
import { fieldCoverage, type FieldLayout, fieldRowPoint, harvestedFieldCoverage, insideFieldHex } from './layout.ts';
import { stubbleTuft, wheatStalk, wheatTuft } from './props.ts';

export function harvestedRows(m: Build, layout: FieldLayout, soilY: (x: number, z: number) => number, color: RGB, seed: number): void {
  const count = 33;
  const segments = 28;
  for (let k = 0; k < count; k++) {
    const row = k - (count - 1) / 2;
    for (let i = 0; i < segments; i++) {
      const u0 = -1.02 + (2.04 * i) / segments;
      const u1 = -1.02 + (2.04 * (i + 1)) / segments;
      const a = fieldRowPoint(layout, row, u0);
      const b = fieldRowPoint(layout, row, u1);
      if (!insideFieldHex(a.x, a.z) || !insideFieldHex(b.x, b.z)) continue;
      const midX = (a.x + b.x) / 2;
      const midZ = (a.z + b.z) / 2;
      if (harvestedFieldCoverage(layout, midX, midZ) < 0.48) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const wx = (-dz / len) * 0.024;
      const wz = (dx / len) * 0.024;
      const leftA = v(a.x - wx, soilY(a.x - wx, a.z - wz) + 0.004, a.z - wz);
      const crestA = v(a.x, soilY(a.x, a.z) + 0.021, a.z);
      const rightA = v(a.x + wx, soilY(a.x + wx, a.z + wz) + 0.004, a.z + wz);
      const leftB = v(b.x - wx, soilY(b.x - wx, b.z - wz) + 0.004, b.z - wz);
      const crestB = v(b.x, soilY(b.x, b.z) + 0.021, b.z);
      const rightB = v(b.x + wx, soilY(b.x + wx, b.z + wz) + 0.004, b.z + wz);
      const col = shade(color, 0.94 + ((k + i) % 3) * 0.035);
      faceQuadFlat(m, leftA, leftB, crestB, crestA, col, UP);
      faceQuadFlat(m, crestA, crestB, rightB, rightA, shade(col, 1.05), UP);

      if ((i + k) % 2 === 0) {
        stubbleTuft(m, midX, midZ, soilY(midX, midZ) + 0.018, layout.rowAngle, seed + k * 37 + i * 11);
      }
    }
  }
}

// A low corrugated under-canopy gives the standing crop enough continuous golden coverage to
// survive board-distance rasterization. It follows the same curved rows and harvested mask as
// the stalks, so it never becomes a rectangular pad; individual tufts still provide the close
// silhouette and grain detail above it.
export function standingCanopy(m: Build, layout: FieldLayout, soilY: (x: number, z: number) => number, color: RGB): void {
  const rows = 33;
  const segments = 30;
  for (let k = 0; k < rows; k++) {
    const row = k - (rows - 1) / 2;
    for (let i = 0; i < segments; i++) {
      const u0 = -1.02 + (2.04 * i) / segments;
      const u1 = -1.02 + (2.04 * (i + 1)) / segments;
      const a = fieldRowPoint(layout, row, u0);
      const b = fieldRowPoint(layout, row, u1);
      if (!insideFieldHex(a.x, a.z) || !insideFieldHex(b.x, b.z)) continue;
      const wa = smooth((fieldCoverage(layout, a.x, a.z) - 0.44) / 0.28);
      const wb = smooth((fieldCoverage(layout, b.x, b.z) - 0.44) / 0.28);
      if (wa < 0.04 && wb < 0.04) continue;

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const half = layout.spacing * 0.51;
      const wx = (-dz / len) * half;
      const wz = (dx / len) * half;
      const edgeA = soilY(a.x, a.z) + 0.009 + wa * 0.021;
      const crestA = soilY(a.x, a.z) + 0.009 + wa * 0.046;
      const edgeB = soilY(b.x, b.z) + 0.009 + wb * 0.021;
      const crestB = soilY(b.x, b.z) + 0.009 + wb * 0.046;
      const leftA = v(a.x - wx, edgeA, a.z - wz);
      const midA = v(a.x, crestA, a.z);
      const rightA = v(a.x + wx, edgeA, a.z + wz);
      const leftB = v(b.x - wx, edgeB, b.z - wz);
      const midB = v(b.x, crestB, b.z);
      const rightB = v(b.x + wx, edgeB, b.z + wz);
      const band = shade(color, 0.97 + ((k + i) % 3) * 0.025);
      const px = wx / half;
      const pz = wz / half;
      faceQuadWithNormal(m, leftA, leftB, midB, midA, shade(band, 0.98), v(-px * 0.24, 1, -pz * 0.24));
      faceQuadWithNormal(m, midA, midB, rightB, rightA, shade(band, 1.035), v(px * 0.24, 1, pz * 0.24));
    }
  }
}

// Dense, individually modelled stalks fill every unharvested portion of the tile. Their rows
// follow the same gentle curves as the stubble, so the cut and standing crop read as one field.
export function standingWheat(m: Build, layout: FieldLayout, soilY: (x: number, z: number) => number, seed: number): void {
  const rows = 33;
  const along = 41;
  for (let k = 0; k < rows; k++) {
    const row = k - (rows - 1) / 2;
    for (let i = 0; i < along; i++) {
      const jitter = hash2(i * 3.7 + seed, k * 5.1 - seed);
      const u = -0.98 + (1.96 * (i + 0.5 + (jitter - 0.5) * 0.62)) / along;
      const q = fieldRowPoint(layout, row, u);
      const acrossJitter = (hash2(i * 5.9 - seed, k * 3.3 + seed) - 0.5) * 0.03;
      q.x -= Math.sin(layout.rowAngle) * acrossJitter;
      q.z += Math.cos(layout.rowAngle) * acrossJitter;
      const coverage = fieldCoverage(layout, q.x, q.z);
      if (!insideFieldHex(q.x, q.z) || coverage < 0.48) continue;
      const r = Math.hypot(q.x, q.z);
      if (r < 0.205) continue;
      const h = 0.112 + hash2(i * 11.3 + seed, k * 8.7 - seed) * 0.032;
      const lean = layout.rowAngle + (hash2(i - seed * 0.7, k + seed * 0.3) - 0.5) * 0.34;
      const stalkSeed = seed + k * 43 + i * 17;
      const y0 = soilY(q.x, q.z) + 0.006;
      if (coverage < 0.76 || r > 0.72) wheatStalk(m, q.x, q.z, y0, h, lean, stalkSeed);
      else wheatTuft(m, q.x, q.z, y0, h, lean, stalkSeed);
    }
  }
}


