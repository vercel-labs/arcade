// Hover-to-peek / click-to-lift for a row of face-down hole cards resting on the felt.
// This is the exact interaction from the cards sandbox's hand mode, factored out so the
// live poker game reuses it verbatim (rather than a parallel implementation that can
// drift or flicker). Cards rest at (seatX, felt, seatZ); hovering bends one up to peek,
// clicking lifts it fully face-on (click again lays it back down).
//
// Picking: while a card is near-flat we test the cursor's felt-plane hit against the
// card's resting footprint; once it's peeking/lifted we instead test proximity to the
// card's projected (bent) center, so the hitbox follows the card up and the hover never
// oscillates as it arches.

import {
  type Camera,
  cameraMatrices,
  type Mat4,
  mat4MulVec4,
  normalize3,
  type RenderTarget,
  type Texture,
} from '../../../engine/index.ts';
import type { OrbitCamera } from '../../orbit.ts';
import type { Card } from '../../../rules/poker/cards.ts';
import { CARD_H, CARD_W, drawPeekCard, type PeekPose, peekCardCenter } from './card-render.ts';

const FOVY = (46 * Math.PI) / 180;
export const PEEK = 0.6; // reveal a hovered card bends to

interface PeekCard {
  card: Card;
  seatX: number; // resting x offset along the seat
  reveal: number; // animated 0..1 (spring-driven, can briefly overshoot)
  vel: number; // reveal velocity, for the spring settle
  up: boolean; // clicked fully up
}

// A card counts as "seen" once it has bent up past this reveal — below PEEK (0.6), so a
// deliberate hover-peek latches it, not just a cursor grazing by. Drives the game HUD's
// hand readout (a face-down card the hero has glimpsed shows its rank/suit there).
const SEEN_AT = 0.35;

export class HandPeek {
  private cards: PeekCard[] = [];
  private hovered = -1;
  private seenFlags: boolean[] = []; // per card: has it been peeked/lifted at least once

  // `seatZ` is where the cards rest along the seat's radial (HAND_SEAT_Z in the sandbox,
  // the hole-card radius in the game); the felt plane is y=0.
  constructor(private readonly seatZ: number) {}

  // (Re)seat the cards face-down for a fresh hand.
  reset(cards: readonly { card: Card; seatX: number }[]): void {
    this.cards = cards.map((c) => ({ card: c.card, seatX: c.seatX, reveal: 0, vel: 0, up: false }));
    this.hovered = -1;
    this.seenFlags = cards.map(() => false);
  }
  count(): number {
    return this.cards.length;
  }
  // Whether card i has been peeked/lifted at least once this hand (latched in step once
  // its reveal crosses SEEN_AT). The game HUD uses this to reveal a glimpsed hole card.
  seen(i: number): boolean {
    return this.seenFlags[i] ?? false;
  }

  private revealTarget(i: number): number {
    const c = this.cards[i];
    if (c.up) return 1;
    return this.hovered === i ? PEEK : 0;
  }

  // Whether any card is still moving toward its target (drives the render lease).
  animating(): boolean {
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      if (Math.abs(c.reveal - this.revealTarget(i)) > 0.001 || Math.abs(c.vel) > 0.001) return true;
    }
    return false;
  }

  // Lightly-damped spring toward each card's target (a subtle single bounce; never
  // curls below the felt). Integrated in fixed sub-steps so it stays stable no matter
  // the frame dt — a big dt on a slow frame (the live game can hit ~0.1s while an AI
  // thinks) would otherwise make this explicit spring overshoot and diverge, flip-
  // flopping the card between face-down and standing up.
  step(dt: number): void {
    const steps = Math.max(1, Math.ceil(dt / 0.02));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < this.cards.length; i++) {
        const c = this.cards[i];
        c.vel += (190 * (this.revealTarget(i) - c.reveal) - 19 * c.vel) * h;
        c.reveal += c.vel * h;
        if (c.reveal < 0) {
          c.reveal = 0;
          if (c.vel < 0) c.vel = 0;
        }
        if (c.reveal > SEEN_AT) this.seenFlags[i] = true; // latch: the hero has glimpsed it
      }
    }
  }

  private peekPose(i: number, az: number): PeekPose {
    return { seatX: this.cards[i].seatX, seatZ: this.seatZ, reveal: this.cards[i].reveal, peek: PEEK, az };
  }

  // Draw every card bent to its current reveal.
  draw(target: RenderTarget, vp: Mat4, az: number, back: Texture): void {
    for (let i = 0; i < this.cards.length; i++) drawPeekCard(target, vp, this.peekPose(i, az), this.cards[i].card, back);
  }

  // Pointer-move: peek whichever card is under the cursor (−1 = none). Returns true if
  // the hovered card changed (so the caller can mark itself dirty).
  hover(cam: OrbitCamera, ndcX: number, ndcY: number, aspect: number): boolean {
    const h = this.pick(cam, ndcX, ndcY, aspect);
    if (h === this.hovered) return false;
    this.hovered = h;
    return true;
  }
  // Click: lift the card under the cursor fully face-on (toggle down on a second click).
  click(cam: OrbitCamera, ndcX: number, ndcY: number, aspect: number): boolean {
    const h = this.pick(cam, ndcX, ndcY, aspect);
    if (h < 0) return false;
    this.cards[h].up = !this.cards[h].up;
    return true;
  }
  // Keyboard / headless equivalents.
  flipCard(i: number): boolean {
    const c = this.cards[i];
    if (!c) return false;
    c.up = !c.up;
    return true;
  }
  setHovered(i: number): boolean {
    if (i === this.hovered) return false;
    this.hovered = i;
    return true;
  }

  // Ray-pick: through the felt for a flat/peeking card, else proximity to the projected
  // (bent) card center once it's lifted off the table.
  private pick(cam: OrbitCamera, ndcX: number, ndcY: number, aspect: number): number {
    const eye = cam.eye();
    const { forward, right, up } = cam.basis();
    const tan = Math.tan(FOVY / 2);
    const dir = normalize3({
      x: forward.x + right.x * ndcX * tan * aspect + up.x * ndcY * tan,
      y: forward.y + right.y * ndcX * tan * aspect + up.y * ndcY * tan,
      z: forward.z + right.z * ndcX * tan * aspect + up.z * ndcY * tan,
    });
    // Felt-plane (y=0) hit for flat / peeking cards.
    let hitX = Infinity;
    let hitZ = Infinity;
    if (Math.abs(dir.y) > 1e-4) {
      const tHit = -eye.y / dir.y;
      if (tHit > 0) {
        hitX = eye.x + dir.x * tHit;
        hitZ = eye.z + dir.z * tHit;
      }
    }
    const camera: Camera = { eye, target: cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 200 };
    const vp = cameraMatrices(camera, aspect).viewProjection;
    let best = -1;
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      if (c.reveal < 0.5) {
        if (Math.abs(hitX - c.seatX) <= CARD_W / 2 + 0.12 && Math.abs(hitZ - this.seatZ) <= CARD_H / 2 + 0.12) best = i;
      } else {
        const center = peekCardCenter(this.peekPose(i, cam.azimuth));
        const p = mat4MulVec4(vp, { x: center.x, y: center.y, z: center.z, w: 1 });
        if (p.w > 1e-4 && Math.abs(p.x / p.w - ndcX) < 0.35 && Math.abs(p.y / p.w - ndcY) < 0.45) best = i;
      }
    }
    return best;
  }
}
