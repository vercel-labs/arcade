import type { Mat4, RenderTarget, Texture } from '../../../engine/index.ts';
import type { Card } from '../../../rules/poker/cards.ts';
import { cardFaceTexture } from './card-textures.ts';
import * as shared from '../../../game-visuals/poker/card-render.ts';

export const { CARD_H, CARD_MESH, CARD_SCALE, CARD_W, flatDown, flatUp, peekCardCenter } = shared;
export type { ArchPlace, PeekPose } from '../../../game-visuals/poker/card-render.ts';

export function drawCard(target: RenderTarget, vp: Mat4, model: Mat4, card: Card, back: Texture, bright = 1): void { shared.drawCard(target, vp, model, card, back, bright, cardFaceTexture); }
export function drawPeekCard(target: RenderTarget, vp: Mat4, pose: shared.PeekPose, card: Card, back: Texture, bright = 1): void { shared.drawPeekCard(target, vp, pose, card, back, bright, cardFaceTexture); }
export function drawArchCard(target: RenderTarget, vp: Mat4, place: shared.ArchPlace, card: Card, back: Texture, bright = 1): void { shared.drawArchCard(target, vp, place, card, back, bright, cardFaceTexture); }
