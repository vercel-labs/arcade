// The idle deck shuffle: a stack of cards at the table center that loops a
// lifelike riffle → bridge → rest cycle, shown while no hand is in play. The cards
// actually bend — each is drawn as a bent strip (drawArchCard), the same per-vertex
// curvature the hole-card peek uses — so the riffle and the bridge read as real card
// flex, not a flat slide.
//
// It follows a real riffle, phase by phase:
//   split   — a real cut, not a symmetric mitosis: the TOP half (odd cards) lifts straight
//             UP off the deck into a floating pile while the bottom half (even) squares
//             down on the felt — both still centred — and only THEN do the two halves part
//             along X to their side positions (bottom slides out, top descends beside it),
//             short inner edges meeting at the middle. Cards stay flat, one orientation.
//   lift    — WHILE STILL APART, each half flexes up by its INNER short edge (a
//             one-sided `curl`), the outer edge staying pinned to the felt. The halves
//             mirror: the left yaws +90°, the right −90°, so `curl` lifts each toward
//             the centre.
//   riffle  — the raised halves slide together and interleave ONE BY ONE: because the
//             inner edges are already up, the overlap happens naturally as they close.
//             Each card releases on a staggered, bottom-up window (even i ← left, odd i
//             ← right, so consecutive releases alternate halves — a zipper down the
//             seam), drops to its interleaved HEIGHT and FLATTENS. The deck ends as two
//             overlapping sections lying FLAT on the felt (curl back to 0) — not merged.
//   bridge  — WITHOUT squaring up, the two still-overlapping halves bow UP into one
//             arch whose APEX sits over the seam (the overlap), not over any card's
//             middle. Each card is one concave-down SLOPE (dome): outer edge pinned on
//             the felt, inner edge raised to the apex. Cards nest as CONCENTRIC layers
//             (a `depth` offset along the surface normal), so within a half none cross,
//             and the two halves' inner edges meet at the seam and fan into a layered
//             apex — one card always on top of the next, none phasing through.
//   cascade — the bridge is released: cards peel off the arch bottom-up, one by one, and
//             FALL into a squared pile building below the apex (each drops from its slope
//             to its flat settled spot at the centre). The arch empties as the pile grows.
//   rest    — a still, squared stack, then the loop repeats.
//
// Continuity trick: the settled stack is FIXED and the phases interpolate between the
// settled position and the split/overlap positions (even i → left comb, odd i → right
// comb). Every card's (x, y, curl, depth) is continuous across each phase boundary, so
// the loop never pops.

import { type Mat4, mat4Multiply, mat4RotY, mat4Translate, type RenderTarget, type Texture } from '../../../engine/index.ts';
import type { Card } from '../../../rules/poker/cards.ts';
import { type ArchPlace, drawArchCard, drawCard, flatDown } from './card-render.ts';

// ── Tuning ───────────────────────────────────────────────────────────────────────
const N = 28; // cosmetic card count (a full 52 isn't needed and costs bent-strip quads)
const THICK = 0.014; // stacked card thickness (keeps the stack from reading as a tall block)
const BASE_Y = 0.02; // the bottom card floats a hair above the felt
// Half-gap the two packets slide apart to. The card length is CARD_H = 1.4, so a
// packet centre at ±SEP puts each inner short edge (½·1.4 = 0.7 from centre) just
// shy of the middle — the halves meet at the seam with a sliver of daylight.
const SEP = 0.8;
// Vertical clearance the TOP half lifts to during the cut, before the halves part. Chosen
// to float the top pile clearly above the resting stack (≈N·THICK ≈ 0.39 tall).
const SPLIT_LIFT = 0.5;
// Half-offset each half keeps AFTER the riffle (and holds through the bridge): the piles
// slide inward only to here, staying double-wide and overlapping at the seam. Chosen so
// that at the full BRIDGE_CURL the arched slopes' inner edges just meet over the seam:
// a card bowed to BRIDGE_CURL foreshortens to a half-chord ≈0.56, so centres ±OVERLAP
// apart put the raised inner edges just crossing over the middle. Lowering it in step
// with a steeper BRIDGE_CURL shifts each half's felt contact inward for a taller arch.
const OVERLAP = 0.5;
const CURL_LIFT = 0.9; // one-sided curl of a lifted half (radians of inner-edge tangent)
const BRIDGE_CURL = 1.15; // concave-down slope of each bridge half (radians of outer-edge tangent) — steep enough for a peaked arch, shallow enough not to balloon toward the camera
const RIFFLE_W = 0.42; // fraction of the riffle phase one card spends falling (rest is stagger)
const CASCADE_W = 0.4; // fraction of the cascade one card spends falling into the pile (rest is stagger)
const EPS = 1e-3; // below this bend a card is drawn via the cheap flat path

// The looping phase timeline (seconds). rest is the still pause between shuffles.
const PHASES: readonly (readonly [string, number])[] = [
  ['split', 0.55],
  ['lift', 0.35],
  ['riffle', 0.75],
  ['bridge', 0.7],
  ['cascade', 0.65],
  ['rest', 1.5],
];
const LOOP = PHASES.reduce((s, [, d]) => s + d, 0);

const DUMMY: Card = { rank: 0, suit: 0 }; // drawn face-down, so identity is irrelevant

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class DeckShuffle {
  private clock = 0;
  private readonly cx: number;
  private readonly cz: number;

  constructor(
    private readonly back: Texture,
    center: { x: number; z: number },
  ) {
    this.cx = center.x;
    this.cz = center.z;
  }

  // Advance the loop clock (wrapping); dt is the scene's per-frame delta.
  step(dt: number): void {
    this.clock = (this.clock + dt) % LOOP;
  }

  // One full riffle→bridge→cascade→rest cycle, in seconds. Lets a caller run the
  // shuffle a bounded number of cycles (e.g. the between-hands interlude) by owning
  // its own clock and counting `loop`-length passes, rather than looping forever.
  get loop(): number {
    return LOOP;
  }

  // Drive the animation to an explicit clock (0 = squared, start of the cut). Used when
  // an external owner (the between-hands interlude) times the shuffle instead of step().
  setClock(t: number): void {
    this.clock = t;
  }

  // Which phase the clock is in, and 0..1 progress through it.
  private phase(): { name: string; p: number } {
    let t = this.clock;
    for (const [name, dur] of PHASES) {
      if (t < dur) return { name, p: dur > 0 ? t / dur : 1 };
      t -= dur;
    }
    return { name: 'rest', p: 1 };
  }

  // Where card `i` sits (centre + bend) at the current phase. Even i → left half, odd →
  // right half. Three lateral anchors, all offset ±side from centre: `packetX` (split
  // apart), `overlapX` (riffled together but still offset), `settledX = cx` (squared).
  private place(i: number): ArchPlace {
    const even = i % 2 === 0;
    const side = even ? -1 : 1;
    // Mirror the yaw per half so the one-sided `curl` lifts each half's INNER short
    // edge (the one toward the centre seam), leaving the outer edge pinned.
    const yaw = even ? Math.PI / 2 : -Math.PI / 2;
    const settledY = BASE_Y + i * THICK;
    const packetRank = Math.floor(i / 2); // height within its half's little stack
    const packetX = this.cx + side * SEP;
    const overlapX = this.cx + side * OVERLAP;
    const packetY = BASE_Y + packetRank * THICK;

    const { name, p } = this.phase();
    let x = this.cx;
    let y = settledY;
    let curl = 0;
    let dome = false;
    let depth = 0;

    switch (name) {
      case 'split': {
        // A real cut in two stages. rise (first ~half): the top half (odd) lifts straight
        // up into a floating pile while the bottom half (even) squares down on the felt —
        // both still centred at cx. part (second ~half): the halves move apart to packetX,
        // the top pile descending as it goes. Sequenced so you SEE the top lift off first.
        const rise = ease(clamp01(p / 0.5));
        const part = ease(clamp01((p - 0.4) / 0.6));
        x = lerp(this.cx, packetX, part);
        if (even) {
          y = lerp(settledY, packetY, rise); // bottom half: gather down onto the felt
        } else {
          const lifted = lerp(settledY, packetY + SPLIT_LIFT, rise); // top half: lift clear
          y = lerp(lifted, packetY, part); // then set down beside the bottom half
        }
        break;
      }
      case 'lift': {
        // While still apart, each half flexes its inner short edge up off the felt.
        x = packetX;
        y = packetY;
        curl = CURL_LIFT * ease(p);
        break;
      }
      case 'riffle': {
        // The raised halves slide together and interleave: each card releases on a
        // bottom-up stagger (alternating halves), drops to its interleaved HEIGHT AND
        // flattens (curl back to 0), sliding inward only to `overlapX`. The deck ends
        // as two overlapping sections lying flat on the felt — not merged.
        const lag = (1 - RIFFLE_W) / Math.max(1, N - 1);
        const e = ease(clamp01((p - i * lag) / RIFFLE_W));
        x = lerp(packetX, overlapX, e);
        y = lerp(packetY, settledY, e);
        curl = CURL_LIFT * (1 - e);
        break;
      }
      case 'bridge': {
        // Still overlapping (x held at overlapX), each half bows into a concave-down
        // slope rising to the seam apex; `depth` nests the cards as concentric layers so
        // none cross. y drops to BASE_Y because depth (along the up-normal, = +Y when
        // flat) now carries the stacking — at curl 0 this equals the settled stack.
        x = overlapX;
        y = BASE_Y;
        dome = true;
        depth = i * THICK;
        curl = BRIDGE_CURL * ease(p);
        break;
      }
      case 'cascade': {
        // The bridge is released: cards peel off bottom-up (staggered) and fall into a
        // squared pile at the centre — each drops from its slope (overlapX, full curl) to
        // its flat settled spot (cx, curl 0). depth keeps the stack from crossing en route.
        const lag = (1 - CASCADE_W) / Math.max(1, N - 1);
        const e = ease(clamp01((p - i * lag) / CASCADE_W));
        x = lerp(overlapX, this.cx, e);
        y = BASE_Y;
        dome = true;
        depth = i * THICK;
        curl = BRIDGE_CURL * (1 - e);
        break;
      }
      default: // rest: still, squared, flat
        break;
    }
    return { x, y, z: this.cz, yaw, curl, dome, depth };
  }

  // Draw the whole deck at the current phase. Cards that aren't bending take the cheap
  // flat two-quad path (still yawed to match, so there's no orientation pop when a card
  // crosses in or out of bending); only actively-bent cards pay the bent-strip cost.
  draw(target: RenderTarget, vp: Mat4): void {
    for (let i = 0; i < N; i++) {
      const pl = this.place(i);
      if (pl.curl > EPS) {
        drawArchCard(target, vp, pl, DUMMY, this.back);
      } else {
        // Flat card: `depth` (a normal offset that is purely +Y when flat) becomes a
        // plain y lift, so a card crossing in/out of the arch path doesn't jump.
        const m = mat4Multiply(mat4Translate(pl.x, pl.y + pl.depth, pl.z), mat4Multiply(mat4RotY(pl.yaw), flatDown()));
        drawCard(target, vp, m, DUMMY, this.back);
      }
    }
  }
}
