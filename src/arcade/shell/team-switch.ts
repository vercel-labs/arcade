// The "switch Vercel team" modal, opened by the settings gear on the Cover Flow
// menu. A persistent Select (survives the per-frame rebuild, mounted via Slot like
// the match-setup dropdowns) lists the signed-in user's teams with the currently
// billed one marked; clicking / Enter on a row switches to it (persist + re-mint the
// gateway key). main.ts owns the async load/switch and the open/close state; this
// module just holds the list instance and builds the centered popup.
import { Box, Button, Modal, Select, Slot, Text, type Node, type Screen, type Style } from '../../tui/index.ts';
import type { Team } from '../../auth/index.ts';

const LIST_W = 34;
const LIST_ROWS = 7; // visible rows; longer team lists scroll past this

// The teams backing the current list contents (index-aligned with the Select's
// rows), and the pick handler main.ts wires in once at startup.
let teams: Team[] = [];
let onPick: (team: Team) => void = () => {};

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

// One row label: the currently billed team gets a ● marker, others a blank gutter
// (so names stay aligned); a dim-free "(slug)" tail disambiguates when the slug
// differs from the name. Truncated to the list width so long names can't overflow.
function label(team: Team, current: Team | null): string {
  const mark = current && team.id === current.id ? '● ' : '  ';
  const tail = team.slug && team.slug !== team.name ? ` (${team.slug})` : '';
  return truncate(`${mark}${team.name}${tail}`, LIST_W - 2); // -2 for the row's [0,1] padding
}

function truncate(s: string, max: number): string {
  const cps = [...s];
  return cps.length <= max ? s : `${cps.slice(0, Math.max(0, max - 1)).join('')}…`;
}

// Feed the loaded teams into the list and preselect the current one so it's the
// highlighted row when the modal opens. setItems resets index+scroll to the top,
// so the current-team index is applied after.
export function setTeamSwitchTeams(next: Team[], current: Team | null): void {
  teams = next;
  list.setItems(next.map((t) => label(t, current)));
  const ci = current ? next.findIndex((t) => t.id === current.id) : -1;
  if (ci >= 0) list.index = ci;
}

// The modal's visual states: loading the list, the loaded list, an in-flight
// switch, no session (offer sign-in), or a load/switch error.
export type TeamSwitchView =
  | { kind: 'loading' }
  | { kind: 'loaded' }
  | { kind: 'switching'; team: string }
  | { kind: 'signedOut' }
  | { kind: 'error'; message: string };

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
const CANCEL: Style = {
  padding: [0, 2],
  background: [40, 42, 52],
  color: [212, 214, 224],
  hover: { background: [72, 76, 92] },
  focus: { background: [72, 76, 92] },
};

const center = (n: Node): Node => Box({ justifyContent: 'center' }, [n]);
const note = (text: string, color: Style['color'] = 'muted'): Node => center(Text({ text, style: { color } }));

// Build the centered team-switch modal for the given view. `onCancel` closes it;
// `onSignIn` (used only in the signed-out view) kicks off the plain-text device
// login flow.
export function buildTeamSwitch(view: TeamSwitchView, opts: { onCancel: () => void; onSignIn: () => void }): Node {
  const cancel = Button({ id: 'team-cancel', label: 'Cancel', onClick: opts.onCancel, style: CANCEL });

  const body: Node[] = [];
  const footer: Node[] = [cancel];

  if (view.kind === 'loading') {
    body.push(note('Loading teams…'));
  } else if (view.kind === 'switching') {
    body.push(note(`Switching to ${view.team}…`));
  } else if (view.kind === 'error') {
    body.push(note(view.message, 'danger'));
  } else if (view.kind === 'signedOut') {
    body.push(note('Not signed in to Vercel.'));
    footer.unshift(Button({ id: 'team-signin', label: 'Sign in with Vercel', onClick: opts.onSignIn, style: PRIMARY }));
  } else {
    // loaded: the scrollable team list + a control hint. Switching happens on a
    // row click / Enter (Select.onSelect), so there's no separate confirm button.
    body.push(Slot('team-switch-list'));
    body.push(note('↑↓ move · Enter switch · Esc close'));
  }

  const card = Box(CARD, [
    center(Text({ text: 'Switch team', style: { color: [222, 224, 234], bold: true } })),
    ...body,
    Box({ flexDirection: 'row', justifyContent: 'center', gap: 2 }, footer),
  ]);
  return Modal(card);
}
