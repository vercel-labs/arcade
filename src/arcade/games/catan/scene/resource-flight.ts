// Compact Catan cards flying from a source pile to the hand card they land on.
//
// Rolls, maritime trades, and development purchases all use the same screen-space arc and delayed
// settlement. Staggered cards report departure and landing separately so their source and hand
// counts can tick at the exact moments represented by the animation.
//
// These live in screen cells, not the 3D scene. They are projected once at launch and then follow
// a flat 2D arc, the same way the number chips are 2D overlays pinned to a projected point — the
// board can keep animating underneath without dragging a card off its path. The HUD draws them
// last so they pass over the scene AND over the hand panel.

import { FrameClock, smoothstep } from '../../../../engine/index.ts';
import { type Resource } from '../../../../rules/catan/types.ts';

// Where a card is right now, for the HUD to place a glyph.
export interface FlyingResource<Card extends string = Resource> {
  resource: Card;
  col: number;
  row: number;
  // The chip is passing behind the hand panel's top edge: only its upper part is still clear, and
  // that part sits in the bottom half of `row`. The HUD draws it as a half block — an emoji has no
  // half-height form, so the glyph drops and the fill alone carries the last step.
  sinking: boolean;
}

interface Flight<Card extends string> {
  batch: number;
  resource: Card;
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
  launchAt: number; // clock time this card leaves the tile
  arc: number; // peak lift above the straight line, in rows
  sinkAtTarget: boolean;
  departed: boolean;
  banked: boolean;
}

export interface ResourceFlightAdvance<Card extends string = Resource> {
  departed: Card[];
  landed: Card[];
}

export interface DrainedResourceFlight<Card extends string = Resource> {
  resource: Card;
  departed: boolean;
}

// Exported so tuning these does not silently invalidate the tests that step through a flight.
export const FLIGHT_DUR = 1.2; // seconds in the air
export const STAGGER = 0.25; // between cards out of the same hex — enough to read as separate arrivals
// The lift scales with how far the card travels, so a short hop does not loop absurdly high and a
// cross-screen throw still clears the board. Rows, not cells: a cell is about twice as tall as it
// is wide, so an arc measured in rows reads much deeper than the same number of columns.
const ARC_PER_COL = 0.22;
const ARC_MIN = 3;
const ARC_MAX = 12;
// The horizontal is finished this far into the flight, leaving the rest a straight drop.
//
// Sharing one progress between both axes put the chip over its card while it was still a column or
// two out, so it visibly stepped sideways after it had already begun sinking. That is a mismatch of
// scale, not of timing: the row spans a third of what the column does, so "within one row of the
// target" — where the sink begins — arrives while the column still has cells to cover. Settling the
// column first turns the ending into a drop onto a fixed spot, and the sideways step cannot happen
// because there is no sideways left.
const COL_SETTLE = 0.86;

export class ResourceFlights<Card extends string = Resource> {
  private flights: Flight<Card>[] = [];
  private readonly clock = new FrameClock();
  private nextBatch = 1;
  private readonly batches = new Map<number, { remaining: number; resolve: () => void }>();

  // Throw `count` cards from one hex, staggered. `order` offsets the whole group so several hexes
  // paying at once do not launch on top of each other.
  spawn(
    resource: Card,
    count: number,
    from: { col: number; row: number },
    to: { col: number; row: number },
    order: number,
    maxArc = ARC_MAX,
    sinkAtTarget = true,
  ): Promise<void> {
    if (count <= 0) return Promise.resolve();
    const batch = this.nextBatch++;
    let resolveBatch: () => void = () => {};
    const completion = new Promise<void>((resolve) => { resolveBatch = resolve; });
    this.batches.set(batch, { remaining: count, resolve: resolveBatch });
    const span = Math.hypot(to.col - from.col, (to.row - from.row) * 2);
    const arc = Math.max(ARC_MIN, Math.min(maxArc, span * ARC_PER_COL));
    for (let i = 0; i < count; i++) {
      this.flights.push({
        batch,
        resource,
        fromCol: from.col,
        fromRow: from.row,
        toCol: to.col,
        toRow: to.row,
        launchAt: this.clock.elapsed + (order + i) * STAGGER,
        arc,
        sinkAtTarget,
        departed: false,
        banked: false,
      });
    }
    return completion;
  }

  busy(): boolean {
    return this.flights.length > 0;
  }

  // Hand back every card still in the air and forget them. For leaving the screen mid-roll: the
  // clock is fed the app's monotonic time, so coming back later would advance it by the whole
  // absence and land the lot in one tick. The caller banks what it gets — the roll did happen,
  // so the cards are owed whether or not their animation got to finish.
  drain(): Card[] {
    return this.drainPending().map((flight) => flight.resource);
  }

  // Trade flights need to distinguish cards that have already left the bank from staggered cards
  // that are still waiting on its face. Production only needs `drain`; this richer form lets a
  // caller settle both states correctly when the screen closes mid-animation.
  drainPending(): DrainedResourceFlight<Card>[] {
    const owed = this.flights.map((f) => ({ resource: f.resource, departed: f.departed }));
    this.flights = [];
    for (const pending of this.batches.values()) pending.resolve();
    this.batches.clear();
    this.clock.reset();
    return owed;
  }

  // Advance to `t` and report each card that touched down on this tick, in arrival order. The
  // caller banks them — nothing here touches the hand.
  advance(t: number): Card[] {
    return this.advanceWithDepartures(t).landed;
  }

  // Advance to `t`, reporting the two inventory boundaries independently. A trade removes a
  // card from the bank at departure and adds it to the hand at landing; ordinary production
  // callers can keep using `advance`, which reports landings exactly as before.
  advanceWithDepartures(t: number): ResourceFlightAdvance<Card> {
    this.clock.tick(t);
    if (!this.flights.length) return { departed: [], landed: [] };
    const departed: Card[] = [];
    const landed: Card[] = [];
    for (const flight of this.flights) {
      if (!flight.departed && this.clock.elapsed >= flight.launchAt) {
        flight.departed = true;
        departed.push(flight.resource);
      }
      if (!flight.banked && this.clock.elapsed >= flight.launchAt + FLIGHT_DUR) {
        flight.banked = true;
        landed.push(flight.resource);
        const batch = this.batches.get(flight.batch);
        if (batch) {
          batch.remaining--;
          if (batch.remaining <= 0) {
            this.batches.delete(flight.batch);
            batch.resolve();
          }
        }
      }
    }
    // The target row is the panel's first row, so a card is fully behind the hand at the instant
    // it arrives — it is banked and dropped on the same tick, with nothing left to draw.
    this.flights = this.flights.filter((f) => !f.banked);
    // Idle runs reset the clock so the next roll starts from zero and launch times stay small.
    if (!this.flights.length) this.clock.reset();
    return { departed, landed };
  }

  // Cards currently in the air. A card that has not launched yet is not drawn — it is still
  // sitting in the tile.
  active(): FlyingResource<Card>[] {
    const out: FlyingResource<Card>[] = [];
    for (const flight of this.flights) {
      if (!flight.departed) continue;
      const p = (this.clock.elapsed - flight.launchAt) / FLIGHT_DUR;
      // Eased, so the card leaves the tile gently, covers the distance quickly, then settles onto
      // its card slowly enough to watch it arrive. Only the pacing changes — the path through
      // space is the same curve either way. Clamped at 1, so a card in its landing hold sits
      // still on the target rather than sailing past it.
      const progress = smoothstep(Math.min(1, p));
      // Straight line in both axes, then lift by a parabola that is zero at each end and peaks at
      // the midpoint. Subtracting raises it: rows count downward.
      const lift = flight.arc * 4 * progress * (1 - progress);
      const row = flight.fromRow + (flight.toRow - flight.fromRow) * progress - lift;
      const col = Math.round(flight.fromCol + (flight.toCol - flight.fromCol) * smoothstep(Math.min(1, p / COL_SETTLE)));
      // Incoming cards descend behind the hand's top edge, so they use the clipped half-cell
      // finish below. A trade payment approaches its bank pile in the opposite direction; keep
      // that chip whole until it reaches the pile rather than applying the hand-only clipping
      // rule, which would hide it for most of an upward flight.
      if (!flight.sinkAtTarget) {
        out.push({ resource: flight.resource, col, row: Math.round(row), sinking: false });
        continue;
      }
      // How much of the chip's one row is still clear of the card. It occupies [row, row + 1) and
      // everything from `toRow` down is the card face, so this shrinks to zero as it arrives.
      // Half cells are the finest vertical step a glyph has, so the sink is two states: whole
      // chip, then a half-height bar of fill, then gone.
      //
      // The switch to the bar happens as soon as ANY of the chip is over the card, and it holds
      // until none of it is. Splitting the last row evenly between the two states looks more
      // correct but gave the bar barely one frame: easing means the chip creeps through its final
      // row over many frames, and cutting early threw all of them away. Holding the bar to the
      // very end spends that deceleration on the part of the motion worth watching.
      const clear = flight.toRow - row;
      if (clear <= 0) continue;
      if (clear < 1) {
        out.push({ resource: flight.resource, col, row: flight.toRow - 1, sinking: true });
        continue;
      }
      out.push({ resource: flight.resource, col, row: Math.round(row), sinking: false });
    }
    return out;
  }
}
