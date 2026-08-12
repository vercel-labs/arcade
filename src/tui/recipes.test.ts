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

test('Field composes a horizontal labeled row with aligned controls', () => {
  const first = Button({ id: 'creator', label: 'OpenAI' });
  const second = Button({ id: 'model', label: 'GPT' });
  const field = Field({ label: 'white', child: [first, second], direction: 'row', labelWidth: 8 });
  assert.deepEqual(field, {
    kind: 'box',
    style: { flexDirection: 'row', gap: 1, alignItems: 'start' },
    children: [
      {
        kind: 'box',
        style: { width: 8 },
        children: [{ kind: 'text', text: 'white', id: undefined, style: { color: 'textMuted' } }],
      },
      first,
      second,
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
        background: 'surfaceControl',
        color: 'textPrimary',
        bold: true,
        hover: { background: 'controlHoverBg', color: 'controlHoverFg' },
        focus: { background: 'controlFocusBg', color: 'controlFocusFg' },
        pressed: { background: 'controlPressedBg', color: 'controlPressedFg' },
        disabled: { background: 'disabledBg', color: 'disabledFg' },
      },
    }),
  );
});
