// The chess match chat: a persistent, scrollable Twitch-style thread down the right
// edge. Each model's pre-move rationale is one entry — the model name in its
// creator's wisp color (bold), a white colon, then the dialogue in white — wrapping
// flush-left, with a blank line between entries and single spacing within one.
// Replaces the old transient commentary toast for model lines (app/system notices
// still toast — see hud.ts / main.ts).
//
// Bespoke (not ScrollBox) because it owns its own word-wrapping: it measures the
// wrapped content height analytically and scrolls by translating an absolutely-
// positioned content column inside an overflow-clipped viewport, with follow-to-
// bottom (sticks to the newest entry until the reader scrolls up).

import { Box, Text, wrapText, type Component, type Node, type Screen } from '../../tui/index.ts';
import type { RGB, Surface } from '../../engine/index.ts';
import type { KeyEvent } from '../../platform/input.ts';
import type { LayoutBox, PointerHit } from '../../tui/types.ts';
import { creatorTint } from '../scenes/wisp.ts';
import { shortModel } from '../../harness/model-label.ts';
import { SIDEBAR_PAD_L, SIDEBAR_PAD_R } from '../../tui/index.ts';
import { ARCADE_THEME, RAIL_ERROR_FG, RAIL_MUTED_FG, RAIL_TEXT_FG } from '../theme.ts';

// One chat line. Normally a model's rationale, tagged with its slug (drives the name +
// color). When `event` is set it's a neutral game-event notice (e.g. "Flop  Q♥ 9♦ 5♣"),
// rendered as a nameless grey line — `model` is ignored. `error` promotes an event line
// to red (e.g. a chess move played illegally under the illegal-moves toggle).
export interface ChatMessage {
  text: string;
  model: string; // model slug, e.g. "openai/gpt-5.4"
  label?: string; // resolved speaker label; model remains the source of creator color
  event?: boolean; // a grey system/game-event line (no name, no color)
  error?: boolean; // with event: render the line red instead of grey (illegal move)
}

// ── Layout ────────────────────────────────────────────────────────────────────
const SCROLLBAR_W = 1;
const RIGHT_GAP = 1; // clear column(s) between the text and the scrollbar
// Panel width (cells) — narrow, like a live-chat rail. Widened by the scrollbar
// column PLUS a gap column so reserving them doesn't eat into the text region: the
// bar gets its own column at the far right, with a blank column before it, and text
// never wraps under or flush against it.
export const CHAT_WIDTH = 34 + SCROLLBAR_W + RIGHT_GAP;
// Panel insets: a touch more on the left; ZERO on the right so the scrollbar sits
// flush at the panel edge (a right inset leaves a translucent strip that shows the
// moving scene through it, reading as a jagged edge). Mirrors the moves panel.
export const PANEL_PAD_L = SIDEBAR_PAD_L;
export const PANEL_PAD_R = SIDEBAR_PAD_R;
const MSG_GAP = 1; // blank rows between messages
const VIEW_W = CHAT_WIDTH - PANEL_PAD_L - PANEL_PAD_R; // viewport width inside the panel
const CONTENT_W = VIEW_W - SCROLLBAR_W - RIGHT_GAP; // text wrap width — a gap col, then the scrollbar

const MSG_FG: RGB = RAIL_TEXT_FG; // dialogue + colon — normal white
const EVENT_FG: RGB = RAIL_MUTED_FG; // grey — game-event notices
const ERROR_FG: RGB = RAIL_ERROR_FG;
const DEFAULT_PLACEHOLDER = 'AI dialogue will appear here';
const PLACEHOLDER_FG: RGB = ARCADE_THEME.textMuted;
const TRACK: RGB = ARCADE_THEME.scrollbarTrack;
const THUMB: RGB = ARCADE_THEME.scrollbarThumb;
const WHEEL_STEP = 3;

// The creator's wisp color for a slug (its provider's tint — the same signature
// color the model's orb glows in the match HUD).
function creatorColor(slug: string): RGB {
  const t = creatorTint(slug.split('/')[0] ?? slug);
  return [Math.round(t.x), Math.round(t.y), Math.round(t.z)];
}

// A message's rendered form: the colored bold name, and its dialogue split into
// lines (line 0 shares the row with the "name: " prefix; the rest are flush-left).
// `event` lines have no name — the whole text wraps full-width in grey.
interface Rendered {
  name: string;
  color: RGB;
  lines: string[];
  event: boolean;
}

function render(messages: ChatMessage[]): Rendered[] {
  return messages.map((m) => {
    if (m.event) return { name: '', color: m.error ? ERROR_FG : EVENT_FG, lines: wrapText(m.text, CONTENT_W), event: true };
    const name = m.label ?? shortModel(m.model);
    const prefixW = name.length + 2; // "name" + ": "
    return { name, color: creatorColor(m.model), lines: wrapText(m.text, CONTENT_W, { first: CONTENT_W - prefixW }), event: false };
  });
}

// A model message renders "<name>: <dialogue…>" (name bold + colored, text white) with
// flush-left continuation rows. An event renders its grey text with no name prefix. Both
// end with a blank spacer row.
function messageNode(r: Rendered): Node {
  const rows: Node[] = r.event
    ? r.lines.map((l) => Text({ text: l, style: { color: r.color } }))
    : [
        Box({ flexDirection: 'row', width: CONTENT_W }, [
          Text({ text: r.name, style: { color: r.color, bold: true } }),
          Text({ text: `: ${r.lines[0] ?? ''}`, style: { color: MSG_FG } }),
        ]),
        ...r.lines.slice(1).map((l) => Text({ text: l, style: { color: MSG_FG } })),
      ];
  rows.push(Box({ height: MSG_GAP }));
  return Box({ flexDirection: 'column', width: CONTENT_W }, rows);
}

// ── The component ─────────────────────────────────────────────────────────────
export class ChatBox implements Component {
  scroll = 0;
  messages: ChatMessage[] = [];
  private follow = true; // stick to newest until the reader scrolls up
  private viewport = 10; // rows; set each frame from the panel height
  private active = false; // whether an AI match is in progress (set each frame)

  // `id` + `placeholder` are per-instance so the same component serves several games
  // (chess DMs, poker table talk) with distinct Slot ids and empty-state hints.
  constructor(
    readonly id: string = 'chess-chat',
    private readonly placeholder: string = DEFAULT_PLACEHOLDER,
  ) {}

  setViewport(h: number): void {
    this.viewport = Math.max(1, h);
  }

  // A match in progress suppresses the empty-state placeholder (dialogue is coming).
  setActive(active: boolean): void {
    this.active = active;
  }

  // Follow is governed by scroll position, NOT by arrival: a new line only pulls the
  // view down if the reader is already at the bottom.
  push(msg: ChatMessage): void {
    this.messages.push(msg);
  }

  clear(): void {
    this.messages = [];
    this.scroll = 0;
    this.follow = true;
  }

  private contentHeight(items: Rendered[]): number {
    let h = 0;
    for (const it of items) h += it.lines.length + MSG_GAP;
    return h;
  }

  private maxScroll(): number {
    return Math.max(0, this.contentHeight(render(this.messages)) - this.viewport);
  }

  private scrollBy(delta: number, max: number): void {
    this.scroll = Math.max(0, Math.min(max, this.scroll + delta));
    this.follow = this.scroll >= max; // re-arm auto-follow only at the very bottom
  }

  onKey(ev: KeyEvent): boolean {
    const max = this.maxScroll();
    if (max === 0) return false; // nothing to scroll — let the key fall through
    if (ev.name === 'up' || ev.name === 'k') this.scrollBy(-1, max);
    else if (ev.name === 'down' || ev.name === 'j') this.scrollBy(1, max);
    else if (ev.name === 'pageup') this.scrollBy(-this.viewport, max);
    else if (ev.name === 'pagedown') this.scrollBy(this.viewport, max);
    else return false;
    return true;
  }

  onMouse(ev: PointerHit): boolean {
    const max = this.maxScroll();
    if (ev.type === 'wheel') {
      if (max === 0) return false;
      this.scrollBy(ev.wheel === -1 ? -WHEEL_STEP : WHEEL_STEP, max);
      return true;
    }
    if (ev.x >= ev.w - 1 && max > 0) {
      const frac = ev.h > 1 ? ev.y / (ev.h - 1) : 0;
      this.scroll = Math.max(0, Math.min(max, Math.round(frac * max)));
      this.follow = this.scroll >= max;
    }
    return true;
  }

  // Slim scrollbar in the rightmost column (cell backgrounds, gapless), like ScrollBox.
  private paintBar(surf: Surface, box: LayoutBox, content: number): void {
    if (content <= this.viewport) return;
    const x = box.x + box.w - 1;
    const thumb = Math.max(1, Math.round((this.viewport / content) * box.h));
    const span = box.h - thumb;
    const max = content - this.viewport;
    const top = box.y + (max === 0 ? 0 : Math.round((this.scroll / max) * span));
    for (let y = box.y; y < box.y + box.h; y++) {
      const c = y >= top && y < top + thumb ? THUMB : TRACK;
      surf.setCell(x, y, ' ', c, c);
    }
  }

  build(): Node {
    // Empty state (no dialogue yet and no match running): a muted hint centered in
    // the viewport. A match in progress suppresses it — its dialogue is imminent.
    if (this.messages.length === 0 && !this.active) {
      const lines = wrapText(this.placeholder, CONTENT_W);
      return {
        ...Box({ width: VIEW_W, height: this.viewport, flexDirection: 'column', justifyContent: 'center', alignItems: 'center' },
          lines.map((l) => Text({ text: l, style: { color: PLACEHOLDER_FG } }))),
        id: this.id,
        focusable: true,
      };
    }
    const items = render(this.messages);
    const content = this.contentHeight(items);
    const max = Math.max(0, content - this.viewport);
    if (this.follow) this.scroll = max;
    else this.scroll = Math.min(this.scroll, max);

    // The content column, absolutely positioned and translated up by `scroll`, sits
    // inside a fixed-height viewport that clips it (overflow:hidden). Off-screen
    // messages are clipped by the viewport — no manual per-row culling.
    const inner = {
      ...Box({ flexDirection: 'column', width: CONTENT_W, position: 'absolute', left: 0, top: -this.scroll }, items.map(messageNode)),
    };
    return {
      ...Box({ width: VIEW_W, height: this.viewport, position: 'relative', overflow: 'hidden' }, [inner]),
      id: this.id,
      focusable: true,
      onKey: (ev) => this.onKey(ev),
      onMouse: (ev) => this.onMouse(ev),
      draw: (surf, b) => this.paintBar(surf, b, content),
    };
  }
}

// Long-lived so scroll + history survive the per-frame tree rebuild and modal roots.
export const chatBox = new ChatBox();

export function mountChat(ui: Screen): void {
  ui.mount(chatBox);
}

export function pushChatMessage(msg: ChatMessage): void {
  chatBox.push(msg);
}

export function clearChat(): void {
  chatBox.clear();
}
