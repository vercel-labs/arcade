import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  GATEWAY_HOST,
  VERCEL_API_HOST,
  TERMINAL_CWD,
  baseNetworkPolicy,
  baseSandboxName,
  hostedGatewayCredential,
  interactiveStart,
  packageSpec,
  parseTerminalSize,
  isTerminalBaseWarmRequest,
  sessionNetworkPolicy,
  terminalFiles,
} from './terminal-config';

describe('hosted Arcade terminal configuration', () => {
  test('uses practical defaults and clamps terminal dimensions', () => {
    assert.deepEqual(parseTerminalSize(null), { cols: 100, rows: 48 });
    assert.deepEqual(parseTerminalSize({ cols: 12, rows: 500 }), { cols: 48, rows: 100 });
    assert.deepEqual(parseTerminalSize({ cols: 131.6, rows: 41.2 }), { cols: 132, rows: 41 });
  });

  test('pins the installed package and reusable base to the deployment revision', () => {
    const env = { VERCEL_GIT_COMMIT_SHA: 'ABCDEF1234567890' } as unknown as NodeJS.ProcessEnv;
    assert.equal(packageSpec(env), '@vercel/arcade#ABCDEF1234567890');
    assert.equal(baseSandboxName(env), 'arcade-web-base-v16-abcdef123456');
  });

  test('recognizes only an explicit base-only warm request', () => {
    assert.equal(isTerminalBaseWarmRequest({ warmOnly: true }), true);
    assert.equal(isTerminalBaseWarmRequest({ warmOnly: false }), false);
    assert.equal(isTerminalBaseWarmRequest(null), false);
  });

  test('allows only package installation hosts while building the base', () => {
    assert.deepEqual(baseNetworkPolicy(), {
      allow: ['registry.npmjs.org', '*.npmjs.org'],
    });
  });

  test('allows browser-auth APIs but no demo credential transform without a hosted credential', () => {
    const policy = sessionNetworkPolicy('placeholder', null);
    assert.notEqual(policy, 'deny-all');
    if (typeof policy === 'string' || !policy.allow || Array.isArray(policy.allow)) assert.fail('expected allow policy');
    assert.deepEqual(policy.allow[VERCEL_API_HOST], []);
    assert.deepEqual(policy.allow[GATEWAY_HOST], [{ match: {}, transform: [] }]);
    assert.equal(hostedGatewayCredential({} as unknown as NodeJS.ProcessEnv), null);
  });

  test('injects a credential only for a matching placeholder request to Gateway', () => {
    const policy = sessionNetworkPolicy('placeholder', { token: 'real-token', authMethod: 'api-key' });
    assert.notEqual(policy, 'deny-all');
    if (typeof policy === 'string' || !policy.allow || Array.isArray(policy.allow)) assert.fail('expected transformed allow policy');
    const rules = policy.allow[GATEWAY_HOST];
    const valueMatcher = rules?.[0]?.match?.headers?.[0]?.value;
    assert.ok(valueMatcher && 'exact' in valueMatcher);
    assert.equal(valueMatcher.exact, 'Bearer placeholder');
    assert.equal(rules?.[0]?.transform?.[0]?.headers?.authorization, 'Bearer real-token');
    assert.deepEqual(rules?.[1], { match: {}, transform: [] });
  });

  test('seeds the actual CLI wrapper and navigable docs filesystem', () => {
    const files = terminalFiles('git+https://example.test/arcade#sha', 'placeholder');
    const byPath = new Map(files.map((file) => [file.path, file.content]));
    assert.match(byPath.get(`${TERMINAL_CWD}/README.md`) ?? '', /cd docs/);
    assert.match(byPath.get(`${TERMINAL_CWD}/docs/engine.md`) ?? '', /@vercel\/arcade\/engine/);
    assert.match(byPath.get(`${TERMINAL_CWD}/examples/README.md`) ?? '', /rendering\.md/);
    assert.match(byPath.get(`${TERMINAL_CWD}/system/arcade-demo`) ?? '', /ARCADE_TELEMETRY=0/);
    assert.match(byPath.get(`${TERMINAL_CWD}/system/arcade-demo`) ?? '', /exec \/usr\/local\/bin\/arcade/);
    assert.match(byPath.get(`${TERMINAL_CWD}/system/arcade-demo`) ?? '', /"\$@"/);
    const visitorShell = byPath.get(`${TERMINAL_CWD}/system/visitor.bashrc`) ?? '';
    assert.match(visitorShell, /function help\(\) \{ arcade_help; \}/);
    assert.match(visitorShell, /__ARCADE_HOST_MODE_1__/);
    assert.match(visitorShell, /__ARCADE_HOST_MODE_0__/);
    assert.match(visitorShell, /arcade --version/);
    assert.match(visitorShell, /cd docs/);
    assert.match(visitorShell, /cd examples/);
    assert.match(visitorShell, /Telemetry is disabled/);
  });

  test('starts a login shell with a truecolor PTY at the requested size', () => {
    assert.deepEqual(interactiveStart({ cols: 120, rows: 60 }), {
      command: '/usr/bin/sudo',
      args: ['-iu', 'visitor', 'env', 'TERM=xterm-256color', 'COLORTERM=truecolor', '/bin/bash', '-li'],
      env: ['TERM=xterm-256color', 'COLORTERM=truecolor'],
      cwd: TERMINAL_CWD,
      cols: 120,
      rows: 60,
    });
  });
});
