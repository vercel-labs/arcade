// What a 2:1 port carries on deck — one load per traded resource, sized so it nearly fills the
// open well. Grain rides as tied wheat sheaves; a 3:1 (generic) ship carries nothing.

import { type Vec3 } from '../../../../../engine/index.ts';
import { mulberry32 } from '../../../../scenes/wisp.ts';
import { type Build, cross, faceQuadFlat, faceTriWithNormal, norm, type RGB, shade, UP, v } from '../build.ts';
import { felledPine, PINE_GREENS, sheep } from '../nature.ts';
import { angularRock, box } from '../props.ts';
import { FLOOR_Y, type PortKind } from './spec.ts';

// ── Sheaves (the grain port's cargo) ────────────────────────────────────────
// A sheaf is a bundle of cut stalks corded at the waist, so it flares at both ends and pinches
// in the middle — the bowtie silhouette of the physical wheat token. Built around an arbitrary
// axis so bundles can lie on their sides at any angle, the way a load settles in a hold.
const STRAW: RGB = [226, 184, 84]; // stalk sides
const STRAW_CUT: RGB = [242, 216, 152]; // the packed disc of cut ends at the butt
const STRAW_HEAD: RGB = [208, 156, 66]; // the grain end, browner than the straw
const TWINE: RGB = [124, 84, 46]; // the cord — dark enough to draw the waist as a line

// Bundle radius at `t` along its length (0 = butt, 1 = grain end). The exponent makes the flare
// concave: stalks splay quickly near the ends and stay gathered through the tie.
const sheafRadius = (t: number, waist: number, end: number): number => waist + (end - waist) * Math.abs(2 * t - 1) ** 2;

function wheatBundle(m: Build, cx: number, cy: number, cz: number, yaw: number, pitch: number, len: number, endR: number, seed: number): void {
  const rng = mulberry32(seed | 0 || 1);
  const cp = Math.cos(pitch);
  const axis = norm(v(Math.cos(yaw) * cp, Math.sin(pitch), Math.sin(yaw) * cp));
  const ref: Vec3 = Math.abs(axis.y) > 0.9 ? v(1, 0, 0) : UP;
  const u = norm(cross(axis, ref));
  const w = norm(cross(axis, u));
  const waist = endR * 0.42;
  const STALKS = 12;
  const SEGS = 4;
  // A point `t` along the axis, `ang` around it, `r` out from it, slid `tan` across (tangentially)
  // — enough to lay a narrow ribbon along each stalk.
  const at = (t: number, ang: number, r: number, tan = 0): Vec3 => {
    const d = (t - 0.5) * len;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const ru = ca * r - sa * tan;
    const rw = sa * r + ca * tan;
    return v(cx + axis.x * d + u.x * ru + w.x * rw, cy + axis.y * d + u.y * ru + w.y * rw, cz + axis.z * d + u.z * ru + w.z * rw);
  };
  const radial = (ang: number): Vec3 => norm(v(u.x * Math.cos(ang) + w.x * Math.sin(ang), u.y * Math.cos(ang) + w.y * Math.sin(ang), u.z * Math.cos(ang) + w.z * Math.sin(ang)));

  // Whole-bundle tint, so a stack doesn't read as one repeated object.
  const tint = 0.93 + rng() * 0.15;
  // Each stalk is its own ribbon, lit from its own radial normal, so the bundle reads as ribbed
  // straw instead of one smooth spindle. Per-stalk flare keeps the flared ends off-round, and
  // each ribbon overruns the cap by its own margin so the cut ends bristle instead of lining up
  // on a machined plane.
  for (let i = 0; i < STALKS; i++) {
    const ang = (Math.PI * 2 * i) / STALKS + (rng() - 0.5) * 0.14;
    const flare = 0.88 + rng() * 0.24;
    const tone = shade(STRAW, tint * (0.84 + rng() * 0.28));
    const n = radial(ang);
    const from = -rng() * 0.055;
    const span = 1 - from + rng() * 0.06;
    for (let s = 0; s < SEGS; s++) {
      const t0 = from + (span * s) / SEGS;
      const t1 = from + (span * (s + 1)) / SEGS;
      const r0 = sheafRadius(t0, waist, endR) * flare;
      const r1 = sheafRadius(t1, waist, endR) * flare;
      // Ribbons cover most of the spacing between stalks, so the bundle stays solid where it
      // splays and the leftover seams read as ribs rather than gaps into a hollow shell.
      const hw0 = ((Math.PI * r0) / STALKS) * 0.88;
      const hw1 = ((Math.PI * r1) / STALKS) * 0.88;
      faceQuadFlat(m, at(t0, ang, r0, -hw0), at(t0, ang, r0, hw0), at(t1, ang, r1, hw1), at(t1, ang, r1, -hw1), tone, n);
    }
  }

  // Both ends are capped so the bundle isn't hollow seen end-on: a nearly flat pale disc of cut
  // stalks at the butt, a blunt dome of grain at the far end. Normals lean out from the axis
  // toward the rim so the grain end rounds off instead of reading as one flat plate. Each rim
  // point also rides in or out along the axis, which breaks the disc off a clean plane; the
  // points are shared between neighbouring wedges so that jitter can't tear it open.
  for (const end of [0, 1]) {
    const sides = 12;
    const rEnd = sheafRadius(end, waist, endR);
    const out = end === 0 ? -1 : 1;
    const rim = Array.from({ length: sides }, (_, i) => {
      const p = at(end, (Math.PI * 2 * i) / sides, rEnd * (0.88 + rng() * 0.18));
      const lift = out * rEnd * (rng() - 0.45) * 0.34;
      return v(p.x + axis.x * lift, p.y + axis.y * lift, p.z + axis.z * lift);
    });
    const bulge = rEnd * (end === 0 ? 0.08 : 0.2) * out;
    const c = at(end, 0, 0);
    const hub = v(c.x + axis.x * bulge, c.y + axis.y * bulge, c.z + axis.z * bulge);
    const base = end === 0 ? STRAW_CUT : STRAW_HEAD;
    for (let i = 0; i < sides; i++) {
      const rad = radial((Math.PI * 2 * (i + 0.5)) / sides);
      const n = norm(v(axis.x * out * 0.85 + rad.x * 0.55, axis.y * out * 0.85 + rad.y * 0.55, axis.z * out * 0.85 + rad.z * 0.55));
      faceTriWithNormal(m, hub, rim[i], rim[(i + 1) % sides], shade(base, tint * (0.9 + rng() * 0.2)), n);
    }
  }

  // The cord: two wraps cinching the waist, standing clear of the pinched stalks so the dark
  // band draws a line across the bundle at the size this is actually seen.
  const bandR = waist * 1.3;
  for (const bt of [0.42, 0.58]) {
    const sides = 10;
    for (let i = 0; i < sides; i++) {
      const a0 = (Math.PI * 2 * i) / sides;
      const a1 = (Math.PI * 2 * (i + 1)) / sides;
      faceQuadFlat(m, at(bt - 0.05, a0, bandR), at(bt + 0.05, a0, bandR), at(bt + 0.05, a1, bandR), at(bt - 0.05, a1, bandR), shade(TWINE, 0.88 + (i % 2) * 0.22), radial((a0 + a1) / 2));
    }
  }
}

// Cargo for a 2:1 port: a large load of that resource filling the open bow deck ahead of the
// mast (the generic 3:1 ship carries nothing). Sized to the reference — the load nearly fills
// the deck.
export function boatCargo(m: Build, kind: PortKind, seed: number): void {
  const y = FLOOR_Y;
  if (kind === 'grain') {
    // Sheaves pitched into the well: four laid across the floor, two more settled into the seams
    // between them, each at its own angle. `rest` sits a bundle's flared ends on what's below it —
    // the second layer rides a seam, so it clears the floor by less than a full bundle width.
    // Lengths and offsets keep each bundle's flared ends inside the well floor, which narrows
    // sharply toward the bow — overrun the floor and an end pokes out through the planking.
    const rest = (endR: number, on = 0): number => y + on + endR * 0.92;
    wheatBundle(m, -0.12, rest(0.086), 0.02, 1.18, 0.03, 0.28, 0.086, seed + 1);
    wheatBundle(m, 0.05, rest(0.098), -0.07, 1.48, 0.02, 0.33, 0.098, seed + 5);
    wheatBundle(m, 0.24, rest(0.096), 0.04, 1.66, -0.02, 0.31, 0.096, seed + 9);
    wheatBundle(m, 0.42, rest(0.078), -0.02, 0.92, 0.04, 0.24, 0.078, seed + 13);
    wheatBundle(m, 0.13, rest(0.09, 0.112), 0.02, 0.26, 0.06, 0.32, 0.09, seed + 17);
    wheatBundle(m, 0.34, rest(0.082, 0.1), -0.03, -0.34, -0.05, 0.28, 0.082, seed + 21);
  } else if (kind === 'ore') {
    const GREY: RGB = [150, 154, 164];
    angularRock(m, -0.02, 0.08, y, 0.16, 0.23, 0.13, GREY, seed, 'slab', 0.1);
    angularRock(m, 0.15, -0.08, y, 0.17, 0.25, 0.14, shade(GREY, 0.93), seed + 3, 'crag', -0.18);
    angularRock(m, 0.32, 0.04, y, 0.13, 0.18, 0.1, shade(GREY, 1.05), seed + 6, 'wedge', 0.32);
    angularRock(m, 0.16, 0.11, y, 0.095, 0.15, 0.08, shade(GREY, 0.98), seed + 9, 'wedge', -0.4);
    angularRock(m, 0.09, 0.0, y + 0.09, 0.11, 0.16, 0.09, shade(GREY, 1.08), seed + 12, 'crag', 0.22);
  } else if (kind === 'lumber') {
    felledPine(m, -0.07, -0.135, y, -0.22, 0.05, 0.94, PINE_GREENS[0], seed);
    felledPine(m, 0.01, 0.135, y + 0.01, 0.32, 0.08, 0.88, PINE_GREENS[1], seed + 3);
    felledPine(m, 0.04, -0.02, y + 0.14, 1.0, 0.2, 0.9, PINE_GREENS[2], seed + 6);
  } else if (kind === 'wool') {
    sheep(m, 0.28, 0.09, y, 0.2, seed, 1.55);
    sheep(m, 0.05, -0.05, y, -0.4, seed + 4, 1.55);
    sheep(m, 0.34, -0.14, y, 0.05, seed + 8, 1.4);
  } else if (kind === 'brick') {
    const BRICK: RGB = [207, 91, 61];
    const rng = mulberry32((Math.abs(seed) * 2246822519 + 0x165667b1) >>> 0 || 1);
    const baseYaw = (rng() - 0.5) * 0.18;
    const c = Math.cos(baseYaw);
    const s = Math.sin(baseYaw);
    const put = (x: number, z: number, lift: number, yaw = baseYaw, scale = 1): void => {
      const jx = (rng() - 0.5) * 0.012;
      const jz = (rng() - 0.5) * 0.012;
      const px = 0.1 + (x + jx) * c - (z + jz) * s;
      const pz = -0.015 + (x + jx) * s + (z + jz) * c;
      box(m, px, pz, 0.16 * scale, 0.057 * scale, 0.09 * scale, shade(BRICK, 0.89 + rng() * 0.2), yaw, y + lift);
    };

    const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
    const scatterLayer = (count: number, rx: number, rz: number, lift: number, phase: number, yawSpread: number, shiftX = 0): void => {
      for (let i = 0; i < count; i++) {
        // A sunflower-style distribution fills an ellipse without rows or a rectangular edge.
        // Seeded angular/radial noise stops the mathematically even placement from showing.
        const radius = Math.sqrt((i + 0.35 + rng() * 0.3) / count) * (0.9 + rng() * 0.1);
        const angle = phase + i * GOLDEN_ANGLE + (rng() - 0.5) * 0.38;
        const x = shiftX + Math.cos(angle) * rx * radius;
        // The real hold narrows toward +x. Preserve the broad oval through its middle, then
        // gently taper only the forward end so the larger pile follows the boat rather than
        // clipping through it.
        const forward = Math.max(0, x / rx);
        const z = Math.sin(angle) * rz * radius * (1 - forward * 0.28);
        const turn = forward > 0.68 ? yawSpread * 0.42 : yawSpread;
        put(x, z, lift, baseYaw + (rng() - 0.5) * turn, 0.94 + rng() * 0.12);
      }
    };

    // Three nested oval layers behave like a dumped load: a wide footprint, a smaller shoulder,
    // then a broken crown. Larger bricks and the broad base now approach the wheat cargo's deck
    // coverage while every piece retains its own silhouette.
    scatterLayer(24, 0.29, 0.15, 0, 0.3 + rng() * 0.5, 1.2, 0);
    scatterLayer(16, 0.23, 0.118, 0.057, 1.1 + rng() * 0.5, 1.35, -0.012);
    scatterLayer(9, 0.16, 0.082, 0.114, 2.0 + rng() * 0.5, 1.5, 0.01);

    // A few pieces roll beyond the main ellipse, further breaking the outline without reaching
    // the tapered hull lip.
    put(0.29, -0.065, 0, baseYaw - 0.28 + (rng() - 0.5) * 0.18, 0.97);
    put(0.28, 0.07, 0, baseYaw + 0.3 + (rng() - 0.5) * 0.18, 0.95);
    put(-0.275, 0.112, 0, baseYaw + 0.42 + (rng() - 0.5) * 0.24, 0.96);
    put(-0.265, -0.115, 0, baseYaw - 0.46 + (rng() - 0.5) * 0.24, 0.94);
    put(-0.015, 0.155, 0, baseYaw + 0.16 + (rng() - 0.5) * 0.22, 0.95);
  }
}
