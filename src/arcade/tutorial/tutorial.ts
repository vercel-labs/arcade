// The tutorial controller + its guide panel. The controller owns progress (which chapter,
// which steps are ticked) and reacts to named signals the app emits when the real feature
// fires; the panel is a right-edge rail rebuilt each frame from that state. main.ts stages
// each chapter's screen through the host and routes input/game events into `signal()`.

import type { RGB } from '../../engine/index.ts';
import { Box, Button, type Node, type PulseStyle, Sidebar, Text, wrapText } from '../../tui/index.ts';
import { ARCADE_CHROME_TEXT, ARCADE_THEME, UI_CHROME_BG, UI_CHROME_PILL } from '../theme.ts';
import { TUTORIAL_CHAPTERS, type TutorialChapter, type TutorialScreen, type TutorialStep } from './chapters.ts';

export { TUTORIAL_CHAPTERS, type TutorialChapter, type TutorialScreen, type TutorialStep } from './chapters.ts';

// The rail's width. Narrow terminals give up a little of it so the scene keeps most of
// the screen; below that the copy just wraps more. The Islanders chapter also needs the
// game's own hand/log sidebar (which hides itself under 112 board columns), so there the
// rail yields down to its minimum first — on a 140-column terminal both fit.
const RAIL_W = 36;
const RAIL_MIN_W = 28;
const ISLANDERS_SIDEBAR_MIN_BOARD_W = 112;
export function tutorialRailWidth(cols: number, screen?: TutorialScreen): number {
  const fit = screen === 'islanders' ? Math.min(RAIL_W, cols - ISLANDERS_SIDEBAR_MIN_BOARD_W) : RAIL_W;
  return Math.max(RAIL_MIN_W, Math.min(fit, Math.floor(cols * 0.32)));
}

// The attention pulse the tutorial attaches to whatever it wants clicked next: filled pills
// breathe toward the app's indigo accent, outlined controls brighten their border.
export const TUTORIAL_PULSE: PulseStyle = {
  background: ARCADE_THEME.accent,
  borderColor: [156, 166, 232],
  color: ARCADE_THEME.textStrong,
  period: 1.6,
  strength: 0.85,
};

const DONE_FG: RGB = [120, 200, 150];
const PENDING_FG: RGB = ARCADE_THEME.textMuted;
const CURRENT_FG: RGB = ARCADE_THEME.textStrong;

export const TUTORIAL_EXIT_ID = 'tutorial-exit';
export const TUTORIAL_BACK_ID = 'tutorial-back';
export const TUTORIAL_SKIP_ID = 'tutorial-skip';
export const TUTORIAL_NEXT_ID = 'tutorial-next';

// The rail sits a shade above the game's own chat/hand sidebars (UI_CHROME_BG), so the
// two read as sibling panels rather than one continuous slab when they meet edge to edge.
const RAIL_BG: RGB = [UI_CHROME_BG[0] + 6, UI_CHROME_BG[1] + 6, UI_CHROME_BG[2] + 8];

export interface TutorialHost {
  // Stage `chapter`'s screen (enter the game, load a position, seat the bots). `previous`
  // is the chapter just left, so its session can be torn down.
  show(chapter: TutorialChapter, previous: TutorialChapter | null): void;
  // The user left — through ✕, or the closing chapter's end button. Return to the home screen.
  exit(): void;
  requestRender(): void;
  // Whether a step's requirement is met right now (an AI Gateway key for `requires: 'gateway'`).
  // Omit to treat every step as available.
  stepAvailable?(step: TutorialStep): boolean;
}

const UNAVAILABLE_FG: RGB = [96, 100, 114];
const UNAVAILABLE_NOTE = 'sign in to try this';

export class TutorialController {
  private running = false;
  private index = 0;
  private done = new Set<string>();
  // Signal arrivals per step, for steps that want the same thing done several times.
  private progress = new Map<string, number>();

  constructor(private readonly host: TutorialHost, private readonly chapters: readonly TutorialChapter[] = TUTORIAL_CHAPTERS) {}

  active(): boolean {
    return this.running;
  }

  chapter(): TutorialChapter {
    return this.chapters[this.index];
  }

  chapterIndex(): number {
    return this.index;
  }

  chapterCount(): number {
    return this.chapters.length;
  }

  start(): void {
    this.running = true;
    this.index = 0;
    this.openChapter(null);
  }

  // End the walkthrough without navigating — the host decides where the user lands.
  stop(): void {
    this.running = false;
    this.done.clear();
    this.progress.clear();
  }

  private openChapter(previous: TutorialChapter | null): void {
    this.done.clear();
    this.progress.clear();
    this.host.show(this.chapter(), previous);
    this.host.requestRender();
  }

  // Advance to the next chapter (skip or continue). Off the end → leave, like ✕.
  next(): void {
    if (!this.running) return;
    if (this.index + 1 >= this.chapters.length) {
      this.exit();
      return;
    }
    const previous = this.chapter();
    this.index++;
    this.openChapter(previous);
  }

  // Return to the previous chapter (its checklist starts over). No-op on the first.
  prev(): void {
    if (!this.running || this.index === 0) return;
    const previous = this.chapter();
    this.index--;
    this.openChapter(previous);
  }

  exit(): void {
    if (!this.running) return;
    this.stop();
    this.host.exit();
  }

  // A named event from the app. Advances every current-chapter step listening for it (a step
  // ticks once it has heard its signal `count` times, once by default); the chapter is
  // complete once all are ticked. Unknown / already-ticked names are ignored. Nothing
  // advances on its own from here — the user moves on with the continue button.
  signal(name: string): void {
    if (!this.running) return;
    let changed = false;
    for (const step of this.chapter().steps) {
      if (this.done.has(step.id)) continue;
      const listens = typeof step.signal === 'string' ? step.signal === name : step.signal.includes(name);
      if (!listens) continue;
      const heard = (this.progress.get(step.id) ?? 0) + 1;
      this.progress.set(step.id, heard);
      if (heard >= (step.count ?? 1)) this.done.add(step.id);
      changed = true;
    }
    if (changed) this.host.requestRender();
  }

  isDone(step: TutorialStep): boolean {
    return this.done.has(step.id);
  }

  // A step whose requirement isn't met is shown but sits outside the checklist's arithmetic.
  isAvailable(step: TutorialStep): boolean {
    return !step.requires || (this.host.stepAvailable?.(step) ?? true);
  }

  // How many times a multi-count step has heard its signal so far.
  stepProgress(step: TutorialStep): number {
    return this.progress.get(step.id) ?? 0;
  }

  complete(): boolean {
    return this.chapter().steps.every((s) => this.done.has(s.id) || !this.isAvailable(s));
  }

  // The first unticked available step — owns the hint and the pulse.
  currentStep(): TutorialStep | null {
    return this.chapter().steps.find((s) => !this.done.has(s.id) && this.isAvailable(s)) ?? null;
  }

  // Node ids to pulse right now: the current step's targets, or the panel's own primary
  // button once the chapter is complete.
  attentionIds(): readonly string[] {
    if (!this.running) return [];
    if (this.complete()) return [TUTORIAL_NEXT_ID];
    return this.currentStep()?.target ?? [];
  }

  // The guide rail, `width` cells wide and the full screen tall, docked at the right edge.
  build(cols: number, rows: number): Node {
    const chapter = this.chapter();
    const width = tutorialRailWidth(cols, chapter.screen);
    // Sidebar insets its body by SIDEBAR_PAD_L (2) on the left; keep a 2-cell right margin.
    const inner = width - 4;
    const complete = this.complete();
    const current = this.currentStep();

    const title = Box({ flexDirection: 'row', gap: 1, alignItems: 'center' }, [
      Text({ text: 'tutorial', style: { color: ARCADE_CHROME_TEXT.title, bold: true } }),
      Text({ text: `${this.index + 1} of ${this.chapters.length}`, style: { color: ARCADE_CHROME_TEXT.muted } }),
    ]);

    // Chapter progress: one dot per chapter — done ones green, the current one bright.
    const dots = Box({ flexDirection: 'row', gap: 1 }, this.chapters.map((_, i) =>
      Text({ text: i <= this.index ? '●' : '○', style: { color: i < this.index ? DONE_FG : i === this.index ? CURRENT_FG : PENDING_FG } }),
    ));

    const para = (text: string, color: RGB): Node[] => wrapText(text, inner).map((line) => Text({ text: line, style: { color } }));

    const stepRows = chapter.steps.flatMap((step) => {
      const done = this.done.has(step.id);
      const available = this.isAvailable(step);
      const isCurrent = !done && current?.id === step.id;
      const glyph = done ? '✓' : isCurrent ? '▸' : available ? '○' : '·';
      const color = done ? DONE_FG : isCurrent ? CURRENT_FG : available ? PENDING_FG : UNAVAILABLE_FG;
      // A multi-count step shows its tally (0/3 from the start, so the ask is clear); an
      // unavailable one says what would unlock it.
      const count = step.count ?? 1;
      const label = !available
        ? `${step.label} · ${UNAVAILABLE_NOTE}`
        : !done && count > 1 ? `${step.label}  ${this.stepProgress(step)}/${count}` : step.label;
      // Continuation lines hang under the label, past the 2-cell glyph gutter.
      const lines = wrapText(label, inner - 2);
      return lines.map((line, i) => Text({ text: `${i === 0 ? glyph : ' '} ${line}`, style: { color, bold: isCurrent } }));
    });

    // The explanation slot: the current step's hint, or the chapter's outro once done.
    const note = complete ? chapter.outro ?? '' : current?.hint ?? '';
    const noteRows = note ? para(note, ARCADE_CHROME_TEXT.secondary) : [];

    const pill = (id: string, label: string, onClick: () => void, primary: boolean): Node =>
      Button({ id, label, onClick, style: { ...UI_CHROME_PILL, padding: [0, 2], bold: primary, background: primary ? 'surfaceControl' : 'surfaceChrome' } });
    const primaryLabel = chapter.action ?? 'continue →';
    // Back on the left; skip (or, once done, the primary action) on the right.
    const footer = Box({ flexDirection: 'row', justifyContent: 'between', width: inner }, [
      this.index > 0 ? pill(TUTORIAL_BACK_ID, '‹ back', () => this.prev(), false) : Box({}),
      complete
        ? pill(TUTORIAL_NEXT_ID, primaryLabel, () => this.next(), true)
        : pill(TUTORIAL_SKIP_ID, 'skip chapter ›', () => this.next(), false),
    ]);

    const rail = Sidebar(
      { width, height: rows, title, closeId: TUTORIAL_EXIT_ID, onClose: () => this.exit(), background: RAIL_BG, flexShrink: 0 },
      [
        dots,
        Box({ height: 1 }),
        Text({ text: chapter.title, style: { color: CURRENT_FG, bold: true } }),
        ...para(chapter.intro, ARCADE_CHROME_TEXT.body),
        ...(stepRows.length ? [Box({ height: 1 }), ...stepRows] : []),
        ...(noteRows.length ? [Box({ height: 1 }), ...noteRows] : []),
        Box({ flexGrow: 1 }),
        footer,
      ],
    );
    // A full-screen, transparent root (so pointer input off the rail falls through to the
    // game) with the rail docked at the right edge.
    return Box({ width: cols, height: rows }, [Box({ position: 'absolute', top: 0, right: 0 }, [rail])]);
  }
}
