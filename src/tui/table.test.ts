import assert from 'node:assert/strict';
import test from 'node:test';
import { distribute } from './distribute.ts';
import { resolveColumns, Table, TableCell, TableHeader, TableRow } from './components/table.ts';
import type { ColumnDef, Node } from './index.ts';

// Widths as they end up on the cells, which is what actually has to agree across rows.
function widthsOf(row: Node): (number | undefined)[] {
  return (row.children ?? []).map((c) => (typeof c.style.width === 'number' ? c.style.width : undefined));
}

test('distribute spends free space by grow weight', () => {
  assert.deepEqual(distribute([0, 0], [1, 1], [0, 0], 10), [5, 5]);
  assert.deepEqual(distribute([0, 0], [3, 1], [0, 0], 8), [6, 2]);
  // Whole cells only, so an uneven split puts the remainder on the last grower.
  assert.deepEqual(distribute([0, 0, 0], [1, 1, 1], [0, 0, 0], 10), [3, 3, 4]);
});

test('distribute leaves sizes alone with nothing to grow into', () => {
  assert.deepEqual(distribute([4, 4], [0, 0], [0, 0], 10), [4, 4]);
  assert.deepEqual(distribute([4, 4], [1, 0], [0, 0], 0), [4, 4]);
});

test('distribute weights shrink by base size', () => {
  // Overflow of 3: the 8-wide item gives up more than the 4-wide one.
  const out = distribute([8, 4], [0, 0], [1, 1], -3);
  assert.equal(out[0] + out[1], 9);
  assert.ok(out[0] < 8 && out[1] < 4);
  assert.ok(8 - out[0] > 4 - out[1]);
});

test('distribute never drives a size below zero', () => {
  for (const v of distribute([2, 2], [0, 0], [1, 1], -100)) assert.ok(v >= 0);
});

test('resolveColumns gives the remainder to the flex column', () => {
  const cols: ColumnDef[] = [{ flex: 1 }, { width: 5 }, { width: 3 }];
  // 20 total, 2 gaps of 1, fixed columns take 8 -> flex gets 10.
  assert.deepEqual(resolveColumns(cols, 20, 1), [10, 5, 3]);
});

test('resolveColumns accounts for the gaps', () => {
  const cols: ColumnDef[] = [{ flex: 1 }, { width: 4 }];
  assert.deepEqual(resolveColumns(cols, 10, 0), [6, 4]);
  assert.deepEqual(resolveColumns(cols, 10, 1), [5, 4]);
  assert.deepEqual(resolveColumns(cols, 10, 3), [3, 4]);
});

test('resolveColumns honours min and max', () => {
  assert.deepEqual(resolveColumns([{ flex: 1, min: 8 }, { width: 5 }], 10, 0), [8, 5]);
  assert.deepEqual(resolveColumns([{ flex: 1, max: 3 }, { width: 5 }], 20, 0), [3, 5]);
});

test('resolveColumns pins fixed columns and shrinks the flexible one', () => {
  // Too narrow for the fixed columns plus the flex minimum: the numeric columns must
  // keep their width, because a clipped digit is worse than a clipped name.
  const cols: ColumnDef[] = [{ flex: 1 }, { width: 5 }, { width: 5 }];
  const w = resolveColumns(cols, 8, 1);
  assert.equal(w[1], 5);
  assert.equal(w[2], 5);
});

test('an auto column sizes to its widest text cell', () => {
  const cols: ColumnDef[] = [{ flex: 1 }, { auto: true }];
  const rows = [
    TableRow({}, [TableCell('a'), TableCell('7')]),
    TableRow({}, [TableCell('b'), TableCell('7 (10)')]),
  ];
  // '7 (10)' is 6 cells, so the auto column takes 6 and the flex column the rest.
  assert.deepEqual(resolveColumns(cols, 20, 1, rows), [13, 6]);
});

test('an auto column collapses when no row needs it', () => {
  const cols: ColumnDef[] = [{ flex: 1 }, { auto: true, min: 2 }];
  const rows = [TableRow({}, [TableCell('a'), TableCell('7')])];
  // Nothing carries the wide form, so the column drops back to its floor and the
  // name column gets the cells back.
  assert.deepEqual(resolveColumns(cols, 20, 1, rows), [17, 2]);
});

test('Table gives the header and every row identical widths', () => {
  const cols: ColumnDef[] = [{ flex: 1 }, { width: 5, align: 'end' }, { width: 3, align: 'end' }];
  const header = TableHeader([TableCell('players'), TableCell('cards'), TableCell('vp')]);
  const rowA = TableRow({}, [TableCell('claude'), TableCell('3'), TableCell('2')]);
  const rowB = TableRow({}, [TableCell('gpt'), TableCell('12'), TableCell('10')]);
  Table({ columns: cols, width: 24, gap: 1 }, [header, rowA, rowB]);

  const expected = [14, 5, 3];
  assert.deepEqual(widthsOf(header), expected);
  assert.deepEqual(widthsOf(rowA), expected);
  assert.deepEqual(widthsOf(rowB), expected);
});

test('Table applies per-column alignment, overridable per cell', () => {
  const cols: ColumnDef[] = [{ flex: 1 }, { width: 5, align: 'end' }];
  const row = TableRow({}, [TableCell('name'), TableCell('3')]);
  const override = TableRow({}, [TableCell('name'), TableCell('3', { align: 'center' })]);
  Table({ columns: cols, width: 12, gap: 1 }, [row, override]);
  assert.equal(row.children?.[1].style.justifyContent, 'end');
  assert.equal(override.children?.[1].style.justifyContent, 'center');
});

test('Table owns the gap, and the row spans the declared width', () => {
  const row = TableRow({ style: { gap: 99 } }, [TableCell('a'), TableCell('b')]);
  const table = Table({ columns: [{ flex: 1 }, { flex: 1 }], width: 11, gap: 1 }, [row]);
  assert.equal(row.style.gap, 1);
  assert.equal(table.style.width, 11);
  // Columns plus gaps fill the row exactly — that's what keeps them aligned.
  const w = widthsOf(row) as number[];
  assert.equal(w[0] + w[1] + 1, 11);
});

test('Table leaves a row style the caller set alone', () => {
  const row = TableRow({ style: { color: 'accent', bold: true } }, [TableCell('x')]);
  Table({ columns: [{ flex: 1 }], width: 6, gap: 0 }, [row]);
  assert.equal(row.style.color, 'accent');
  assert.equal(row.style.bold, true);
});

test('string cells truncate to their column so alignment cannot break', () => {
  const row = TableRow({}, [TableCell('claude-haiku-4.5')]);
  Table({ columns: [{ width: 6 }], width: 6, gap: 0 }, [row]);
  assert.equal(row.children?.[0].children?.[0].style.textOverflow, 'ellipsis');
});

test('Table passes a Node cell through without wrapping its styling', () => {
  const inner = TableRow({}, []); // any node stands in for mixed-style content
  const cell = TableCell(inner);
  assert.equal(cell.children?.[0], inner);
});

test('Table ignores non-row children, so spacers and rules can sit between rows', () => {
  const spacer: Node = { kind: 'box', style: { height: 1 }, children: [] };
  const row = TableRow({}, [TableCell('a')]);
  const table = Table({ columns: [{ flex: 1 }], width: 4, gap: 0 }, [spacer, row]);
  assert.equal(table.children?.length, 2);
  assert.equal(spacer.style.width, undefined); // untouched
  assert.equal(row.children?.[0].style.width, 4);
});
