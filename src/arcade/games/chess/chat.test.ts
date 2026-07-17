import assert from 'node:assert/strict';
import test from 'node:test';
import { Box, Screen, Slot } from '../../../tui/index.ts';
import { ChatBox } from './chat.ts';

function renderedRows(chat: ChatBox, height: number): string[] {
  const width = 36;
  const screen = new Screen(width, height);
  screen.mount(chat);
  screen.setRoot(Box({ width, height }, [Slot(chat.id)]), { x: 0, y: 0, w: width, h: height });
  const surface = screen.snapshot(() => {});
  return Array.from({ length: height }, (_, y) => {
    let text = '';
    for (let x = 0; x < width; x++) text += surface.getCell(x, y)?.ch ?? ' ';
    return text.trimEnd();
  });
}

test('ChatBox keeps first words intact after a long model-name prefix', () => {
  const chat = new ChatBox('chat-wrap-test');
  chat.setViewport(8);
  chat.setActive(true);
  chat.push({
    model: 'xai/grok-4.1-fast-non-reasoning',
    text: 'Gemini, that raise has me thinking',
  });
  chat.push({
    model: 'xai/grok-4.1-fast-non-reasoning',
    text: 'Nice raise Gemini, but I am good.',
  });

  assert.deepEqual(renderedRows(chat, 8).slice(0, 7), [
    'grok-4.1-fast-non-reasoning:',
    'Gemini, that raise has me',
    'thinking',
    '',
    'grok-4.1-fast-non-reasoning:',
    'Nice raise Gemini, but I am',
    'good.',
  ]);
});
