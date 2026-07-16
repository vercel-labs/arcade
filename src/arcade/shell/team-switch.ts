// The "switch Vercel team" modal, opened by the settings gear on the Cover Flow
// menu. A persistent Select (survives the per-frame rebuild, mounted via Slot like
// the match-setup dropdowns) lists the signed-in user's teams with the currently
// billed one marked; clicking / Enter on a row switches to it (persist + re-mint the
// gateway key). main.ts owns the async load/switch and the open/close state; this
// module just holds the list instance and builds the centered popup.
import { Box, Button, Modal, Select, Slot, Text, type Node, type Screen, type Style } from '../../tui/index.ts';
import type { Team } from '../../auth/index.ts';

const LIST_W = 34;
const LIST_ROWS = 7; // fixed viewport height; longer team lists scroll past this
const CARD_W = LIST_W + 6; // card outer width (content = LIST_W within the [1,3] padding)

// The teams backing the current list contents (index-aligned with the Select's
// rows), and the pick handler main.ts wires in once at startup. `currentId` is the
// billed team (● marker); `succeededId` is a team we just switched to (✓ marker),
// which supersedes the dot so the switch reads as confirmed.
let teams: Team[] = [];
let onPick: (team: Team) => void = () => {};
let currentId: string | null = null;
let succeededId: string | null = null;

const list = new Select({
  id: 'team-switch-list',
  items: [],
  width: LIST_W,
  height: LIST_ROWS,
  onSelect: (i) => {
    const t = teams[i];
    if (t) onPick(t);
  },
});

export function mountTeamSwitch(ui: Screen): void {
  ui.mount(list);
}

export function setTeamSwitchHandlers(h: { onPick: (team: Team) => void }): void {
  onPick = h.onPick;
}

// One row label: a ✓ for a just-switched team, else ● for the billed team, else a
// blank gutter (so names stay aligned); a "(slug)" tail disambiguates when the slug
// differs from the name. Truncated to the list width so long names can't overflow.
function labelOf(team: Team): string {
  const mark = team.id === succeededId ? '✓ ' : team.id === currentId ? '● ' : '  ';
  const tail = team.slug && team.slug !== team.name ? ` (${team.slug})` : '';
  return truncate(`${mark}${team.name}${tail}`, LIST_W - 2); // -2 for the row's [0,1] padding
}

function truncate(s: string, max: number): string {
  const cps = [...s];
  return cps.length <= max ? s : `${cps.slice(0, Math.max(0, max - 1)).join('')}…`;
}

// Recompute the row labels in place (preserving selection + scroll) after a marker
// changes — unlike setItems, which resets them.
function relabel(): void {
  list.items = teams.map(labelOf);
}

// Feed the loaded teams into the list and preselect the current one so it's the
// highlighted row when the modal opens. Clears any prior ✓ (this is a fresh open).
// setItems resets index+scroll, so the current-team index is applied after.
export function setTeamSwitchTeams(next: Team[], current: Team | null): void {
  teams = next;
  currentId = current?.id ?? null;
  succeededId = null;
  list.setItems(next.map(labelOf));
  const ci = current ? next.findIndex((t) => t.id === current.id) : -1;
  if (ci >= 0) list.index = ci;
}

// Mark a team as just-switched-to: it becomes the billed team and gets the ✓
// success marker. Keeps the current selection/scroll so the row stays put.
export function markSwitchSucceeded(team: Team): void {
  currentId = team.id;
  succeededId = team.id;
  relabel();
  const i = teams.findIndex((t) => t.id === team.id);
  if (i >= 0) list.index = i;
}

// The modal's visual states: loading the list, the loaded list, an in-flight
// switch, no session (offer sign-in), or a load/switch error.
export type TeamSwitchView =
  | { kind: 'loading' }
  | { kind: 'loaded' }
  | { kind: 'switching'; team: string }
  | { kind: 'signedOut' }
  // `canReturn` (a switch that failed with the list still loaded) shows a "← back"
  // to the list instead of the plain close hint.
  | { kind: 'error'; message: string; canReturn?: boolean };

const CARD: Style = { flexDirection: 'column', gap: 1, padding: [1, 3], background: [22, 24, 32] };
const PRIMARY: Style = {
  padding: [0, 3],
  background: [86, 64, 120],
  color: [238, 230, 250],
  bold: true,
  hover: { background: [110, 84, 150] },
  focus: { background: [110, 84, 150] },
  pressed: { background: [120, 124, 142] },
};
// The close (✕) button in the card's top-right: understated, matching the game-menu
// and chat ✕ — the glyph just brightens to white on hover/focus/press, no fill.
const CLOSE: Style = {
  padding: [0, 1],
  color: [150, 154, 166],
  hover: { color: [255, 255, 255] },
  focus: { color: [255, 255, 255] },
  pressed: { color: [255, 255, 255] },
};
// The "← back" control on a switch error: a quiet text button (like the close hint it
// replaces) that returns to the team list.
const BACK: Style = {
  color: [170, 174, 186],
  hover: { color: [235, 237, 245] },
  focus: { background: [72, 76, 92], color: [235, 237, 245] },
  pressed: { color: [255, 255, 255] },
};
// Destructive account action, kept visually separate at the bottom of the card.
const LOGOUT: Style = {
  padding: [0, 2],
  color: [222, 150, 150],
  border: 'round',
  borderColor: [108, 54, 58],
  hover: { color: [255, 242, 242] },
  focus: { background: [112, 44, 50], color: [255, 242, 242], borderColor: [190, 72, 78] },
  pressed: { background: [190, 58, 64], color: [255, 255, 255] },
};

const center = (n: Node): Node => Box({ justifyContent: 'center' }, [n]);

// A status line centered in the body's fixed footprint (loading / switching /
// signed-out / error), so those views are the exact size of the loaded list — no
// resize flicker when the teams land.
function statusBody(text: string, color: Style['color']): Node {
  return Box({ width: LIST_W, height: LIST_ROWS, justifyContent: 'center', alignItems: 'center' }, [Text({ text, style: { color } })]);
}

// The loaded list in a fixed-height, clipped viewport: the space is allocated up
// front (empty rows below a short list), and a long list scrolls within it — the
// modal looks identical whether the account has two teams or twenty.
function listBody(): Node {
  return Box({ width: LIST_W, height: LIST_ROWS, overflow: 'hidden' }, [Slot('team-switch-list')]);
}

// Build the centered team-switch modal for the given view. The card is a fixed
// size across every view (see statusBody/listBody). `onClose` (the ✕ / Esc) closes
// it; `onSignIn` (signed-out view only) kicks off the plain-text device login flow;
// `onBack` (a failed switch) returns to the team list; `onLogout` clears Arcade's
// cached Vercel session and quits. There's no Cancel button.
export function buildTeamSwitch(
  view: TeamSwitchView,
  opts: { onClose: () => void; onSignIn: () => void; onBack: () => void; onLogout: () => void },
): Node {
  let body: Node;
  let hint = 'Esc close';
  let footer: Node | null = null;
  if (view.kind === 'loading') body = statusBody('Loading teams…', 'muted');
  else if (view.kind === 'error') {
    body = statusBody(truncate(view.message, LIST_W), 'danger');
    // A switch that failed still has the list loaded → offer "← back" to it instead of
    // the plain close hint. A load failure (no list) keeps the close hint.
    if (view.canReturn) {
      hint = '';
      footer = Box({ flexDirection: 'row', justifyContent: 'start' }, [Button({ id: 'team-back', label: '← back', onClick: opts.onBack, style: BACK })]);
    }
  } else if (view.kind === 'signedOut') {
    body = statusBody('Not signed in to Vercel.', 'muted');
    footer = Box({ flexDirection: 'row', justifyContent: 'center' }, [Button({ id: 'team-signin', label: 'sign in', onClick: opts.onSignIn, style: PRIMARY })]);
  } else {
    // loaded / switching: the list stays visible (so the switched row's ✓ shows in
    // place). Switching is quick, so no transient "switching…" label — just the list.
    body = listBody();
    hint = '↑↓ move · ⏎ switch · Esc';
  }

  // The ✕ close button, inset one cell from the card's top-right corner. Absolute
  // children resolve against the content box (inside the card's [1,3] padding), so
  // `top: 0` already leaves the one-row top padding above it, and `right: -2` pulls it
  // out through two of the three right-padding cells to leave exactly one cell to the
  // card's right edge.
  const close = Box({ position: 'absolute', top: 0, right: -2 }, [Button({ id: 'team-close', label: '✕', onClick: opts.onClose, style: CLOSE })]);
  const logout =
    view.kind === 'signedOut'
      ? null
      : center(Button({ id: 'team-logout', label: 'log out and quit', onClick: opts.onLogout, style: LOGOUT }));

  const card = Box({ ...CARD, width: CARD_W }, [
    center(Text({ text: 'Vercel account', style: { color: [222, 224, 234], bold: true } })),
    body,
    ...(hint ? [center(Text({ text: hint, style: { color: 'muted' } }))] : []),
    ...(footer ? [footer] : []),
    ...(logout ? [logout] : []),
    close,
  ]);
  return Modal(card);
}
