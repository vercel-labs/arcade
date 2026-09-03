// Per-player opponent notes for the poker session — the "home game" memory. Each AI seat
// keeps a few short, private, natural-language reads on every OTHER player (including the
// human), authored by that seat's own model. The flow, mirroring the note-taking poker
// agents in the literature (Readable Minds' between-hands notes, Suspicion-Agent's
// reflexion + hindsight): after each hand we hand the model a PUBLIC factual digest of
// what just happened (see HoldemState.publicRecord) plus its current notes, and it edits
// its notes in place. Notes are then injected into that seat's move prompt so reads carry
// across hands and the table adapts (the maniac gets called out, etc.).
//
// Two hard rules keep it grounded and bounded:
//   - FACTS IN, READS OUT: we only ever feed public information (actions everyone saw,
//     cards shown at showdown, chip results). The model supplies the interpretation.
//   - BOUNDED: at most MAX_NOTES short notes per player, edited/compressed each hand
//     rather than appended, so a 100-hand session never grows the prompt without limit.

import { generateText, type LanguageModel, Output } from 'ai';
import { z } from 'zod';
import { cardLabel } from '../../rules/poker/cards.ts';
import type { HandPublicRecord } from '../../rules/poker/holdem.ts';

export const MAX_NOTES = 3; // short notes kept per opponent
const NOTE_MAXLEN = 160; // safety clamp on a single note's length

// The reflection output: the model returns, per player it has a read on, that player's
// full (updated) note list. We map the returned name back to a seat and store it capped.
const reflectionSchema = z.object({
  players: z
    .array(
      z.object({
        player: z.string().describe('the exact player name shown in the digest, or "the human"'),
        notes: z.array(z.string()).describe(`up to ${MAX_NOTES} short notes, each one sentence`),
      }),
    )
    .describe('your updated notes, one entry per player you have a read on'),
});

// The private notebook store, keyed by SEAT INDEX (stable across the session); player
// labels are applied only at the edges (prompt/UI) via a caller-supplied label list, so
// the store itself never bakes in a name. `notes[observer][subject]` = observer's reads
// on subject.
export class PokerMemory {
  private notes = new Map<number, Map<number, string[]>>();

  // Fresh session: forget everything.
  reset(): void {
    this.notes.clear();
  }

  // A seat's model was swapped: that seat starts with fresh eyes (its own reads are
  // dropped). Other seats' reads ABOUT it are left alone — they observed how the seat
  // played, which is still worth remembering.
  clearObserver(seat: number): void {
    this.notes.delete(seat);
  }

  private book(observer: number): Map<number, string[]> {
    let b = this.notes.get(observer);
    if (!b) {
      b = new Map();
      this.notes.set(observer, b);
    }
    return b;
  }

  // Observer's current notes on one subject (never null).
  get(observer: number, subject: number): string[] {
    return this.book(observer).get(subject) ?? [];
  }

  // Store observer's notes on subject, trimmed + capped to MAX_NOTES (the safety net for
  // a model that ignores the instruction).
  private set(observer: number, subject: number, notes: string[]): void {
    const clean = notes
      .map((n) => n.trim().replace(/\s+/g, ' ').slice(0, NOTE_MAXLEN))
      .filter(Boolean)
      .slice(0, MAX_NOTES);
    if (clean.length) this.book(observer).set(subject, clean);
    else this.book(observer).delete(subject);
  }

  // Install notes an observer didn't write itself — the practice table's sample reads, so
  // the reads modal has something real-looking to show before any model has reflected.
  seed(observer: number, subject: number, notes: string[]): void {
    this.set(observer, subject, notes);
  }

  // Observer's notes on the given subjects, in seat order, for the UI modal. Every
  // subject is included (even with no notes yet) so the modal can show the full table.
  view(observer: number, subjects: number[]): { subject: number; notes: string[] }[] {
    return subjects.map((subject) => ({ subject, notes: this.get(observer, subject) }));
  }

  // The notes block injected into an observer's MOVE prompt: its reads on the players
  // still at the table, keyed by label. Empty string when it has nothing yet (so the
  // prompt stays clean early on).
  renderForPrompt(observer: number, subjects: number[], labelOf: (seat: number) => string): string {
    const lines: string[] = [];
    for (const subject of subjects) {
      const notes = this.get(observer, subject);
      if (notes.length) lines.push(`- ${labelOf(subject)}: ${notes.join('; ')}`);
    }
    if (!lines.length) return '';
    return `Your private reads on the other players:\n${lines.join('\n')}`;
  }

  // Reflection: after a hand, let `observer`'s model update its notes from the hand's
  // public record. `subjects` are the other seats still in the session. Mutates the
  // store; on any failure (provider error, cancel) it leaves the notes untouched.
  async reflect(opts: {
    model: LanguageModel;
    observer: number;
    subjects: number[];
    record: HandPublicRecord;
    labelOf: (seat: number) => string;
    signal?: AbortSignal;
  }): Promise<void> {
    const { model, observer, subjects, record, labelOf, signal } = opts;
    const digest = buildHandDigest(record, labelOf);
    const current = subjects
      .map((s) => {
        const notes = this.get(observer, s);
        return `- ${labelOf(s)}: ${notes.length ? notes.join('; ') : '(no notes yet)'}`;
      })
      .join('\n');

    const system =
      `You are ${labelOf(observer)} in a casual home game of no-limit Texas Hold'em. ` +
      'Between hands you keep short private notes on how the other players play.';
    const prompt = [
      'A hand just finished. Here is what everyone at the table saw:',
      '',
      digest,
      '',
      'Your current notes:',
      current,
      '',
      `Update your notes on the other players from what you just saw. Keep at most ${MAX_NOTES} notes per player, each one short sentence. ` +
        'Refine, merge, or drop notes rather than only adding. Refer to players by the names above, or "the human". ' +
        'Only note what their play shows; do not invent reads you have no evidence for.',
    ].join('\n');

    try {
      const { output } = await generateText({
        model,
        system,
        abortSignal: signal,
        output: Output.object({ schema: reflectionSchema }),
        prompt,
      });
      // Resolve each returned player name back to a seat (case-insensitive exact match on
      // the label), and store the capped notes. Unmatched names are ignored.
      const bySlug = new Map(subjects.map((s) => [labelOf(s).trim().toLowerCase(), s]));
      for (const entry of output.players) {
        const seat = bySlug.get(entry.player.trim().toLowerCase());
        if (seat !== undefined) this.set(observer, seat, entry.notes);
      }
    } catch {
      // Reflection is best-effort — a failed/cancelled call just keeps the old notes.
    }
  }
}

// Render a finished hand's public record as a compact factual digest for reflection —
// positions, the action log (seat tokens mapped to player names), any showdown cards, and
// the chip results. Pure + label-driven, so it is unit-testable and never leaks hidden
// cards (the record only carries what was public). Exported for tests.
export function buildHandDigest(record: HandPublicRecord, labelOf: (seat: number) => string): string {
  const lines: string[] = [];
  lines.push(`Button: ${labelOf(record.button)}. Small blind: ${labelOf(record.sb)}, big blind: ${labelOf(record.bb)}.`);
  const board = record.board.map(cardLabel).join(' ');
  lines.push(`Board: ${board || '(none)'} (reached ${record.street}).`);
  // The action log uses "P<seat>" tokens; swap in the player names.
  const named = record.log.map((entry) => entry.replace(/\bP(\d+)\b/g, (_m, d) => labelOf(Number(d))));
  lines.push('Action:');
  for (const entry of named) lines.push(`  ${entry}`);
  if (record.shown.length) {
    lines.push('Showdown:');
    for (const s of record.shown) lines.push(`  ${labelOf(s.seat)} showed ${s.cards.map(cardLabel).join(' ')}`);
  } else {
    lines.push('Showdown: none (pot uncontested).');
  }
  const results = record.results
    .filter((r) => r.delta !== 0)
    .map((r) => `${labelOf(r.seat)} ${r.delta > 0 ? '+' : ''}${r.delta}`)
    .join(', ');
  lines.push(`Result: ${results || 'no chips changed hands'}.`);
  return lines.join('\n');
}
