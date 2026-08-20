import assert from 'node:assert/strict';
import test from 'node:test';
import { FLIGHT_DUR, ResourceFlights, STAGGER } from './resource-flight.ts';

const FROM = { col: 95, row: 21 };
const TO = { col: 13, row: 74 };

// Drives one flight set at 60fps. The clock accumulates deltas from the times it is handed, so
// the wall time has to keep moving forward across calls — restarting the count each time would
// silently double it.
function stepper(flights: ResourceFlights): (to: number) => string[] {
  let now = 0;
  return (to) => {
    const landed: string[] = [];
    while (now < to - 1e-9) {
      now = Math.min(to, now + 1 / 60);
      landed.push(...flights.advance(now));
    }
    return landed;
  };
}

test('a card leaves its hex and arrives on its card, arcing above the straight line between', () => {
  const flights = new ResourceFlights();
  const run = stepper(flights);
  flights.spawn('brick', 1, FROM, TO, 0);
  flights.advance(0);
  assert.deepEqual(flights.active(), [{ resource: 'brick', col: FROM.col, row: FROM.row, sinking: false }]);

  // Halfway: lifted well above the straight line between the two points, and already past the
  // horizontal midpoint — the column runs on its own faster ease so it is settled before the drop.
  run(FLIGHT_DUR / 2);
  const [mid] = flights.active();
  const straightRow = FROM.row + (TO.row - FROM.row) / 2;
  assert.ok(mid.col < (FROM.col + TO.col) / 2 && mid.col > TO.col, `col ${mid.col} should lead the midpoint without arriving`);
  assert.ok(mid.row < straightRow - 5, `row ${mid.row} should sit above ${straightRow}`);

  // Banked and dropped on the same tick: the target row is already behind the panel, so there is
  // nothing left to draw once it arrives.
  assert.deepEqual(run(FLIGHT_DUR + 0.05), ['brick']);
  assert.equal(flights.busy(), false);
  assert.deepEqual(flights.active(), []);
});

test('the last step before arriving is a half-height sliver, never the full chip', () => {
  const flights = new ResourceFlights();
  const run = stepper(flights);
  flights.spawn('brick', 1, FROM, TO, 0);
  // Walk the final approach and record how the chip is drawn on each frame.
  const states: string[] = [];
  for (let f = Math.round(FLIGHT_DUR * 60) - 24; f <= Math.round(FLIGHT_DUR * 60) + 3; f++) {
    run(f / 60);
    const [c] = flights.active();
    states.push(c ? (c.sinking ? `sink@${c.row}` : `full@${c.row}`) : 'gone');
  }
  // Full chips first, then at least one sliver, then gone — and the sliver sits one row above the
  // target, which is the last row still in front of the panel.
  assert.ok(states.some((s) => s.startsWith('full')), states.join(' '));
  assert.ok(states.includes(`sink@${TO.row - 1}`), states.join(' '));
  assert.equal(states.at(-1), 'gone', states.join(' '));
  assert.ok(states.lastIndexOf(`sink@${TO.row - 1}`) > states.findIndex((s) => s.startsWith('full')), 'the sliver comes after the full chip');
  // A full chip is never drawn on the target row itself — that row is behind the hand.
  assert.ok(!states.includes(`full@${TO.row}`), states.join(' '));
});

test('the column is settled well before the drop, so a landing card never steps sideways', () => {
  const flights = new ResourceFlights();
  const run = stepper(flights);
  flights.spawn('lumber', 1, FROM, TO, 0);
  const cols: number[] = [];
  let firstSink = -1;
  const total = Math.round(FLIGHT_DUR * 60);
  for (let f = 1; f <= total; f++) {
    run(f / 60);
    const [c] = flights.active();
    if (!c) break;
    cols.push(c.col);
    if (c.sinking && firstSink < 0) firstSink = cols.length - 1;
  }
  assert.ok(firstSink > 0, 'the chip should reach its sinking state');
  // Nothing moves horizontally from the moment it starts sinking — that sideways step was the
  // whole bug — and it is parked on the target column, not merely stationary.
  assert.deepEqual([...new Set(cols.slice(firstSink))], [TO.col]);
  // And it settled some frames earlier, so the drop itself is straight down rather than diagonal.
  const settledAt = cols.findIndex((c) => c === TO.col);
  assert.ok(firstSink - settledAt >= 4, `settled at ${settledAt}, sinking at ${firstSink}`);
});

test('a city throws two cards a beat apart, each banked on its own arrival', () => {
  const flights = new ResourceFlights();
  const run = stepper(flights);
  flights.spawn('lumber', 2, FROM, TO, 0);
  // The second is still in the air when the first lands, so the count ticks up twice.
  assert.deepEqual(run(FLIGHT_DUR + STAGGER / 2), ['lumber']);
  assert.equal(flights.busy(), true);
  assert.deepEqual(run(FLIGHT_DUR + STAGGER + 0.05), ['lumber']);
  assert.equal(flights.busy(), false);
});

test('a card is not drawn before its launch, and hexes paying together do not overlap', () => {
  const flights = new ResourceFlights();
  const run = stepper(flights);
  flights.spawn('ore', 1, FROM, TO, 0);
  flights.spawn('grain', 1, { col: 60, row: 30 }, TO, 1); // second hex, offset behind the first
  flights.advance(0);
  assert.deepEqual(flights.active().map((f) => f.resource), ['ore'], 'the staggered card has not left yet');
  run(STAGGER + 0.05);
  assert.deepEqual(flights.active().map((f) => f.resource), ['ore', 'grain']);
});

test('staggered departures are reported separately from landings', () => {
  const flights = new ResourceFlights();
  flights.spawn('ore', 2, FROM, TO, 0);

  assert.deepEqual(flights.advanceWithDepartures(0), { departed: ['ore'], landed: [] });
  assert.deepEqual(flights.advanceWithDepartures(STAGGER / 2), { departed: [], landed: [] });
  assert.deepEqual(flights.advanceWithDepartures(STAGGER + 0.01), { departed: ['ore'], landed: [] });
  assert.deepEqual(flights.advanceWithDepartures(FLIGHT_DUR + 0.01), { departed: [], landed: ['ore'] });
  assert.deepEqual(flights.advanceWithDepartures(FLIGHT_DUR + STAGGER + 0.02), { departed: [], landed: ['ore'] });
});

test('draining preserves whether each staggered card has left its source', () => {
  const flights = new ResourceFlights();
  flights.spawn('grain', 2, FROM, TO, 0);
  flights.advanceWithDepartures(0);

  assert.deepEqual(flights.drainPending(), [
    { resource: 'grain', departed: true },
    { resource: 'grain', departed: false },
  ]);
  assert.equal(flights.busy(), false);
});

test('a reverse trade flight stays visible while rising from the hand toward the bank', () => {
  const flights = new ResourceFlights();
  const run = stepper(flights);
  flights.spawn('brick', 1, TO, FROM, 0, 7, false);
  flights.advance(0);
  assert.deepEqual(flights.active(), [{ resource: 'brick', col: TO.col, row: TO.row, sinking: false }]);

  run(FLIGHT_DUR / 2);
  const [mid] = flights.active();
  assert.ok(mid, 'the reverse flight should remain visible while approaching from below');
  assert.equal(mid.sinking, false);

  assert.deepEqual(run(FLIGHT_DUR + 0.05), ['brick']);
  assert.deepEqual(flights.active(), []);
});
