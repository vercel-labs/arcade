// A column-aligned table: one width agreement, shared by the header and every row.
//
// Flexbox alone cannot do this. Each row is its own flex container, so widths resolve
// per-row and don't line up across rows — which is why HTML tables need an algorithm
// separate from flex, and why every HUD that wanted aligned columns ended up declaring
// fixed widths and hand-subtracting them from its container to find the flexible one.
// Table resolves the columns ONCE and writes the result onto each row's cells.
//
// Presentational only, like shadcn/ui's Table: it does not own your rows. Callers build
// TableRows themselves, so a row stays free to carry a seat color, a turn marker, a
// click handler, per-cell flag colors, or to sit inside a ScrollBox. Table's whole job
// is the arithmetic nobody wants to repeat.

import { stringWidth } from '../../engine/width.ts';
import { distribute } from '../distribute.ts';
import { Box, Text } from '../nodes.ts';
import type { Justify, Node, Style } from '../types.ts';

export interface ColumnDef {
  // Exactly one sizing mode. `width` is fixed cells; `flex` takes a share of whatever
  // is left over; `auto` sizes to the widest text cell in this column, which is how a
  // column can grow only when the data needs it (and collapse again when it doesn't).
  width?: number;
  flex?: number;
  auto?: boolean;
  min?: number;
  max?: number;
  // How much of an overflow this column absorbs, relative to the others. 0 pins it.
  shrink?: number;
  // Horizontal placement of the cell's content. Numbers read best end-aligned so their
  // digits line up; labels read best from the start.
  align?: 'start' | 'center' | 'end';
}

export interface TableOpts {
  columns: ColumnDef[];
  // Total cells the row spans, columns and gaps together.
  width: number;
  // Cells between columns. Named to match CSS, where column-gap and row-gap are
  // separate — a table usually wants tight columns and breathing room between rows.
  gap?: number;
  rowGap?: number;
  style?: Style;
}

const JUSTIFY: Record<NonNullable<ColumnDef['align']>, Justify> = {
  start: 'start',
  center: 'center',
  end: 'end',
};

// Marks a Box as a Table cell so Table can find it and stamp a width on it, without
// the marker meaning anything to layout or paint.
const CELL = Symbol('tableCell');
const ROW = Symbol('tableRow');

interface Cell extends Node {
  [CELL]?: { align?: ColumnDef['align']; measure: string | null };
}
interface Row extends Node {
  [ROW]?: true;
}

export interface CellOpts {
  align?: ColumnDef['align'];
  style?: Style;
}

// One cell. A string becomes a Text that truncates to its column (a column is a
// promise about width, so overflowing it would break the alignment the table exists
// for); a Node is passed through untouched for callers that need mixed styling inside
// one cell. Only string cells can be measured, so an `auto` column sizes off those.
export function TableCell(content: string | Node, opts: CellOpts = {}): Node {
  const child: Node =
    typeof content === 'string'
      ? Text({ text: content, style: { ...opts.style, textOverflow: opts.style?.textOverflow ?? 'ellipsis' } })
      : content;
  const cell: Cell = Box({ overflow: 'hidden' }, [child]);
  cell[CELL] = { align: opts.align, measure: typeof content === 'string' ? content : null };
  return cell;
}

export interface RowOpts {
  style?: Style;
}

// A row of cells. An ordinary Box — style it, give it an onMouse, nest it, whatever the
// caller needs. Cells inherit the row's color unless they set their own.
export function TableRow(opts: RowOpts, cells: Node[]): Node {
  const row: Row = Box({ flexDirection: 'row', ...opts.style }, cells);
  row[ROW] = true;
  return row;
}

// A header row. Same geometry as any other row; the muted styling is the only
// difference, and a caller can override it.
export function TableHeader(cells: Node[], opts: RowOpts = {}): Node {
  return TableRow({ style: opts.style }, cells);
}

function clamp(v: number, c: ColumnDef): number {
  let out = v;
  if (c.min != null) out = Math.max(out, c.min);
  if (c.max != null) out = Math.min(out, c.max);
  return Math.max(0, Math.round(out));
}

function cellsOf(row: Node): Cell[] {
  return (row.children ?? []).filter((c): c is Cell => (c as Cell)[CELL] != null);
}

// The widest string cell in each column, for `auto` sizing. Rows are scanned rather
// than the data, so a caller doesn't have to tell Table twice what its content is.
function autoWidths(columns: ColumnDef[], rows: Node[]): number[] {
  const widest = columns.map(() => 0);
  for (const row of rows) {
    if ((row as Row)[ROW] !== true) continue;
    cellsOf(row).forEach((cell, i) => {
      const text = cell[CELL]?.measure;
      if (i < widest.length && text != null) widest[i] = Math.max(widest[i], stringWidth(text));
    });
  }
  return widest;
}

// Concrete cell widths for one column set at one total width. Exported because the
// occasional caller needs the numbers themselves (a scene viewport inset, a scrollbar
// reservation) rather than a built tree.
export function resolveColumns(columns: ColumnDef[], total: number, gap: number, rows: Node[] = []): number[] {
  if (columns.length === 0) return [];
  const auto = autoWidths(columns, rows);
  const base = columns.map((c, i) => clamp(c.auto ? auto[i] : (c.width ?? 0), c));
  const gaps = gap * Math.max(0, columns.length - 1);
  const free = total - gaps - base.reduce((a, v) => a + v, 0);
  const sized = distribute(
    base,
    columns.map((c) => c.flex ?? 0),
    columns.map((c) => c.shrink ?? (c.flex ? 1 : 0)),
    free,
  );
  // distribute() knows nothing about per-column bounds, so re-clamp after it spends.
  // Space a max clips off is NOT handed back to the other columns — CSS runs the
  // distribution again to do that, and a single pass is enough for a table whose
  // columns are mostly fixed with one flexible one.
  return sized.map((v, i) => clamp(v, columns[i]));
}

// Resolve the columns, then stamp each row's cells with their width and alignment.
// Rows are mutated in place — they were built moments ago by the caller for exactly
// this tree, the same way Screen.expand() fills in Slot children before layout.
export function Table(opts: TableOpts, rows: Node[]): Node {
  const gap = opts.gap ?? 0;
  const widths = resolveColumns(opts.columns, opts.width, gap, rows);
  for (const row of rows) {
    if ((row as Row)[ROW] !== true) continue;
    row.style = { ...row.style, gap };
    cellsOf(row).forEach((cell, i) => {
      if (i >= widths.length) return;
      const align = cell[CELL]?.align ?? opts.columns[i].align ?? 'start';
      cell.style = { ...cell.style, width: widths[i], justifyContent: JUSTIFY[align] };
    });
  }
  return Box({ flexDirection: 'column', width: opts.width, gap: opts.rowGap ?? 0, ...opts.style }, rows);
}
