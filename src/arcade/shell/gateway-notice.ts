// The one line the home screen shows when this launch cannot play an AI match yet, and
// what it says. Three states, mutually exclusive by construction: signed out; signed in
// with no card on file (`customer_verification_required`); signed in with a card but no
// balance (`insufficient_funds`). Anything else, including a verdict Gateway could not
// settle, shows nothing, and the Start-time health check remains the authority on
// whether a match can begin. The pill sits top-left of Cover Flow across from the menu
// button, appears once the prism intro hands over to the covers, and returns on every
// launch while the condition holds; the × puts it away for the rest of this session.
import { stringWidth } from '../../engine/index.ts';
import { GATEWAY_ADD_CARD_URL, GATEWAY_TOP_UP_URL } from '../../harness/model-failure-notice.ts';
import { Box, Button, Text, type Node } from '../../tui/index.ts';
import type { ArcadeModelCatalog } from '../match/team-model-catalog.ts';
import { ARCADE_CHROME_TEXT, UI_CHROME_PILL } from '../theme.ts';

export type GatewayNoticeKind = 'sign-in' | 'add-card' | 'buy-credits';

// One sentence whose opening words are the link: `lead` is underlined and clickable,
// `rest` completes it. `title` names the situation ahead of the sentence when the
// sentence alone would not (there is no title for signing in; the sentence is enough).
export interface GatewayNotice {
  kind: GatewayNoticeKind;
  title?: string;
  lead: string;
  rest: string;
  // Absent for `sign-in`, whose action is the in-app device flow rather than a page.
  url?: string;
}

const NOTICES: Record<GatewayNoticeKind, GatewayNotice> = {
  'sign-in': {
    kind: 'sign-in',
    lead: 'sign in',
    rest: 'to play AI matches',
  },
  'add-card': {
    kind: 'add-card',
    title: 'AI Gateway setup needed',
    lead: 'add a credit card',
    rest: 'to play AI matches and unlock $5 in free monthly credits',
    url: GATEWAY_ADD_CARD_URL,
  },
  'buy-credits': {
    kind: 'buy-credits',
    title: 'AI Gateway credit required',
    lead: 'add credits',
    rest: 'to play AI matches',
    url: GATEWAY_TOP_UP_URL,
  },
};

export function gatewayNoticeFor(signedIn: boolean, catalog: ArcadeModelCatalog | null): GatewayNotice | null {
  if (!signedIn) return NOTICES['sign-in'];
  const verdict = catalog?.requestAvailability;
  if (verdict?.status !== 'unavailable') return null;
  if (verdict.reason === 'customer_verification_required') return NOTICES['add-card'];
  if (verdict.reason === 'insufficient_funds') return NOTICES['buy-credits'];
  return null;
}

// The same message as one sentence for a setup panel, where no title precedes it, so
// the product is named in the body instead.
export function gatewayNoticeSentence(notice: GatewayNotice): string {
  switch (notice.kind) {
    case 'sign-in': return 'sign in to play AI matches.';
    case 'add-card': return 'add a credit card to play AI matches and unlock $5 in free monthly AI Gateway credits.';
    case 'buy-credits': return 'add AI Gateway credits to play AI matches.';
  }
}

// The account modal's line under "view spend": whether the picker is showing this team
// the whole catalog, or how many models a credit purchase would add to it. Null while the
// catalog is the baked fallback, which knows nothing about the team.
export function catalogAccessLine(catalog: ArcadeModelCatalog | null): { text: string; url?: string } | null {
  if (!catalog || catalog.source !== 'team') return null;
  const restricted = catalog.planRestrictedCount;
  if (restricted === 0) return { text: 'all models available to this team' };
  return { text: `${restricted} more model${restricted === 1 ? '' : 's'} with paid credits`, url: GATEWAY_TOP_UP_URL };
}

const PILL_GAP = 2;
const PILL_INK = UI_CHROME_PILL.color!;
const LINK_STYLE = {
  padding: 0,
  color: ARCADE_CHROME_TEXT.title,
  underline: true,
  hover: { color: 'textStrong', underline: true, bold: true },
  focus: { color: 'textStrong', underline: true, bold: true },
  pressed: { color: 'controlPressedBg', underline: true, bold: true },
} as const;

// `title  lead rest  ✕` on one row of chrome. The rest of the sentence is the first thing
// to go when the row would collide with the menu button; the title, the link, and ✕
// always fit or the pill is not drawn at all, since a truncated instruction is worse
// than none.
export function buildGatewayNoticePill(notice: GatewayNotice, opts: { maxWidth: number; onAction: () => void; onDismiss: () => void }): Node | null {
  const titleW = notice.title ? stringWidth(notice.title) + PILL_GAP : 0;
  const fixed = 1 + titleW + stringWidth(notice.lead) + PILL_GAP + 1 + 1;
  if (fixed > opts.maxWidth) return null;
  const withRest = fixed + 1 + stringWidth(notice.rest) <= opts.maxWidth;
  return Box({ flexDirection: 'row', alignItems: 'center', gap: PILL_GAP, padding: [0, 1], background: UI_CHROME_PILL.background }, [
    ...(notice.title ? [Text({ text: notice.title, style: { color: ARCADE_CHROME_TEXT.title, bold: true } })] : []),
    Box({ flexDirection: 'row' }, [
      Button({ id: 'gateway-notice-action', label: notice.lead, onClick: opts.onAction, style: LINK_STYLE }),
      ...(withRest ? [Text({ text: ` ${notice.rest}`, style: { color: PILL_INK } })] : []),
    ]),
    Button({
      id: 'gateway-notice-dismiss',
      label: '✕',
      onClick: opts.onDismiss,
      style: {
        padding: 0,
        color: ARCADE_CHROME_TEXT.muted,
        hover: { color: 'textStrong' },
        focus: { color: 'textStrong' },
        pressed: { color: 'controlPressedBg' },
      },
    }),
  ]);
}
