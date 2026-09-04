// The Vercel account modal, opened from Account in the Cover Flow home menu.
// A persistent searchable Dropdown shows the current billing team in its committed
// field and owns filtering, wrapped options, and overflow scrolling. main.ts owns
// async loading/switching and the modal lifecycle.
import { Box, Button, Dialog, Dropdown, Link, Modal, NoticeToast, RoundedButton, Slot, Text, wrapText, type Node, type Screen, type Style } from '../../tui/index.ts';
import type { Team } from '../../auth/index.ts';
import { ARCADE_OUTLINE_CONTROL } from '../theme.ts';

const LIST_W = 36;
const LIST_ROWS = 7; // maximum visible dropdown option rows before scrolling
const CARD_W = LIST_W + 6; // three cells of breathing room on each side
const SIGNED_IN_PREFIX = 'Signed in as ';
// Pieces of the committed-team card, which is the reference shape (see
// committedBodyHeight).
const DIALOG_GAP = 1;
const DROPDOWN_BODY_H = 4;
const SPEND_ROW_H = 2; // "view spend" plus the model-access line beneath it
const ROUNDED_BUTTON_H = 3; // a rounded button needs three rows for its arc border
const FLAT_BUTTON_H = 1; // `short` swaps in borderless buttons

// Height of everything the committed-team card holds below the title: the dropdown
// body, the "view spend" rows, and the account actions, with the Dialog's gap between
// each. The transient and signed-out states reserve this same total so the card never
// resizes while a team resolves. It varies by mode because `compact` stacks the two
// account buttons and `short` drops the spend row and the button borders.
function committedBodyHeight(compact: boolean, short: boolean): number {
  const actions = short
    ? FLAT_BUTTON_H
    : compact
      ? ROUNDED_BUTTON_H * 2 + DIALOG_GAP
      : ROUNDED_BUTTON_H;
  const spend = short ? 0 : SPEND_ROW_H + DIALOG_GAP;
  return DROPDOWN_BODY_H + spend + DIALOG_GAP + actions;
}

// The teams backing the dropdown (index-aligned with its items), and the pick
// handler main.ts wires once at startup. The committed field shows the current team.
let teams: Team[] = [];
let onPick: (team: Team) => void = () => {};

const dropdown = new Dropdown({
  id: 'team-switch-dropdown',
  items: [],
  width: LIST_W,
  rows: LIST_ROWS,
  searchable: true,
  searchPlaceholder: 'Search billing teams',
  placeholder: 'select a billing team',
  onSelect: (i) => {
    const team = teams[i];
    if (team) onPick(team);
  },
});

export function mountTeamSwitch(ui: Screen): void {
  ui.mount(dropdown);
}

export function setTeamSwitchHandlers(h: { onPick: (team: Team) => void }): void {
  onPick = h.onPick;
}


// Feed the loaded teams into the dropdown and commit the current billing team so
// the closed field itself is the current-account indicator.
export function setTeamSwitchTeams(next: Team[], current: Team | null): void {
  teams = next;
  const currentIndex = current ? next.findIndex((team) => team.id === current.id) : -1;
  dropdown.setItems(next.map((team) => team.name), currentIndex);
}

// A successful switch commits the chosen team in the closed dropdown. setItems
// updates the value without firing onSelect again.
export function markSwitchSucceeded(team: Team): void {
  const index = teams.findIndex((candidate) => candidate.id === team.id);
  if (index >= 0) dropdown.setItems(teams.map((candidate) => candidate.name), index);
}

// The modal's visual states: loading the list, the loaded list, an in-flight
// switch, no session (offer sign-in), or a load/switch error.
export type TeamSwitchView =
  | { kind: 'loading' }
  | { kind: 'loaded'; username?: string }
  | { kind: 'switching'; team: string; username?: string }
  | { kind: 'signedOut' }
  | { kind: 'noTeams'; username?: string }
  // `canReturn` (a switch that failed with the list still loaded) shows a "← back"
  // to the dropdown instead of the plain close behavior.
  | { kind: 'error'; message: string; canReturn?: boolean; canRetry?: boolean; username?: string };

const CARD_PAD: [number, number] = [1, 3];
const PRIMARY: Style = {
  padding: [0, 3],
  background: [86, 64, 120],
  color: [238, 230, 250],
  bold: true,
  hover: { background: [110, 84, 150] },
  focus: { background: [110, 84, 150] },
  pressed: { background: [120, 124, 142] },
};
const RECOVERY: Style = {
  padding: [0, 2],
  color: 'textPrimary',
  background: 'surfaceControl',
  bold: true,
  hover: { background: 'controlHoverBg', color: 'controlHoverFg' },
  focus: { background: 'controlFocusBg', color: 'controlFocusFg' },
  pressed: { background: 'controlPressedBg', color: 'controlPressedFg' },
};

const center = (n: Node): Node => Box({ justifyContent: 'center' }, [n]);

function switchAccountButton(onClick: () => void, disabled = false): Node {
  return RoundedButton({
    id: 'team-change-account',
    label: 'switch account',
    onClick,
    disabled,
    color: ARCADE_OUTLINE_CONTROL.neutralText,
    borderColor: ARCADE_OUTLINE_CONTROL.neutralBorder,
    padding: [0, 2],
  });
}

function signOutButton(onClick: () => void, disabled = false): Node {
  return RoundedButton({
    id: 'team-logout',
    label: 'sign out',
    onClick,
    disabled,
    color: [222, 150, 150],
    borderColor: [108, 54, 58],
    activeColor: [255, 242, 242],
    padding: [0, 2],
  });
}

function signedInRow(username: string, width = LIST_W): Node {
  const prefix = width < SIGNED_IN_PREFIX.length + 6 ? 'As ' : SIGNED_IN_PREFIX;
  return Box({ flexDirection: 'row', width }, [
    Text({ text: prefix, style: { color: 'muted', width: prefix.length, flexShrink: 0 } }),
    Text({ text: username, style: { width: Math.max(1, width - prefix.length), color: 'textStrong', bold: true, textOverflow: 'ellipsis' } }),
  ]);
}

export function buildGatewaySignInPrompt(onSignIn: () => void, onDismiss: () => void, width: number, height = Number.POSITIVE_INFINITY): Node {
  const compact = width < 36;
  const short = height < 15;
  const tiny = height < 9;
  return NoticeToast({
    id: 'gateway-signin',
    severity: 'warning',
    title: compact ? 'AI sign-in' : 'Sign in for AI matches',
    body: tiny ? '' : short ? 'Use AI Gateway.' : 'Sign in to play with AI models using Vercel AI Gateway.',
    width: compact ? Math.max(12, width - 2) : Math.min(52, Math.max(32, width - 4)),
    compact,
    action: { label: compact ? 'sign in' : 'sign in to Vercel', onClick: onSignIn },
    onDismiss,
  });
}

// Status views keep the list's normal footprint. Long errors wrap and can grow
// beyond it so the complete gateway response remains readable.
function statusBody(text: string, color: Style['color'], align: 'left' | 'center' = 'center', width = LIST_W, minRows = LIST_ROWS): Node {
  const lines = wrapText(text, Math.max(1, width - 2));
  return Box(
    {
      width,
      height: Math.max(minRows, lines.length),
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: align === 'left' ? 'start' : 'center',
      padding: [0, 1],
    },
    lines.map((line) => Text({ text: line, style: { color } })),
  );
}

// The dropdown stays one row in layout; its search and option list are overlays, so
// opening it does not resize the card or push the logout action down.
function dropdownBody(username: string | undefined, width: number, compact: boolean): Node {
  return Box({ width, height: DROPDOWN_BODY_H, flexDirection: 'column', gap: 1 }, [
    ...(username ? [signedInRow(username, width)] : []),
    Box({ width, flexDirection: 'column', gap: 0 }, [
      Text({ text: compact ? 'Billing team' : 'AI Gateway billing team', style: { color: 'muted' } }),
      Slot('team-switch-dropdown'),
    ]),
  ]);
}

// Build the centered team-switch modal for the given view. Every state in the load
// flow — loading, switching, signed-out, committed — holds one card height (see
// committedBodyHeight); the noTeams and error destinations carry more copy and are
// allowed to be taller. `onClose` (the ✕ / Esc) closes
// it; `onSignIn` (signed-out view only) kicks off the plain-text device login flow;
// `onBack` (a failed switch) returns to the dropdown; `onLogout` clears Arcade's
// cached Vercel session in place. There's no Cancel button.
export function buildTeamSwitch(
  view: TeamSwitchView,
  opts: {
    onClose: () => void;
    onSignIn: () => void;
    onChangeAccount: () => void;
    onRetry: () => void;
    onOpenVercel: () => void;
    onBack: () => void;
    onLogout: () => void;
    onViewSpend: () => void;
    // How much of the model catalog the committed team can reach, from the team catalog's
    // eligibility rows; null while the catalog is the baked fallback, which knows nothing
    // about the team. The row is reserved either way so the card never resizes.
    modelAccess?: { text: string; onClick?: () => void } | null;
  },
  viewportWidth = CARD_W + 2,
  viewportHeight = Number.POSITIVE_INFINITY,
): Node {
  const compact = viewportWidth < CARD_W + 2;
  const short = compact && viewportHeight < 20;
  const cardWidth = compact ? Math.max(14, viewportWidth - 2) : CARD_W;
  const horizontalPadding = compact ? 1 : CARD_PAD[1];
  const listWidth = Math.max(8, cardWidth - horizontalPadding * 2);
  const reservedBodyH = committedBodyHeight(compact, short);
  dropdown.setWidth(listWidth);
  let body: Node;
  let footer: Node | null = null;
  // A switch that failed still has the accounts loaded, so offer a top-left ← back to the
  // dropdown (a load failure has nothing to return to — just the modal's ✕).
  const canBack = view.kind === 'error' && view.canReturn;
  if (view.kind === 'loading') body = statusBody('Loading teams…', 'muted', 'center', listWidth, reservedBodyH);
  else if (view.kind === 'error') {
    const message = compact
      ? view.canReturn ? 'Could not switch teams.' : 'Could not load account.'
      : view.message;
    body = statusBody(message, 'danger', 'left', listWidth, short ? 2 : LIST_ROWS);
    if (view.canRetry) {
      footer = Box({ flexDirection: 'column', alignItems: 'center', gap: 1 }, [
        Button({ id: 'team-retry', label: 'try again', onClick: opts.onRetry, style: PRIMARY }),
        Button({ id: 'team-change-account', label: 'switch account', onClick: opts.onChangeAccount, style: RECOVERY }),
      ]);
    }
  } else if (view.kind === 'signedOut') {
    const message = compact
      ? 'Sign in to play with AI models.'
      : "Sign in to play with AI models through Vercel's AI Gateway.";
    body = Box({ width: listWidth, height: Math.max(1, reservedBodyH - DIALOG_GAP - ROUNDED_BUTTON_H), flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }, [
      ...wrapText(message, listWidth).map((text) => Text({ text, style: { color: 'textPrimary' } })),
    ]);
    footer = Box({ flexDirection: 'row', justifyContent: 'center' }, [RoundedButton({
      id: 'team-signin',
      label: 'sign in',
      onClick: opts.onSignIn,
      color: ARCADE_OUTLINE_CONTROL.activeText,
      borderColor: ARCADE_OUTLINE_CONTROL.activeBorder,
      activeColor: 'textStrong',
    })]);
  } else if (view.kind === 'noTeams') {
    const unavailable = short ? 'No AI Gateway team.' : compact ? 'No team for AI Gateway billing.' : 'No Vercel team is available for AI Gateway billing.';
    const recovery = short
      ? 'Create or join one on Vercel.'
      : compact
      ? 'Create or join one on Vercel, then retry.'
      : 'Create or join a team on Vercel, then try again. You can continue playing without AI.';
    body = Box({ width: listWidth, flexDirection: 'column', gap: 1 }, [
      ...(view.username && !short ? [signedInRow(view.username, listWidth)] : []),
      ...wrapText(unavailable, listWidth).map((line) => Text({ text: line, style: { color: 'danger' } })),
      ...wrapText(recovery, listWidth).map((line) => Text({ text: line, style: { color: 'muted' } })),
    ]);
    const primary = compact ? { ...PRIMARY, padding: [0, 1] as [number, number] } : PRIMARY;
    const secondary = compact ? { ...RECOVERY, padding: [0, 1] as [number, number] } : RECOVERY;
    const open = Button({ id: 'team-open-vercel', label: compact ? 'Vercel' : 'open Vercel', onClick: opts.onOpenVercel, style: primary });
    const retry = Button({ id: 'team-retry', label: compact ? 'retry' : 'try again', onClick: opts.onRetry, style: secondary });
    const change = Button({ id: 'team-change-account', label: short ? 'switch' : 'switch account', onClick: opts.onChangeAccount, style: secondary });
    const shortSignOut = Button({ id: 'team-logout', label: 'sign out', onClick: opts.onLogout, style: { ...secondary, color: [222, 150, 150] } });
    footer = Box({ flexDirection: 'column', alignItems: 'center', gap: 1 }, short
      ? [Box({ flexDirection: 'row', justifyContent: 'center', gap: 1 }, [open, retry]), Box({ flexDirection: 'row', justifyContent: 'center', gap: 1 }, [change, shortSignOut])]
      : compact
      ? [Box({ flexDirection: 'row', justifyContent: 'center', gap: 1 }, [open, retry]), change]
      : [Box({ flexDirection: 'row', justifyContent: 'center', gap: 1 }, [open, retry]), change]);
  } else {
    // Loaded and switching states keep the current team in the committed field.
    // Switching is quick, so there is no transient replacement label.
    body = dropdownBody(view.username, listWidth, compact);
  }

  // Spend belongs to the committed team, so this rides with the dropdown and stays out
  // of the loading/error/signed-out/noTeams views. Left-aligned to the field's edge so it
  // reads as that field's helper rather than a third card-level action; the Dialog's own
  // gap supplies the one row above and below. `short` viewports drop it — they already
  // shed the signed-in row, and a link is worth less there than the account buttons.
  const access = opts.modelAccess;
  const viewSpend =
    (view.kind === 'loaded' || view.kind === 'switching') && !short
      ? Box({ width: listWidth, height: SPEND_ROW_H, flexDirection: 'column' }, [
          Link({ id: 'team-view-spend', label: 'view spend', onClick: opts.onViewSpend }),
          ...(access
            ? [access.onClick
                ? Link({ id: 'team-model-access', label: access.text, onClick: access.onClick })
                : Text({ text: access.text, style: { color: 'muted' } })]
            : []),
        ])
      : null;

  // `switching` keeps the same actions rather than dropping the row: it is a brief
  // transient, and removing it resized the card mid-switch. They stay inert while the
  // switch is in flight so a second account action cannot race the first.
  const committed = view.kind === 'loaded' || view.kind === 'switching';
  const settling = view.kind === 'switching';
  const accountActions = committed
    ? short
      ? Box({ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 1 }, [
          Button({ id: 'team-change-account', label: 'switch', onClick: opts.onChangeAccount, disabled: settling, style: { ...RECOVERY, padding: [0, 1] } }),
          Button({ id: 'team-logout', label: 'sign out', onClick: opts.onLogout, disabled: settling, style: { ...RECOVERY, padding: [0, 1], color: [222, 150, 150] } }),
        ])
      : Box({ flexDirection: compact ? 'column' : 'row', justifyContent: 'center', alignItems: 'center', gap: 1 }, [
          switchAccountButton(opts.onChangeAccount, settling),
          signOutButton(opts.onLogout, settling),
        ])
    : (view.kind === 'noTeams' && !short) || (view.kind === 'error' && view.canRetry)
      ? center(signOutButton(opts.onLogout))
      : null;

  // Dialog supplies the fixed-width card, the centered "Vercel account" title, and the
  // corner ✕ (its absolute placement lines the ✕ up one cell from the edge through the
  // card's [1,1] padding — the same result the hand-rolled close box produced).
  return Modal(
    Dialog({ title: compact ? 'Account' : 'Vercel account', onClose: opts.onClose, closeId: 'team-close', onBack: canBack ? opts.onBack : undefined, backId: 'team-back', align: 'center', width: cardWidth, padding: [1, horizontalPadding] }, [
      body,
      ...(footer ? [footer] : []),
      ...(viewSpend ? [viewSpend] : []),
      ...(accountActions ? [accountActions] : []),
    ]),
    { onDismiss: opts.onClose },
  );
}
