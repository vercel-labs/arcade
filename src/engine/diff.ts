// Frame differ for the unified compositing path. Holds the last flushed frame
// as a shadow Surface; diff(cur) returns escapes for only the cells that changed
// since, then updates the shadow. An idle frame (nothing changed) returns '' — no
// write at all. reset() forces the next diff to repaint everything (used on
// resize / mode switch / after an ESC[2J).

import { Surface } from './surface.ts';

export class CellDiffer {
  private prev: Surface | null = null;

  diff(cur: Surface): string {
    if (!this.prev || this.prev.cols !== cur.cols || this.prev.rows !== cur.rows) {
      // Fresh shadow is all-transparent, so every opaque cell differs → full emit.
      this.prev = new Surface(cur.cols, cur.rows);
    }
    const out = cur.diff(this.prev);
    cur.copyInto(this.prev);
    return out;
  }

  // Drop the shadow so the next diff emits a full frame.
  reset(): void {
    this.prev = null;
  }
}
