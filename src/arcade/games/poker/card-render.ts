// Shared 3D playing-card drawing, used by the cards sandbox (cards-scene.ts) and
// the poker game (poker-scene.ts). A card is a textured double-sided billboard: a
// `quad` per side (face + red back), each offset a hair along the normal so the two
// faces don't z-fight, so a card reads as double-sided as it turns.

import {
  coverMaterial,
  type Mat4,
  mat4Multiply,
  mat4RotX,
  mat4RotY,
  mat4Scale,
  mat4Translate,
  normalize3,
  quad,
  rasterize,
  type RenderTarget,
  type Texture,
  type Vec3,
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

// Draw a double-sided card at model matrix `M` (already scaled to the card quad).
// `back` is the shared card-back texture. `bright` dims/brightens both faces.
export function drawCard(target: RenderTarget, vp: Mat4, M: Mat4, card: Card, back: Texture, bright = 1): void {
  const faceModel = mat4Multiply(M, mat4Translate(0, 0, CARD_EPS));
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
  const backModel = mat4Multiply(M, mat4Multiply(mat4Translate(0, 0, -CARD_EPS), mat4RotY(Math.PI)));
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

// A card lying flat on the table, face DOWN (back up): rotate the upright quad +90°
// about X so its face (+z) points down and its back points up.
export function flatDown(): Mat4 {
  return mat4Multiply(mat4RotX(Math.PI / 2), CARD_SCALE);
}

// A card lying flat on the table, face UP.
export function flatUp(): Mat4 {
  return mat4Multiply(mat4RotX(-Math.PI / 2), CARD_SCALE);
}
