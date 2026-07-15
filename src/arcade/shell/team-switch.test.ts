import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Node } from '../../tui/index.ts';
import { buildTeamSwitch } from './team-switch.ts';

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
    const button = find(root, 'team-logout');
    assert.ok(button, 'expected the logout button');
    button.onClick?.();
    assert.equal(loggedOut, true);
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
