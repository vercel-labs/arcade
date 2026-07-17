// The Vercel account modal, opened from Account in the Cover Flow home menu.
// A persistent searchable Dropdown shows the current billing team in its committed
// field and owns filtering, wrapped options, and overflow scrolling. main.ts owns
// async loading/switching and the modal lifecycle.
import { Box, Button, Dialog, Dropdown, Modal, Slot, Text, type Node, type Screen, type Style } from '../../tui/index.ts';
import type { Team } from '../../auth/index.ts';

const LIST_W = 36;
const LIST_ROWS = 7; // maximum visible dropdown option rows before scrolling
const CARD_W = LIST_W + 6; // three cells of breathing room on each side

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
  searchPlaceholder: 'Search Vercel accounts',
  placeholder: 'select an account',
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

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (word.length > width) {
      if (line) lines.push(line);
      let rest = word;
      while (rest.length > width) {
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      line = rest;
    } else if (!line) line = word;
    else if (line.length + word.length + 1 <= width) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
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
  | { kind: 'loaded' }
  | { kind: 'switching'; team: string }
  | { kind: 'signedOut' }
  // `canReturn` (a switch that failed with the list still loaded) shows a "← back"
  // to the dropdown instead of the plain close behavior.
  | { kind: 'error'; message: string; canReturn?: boolean };

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

// Status views keep the list's normal footprint. Long errors wrap and can grow
// beyond it so the complete gateway response remains readable.
function statusBody(text: string, color: Style['color'], align: 'left' | 'center' = 'center'): Node {
  const lines = wrapText(text, LIST_W - 2);
  return Box(
    {
      width: LIST_W,
      height: Math.max(LIST_ROWS, lines.length),
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
function dropdownBody(): Node {
  return Box({ width: LIST_W }, [Slot('team-switch-dropdown')]);
}

// Build the centered team-switch modal for the given view. The card is a fixed
// size across every view (see statusBody/dropdownBody). `onClose` (the ✕ / Esc) closes
// it; `onSignIn` (signed-out view only) kicks off the plain-text device login flow;
// `onBack` (a failed switch) returns to the dropdown; `onLogout` clears Arcade's
// cached Vercel session and quits. There's no Cancel button.
export function buildTeamSwitch(
  view: TeamSwitchView,
  opts: { onClose: () => void; onSignIn: () => void; onBack: () => void; onLogout: () => void },
): Node {
  let body: Node;
  let footer: Node | null = null;
  // A switch that failed still has the accounts loaded, so offer a top-left ← back to the
  // dropdown (a load failure has nothing to return to — just the modal's ✕).
  const canBack = view.kind === 'error' && view.canReturn;
  if (view.kind === 'loading') body = statusBody('Loading teams…', 'muted');
  else if (view.kind === 'error') {
    body = statusBody(view.message, 'danger', 'left');
  } else if (view.kind === 'signedOut') {
    body = statusBody('Not signed in to Vercel.', 'muted');
    footer = Box({ flexDirection: 'row', justifyContent: 'center' }, [Button({ id: 'team-signin', label: 'sign in', onClick: opts.onSignIn, style: PRIMARY })]);
  } else {
    // Loaded and switching states keep the current team in the committed field.
    // Switching is quick, so there is no transient replacement label.
    body = dropdownBody();
  }

  const logout =
    view.kind === 'signedOut'
      ? null
      : center(Button({ id: 'team-logout', label: 'log out and quit', onClick: opts.onLogout, style: LOGOUT }));

  // Dialog supplies the fixed-width card, the centered "Vercel account" title, and the
  // corner ✕ (its absolute placement lines the ✕ up one cell from the edge through the
  // card's [1,1] padding — the same result the hand-rolled close box produced).
  return Modal(
    Dialog({ title: 'Vercel account', onClose: opts.onClose, closeId: 'team-close', onBack: canBack ? opts.onBack : undefined, backId: 'team-back', align: 'center', width: CARD_W, padding: CARD_PAD }, [
      body,
      ...(footer ? [footer] : []),
      ...(logout ? [logout] : []),
    ]),
    { onDismiss: opts.onClose },
  );
}
