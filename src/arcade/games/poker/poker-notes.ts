import type { RGB } from '../../../engine/index.ts';
import { Dialog, Dropdown, Modal, ScrollBox, Slot, Text, wrapText, type Node, type Row, type Screen } from '../../../tui/index.ts';
import { creatorTint } from '../../scenes/wisp.ts';
import { ARCADE_CHROME_TEXT } from '../../theme.ts';
import { POKER_PALETTE } from './palette.ts';

const NOTES_INNER_W = 46;
const NOTES_CARD_W = NOTES_INNER_W + 2;
const NOTES_WRAP_W = NOTES_INNER_W - 3;
const NOTES_VIEW_H = 16;
const NOTES_OBSERVER_W = 34;
const NOTES_PLACEHOLDERS = 2;
const NOTE_HEAD: RGB = POKER_PALETTE.noteHeading;
const NOTE_FG: RGB = POKER_PALETTE.noteText;
const NOTE_PLACEHOLDER: RGB = POKER_PALETTE.notePlaceholder;
const NOTES_LABEL_FG: RGB = ARCADE_CHROME_TEXT.title;

const notesScroll = new ScrollBox({ id: 'poker-notes-scroll', width: NOTES_INNER_W, height: NOTES_VIEW_H, rows: [] });
let notesObserver = '';
let onObserverPick: ((index: number) => void) | null = null;

export function setNotesObserverPick(fn: (index: number) => void): void {
  onObserverPick = fn;
}

const notesObserverDropdown = new Dropdown({
  id: 'poker-notes-observer',
  items: [],
  width: NOTES_OBSERVER_W,
  bare: true,
  onSelect: (i) => onObserverPick?.(i),
});

export function mountPokerNotes(ui: Screen): void {
  ui.mount(notesScroll);
  ui.mount(notesObserverDropdown);
}

function seatTint(creator: string): RGB {
  const tint = creatorTint(creator);
  return [tint.x | 0, tint.y | 0, tint.z | 0];
}

function notesRows(label: string, notes: string[]): Row[] {
  const rows: Row[] = [Text({ text: label, style: { color: NOTE_HEAD, bold: true } })];
  if (notes.length) {
    for (const note of notes) {
      wrapText(note, NOTES_WRAP_W).forEach((line, i) => rows.push(Text({ text: `${i === 0 ? '• ' : '  '}${line}`, style: { color: NOTE_FG } })));
    }
  } else {
    for (let i = 0; i < NOTES_PLACEHOLDERS; i++) rows.push(Text({ text: '•', style: { color: NOTE_PLACEHOLDER } }));
  }
  return rows;
}

export function buildPokerNotesModal(opts: {
  observers: { label: string; creator?: string }[];
  activeIndex: number;
  entries: { label: string; notes: string[] }[];
  onClose: () => void;
}): Node {
  const labels = opts.observers.map((observer) => observer.label);
  if (labels.join('\x00') !== notesObserverDropdown.items.join('\x00')) notesObserverDropdown.setItems(labels, opts.activeIndex);
  const active = opts.observers[opts.activeIndex];
  notesObserverDropdown.setAccent(active?.creator ? seatTint(active.creator) : NOTES_LABEL_FG);

  const rows: Row[] = [];
  opts.entries.forEach((entry, i) => {
    if (i > 0) rows.push(Text({ text: '' }));
    rows.push(...notesRows(entry.label, entry.notes));
  });
  if ((active?.label ?? '') !== notesObserver) {
    notesScroll.scroll = 0;
    notesObserver = active?.label ?? '';
  }
  notesScroll.rows = rows;

  return Modal(
    Dialog(
      { title: Slot(notesObserverDropdown.id), onClose: opts.onClose, closeId: 'poker-notes-close', width: NOTES_CARD_W, padding: [1, 0, 1, 2] },
      [Slot(notesScroll.id)],
    ),
    { onDismiss: opts.onClose },
  );
}
