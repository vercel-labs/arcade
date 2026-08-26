import { Box, Button, Input, Slot, Text, type Node, type Screen } from '../../../tui/index.ts';
import { UI_CHROME_PILL } from '../../theme.ts';

interface ChatTarget {
  seat: number;
  label: string;
}

let targets: ChatTarget[] = [];
let targetIndex = -1;
let submit: (text: string, targetSeat?: number) => boolean = () => false;

const input = new Input({
  id: 'catan-chat-input',
  width: 25,
  placeholder: 'say something…',
  onEnter: (value) => {
    const target = targets[targetIndex];
    if (!submit(value, target?.seat)) return;
    input.value = '';
    input.caret = 0;
  },
});

export function mountCatanChatComposer(ui: Screen): void {
  ui.mount(input);
}

export function configureCatanChatComposer(next: {
  targets: readonly ChatTarget[];
  onSubmit: (text: string, targetSeat?: number) => boolean;
}): void {
  targets = [...next.targets];
  submit = next.onSubmit;
  if (targetIndex >= targets.length) targetIndex = -1;
}

export function buildCatanChatComposer(): Node {
  const target = targets[targetIndex];
  const cycleTarget = (): void => {
    targetIndex++;
    if (targetIndex >= targets.length) targetIndex = -1;
  };
  return Box({ flexDirection: 'column', gap: 1 }, [
    Text({ text: 'table talk', style: { color: 'muted', bold: true } }),
    Box({ flexDirection: 'row', gap: 1 }, [
      Button({
        id: 'catan-chat-target',
        label: target ? `to ${target.label}` : 'to table',
        onClick: cycleTarget,
        style: { ...UI_CHROME_PILL, width: 10 },
      }),
      Slot('catan-chat-input'),
    ]),
  ]);
}
