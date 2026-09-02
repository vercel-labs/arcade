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
//             seam), flattens, and gains combined-deck spacing only along its overlapping
//             inner end. The exposed outside retains the original half-packet thickness.
//   bridge  — WITHOUT squaring up, the two still-overlapping halves bow UP into one
//             arch. Each card rises from its outer felt contact into a short, level apex
//             section; the interleaved inner ends overlap only on that shared horizontal
//             section, where `depth` keeps every card in a stable vertical order. Lower
//             layers reach farther across the seam; upper layers overlap progressively less.
//   cascade — the bridge is released: cards peel off the arch bottom-up, one by one, and
//             FALL into a squared pile building below the apex. Small deterministic timing
//             variations keep the release from reading as a perfectly uniform shell.
//   rest    — a still, squared stack, then the loop repeats.
//
// Continuity trick: the settled stack is FIXED and the phases interpolate between the
// settled position and the split/overlap positions (even i → left comb, odd i → right
// comb). Every card's (x, y, curl, edgeDepth, depth) is continuous across each phase boundary, so
// the loop never pops.

import { type Mat4, mat4Multiply, mat4RotY, mat4Translate, type RenderTarget, smoothstep, type Texture } from '../../engine/index.ts';
import type { Card } from '../../rules/poker/cards.ts';
import { type ArchPlace, type CardFaceTextureProvider, drawArchCard, drawCard, flatDown } from './card-render.ts';
import { pokerCardFaceTexture } from './cards.ts';

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
// Half-offset each half keeps AFTER the riffle: the piles remain visibly double-wide and
// overlapping at the seam, then receive only a subtle additional pinch during the bridge.
const OVERLAP = 0.5;
const BRIDGE_PINCH = 0.12; // inward centre shift at the bridge apex
const BRIDGE_LAYER_FAN = 0.08; // bottom cards overlap more; top cards retain wider centres
const TOP_COVER_INSET = 0.07; // make the final card visibly cover, rather than meet, the other packet
const CURL_LIFT = 0.9; // one-sided curl of a lifted half (radians of inner-edge tangent)
const BRIDGE_CURL = 1.5; // steeper start preserves the arch height with a level inner apex
const RIFFLE_W = 0.42; // fraction of the riffle phase one card spends falling (rest is stagger)
const RIFFLE_STACK_AT = 0.55; // keep packet thickness until a released card mostly overlaps
const RIFFLE_EDGE_COVER_AT = 0.72; // buried inner borders disappear before the bridge handoff
const CASCADE_W = 0.4; // fraction of the cascade one card spends falling into the pile (rest is stagger)
const CASCADE_JITTER = 0.008; // deterministic variation in per-card release timing
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

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class DeckShuffle {
  private clock = 0;
  private readonly cx: number;
  private readonly cz: number;

  constructor(
    private readonly back: Texture,
    center: { x: number; z: number },
    private readonly faceTexture: CardFaceTextureProvider = pokerCardFaceTexture,
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
    this.clock = ((t % LOOP) + LOOP) % LOOP;
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
    // Every card keeps one physical orientation for the entire shuffle. Mirror only
    // the outer→inner bend coordinate so both packets lift toward the centre without
    // turning either packet (and its directional back artwork) by 180°.
    const yaw = Math.PI / 2;
    const bendDirection: 1 | -1 = even ? 1 : -1;
    const settledY = BASE_Y + i * THICK;
    const packetRank = Math.floor(i / 2); // height within its half's little stack
    const packetX = this.cx + side * SEP;
    const overlapX = this.cx + side * OVERLAP;
    const packetT = packetRank / (N / 2 - 1);
    const layerFan = BRIDGE_LAYER_FAN * (packetT * 2 - 1);
    const bridgeX = this.cx + side * (OVERLAP - BRIDGE_PINCH + layerFan);
    const covering = i === N - 1;
    const riffledX = overlapX - (covering ? side * TOP_COVER_INSET : 0);
    const coveredBridgeX = bridgeX - (covering ? side * TOP_COVER_INSET : 0);
    const packetY = BASE_Y + packetRank * THICK;

    const { name, p } = this.phase();
    let x = this.cx;
    let y = settledY;
    let curl = 0;
    let dome = false;
    let innerEdgeVisibility = 1;
    let edgeDepth = 0;
    let depth = 0;

    switch (name) {
      case 'split': {
        // A real cut in two stages. rise (first ~half): the top half (odd) lifts straight
        // up into a floating pile while the bottom half (even) squares down on the felt —
        // both still centred at cx. part (second ~half): the halves move apart to packetX,
        // the top pile descending as it goes. Sequenced so you SEE the top lift off first.
        const rise = smoothstep(p / 0.5);
        const part = smoothstep((p - 0.4) / 0.6);
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
        curl = CURL_LIFT * smoothstep(p);
        break;
      }
      case 'riffle': {
        // The raised halves slide together and interleave: each card releases on a
        // bottom-up stagger (alternating halves) and flattens while sliding inward. Its
        // outer end retains packet-local spacing; only the inner end fans toward the
        // combined interleaved order once most of the horizontal overlap is present.
        const lag = (1 - RIFFLE_W) / Math.max(1, N - 1);
        const e = smoothstep((p - i * lag) / RIFFLE_W);
        const stack = smoothstep((e - RIFFLE_STACK_AT) / (1 - RIFFLE_STACK_AT));
        // The final card travels the last few centimetres farther across the seam so its
        // face visibly covers the opposing packet. Delay that inset until stacking begins;
        // the early riffle trajectory stays identical.
        x = lerp(packetX, overlapX, e) - (covering ? side * TOP_COVER_INSET * stack : 0);
        y = BASE_Y;
        edgeDepth = packetRank * THICK;
        depth = lerp(packetRank * THICK, i * THICK, stack);
        curl = CURL_LIFT * (1 - e);
        // The final card owns the visible top boundary. Once it has crossed the seam,
        // let its inner edge settle faster than the remaining riffle cards so that its
        // fully-visible border lies over the opposing packet instead of standing upright
        // through it like a blade. Squaring (1-e) keeps both endpoints continuous.
        if (covering) curl *= 1 - e;
        if (!covering) {
          const covered = smoothstep((e - RIFFLE_EDGE_COVER_AT) / (1 - RIFFLE_EDGE_COVER_AT));
          innerEdgeVisibility = 1 - covered;
        }
        break;
      }
      case 'bridge': {
        // Keep the subtle inward motion and fan the centres by packet rank: bottom cards
        // overlap farther across the seam, while top cards stay progressively wider. The
        // flat inner apex keeps the opposing surfaces depth-ordered instead of crossing.
        const arch = smoothstep(p);
        x = lerp(riffledX, coveredBridgeX, arch);
        y = BASE_Y;
        dome = true;
        innerEdgeVisibility = covering ? 1 : 0;
        edgeDepth = packetRank * THICK;
        depth = i * THICK;
        curl = BRIDGE_CURL * arch;
        break;
      }
      case 'cascade': {
        // The bridge is released: cards peel off bottom-up (staggered) and fall into a
        // squared pile at the centre. A tiny repeatable delay variation breaks the rigid
        // cadence while preserving the overall bottom-to-top release order.
        const lag = (1 - CASCADE_W - CASCADE_JITTER) / Math.max(1, N - 1);
        const jitter = (((i * 7) % 5) / 4) * CASCADE_JITTER;
        const e = smoothstep((p - (i * lag + jitter)) / CASCADE_W);
        x = lerp(coveredBridgeX, this.cx, e);
        y = BASE_Y;
        dome = true;
        innerEdgeVisibility = covering ? 1 : 0;
        edgeDepth = lerp(packetRank * THICK, i * THICK, e);
        depth = i * THICK;
        curl = BRIDGE_CURL * (1 - e);
        break;
      }
      default: // rest: still, squared, flat
        break;
    }
    return { x, y, z: this.cz, yaw, bendDirection, curl, dome, innerEdgeVisibility, edgeDepth, depth };
  }

  // Draw the whole deck. `yawOverride` is only for the caller's post-shuffle turn after
  // the rest pose has settled; the riffle/bridge choreography always uses each card's
  // native yaw. A card uses the strip path while bent or depth-fanned.
  draw(target: RenderTarget, vp: Mat4, yawOverride?: number): void {
    for (let i = 0; i < N; i++) {
      const native = this.place(i);
      const pl = yawOverride === undefined ? native : { ...native, yaw: yawOverride };
      if (pl.curl > EPS || Math.abs(pl.depth - pl.edgeDepth) > EPS) {
        drawArchCard(target, vp, pl, DUMMY, this.back, 1, this.faceTexture);
      } else {
        // Flat card: `depth` (a normal offset that is purely +Y when flat) becomes a
        // plain y lift, so a card crossing in/out of the arch path doesn't jump.
        const m = mat4Multiply(mat4Translate(pl.x, pl.y + pl.depth, pl.z), mat4Multiply(mat4RotY(pl.yaw), flatDown()));
        drawCard(target, vp, m, DUMMY, this.back, 1, this.faceTexture);
      }
    }
  }

  /** Read one deterministic card pose for browser timelines and diagnostics. */
  placement(i: number): ArchPlace {
    return this.place(i);
  }
}
