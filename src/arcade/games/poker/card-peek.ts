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
  type Mat4,
  nearestHit,
  type OrbitCamera,
  Raycaster,
  type RenderTarget,
  SpringValue,
  type Texture,
} from '../../../engine/index.ts';
import type { Card } from '../../../rules/poker/cards.ts';
import { CARD_H, CARD_W, drawPeekCard, type PeekPose, peekCardCenter } from './card-render.ts';

const FOVY = (46 * Math.PI) / 180;
export const PEEK = 0.6; // reveal a hovered card bends to

interface PeekCard {
  card: Card;
  seatX: number; // resting x offset along the seat
  reveal: SpringValue; // animated 0..1 (spring-driven, can briefly overshoot)
  up: boolean; // clicked fully up
}

// A card counts as "seen" once it has bent up past this reveal — below PEEK (0.6), so a
// deliberate hover-peek latches it, not just a cursor grazing by. Drives the game HUD's
// hand readout (a face-down card the hero has glimpsed shows its rank/suit there).
const SEEN_AT = 0.35;

export class HandPeek {
  private readonly raycaster = new Raycaster();
  private cards: PeekCard[] = [];
  private hovered = -1;
  private seenFlags: boolean[] = []; // per card: has it been peeked/lifted at least once

  // `seatZ` is where the cards rest along the seat's radial (HAND_SEAT_Z in the sandbox,
  // the hole-card radius in the game); the felt plane is y=0.
  constructor(private readonly seatZ: number) {}

  // (Re)seat the cards face-down for a fresh hand.
  reset(cards: readonly { card: Card; seatX: number }[]): void {
    this.cards = cards.map((c) => ({
      card: c.card,
      seatX: c.seatX,
      reveal: new SpringValue({ stiffness: 190, damping: 19, min: 0, maxStep: 0.02 }),
      up: false,
    }));
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
      c.reveal.setTarget(this.revealTarget(i));
      if (!c.reveal.settled) return true;
    }
    return false;
  }

  // Lightly-damped spring toward each card's target (a subtle single bounce; never
  // curls below the felt). Integrated in fixed sub-steps so it stays stable no matter
  // the frame dt — a big dt on a slow frame (the live game can hit ~0.1s while an AI
  // thinks) would otherwise make this explicit spring overshoot and diverge, flip-
  // flopping the card between face-down and standing up.
  step(dt: number): void {
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      c.reveal.setTarget(this.revealTarget(i)).update(dt);
      if (c.reveal.value > SEEN_AT) this.seenFlags[i] = true; // latch: the hero has glimpsed it
    }
  }

  private peekPose(i: number, az: number): PeekPose {
    return { seatX: this.cards[i].seatX, seatZ: this.seatZ, reveal: this.cards[i].reveal.value, peek: PEEK, az };
  }

  // Current reveal amount, exposed for deterministic headless motion checks.
  reveal(i: number): number | undefined {
    return this.cards[i]?.reveal.value;
  }
  // Whether card i has been clicked fully face-up (as opposed to bent up by a hover).
  lifted(i: number): boolean {
    return this.cards[i]?.up ?? false;
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
    this.toggleCard(h);
    return true;
  }
  // Keyboard / headless equivalents.
  flipCard(i: number): boolean {
    return this.toggleCard(i);
  }
  setHovered(i: number): boolean {
    if (i === this.hovered) return false;
    this.hovered = i;
    return true;
  }

  private toggleCard(i: number): boolean {
    const c = this.cards[i];
    if (!c) return false;
    c.up = !c.up;
    const target = this.revealTarget(i);
    // An interruptible spring normally preserves momentum. For a direct click
    // reversal that can produce one or more frames moving away from the new target
    // (most visible when lowering a card before its lift has fully settled), which
    // reads as a sporadic hitch rather than a physical bounce.
    if ((target - c.reveal.value) * c.reveal.velocity < 0) c.reveal.velocity = 0;
    c.reveal.setTarget(target);
    return true;
  }

  // Ray-pick: through the felt for a flat/peeking card, else proximity to the projected
  // (bent) card center once it's lifted off the table.
  //
  // Shared nearest-hit ranking scores cursor distance normalized to each candidate's own
  // hitbox (0 = dead center, 1 = at the edge). A raised card's hitbox is deliberately fat
  // so hover doesn't flicker as it arches up, which makes it overlap its flat neighbour —
  // so semantic priority ranks raised hits *after* any flat footprint hit. Without this,
  // whichever card had the higher
  // index won every overlap tie: gliding onto the lower-index (left) card left the
  // still-raised right card previewed until the cursor fully cleared its inflated box.
  private pick(cam: OrbitCamera, ndcX: number, ndcY: number, aspect: number): number {
    const camera = cam.toCamera({ fovy: FOVY, near: 0.05, far: 200 });
    const raycaster = this.raycaster.setFromCamera(camera, ndcX, ndcY, aspect);
    const planeHit = raycaster.intersectPlane({ x: 0, y: 1, z: 0 });
    // Felt-plane (y=0) hit for flat / peeking cards.
    const hitX = planeHit?.x ?? Infinity;
    const hitZ = planeHit?.z ?? Infinity;
    const hits: {
      index: number;
      priority: number;
      distance: number;
      radius: number;
      score: number;
    }[] = [];
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      if (c.reveal.value < 0.5) {
        // Flat: normalized distance inside the resting footprint (score in [0,1]).
        const hw = CARD_W / 2 + 0.12;
        const hh = CARD_H / 2 + 0.12;
        const nx = Math.abs(hitX - c.seatX) / hw;
        const nz = Math.abs(hitZ - this.seatZ) / hh;
        const score = Math.max(nx, nz);
        if (score <= 1) hits.push({ index: i, priority: 0, distance: score, radius: 1, score });
      } else {
        // Raised: normalized distance to the projected bent center, ranked below any
        // flat hit (+1) so the fat box can't outrank a footprint the cursor is inside.
        const center = peekCardCenter(this.peekPose(i, cam.azimuth));
        const point = raycaster.project(center);
        if (point.clipW > 1e-4) {
          const nx = Math.abs(point.x - ndcX) / 0.35;
          const ny = Math.abs(point.y - ndcY) / 0.45;
          const score = Math.max(nx, ny);
          if (score < 1) hits.push({ index: i, priority: 1, distance: score, radius: 1, score });
        }
      }
    }
    return nearestHit(hits, { priority: (hit) => hit.priority })?.index ?? -1;
  }
}
