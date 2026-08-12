// Flexbox's main-axis sizing step, on its own: given each item's base size and its
// grow/shrink weights, spend (or reclaim) the free space.
//
// Extracted because two callers need the identical rule. layout.ts applies it to a
// flex container's children; components/table.ts applies it to a set of COLUMN
// specs whose result is then shared by every row. If the two drifted, a table's
// header and its rows could be sized by one rule while the flex row containing
// them was sized by another, and the columns would stop lining up — which is the
// whole reason the table resolves widths itself.

// Grow leftovers go to the LAST growing item rather than being spread, because
// cells are whole and a half-cell rounding error has to land somewhere. Shrink
// weights by base size, matching CSS: a wide item gives up more than a narrow one.
export function distribute(base: readonly number[], grow: readonly number[], shrink: readonly number[], free: number): number[] {
  const out = base.slice();
  if (free > 0) {
    const totalGrow = grow.reduce((a, v) => a + v, 0);
    if (totalGrow <= 0) return out;
    let spent = 0;
    let last = -1;
    for (let i = 0; i < out.length; i++) {
      if (grow[i] <= 0) continue;
      const add = Math.floor((free * grow[i]) / totalGrow);
      out[i] += add;
      spent += add;
      last = i;
    }
    if (last >= 0) out[last] += free - spent;
  } else if (free < 0) {
    const weighted = base.map((bv, i) => bv * (shrink[i] ?? 1));
    const totalW = weighted.reduce((a, v) => a + v, 0) || 1;
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.max(0, out[i] - Math.round((-free * weighted[i]) / totalW));
    }
  }
  return out;
}
