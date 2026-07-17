import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Dropdown, Screen, type Node } from '../../tui/index.ts';
import { buildTeamSwitch, markSwitchSucceeded, mountTeamSwitch, setTeamSwitchHandlers, setTeamSwitchTeams } from './team-switch.ts';

function find(root: Node, id: string): Node | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const match = find(child, id);
    if (match) return match;
  }
  return null;
}

const noop = (): void => {};

describe('Vercel account settings', () => {
  test('offers log out and quit for a signed-in account', () => {
    let loggedOut = false;
    const root = buildTeamSwitch(
      { kind: 'loaded' },
      { onClose: noop, onSignIn: noop, onBack: noop, onLogout: () => (loggedOut = true) },
    );
    assert.equal(root.children?.[0]?.style.width, 42, 'account card leaves three cells around the account dropdown');
    const button = find(root, 'team-logout');
    assert.ok(button, 'expected the logout button');
    button.onClick?.();
    assert.equal(loggedOut, true);
  });

  test('wraps the complete gateway error instead of truncating it', () => {
    const message = 'Could not create AI Gateway key (HTTP 403): Your team does not have permission to create this key.';
    const root = buildTeamSwitch(
      { kind: 'error', message, canReturn: true },
      { onClose: noop, onSignIn: noop, onBack: noop, onLogout: noop },
    );
    const errorLines: string[] = [];
    const visit = (node: Node): void => {
      if (node.style.color === 'danger' && node.text != null) errorLines.push(node.text);
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    assert.ok(errorLines.length > 1, 'the gateway error wraps onto multiple lines');
    assert.equal(errorLines.join(' '), message, 'every word in the gateway error remains visible');
    assert.ok(errorLines.every((line) => line.length <= 34), 'wrapped lines fit the compact card body');
  });

  test('uses a searchable dropdown whose committed value is the current account', () => {
    const teams = [
      { id: 'current', slug: 'current', name: 'Vercel Labs' },
      { id: 'other', slug: 'other', name: 'AI Gateway Early Access Models' },
      { id: 'long', slug: 'long', name: 'This is an intentionally very long Vercel team name that wraps' },
    ];
    const picked: string[] = [];
    const screen = new Screen(80, 30);
    mountTeamSwitch(screen);
    setTeamSwitchHandlers({ onPick: (team) => picked.push(team.id) });
    setTeamSwitchTeams(teams, teams[0]);
    screen.setRoot(
      buildTeamSwitch(
        { kind: 'loaded' },
        { onClose: noop, onSignIn: noop, onBack: noop, onLogout: noop },
      ),
      { x: 0, y: 0, w: 80, h: 30 },
    );

    const dropdown = screen.component('team-switch-dropdown');
    assert.ok(dropdown instanceof Dropdown);
    assert.equal(dropdown.value, 'Vercel Labs', 'the current account is the committed field value');
    assert.deepEqual(dropdown.filteredItems, teams.map((team) => team.name), 'account names have no checkmark gutter or slug suffix');

    dropdown.onKey({ name: 'enter', raw: '\r', sequence: '\r', ctrl: false, shift: false, meta: false, eventType: 'press' });
    assert.equal(dropdown.open, true);
    dropdown.setQuery('gateway');
    assert.deepEqual(dropdown.filteredItems, ['AI Gateway Early Access Models']);

    dropdown.pick(2);
    assert.deepEqual(picked, ['long'], 'choosing an option delegates the account switch');
    markSwitchSucceeded(teams[2]);
    assert.equal(dropdown.value, teams[2].name, 'a successful switch commits the new current account');
  });

  test('does not offer logout when already signed out', () => {
    const root = buildTeamSwitch(
      { kind: 'signedOut' },
      { onClose: noop, onSignIn: noop, onBack: noop, onLogout: noop },
    );
    assert.equal(find(root, 'team-logout'), null);
    assert.ok(find(root, 'team-signin'));
  });
});
