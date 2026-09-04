import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Dropdown, layout, Screen, type Node } from '../../tui/index.ts';
import { buildGatewaySignInPrompt, buildTeamSwitch, markSwitchSucceeded, mountTeamSwitch, setTeamSwitchHandlers, setTeamSwitchTeams } from './team-switch.ts';

function find(root: Node, id: string): Node | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const match = find(child, id);
    if (match) return match;
  }
  return null;
}

function text(root: Node): string {
  return [root.text ?? '', ...(root.children ?? []).map(text)].filter(Boolean).join(' ');
}

const noop = (): void => {};
const actions = (overrides: Partial<Parameters<typeof buildTeamSwitch>[1]> = {}): Parameters<typeof buildTeamSwitch>[1] => ({
  onClose: noop,
  onSignIn: noop,
  onChangeAccount: noop,
  onRetry: noop,
  onOpenVercel: noop,
  onBack: noop,
  onLogout: noop,
  onViewSpend: noop,
  ...overrides,
});

describe('Vercel account settings', () => {
  test('offers view spend beside the committed team, and only there', () => {
    let opened = 0;
    const root = buildTeamSwitch({ kind: 'loaded', username: 'brian.zhang' }, actions({ onViewSpend: () => opened++ }));
    const link = find(root, 'team-view-spend');
    assert.ok(link, 'expected the view spend link');
    assert.equal(link.text, 'view spend');
    assert.equal(link.style.underline, true, 'reads as a link, not a button');
    assert.equal(link.style.border, undefined, 'no button chrome');
    link.onClick?.();
    assert.equal(opened, 1);

    // One row above and below, so the account buttons sit the same distance from the
    // link as they used to sit from the dropdown.
    const card = root.children?.[0];
    assert.equal(card?.style.gap, 1);
    const rows = (card?.children ?? []).filter((child) => child.style.position !== 'absolute');
    const spendIndex = rows.findIndex((row) => find(row, 'team-view-spend'));
    const actionsIndex = rows.findIndex((row) => find(row, 'team-logout'));
    assert.equal(spendIndex, actionsIndex - 1, 'view spend sits directly above the account actions');
    const hasDropdown = (node: Node): boolean =>
      node.component === 'team-switch-dropdown' || (node.children ?? []).some(hasDropdown);
    assert.ok(hasDropdown(rows[spendIndex - 1]!), 'the account dropdown body sits directly above it');

    for (const view of [
      { kind: 'loading' } as const,
      { kind: 'signedOut' } as const,
      { kind: 'noTeams', username: 'brian.zhang' } as const,
      { kind: 'error', message: 'nope' } as const,
    ]) {
      assert.equal(find(buildTeamSwitch(view, actions()), 'team-view-spend'), null, `no spend link in the ${view.kind} view`);
    }
  });

  test('a short viewport drops view spend to keep the account buttons', () => {
    const root = buildTeamSwitch({ kind: 'loaded', username: 'brian.zhang' }, actions(), 30, 18);
    assert.equal(find(root, 'team-view-spend'), null);
    assert.ok(find(root, 'team-logout'), 'the account actions survive instead');
  });

  test('the AI match gate stays focused on Gateway sign-in', () => {
    const root = buildGatewaySignInPrompt(noop, noop, 80);
    assert.match(text(root), /Sign in to play with AI models using Vercel AI Gateway/);
    assert.doesNotMatch(text(root), /Human play/);
  });

  test('the AI match gate uses compact copy and geometry in a narrow terminal', () => {
    const root = buildGatewaySignInPrompt(noop, noop, 24);
    const screen = new Screen(24, 20);
    screen.setRoot(root, { x: 0, y: 0, w: 24, h: 20 });
    assert.match(text(root), /AI sign-in/);
    assert.match(text(root), /sign in/);
    assert.ok((root.children?.[0]?.layout?.w ?? Infinity) <= 24);
  });

  test('the AI match gate keeps close and sign-in visible in a short terminal', () => {
    const root = buildGatewaySignInPrompt(noop, noop, 20, 8);
    const screen = new Screen(20, 8);
    screen.setRoot(root, { x: 0, y: 0, w: 20, h: 8 });
    for (const id of ['gateway-signin-close', 'gateway-signin-action']) {
      const node = find(root, id);
      assert.ok(node?.layout);
      assert.ok(node.layout.y >= 0 && node.layout.y + node.layout.h <= 8);
    }
  });

  test('account recovery keeps its dropdown and actions inside a narrow terminal', () => {
    const screen = new Screen(24, 24);
    mountTeamSwitch(screen);
    const teams = [{ id: 'team', slug: 'team', name: 'A very long billing team name' }];
    setTeamSwitchTeams(teams, teams[0]);
    const root = buildTeamSwitch({ kind: 'loaded', username: 'a-very-long-username' }, actions(), 24);
    screen.setRoot(root, { x: 0, y: 0, w: 24, h: 24 });
    assert.ok((root.children?.[0]?.layout?.w ?? Infinity) <= 24);
    assert.ok((find(root, 'team-switch-dropdown')?.layout?.w ?? Infinity) <= 20);
    assert.ok(find(root, 'team-change-account'));
    assert.ok(find(root, 'team-logout'));
  });

  test('short no-team recovery keeps dismissal and account actions visible', () => {
    const screen = new Screen(24, 16);
    const root = buildTeamSwitch({ kind: 'noTeams', username: 'brian.zhang' }, actions(), 24, 16);
    screen.setRoot(root, { x: 0, y: 0, w: 24, h: 16 });
    for (const id of ['team-close', 'team-open-vercel', 'team-retry', 'team-change-account', 'team-logout']) {
      const node = find(root, id);
      assert.ok(node?.layout, `${id} is present and laid out`);
      assert.ok(node.layout.y >= 0 && node.layout.y + node.layout.h <= 16, `${id} stays inside the short viewport`);
    }
  });

  test('short loaded account keeps close and both account actions visible', () => {
    const screen = new Screen(40, 12);
    mountTeamSwitch(screen);
    const teams = [{ id: 'team', slug: 'team', name: 'Vercel Labs' }];
    setTeamSwitchTeams(teams, teams[0]);
    const root = buildTeamSwitch({ kind: 'loaded', username: 'brian.zhang' }, actions(), 40, 12);
    screen.setRoot(root, { x: 0, y: 0, w: 40, h: 12 });
    for (const id of ['team-close', 'team-change-account', 'team-logout']) {
      const node = find(root, id);
      assert.ok(node?.layout);
      assert.ok(node.layout.y >= 0 && node.layout.y + node.layout.h <= 12);
    }
  });

  test('offers non-destructive account actions for a signed-in account', () => {
    let loggedOut = false;
    let changedAccount = false;
    const root = buildTeamSwitch(
      { kind: 'loaded', username: 'brian.zhang' },
      actions({
        onChangeAccount: () => (changedAccount = true),
        onLogout: () => (loggedOut = true),
      }),
    );
    assert.equal(root.children?.[0]?.style.width, 42, 'account card leaves three cells around the account dropdown');
    assert.match(text(root), /Signed in as\s+brian\.zhang/);
    assert.match(text(root), /AI Gateway billing team/);
    const change = find(root, 'team-change-account');
    const logout = find(root, 'team-logout');
    assert.equal(change?.text, 'switch account');
    assert.equal(logout?.text, 'sign out');
    assert.equal(change?.style.hover?.background, undefined, 'outlined hover never fills black');
    assert.equal(change?.style.hover?.bold, true, 'switch account follows shared rounded hover emphasis');
    assert.equal(logout?.style.hover?.bold, true, 'destructive rounded actions bold on hover too');
    change?.onClick?.();
    logout?.onClick?.();
    assert.equal(changedAccount, true);
    assert.equal(loggedOut, true);
  });

  test('wraps the complete gateway error instead of truncating it', () => {
    const message = 'Could not create AI Gateway key (HTTP 403): Your team does not have permission to create this key.';
    const root = buildTeamSwitch(
      { kind: 'error', message, canReturn: true },
      actions(),
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
        { kind: 'loaded', username: 'brian.zhang' },
        actions(),
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

  test('long account and team names stay inside the fixed-width card', () => {
    const longTeam = { id: 'long', slug: 'long', name: 'An extraordinarily long team name that must not resize the account dialog' };
    const screen = new Screen(80, 30);
    mountTeamSwitch(screen);
    setTeamSwitchTeams([longTeam], longTeam);
    const root = buildTeamSwitch(
      { kind: 'loaded', username: 'an-extraordinarily-long-user-name-that-must-not-resize-the-account-dialog' },
      actions(),
    );
    screen.setRoot(root, { x: 0, y: 0, w: 80, h: 30 });
    assert.equal(root.children?.[0]?.style.width, 42);
    const rendered = screen.frame();
    assert.ok((rendered.match(/…/g) ?? []).length >= 2, 'both constrained identity fields expose truncation rather than overflow');
  });

  test('does not offer logout when already signed out', () => {
    const root = buildTeamSwitch(
      { kind: 'signedOut' },
      actions(),
    );
    assert.equal(find(root, 'team-logout'), null);
    assert.ok(find(root, 'team-signin'));
    assert.match(text(root), /AI models through Vercel's AI Gateway/);
    assert.doesNotMatch(text(root), /Human play/);
  });

  test('the card keeps one height while a team resolves, in every mode', () => {
    // Loading, switching, signed-out and committed all appear in one uninterrupted
    // flow, so the card must not resize between them. noTeams/error are destinations
    // with more to say and are deliberately allowed to be taller.
    const flow = [
      { kind: 'loading' } as const,
      { kind: 'switching', team: 'Vercel Labs', username: 'brian.zhang' } as const,
      { kind: 'signedOut' } as const,
      { kind: 'loaded', username: 'brian.zhang' } as const,
    ];
    for (const [mode, w, h] of [['wide', 80, 40], ['compact', 34, 40], ['short', 34, 18]] as const) {
      const heights = flow.map((view) => {
        const root = buildTeamSwitch(view, actions(), w, h);
        layout(root, { x: 0, y: 0, w, h });
        return root.children?.[0]?.layout?.h;
      });
      assert.equal(new Set(heights).size, 1, `${mode}: card resized across the load flow (${heights.join(' → ')})`);
    }
  });

  test('switching keeps the account actions, inert, rather than dropping the row', () => {
    const switching = buildTeamSwitch({ kind: 'switching', team: 'Vercel Labs', username: 'brian.zhang' }, actions());
    for (const id of ['team-change-account', 'team-logout']) {
      const button = find(switching, id);
      assert.ok(button, `${id} stays mounted mid-switch so the card holds its height`);
      assert.equal(button.disabled, true, `${id} is inert until the switch settles`);
    }
    const loaded = buildTeamSwitch({ kind: 'loaded', username: 'brian.zhang' }, actions());
    assert.ok(!find(loaded, 'team-logout')?.disabled, 'and live again once loaded');
  });

  test('signed-in and signed-out cards share one shape and rounded action rhythm', () => {
    const signedIn = buildTeamSwitch({ kind: 'loaded', username: 'brian.zhang' }, actions());
    const signedOut = buildTeamSwitch({ kind: 'signedOut' }, actions());
    const region = { x: 0, y: 0, w: 80, h: 30 };
    layout(signedIn, region);
    layout(signedOut, region);
    assert.deepEqual(signedOut.children?.[0]?.layout, signedIn.children?.[0]?.layout);
    assert.equal(find(signedOut, 'team-signin')?.style.border, 'round');
  });

  test('no-team recovery keeps the user in Arcade with three next actions', () => {
    const root = buildTeamSwitch({ kind: 'noTeams', username: 'new-player' }, actions());
    const rendered = text(root);
    assert.match(rendered, /Signed in as\s+new-player/);
    assert.match(rendered, /No Vercel team is available for AI Gateway billing/);
    assert.match(rendered, /continue playing without AI/);
    assert.ok(find(root, 'team-open-vercel'));
    assert.ok(find(root, 'team-retry'));
    assert.ok(find(root, 'team-change-account'));
    assert.equal(find(root, 'team-logout')?.text, 'sign out');
  });

  test('a team-list load error can retry, change account, or sign out', () => {
    const root = buildTeamSwitch(
      { kind: 'error', message: 'Could not list teams (HTTP 503).', canRetry: true },
      actions(),
    );
    assert.ok(find(root, 'team-retry'));
    assert.ok(find(root, 'team-change-account'));
    assert.equal(find(root, 'team-logout')?.text, 'sign out');
    assert.equal(find(root, 'team-back'), null, 'a load error has no stale team list to return to');
  });
});
