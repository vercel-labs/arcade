import type { Node, Screen } from '../../../tui/index.ts';
import { buildChatSidebar } from '../../match/chat-sidebar.ts';
import { ChatBox, type ChatMessage } from '../../match/chat.ts';

const pokerChat = new ChatBox('poker-chat');

export function mountPokerChat(ui: Screen): void {
  ui.mount(pokerChat);
}

export function pushPokerChat(msg: ChatMessage): void {
  pokerChat.push(msg);
}

export function clearPokerChat(): void {
  pokerChat.clear();
}

export function buildPokerChatSidebar(height: number, active: boolean, onToggle: () => void, composer?: Node): Node {
  return buildChatSidebar({ chat: pokerChat, height, active, onToggle, closeId: 'poker-chat-close', composer });
}
