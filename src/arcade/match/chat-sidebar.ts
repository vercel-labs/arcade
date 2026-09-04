// Shared Arcade chat rail: games supply their long-lived ChatBox instance while this
// collaborator owns the common viewport math and Sidebar chrome. A composer (the human's
// table-talk field) sits under the transcript and takes its rows from the viewport.

import { Box, Sidebar, SIDEBAR_PAD_L, SIDEBAR_PAD_R, Slot, type Node } from '../../tui/index.ts';
import { ARCADE_CHROME_TEXT, uiChromeBg } from '../theme.ts';
import { CHAT_WIDTH, type ChatBox } from './chat.ts';

const CHAT_PAD_V = 1;
const CHAT_HEADER_H = 2;
const COMPOSER_GAP = 1;
// The rail's right padding is zero so the transcript's scrollbar can sit on the edge; the
// field has no scrollbar, so it stops short of the edge by the same inset the header's ✕ uses.
const COMPOSER_PAD_R = 2;

// The width a composer should be built at inside the rail's padding.
export const CHAT_COMPOSER_W = CHAT_WIDTH - SIDEBAR_PAD_L - SIDEBAR_PAD_R - COMPOSER_PAD_R;

export function buildChatSidebar(opts: {
  chat: ChatBox;
  height: number;
  active: boolean;
  onToggle: () => void;
  closeId: string;
  title?: Node | string;
  flexShrink?: number;
  // Built at CHAT_COMPOSER_W with a numeric `style.height` (ChatComposer.build does both).
  composer?: Node;
}): Node {
  const composerH = typeof opts.composer?.style.height === 'number' ? opts.composer.style.height + COMPOSER_GAP : 0;
  opts.chat.setViewport(Math.max(1, opts.height - 2 * CHAT_PAD_V - CHAT_HEADER_H - composerH));
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
    opts.composer
      ? [Box({ flexDirection: 'column', gap: COMPOSER_GAP, overflow: 'visible' }, [Slot(opts.chat.id), opts.composer])]
      : [Slot(opts.chat.id)],
  );
}
