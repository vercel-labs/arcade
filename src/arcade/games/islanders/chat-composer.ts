import { Box, Button, Input, Slot, type Node, type Screen } from '../../../tui/index.ts';
import { UI_CHROME_PILL } from '../../theme.ts';

export interface ChatTarget {
  seat: number;
  label: string;
}

interface ActiveMention {
  start: number;
  query: string;
}

let targets: ChatTarget[] = [];
let suggestions: ChatTarget[] = [];
let suggestionIndex = 0;
let submit: (text: string, targetSeats: readonly number[]) => boolean = () => false;

function activeMention(value: string, caret: number): ActiveMention | null {
  const start = value.lastIndexOf('@', Math.max(0, caret - 1));
  if (start < 0) return null;
  if (start > 0 && /[\p{L}\p{N}_]/u.test(value[start - 1] ?? '')) return null;
  const query = value.slice(start + 1, caret);
  if (query.includes('\n') || query.includes('@')) return null;
  return { start, query };
}

export function islandersChatMentionCandidates(
  value: string,
  caret: number,
  available: readonly ChatTarget[],
): ChatTarget[] {
  const mention = activeMention(value, caret);
  if (!mention) return [];
  const query = mention.query.toLowerCase();
  return available.filter((target) => target.label.toLowerCase().startsWith(query));
}

export function completeIslandersChatMention(
  value: string,
  caret: number,
  target: ChatTarget,
): { value: string; caret: number } {
  const mention = activeMention(value, caret);
  if (!mention) return { value, caret };
  const insertion = `@${target.label} `;
  return {
    value: value.slice(0, mention.start) + insertion + value.slice(caret),
    caret: mention.start + insertion.length,
  };
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseIslandersChatMentions(text: string, available: readonly ChatTarget[]): number[] {
  return available
    .slice()
    .sort((a, b) => b.label.length - a.label.length)
    .filter((target) => new RegExp(`@${regexEscape(target.label)}(?=$|[\\s,;:!?])`, 'i').test(text))
    .map((target) => target.seat)
    .filter((seat, index, seats) => seats.indexOf(seat) === index);
}

function refreshSuggestions(): void {
  suggestions = islandersChatMentionCandidates(input.value, input.caret, targets);
  if (suggestionIndex >= suggestions.length) suggestionIndex = 0;
}

function completeSuggestion(target = suggestions[suggestionIndex]): boolean {
  if (!target) return false;
  const completed = completeIslandersChatMention(input.value, input.caret, target);
  input.value = completed.value;
  input.caret = completed.caret;
  suggestions = [];
  suggestionIndex = 0;
  return true;
}

// One cell of the field's own fill on each side, so typing never touches its edges and the
// caret opens on the placeholder's first letter.
const COMPOSER_PADDING = 1;
let composerWidth = 36;

const input = new Input({
  id: 'islanders-chat-input',
  width: composerWidth,
  padding: COMPOSER_PADDING,
  maxRows: 4,
  placeholder: 'say something… use @ to address',
  onChange: refreshSuggestions,
  onKeyDown: (event) => {
    if (!suggestions.length) return false;
    if (event.name === 'down') {
      suggestionIndex = (suggestionIndex + 1) % suggestions.length;
      return true;
    }
    if (event.name === 'up') {
      suggestionIndex = (suggestionIndex - 1 + suggestions.length) % suggestions.length;
      return true;
    }
    if (event.name === 'tab' || event.name === 'enter') return completeSuggestion();
    if (event.name === 'escape') {
      suggestions = [];
      suggestionIndex = 0;
      return true;
    }
    return false;
  },
  onEnter: (value) => {
    const addressedSeats = parseIslandersChatMentions(value, targets);
    if (!submit(value, addressedSeats)) return;
    input.value = '';
    input.caret = 0;
    suggestions = [];
    suggestionIndex = 0;
  },
});

export function mountIslandersChatComposer(ui: Screen): void {
  ui.mount(input);
}

export function configureIslandersChatComposer(next: {
  targets: readonly ChatTarget[];
  onSubmit: (text: string, targetSeats: readonly number[]) => boolean;
}): void {
  targets = [...next.targets];
  submit = next.onSubmit;
  refreshSuggestions();
}

// `width` is the sidebar's body width, so the field runs edge to edge inside the panel's margins.
export function buildIslandersChatComposer(width: number): Node {
  if (width !== composerWidth) {
    composerWidth = width;
    input.setWidth(width);
  }
  const rows = input.visibleRows();
  return Box({ position: 'relative', width, height: rows, overflow: 'visible' }, [
    Slot('islanders-chat-input'),
    ...(suggestions.length
      ? [Box({
          position: 'absolute',
          left: 0,
          bottom: rows,
          width,
          flexDirection: 'column',
        }, suggestions.slice(0, 4).map((target, index) => Button({
          id: `islanders-chat-mention-${target.seat}`,
          label: `${index === suggestionIndex ? '›' : ' '} @${target.label}`,
          onClick: () => { completeSuggestion(target); },
          style: { ...UI_CHROME_PILL, width },
        })))]
      : []),
  ]);
}
