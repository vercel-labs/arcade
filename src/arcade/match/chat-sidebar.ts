// Shared Arcade chat rail: games supply their long-lived ChatBox instance while this
// collaborator owns the common viewport math and Sidebar chrome.

import { Sidebar, Slot, type Node } from '../../tui/index.ts';
import { ARCADE_CHROME_TEXT, uiChromeBg } from '../theme.ts';
import { CHAT_WIDTH, type ChatBox } from './chat.ts';

const CHAT_PAD_V = 1;
const CHAT_HEADER_H = 2;

export function buildChatSidebar(opts: {
  chat: ChatBox;
  height: number;
  active: boolean;
  onToggle: () => void;
  closeId: string;
  title?: Node | string;
  flexShrink?: number;
}): Node {
  opts.chat.setViewport(Math.max(1, opts.height - 2 * CHAT_PAD_V - CHAT_HEADER_H));
  opts.chat.setActive(opts.active);
  return Sidebar(
    {
      width: CHAT_WIDTH,
      height: opts.height,
      ...(opts.flexShrink != null ? { flexShrink: opts.flexShrink } : {}),
      title: opts.title ?? 'chat',
      closeId: opts.closeId,
      onClose: opts.onToggle,
      background: uiChromeBg(0.9),
      titleColor: ARCADE_CHROME_TEXT.title,
    },
    [Slot(opts.chat.id)],
  );
}
