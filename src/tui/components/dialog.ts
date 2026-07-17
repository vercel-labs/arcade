// Shared modal chrome: a close (✕) button and a titled card. Every popup used to
// re-implement both — which is how their ✕ hover styles drifted (some understated,
// some a red fill). These give one implementation: a modal is "title + ✕ + body".
//
// `Dialog` builds the CARD (background, padding, optional title, optional corner ✕,
// then the body); wrap it in `Modal(...)` for the dimming scrim + centering, i.e.
// `Modal(Dialog({ title, onClose, closeId }, body))`. Collapsible side rails (the
// chat / move panels) aren't cards, so they use `CloseButton` directly.

import { Box, Button, Text } from '../nodes.ts';
import type { ColorToken } from '../theme.ts';
import type { Dimension, Node, Style } from '../types.ts';

const CLOSE_GLYPH = '✕';
const BACK_GLYPH = '←';
const TITLE_FG: ColorToken = [222, 224, 234];
const CARD_BG: ColorToken = [22, 24, 32];

// The understated close ✕: a muted glyph that just brightens to white on
// hover/focus/press — no background fill. One definition, shared everywhere.
const CLOSE_STYLE: Style = {
  padding: [0, 1],
  color: [150, 154, 166],
  hover: { color: [255, 255, 255] },
  focus: { color: [255, 255, 255] },
  pressed: { color: [255, 255, 255] },
};

// A close button. `style` shallow-overrides the default (e.g. to add a margin).
export function CloseButton(opts: { id: string; onClick: () => void; style?: Style }): Node {
  return Button({ id: opts.id, label: CLOSE_GLYPH, onClick: opts.onClick, style: { ...CLOSE_STYLE, ...opts.style } });
}

// Horizontal padding on the right, for either [v,h] or [t,r,b,l] — index 1 is the
// right inset in both forms.
function rightPad(p: [number, number] | [number, number, number, number]): number {
  return p[1];
}
// Left inset: index 3 for [t,r,b,l], else index 1 ([v,h] shares one horizontal value).
function leftPad(p: [number, number] | [number, number, number, number]): number {
  return p.length === 4 ? p[3] : p[1];
}

export interface DialogOpts {
  title?: string | Node; // a bold label, or a custom header node (e.g. a pager row)
  onClose?: () => void; // present → a corner ✕ that calls it
  closeId?: string; // the ✕ button id (needed when onClose is set)
  onBack?: () => void; // present → a top-left ← icon that calls it (mirrors the ✕)
  backId?: string; // the ← button id (needed when onBack is set)
  width?: Dimension; // fixed card width; omit to size to content
  background?: ColorToken; // card fill (default the shared slate)
  padding?: [number, number] | [number, number, number, number]; // card padding (default [1,1])
  align?: 'left' | 'center'; // title alignment (default left); the body lays out normally
  titleColor?: ColorToken;
  closeInset?: number; // extra cells to pull the ✕ inward from its default (edge-hugging) spot
}

// A titled card. The ✕ is absolutely positioned so it hugs the top-right corner
// (one cell in from the card edge) regardless of the card's horizontal padding —
// `right: -(rightPad - 1)` pulls it out through the padding, matching the hand-
// tuned popups it replaces. Absolute children resolve against the content box, so
// `top: 0` already sits it below the top padding.
export function Dialog(opts: DialogOpts, children: Node[] = []): Node {
  const pad = opts.padding ?? [1, 1];
  const center = opts.align === 'center';
  const titleNode =
    typeof opts.title === 'string' ? Text({ text: opts.title, style: { color: opts.titleColor ?? TITLE_FG, bold: true } }) : (opts.title ?? null);

  const items: Node[] = [];
  if (titleNode) items.push(center ? Box({ flexDirection: 'row', justifyContent: 'center' }, [titleNode]) : titleNode);
  items.push(...children);
  if (opts.onClose) {
    // Default sits the ✕ one cell from the card edge; `closeInset` pulls it further
    // in (e.g. to line the ✕ up with an inset body instead of the card edge).
    items.push(
      Box({ position: 'absolute', top: 0, right: -(rightPad(pad) - 1) + (opts.closeInset ?? 0) }, [
        CloseButton({ id: opts.closeId ?? 'dialog-close', onClick: opts.onClose }),
      ]),
    );
  }
  if (opts.onBack) {
    // A top-left ← icon, mirroring the ✕: same understated glyph, one cell in from the
    // card's left edge (pulled out through the left padding).
    items.push(
      Box({ position: 'absolute', top: 0, left: -(leftPad(pad) - 1) }, [
        Button({ id: opts.backId ?? 'dialog-back', label: BACK_GLYPH, onClick: opts.onBack, style: CLOSE_STYLE }),
      ]),
    );
  }

  return Box(
    {
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: 1,
      padding: pad,
      background: opts.background ?? CARD_BG,
      position: 'relative',
      ...(opts.width != null ? { width: opts.width } : {}),
    },
    items,
  );
}
