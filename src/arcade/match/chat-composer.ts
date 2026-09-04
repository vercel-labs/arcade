// The table-talk field at the foot of a game's chat rail: a multi-line Input whose `@`
// opens a completion list of the seats the human can address. One instance per game,
// each with its own Slot id, so chess, poker, and Islanders can all mount one without
// sharing edit state. Submitting reports the text plus the seats it names; the caller
// decides what an address means (the drivers prompt the named models for a reply).
import { Box, Button, Input, Slot, type Node, type Screen } from '../../tui/index.ts';
import { UI_CHROME_PILL } from '../theme.ts';

export interface ChatTarget {
  seat: number;
  label: string;
}

interface ActiveMention {
  start: number;
  query: string;
}

// The `@` the caret is inside, if any. An `@` glued to a word (an email address) is not
// a mention, and a mention cannot span a newline or another `@`.
function activeMention(value: string, caret: number): ActiveMention | null {
  const start = value.lastIndexOf('@', Math.max(0, caret - 1));
  if (start < 0) return null;
  if (start > 0 && /[\p{L}\p{N}_]/u.test(value[start - 1] ?? '')) return null;
  const query = value.slice(start + 1, caret);
  if (query.includes('\n') || query.includes('@')) return null;
  return { start, query };
}

export function chatMentionCandidates(value: string, caret: number, available: readonly ChatTarget[]): ChatTarget[] {
  const mention = activeMention(value, caret);
  if (!mention) return [];
  const query = mention.query.toLowerCase();
  return available.filter((target) => target.label.toLowerCase().startsWith(query));
}

export function completeChatMention(value: string, caret: number, target: ChatTarget): { value: string; caret: number } {
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

// Every seat the finished text addresses, longest label first so `gpt-5.4` cannot claim a
// mention of `gpt-5.4-nano`.
export function parseChatMentions(text: string, available: readonly ChatTarget[]): number[] {
  return available
    .slice()
    .sort((a, b) => b.label.length - a.label.length)
    .filter((target) => new RegExp(`@${regexEscape(target.label)}(?=$|[\\s,;:!?])`, 'i').test(text))
    .map((target) => target.seat)
    .filter((seat, index, seats) => seats.indexOf(seat) === index);
}

// One cell of the field's own fill on each side, so typing never touches its edges and the
// caret opens on the placeholder's first letter.
const COMPOSER_PADDING = 1;
const MAX_SUGGESTIONS = 4;

export class ChatComposer {
  readonly id: string;
  private readonly input: Input;
  private targets: ChatTarget[] = [];
  private suggestions: ChatTarget[] = [];
  private suggestionIndex = 0;
  private submit: (text: string, targetSeats: readonly number[]) => boolean = () => false;
  private width: number;

  constructor(opts: { id: string; width?: number; maxRows?: number; placeholder?: string }) {
    this.id = opts.id;
    this.width = opts.width ?? 36;
    this.input = new Input({
      id: opts.id,
      width: this.width,
      padding: COMPOSER_PADDING,
      maxRows: opts.maxRows ?? 4,
      placeholder: opts.placeholder ?? 'say something… use @ to address',
      onChange: () => this.refreshSuggestions(),
      onKeyDown: (event) => {
        if (!this.suggestions.length) return false;
        if (event.name === 'down') {
          this.suggestionIndex = (this.suggestionIndex + 1) % this.suggestions.length;
          return true;
        }
        if (event.name === 'up') {
          this.suggestionIndex = (this.suggestionIndex - 1 + this.suggestions.length) % this.suggestions.length;
          return true;
        }
        if (event.name === 'tab' || event.name === 'enter') return this.completeSuggestion();
        if (event.name === 'escape') {
          this.suggestions = [];
          this.suggestionIndex = 0;
          return true;
        }
        return false;
      },
      onEnter: (value) => {
        if (!this.submit(value, parseChatMentions(value, this.targets))) return;
        this.input.value = '';
        this.input.caret = 0;
        this.suggestions = [];
        this.suggestionIndex = 0;
      },
    });
  }

  mount(ui: Screen): void {
    ui.mount(this.input);
  }

  configure(next: { targets: readonly ChatTarget[]; onSubmit: (text: string, targetSeats: readonly number[]) => boolean }): void {
    this.targets = [...next.targets];
    this.submit = next.onSubmit;
    this.refreshSuggestions();
  }

  // How many rows the field currently takes, for a rail layout that reserves room for it.
  rows(): number {
    return this.input.visibleRows();
  }

  // `width` is the rail's body width, so the field runs edge to edge inside the panel's
  // margins. The completion list opens upward over the transcript, never below the field.
  build(width: number): Node {
    if (width !== this.width) {
      this.width = width;
      this.input.setWidth(width);
    }
    const rows = this.input.visibleRows();
    return Box({ position: 'relative', width, height: rows, overflow: 'visible' }, [
      Slot(this.id),
      ...(this.suggestions.length
        ? [Box({ position: 'absolute', left: 0, bottom: rows, width, flexDirection: 'column' },
            this.suggestions.slice(0, MAX_SUGGESTIONS).map((target, index) => Button({
              id: `${this.id}-mention-${target.seat}`,
              label: `${index === this.suggestionIndex ? '›' : ' '} @${target.label}`,
              onClick: () => { this.completeSuggestion(target); },
              style: { ...UI_CHROME_PILL, width },
            })))]
        : []),
    ]);
  }

  private refreshSuggestions(): void {
    this.suggestions = chatMentionCandidates(this.input.value, this.input.caret, this.targets);
    if (this.suggestionIndex >= this.suggestions.length) this.suggestionIndex = 0;
  }

  private completeSuggestion(target = this.suggestions[this.suggestionIndex]): boolean {
    if (!target) return false;
    const completed = completeChatMention(this.input.value, this.input.caret, target);
    this.input.value = completed.value;
    this.input.caret = completed.caret;
    this.suggestions = [];
    this.suggestionIndex = 0;
    return true;
  }
}
