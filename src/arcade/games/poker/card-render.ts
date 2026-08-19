// Shared 3D playing-card drawing, used by the cards sandbox (cards-scene.ts) and
// the poker game (poker-scene.ts). A card is a textured double-sided billboard: a
// `quad` per side (face + red back), each offset a hair along the normal so the two
// faces don't z-fight, so a card reads as double-sided as it turns.

import {
  BufferGeometry,
  clamp01,
  coverMaterial,
  type Mat4,
  mat4Identity,
  mat4Multiply,
  mat4RotX,
  mat4RotY,
  mat4Scale,
  mat4Translate,
  type Mesh,
  normalize3,
  quad,
  rasterize,
  smoothstep,
  type RenderTarget,
  type Texture,
  type Vec3,
  type VertexIn,
} from '../../../engine/index.ts';
import type { Card } from '../../../rules/poker/cards.ts';
import { cardFaceTexture } from './card-textures.ts';

export const CARD_MESH = quad(0.5);
export const CARD_W = 1.0;
export const CARD_H = 1.4;
export const CARD_SCALE = mat4Scale(CARD_W, CARD_H, 1);
const CARD_EPS = 0.007; // half-thickness: face at +eps, back at −eps (no z-fight)
const LIGHT = normalize3({ x: 0.12, y: 0.5, z: 1 });
const WHITE: Vec3 = { x: 250, y: 249, z: 245 };
const BACK_FIELD: Vec3 = { x: 156, y: 22, z: 30 };

// Constant per-card transforms, built once and reused (read-only) every frame rather
// than reallocated per card: the two sheet offsets (face +eps, back −eps + flip) and
// the identity used by the bent-strip draws (their geometry is baked to world space).
const FACE_OFFSET: Mat4 = mat4Translate(0, 0, CARD_EPS);
const BACK_OFFSET: Mat4 = mat4Multiply(mat4Translate(0, 0, -CARD_EPS), mat4RotY(Math.PI));
const IDENTITY: Mat4 = mat4Identity();

// Draw a double-sided card at model matrix `M` (already scaled to the card quad).
// `back` is the shared card-back texture. `bright` dims/brightens both faces.
export function drawCard(target: RenderTarget, vp: Mat4, M: Mat4, card: Card, back: Texture, bright = 1): void {
  const faceModel = mat4Multiply(M, FACE_OFFSET);
  rasterize(target, CARD_MESH, coverMaterial, {
    mvp: mat4Multiply(vp, faceModel),
    model: faceModel,
    tex: cardFaceTexture(card),
    paper: WHITE,
    lightDir: LIGHT,
    ambient: 0.62,
    brightness: bright,
    // Thin margin (the face is white anyway) so the corner index can tuck right into
    // the corner without the pad/bezel clipping it.
    frameWidth: 0.012,
    frameColor: WHITE,
    pad: 0.012,
    fade: 0,
    fadeY0: 0,
    fadeY1: 0,
  });
  const backModel = mat4Multiply(M, BACK_OFFSET);
  rasterize(target, CARD_MESH, coverMaterial, {
    mvp: mat4Multiply(vp, backModel),
    model: backModel,
    tex: back,
    paper: BACK_FIELD,
    lightDir: LIGHT,
    ambient: 0.62,
    brightness: bright,
    frameWidth: 0.03,
    frameColor: WHITE,
    pad: 0.02,
    fade: 0,
    fadeY0: 0,
    fadeY1: 0,
  });
}

// ── Peeking / lifting a hand card by bending it ───────────────────────────────
//
// A real player doesn't tip a hole card up rigidly to peek — they curl its near
// edge off the felt while the far edge stays pinned, so the card bows into a shallow
// arch and the face rolls into view. We model that literally: the card is a thin
// strip subdivided along its length, and we integrate a tangent angle from the
// pinned far edge (angle 0, flat on the felt) toward the near edge. Because every
// lengthwise step only ever tilts the surface *upward* (the tangent angle is never
// negative), no point on the card can dip below the table — the "edges never go
// under the felt" guarantee falls out of the parametrization for free.
//
// The same tangent curve also does the full face-on lift: a uniform stand-up angle
// `phi` rotates the whole strip toward vertical while the local curl relaxes, so a
// hover-peek and a click-to-lift are one continuous motion (no pop at the hand-off).
// Per-vertex normals come straight from the tangent, so `coverMaterial`'s N·L
// lighting shades the arch correctly and the face brightens as it turns to the hero.

const BEND_SEGS = 16; // lengthwise subdivisions of the bent strip (smooth arc)
const BEND_BASE_Y = 0.02; // the pinned far edge floats a hair above the felt
// Sheet half-separation for the bent card. Wider than a flat card's CARD_EPS because
// the two sheets are 32 coplanar triangles: when the lifted card faces the camera
// they'd tie in the depth buffer and z-fight into horizontal bands. This gap (a
// believable card thickness) keeps the front sheet cleanly in front.
const BEND_EPS = 0.02;
const BEND_MAX = 1.6; // radians of curl at a full peek (~92°): near edge stands up to read the face
// On the full lift the card stands up hinged at its far (bottom) edge, so standing it
// upright already grounds the bottom edge on the felt — it must NOT also be raised by
// its own height or it towers over the table. LIFT_Y only floats it a hair off the
// felt (as if held); LIFT_Z slides it toward the hero so it centers in view.
const LIFT_Y = 0.04;
const LIFT_Z = 1.0;

export interface PeekPose {
  seatX: number; // card center across the felt (world x)
  seatZ: number; // resting card center (world z); the far edge is pinned half a card back of it
  reveal: number; // 0 flat & face-down · `peek` fully arched · 1 upright & face-on
  peek: number; // the reveal value at which the arch is fully expressed
  az: number; // camera azimuth, so a lifted card yaws to keep its face to the hero
}

// The reveal → (curl, stand-up, lift) breakdown, shared by the renderer and the
// pick helper so the picked center always matches where the card is drawn.
function peekParams(pose: PeekPose): { phi: number; kappa: number; yaw: number; liftY: number; liftZ: number } {
  // `reveal` is already spring-driven, so keep the peek↔upright pose blend linear.
  // Applying another smoothstep here made the card almost pause at the peek, surge
  // through the middle of the lift, then brake sharply; lowering it repeated the
  // same speed spike in reverse. The spring supplies the easing while this mapping
  // only describes the card's continuous shape.
  const liftF = clamp01((pose.reveal - pose.peek) / (1 - pose.peek)); // 0 through the peek, ramps 0→1 as it lifts
  const peekF = smoothstep(pose.reveal / pose.peek); // 0→1 across the peek
  return {
    phi: (Math.PI / 2) * liftF, // uniform stand-up: 0 flat → 90° upright
    kappa: BEND_MAX * peekF * (1 - liftF), // curl peaks at the peek, relaxes as the card stands up
    yaw: pose.az * liftF, // face the hero once lifted
    liftY: LIFT_Y * liftF,
    liftZ: LIFT_Z * liftF,
  };
}

// A bent-strip mesh has constant topology ((segs+1)×2 vertices, 2 triangles/segment),
// so we build one scratch mesh per strip length once and rewrite its vertex fields in
// place each draw — `bentSheet`/`archSheet` are called twice per card (face + back) and
// the idle shuffle bends up to 28 cards per frame, so a fresh Mesh + hundreds of little
// vertex objects each call was steady per-frame GC churn. `rasterize` consumes a mesh
// synchronously and never retains it, so a single scratch per topology is safe to reuse
// across every card in a frame. `zC`/`yC` are the reused centerline-march scratch.
interface StripScratch {
  mesh: BufferGeometry;
  zC: number[];
  yC: number[];
}
function makeStrip(segs: number): StripScratch {
  const vertices: VertexIn[] = [];
  for (let i = 0; i <= segs; i++) {
    for (let j = 0; j <= 1; j++) {
      vertices.push({ position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, uv: [0, 0], color: WHITE });
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  return { mesh: new BufferGeometry(vertices, indices), zC: new Array(segs + 1), yC: new Array(segs + 1) };
}

// Build the bent card as a strip of `BEND_SEGS` quads in world space (positions and
// normals baked, so the material's model matrix is identity). `side` = +1 builds the
// face sheet (offset +eps along the surface normal, upright uv); −1 the back sheet
// (offset −eps, u mirrored). Winding is irrelevant — `coverMaterial` disables culling
// and the depth buffer resolves which sheet shows. Writes into the shared bend scratch.
const bendScratch = makeStrip(BEND_SEGS);
function bentSheet(pose: PeekPose, side: 1 | -1): Mesh {
  const { phi, kappa, yaw, liftY, liftZ } = peekParams(pose);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const seg = CARD_H / BEND_SEGS;
  const pivotZ = CARD_H / 2; // yaw about the card's mid-length so a lifted card spins on its own axis
  const farZ = pose.seatZ - CARD_H / 2; // the pinned edge sits half a card back of the resting center

  // March the centerline from the pinned far edge (s=0) to the near edge (s=1),
  // accumulating (localZ, localY) from the tangent angle theta(s) = phi + kappa·s.
  const { zC, yC } = bendScratch;
  zC[0] = 0;
  yC[0] = 0;
  for (let i = 1; i <= BEND_SEGS; i++) {
    const th = phi + kappa * ((i - 0.5) / BEND_SEGS);
    zC[i] = zC[i - 1] + seg * Math.cos(th);
    yC[i] = yC[i - 1] + seg * Math.sin(th);
  }

  const vs = bendScratch.mesh.vertices;
  for (let i = 0; i <= BEND_SEGS; i++) {
    const th = phi + kappa * (i / BEND_SEGS);
    // Surface normal from the tangent: (0,−cosθ,sinθ) is face-down at θ=0 and turns
    // to face the hero (+z) as the strip stands up. Flip it for the back sheet.
    const nLy = -Math.cos(th) * side;
    const nLz = Math.sin(th) * side;
    const lz = zC[i] - pivotZ; // relative to the yaw pivot
    const v = 1 - i / BEND_SEGS; // near edge = top of the card image (v=0)
    for (let j = 0; j <= 1; j++) {
      const lx = (j - 0.5) * CARD_W; // −½W (left) … +½W (right)
      // Yaw about Y, then place: world = pivot·yaw + (seatX, base+lift, farZ+lift).
      const px = lx * cy + lz * sy;
      const pz = -lx * sy + lz * cy + pivotZ;
      // The local normal has no x-component; the same yaw rotates its z into x.
      const nx = nLz * sy;
      const nz = nLz * cy;
      // Bulge each sheet along its own (already side-flipped) outward normal so the
      // two never z-fight — the back stays above the felt, the face just below it.
      const wx = pose.seatX + px + nx * BEND_EPS;
      const wy = BEND_BASE_Y + liftY + yC[i] + nLy * BEND_EPS;
      const wz = farZ + liftZ + pz + nz * BEND_EPS;
      const u = side === 1 ? j : 1 - j; // mirror u on the back
      const vtx = vs[i * 2 + j];
      vtx.position.x = wx;
      vtx.position.y = wy;
      vtx.position.z = wz;
      vtx.normal.x = nx;
      vtx.normal.y = nLy;
      vtx.normal.z = nz;
      vtx.uv[0] = u;
      vtx.uv[1] = v;
    }
  }
  return bendScratch.mesh.markNeedsUpdate();
}

// Draw a hand card as a bent, double-sided strip for the whole peek→lift range. At
// rest (reveal 0) the strip is simply flat and face-down, matching the resting card.
export function drawPeekCard(target: RenderTarget, vp: Mat4, pose: PeekPose, card: Card, back: Texture, bright = 1): void {
  const id = IDENTITY;
  const face = bentSheet(pose, 1);
  rasterize(target, face, coverMaterial, {
    mvp: vp,
    model: id,
    tex: cardFaceTexture(card),
    paper: WHITE,
    lightDir: LIGHT,
    ambient: 0.62,
    brightness: bright,
    frameWidth: 0.012,
    frameColor: WHITE,
    pad: 0.012,
    fade: 0,
    fadeY0: 0,
    fadeY1: 0,
  });
  const backSheet = bentSheet(pose, -1);
  rasterize(target, backSheet, coverMaterial, {
    mvp: vp,
    model: id,
    tex: back,
    paper: BACK_FIELD,
    lightDir: LIGHT,
    ambient: 0.62,
    brightness: bright,
    frameWidth: 0.03,
    frameColor: WHITE,
    pad: 0.02,
    fade: 0,
    fadeY0: 0,
    fadeY1: 0,
  });
}

// The world-space center of a bent card, so picking a lifted card tests the same
// point that's drawn. Mirrors the mid-length sample of `bentSheet`.
export function peekCardCenter(pose: PeekPose): Vec3 {
  const { phi, kappa, yaw, liftY, liftZ } = peekParams(pose);
  const seg = CARD_H / BEND_SEGS;
  const pivotZ = CARD_H / 2;
  const farZ = pose.seatZ - CARD_H / 2;
  let z = 0;
  let y = 0;
  for (let i = 1; i <= BEND_SEGS / 2; i++) {
    const th = phi + kappa * ((i - 0.5) / BEND_SEGS);
    z += seg * Math.cos(th);
    y += seg * Math.sin(th);
  }
  const lz = z - pivotZ;
  return {
    x: pose.seatX + lz * Math.sin(yaw),
    y: BEND_BASE_Y + liftY + y,
    z: farZ + liftZ + lz * Math.cos(yaw) + pivotZ,
  };
}

// ── Bending a card for the shuffle (curl lift + concave-down bridge slope) ────
//
// The deck-shuffle bends whole cards with the same strip-marching technique as the
// peek, from a one-sided tangent profile of magnitude `curl` over the card's length
// s ∈ [0,1]; `dome` picks which end is steep:
//   • dome = false — θ(s) = curl·s: flat (pinned) at s=0, steepest at s=1. The card
//     lies flat and its far short edge flexes UP — a thumb lifting one half of the
//     deck by its inner edge (the riffle lift). Concave up.
//   • dome = true — θ(s) falls from `curl` to zero over the outer 82% of the card,
//     then stays level across the inner 18%. Two mirrored cards therefore rise as the
//     same concave-down slopes but overlap only along their horizontal apex sections;
//     those ends remain vertically ordered instead of crossing through one another.
// `edgeDepth` preserves each half-packet's compact thickness at the grounded outer edge;
// that separation blends toward the full interleaved `depth` only near the inner overlap.
// Higher cards keep the same horizontal footprint instead of expanding outward and
// appearing longer. At curl = 0 both depths agree and the card degenerates to a flat quad
// at y + depth, matching the flat-card path. The card's length runs along local z (face
// down / back up, matching flatDown). `bendDirection` mirrors the bend coordinate without
// mirroring the card or its UVs, so both packets keep the same physical top orientation.

const ARCH_SEGS = 10; // lengthwise subdivisions of an arched card (fewer than the peek: many bend at once)
const BRIDGE_APEX_FRACTION = 0.18; // level inner section where the interleaved halves overlap
const BRIDGE_BURIED_INNER_V = 0.94; // hidden inner ends stay outside the material's border band

// Placement of one bent card: center on the felt (x,y,z), yaw about Y, the bend (`curl`
// magnitude + `dome` direction — see the header), plus the outer packet and inner
// interleaved depths used to keep bridge layers ordered without inflating the outside.
export interface ArchPlace {
  x: number;
  y: number;
  z: number;
  yaw: number;
  bendDirection: 1 | -1;
  curl: number;
  dome: boolean;
  innerEdgeVisibility: number;
  edgeDepth: number;
  depth: number;
}

// One sheet of an arched card, baked to world space (positions + normals), so the
// material draws it with an identity model — mirrors `bentSheet`. `side` = +1 face
// (offset +eps along the surface normal), −1 back (offset −eps, u mirrored). Writes
// into the shared arch scratch (see makeStrip).
const archScratch = makeStrip(ARCH_SEGS);
function archSheet(place: ArchPlace, side: 1 | -1): Mesh {
  const { x, y, z, yaw, bendDirection, curl, dome, innerEdgeVisibility, edgeDepth, depth } = place;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const seg = CARD_H / ARCH_SEGS;
  // The bridge slope reaches a zero tangent before the inner edge, leaving a short
  // horizontal apex section for the two interleaved halves to overlap without crossing.
  const slopeEnd = 1 - BRIDGE_APEX_FRACTION;
  const theta = (t: number): number => (dome ? curl * Math.max(0, 1 - t / slopeEnd) : curl * t);

  // March the centerline, accumulating (localZ, localY) from the tangent angle: the s=0
  // end stays at localY 0 (pinned) and the far end lifts (dome = false) or the near end
  // rises to a level apex (dome = true).
  const { zC, yC } = archScratch;
  zC[0] = 0;
  yC[0] = 0;
  for (let i = 1; i <= ARCH_SEGS; i++) {
    const th = theta((i - 0.5) / ARCH_SEGS);
    zC[i] = zC[i - 1] + seg * Math.cos(th);
    yC[i] = yC[i - 1] + seg * Math.sin(th);
  }
  const zMid = (zC[0] + zC[ARCH_SEGS]) / 2; // center the strip on its own length

  const vs = archScratch.mesh.vertices;
  for (let i = 0; i <= ARCH_SEGS; i++) {
    const th = theta(i / ARCH_SEGS);
    // Surface normal from the tangent: at θ=0 the face sheet (+1) points −Y (down)
    // and the back sheet (−1) points +Y (up) — a back-up card, as in the deck.
    const nLy = -Math.cos(th) * side;
    const nLz = Math.sin(th) * side * bendDirection;
    // Retain half-packet spacing through the outer quarter, then smoothly fan into the
    // full interleaved stack by the level apex. The overlap is thick; the outside is not.
    const layerU = Math.max(0, Math.min(1, (i / ARCH_SEGS - 0.25) / (slopeEnd - 0.25)));
    const layerMix = layerU * layerU * (3 - 2 * layerU);
    const layerDepth = edgeDepth + (depth - edgeDepth) * layerMix;
    // Marching is always outer→inner. Reflect that bend coordinate for the right
    // packet while keeping `yaw` fixed, rather than rotating the physical card 180°.
    const lz = (zC[i] - zMid) * bendDirection;
    const ly = yC[i] + layerDepth;
    // Fade the border only on inner ends that have slid underneath the covering card.
    // The physical top card always supplies visibility=1, retaining its complete edge.
    // Starting this blend during the riffle avoids a one-frame pile of opposing borders
    // immediately before `dome` turns on for the bridge.
    const visibility = Math.max(0, Math.min(1, innerEdgeVisibility));
    const innerV = BRIDGE_BURIED_INNER_V + (1 - BRIDGE_BURIED_INNER_V) * visibility;
    // Keep texture-v aligned with flatDown's back sheet. That sheet's Y rotation makes
    // the forward bend walk outer→inner as v=1→0; the reflected bend walks v=0→1.
    // Buried inner edges stop just inside whichever end of the UV range they approach.
    const v = bendDirection === 1 ? 1 - (i / ARCH_SEGS) * innerV : (i / ARCH_SEGS) * innerV;
    for (let j = 0; j <= 1; j++) {
      const lx = (j - 0.5) * CARD_W;
      // Yaw the local (x,z) about Y, then translate to the placement point.
      const px = lx * cy + lz * sy;
      const pz = -lx * sy + lz * cy;
      const nx = nLz * sy;
      const nz = nLz * cy;
      const wx = x + px + nx * BEND_EPS;
      const wy = y + ly + nLy * BEND_EPS;
      const wz = z + pz + nz * BEND_EPS;
      const u = side === 1 ? j : 1 - j;
      const vtx = vs[i * 2 + j];
      vtx.position.x = wx;
      vtx.position.y = wy;
      vtx.position.z = wz;
      vtx.normal.x = nx;
      vtx.normal.y = nLy;
      vtx.normal.z = nz;
      vtx.uv[0] = u;
      vtx.uv[1] = v;
    }
  }
  return archScratch.mesh.markNeedsUpdate();
}

// Draw a double-sided card bent per `place` (curl/dome/depth), centered at (x,y,z) and
// yawed about Y. At curl = 0 this is a flat, face-down card lifted by `depth` in Y.
export function drawArchCard(target: RenderTarget, vp: Mat4, place: ArchPlace, card: Card, back: Texture, bright = 1): void {
  const id = IDENTITY;
  rasterize(target, archSheet(place, 1), coverMaterial, {
    mvp: vp,
    model: id,
    tex: cardFaceTexture(card),
    paper: WHITE,
    lightDir: LIGHT,
    ambient: 0.62,
    brightness: bright,
    frameWidth: 0.012,
    frameColor: WHITE,
    pad: 0.012,
    fade: 0,
    fadeY0: 0,
    fadeY1: 0,
  });
  rasterize(target, archSheet(place, -1), coverMaterial, {
    mvp: vp,
    model: id,
    tex: back,
    paper: BACK_FIELD,
    lightDir: LIGHT,
    ambient: 0.62,
    brightness: bright,
    frameWidth: 0.03,
    frameColor: WHITE,
    pad: 0.02,
    fade: 0,
    fadeY0: 0,
    fadeY1: 0,
  });
}

// A card lying flat on the table, face DOWN (back up): rotate the upright quad +90°
// about X so its face (+z) points down and its back points up. Both flat orientations
// are constant, so build them once and hand back the shared matrix (callers only ever
// read it, composing it into a translate via mat4Multiply).
const FLAT_DOWN: Mat4 = mat4Multiply(mat4RotX(Math.PI / 2), CARD_SCALE);
const FLAT_UP: Mat4 = mat4Multiply(mat4RotX(-Math.PI / 2), CARD_SCALE);
export function flatDown(): Mat4 {
  return FLAT_DOWN;
}

// A card lying flat on the table, face UP.
export function flatUp(): Mat4 {
  return FLAT_UP;
}
