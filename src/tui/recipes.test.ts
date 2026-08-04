import assert from 'node:assert/strict';
import test from 'node:test';
import { FilledButton } from './button.ts';
import { Field } from './components/field.ts';
import { Button } from './nodes.ts';

test('Field composes a muted label with one caller-owned control', () => {
  const child = Button({ id: 'mode', label: 'Board' });
  const field = Field({
    label: 'Mode',
    child,
    style: { gap: 1 },
    labelStyle: { color: 'accent', bold: true },
  });
  assert.deepEqual(field, {
    kind: 'box',
    style: { flexDirection: 'column', gap: 1 },
    children: [
      { kind: 'text', text: 'Mode', id: undefined, style: { color: 'accent', bold: true } },
      child,
    ],
  });
});

test('FilledButton preserves the shared neutral button recipe', () => {
  assert.deepEqual(
    FilledButton({ id: 'submit', label: 'submit' }),
    Button({
      id: 'submit',
      label: 'submit',
      style: {
        padding: [0, 2],
        background: [44, 46, 56],
        color: [212, 214, 224],
        bold: true,
        hover: { background: [238, 240, 248], color: [16, 16, 24] },
        focus: { background: [86, 90, 108], color: [248, 248, 252] },
        pressed: { background: [255, 255, 255], color: [12, 12, 18] },
      },
    }),
  );
});
