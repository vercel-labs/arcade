import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const mainSource = () => readFile(new URL('./main.ts', import.meta.url), 'utf8');
const gatewaySource = () => readFile(new URL('../auth/gateway-key.ts', import.meta.url), 'utf8');

test('every model-backed entry point uses the shared sign-in gate', async () => {
  const source = await mainSource();
  for (const [start, end] of [
    ['function openMatchSetup()', 'function closeMatchSetup()'],
    ['async function confirmMatchSetup()', '// ── In-match model swap'],
    ['function openPokerSetup()', 'function closePokerSetup()'],
    ['async function confirmPokerSetup()', '// The bottom-left "new match" button'],
    ['async function startIslandersGame()', '// Tear the session down'],
  ] as const) {
    const body = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
    assert.match(body, /requireGateway\(/, `${start} must offer direct sign-in before model use`);
  }
  const practiceUpgrade = source.slice(source.indexOf('function openPokerWispSwap'), source.indexOf('function closeWispSwap'));
  assert.match(practiceUpgrade, /spec\.kind === 'bot'.*requireGateway/s);
});

test('the shared sign-in gate installs the key, refreshes models, and resumes the attempted action', async () => {
  const source = await mainSource();
  const flow = source.slice(source.indexOf('function signInFromGatewayPrompt'), source.indexOf('function refreshFailureNoticeOverlay'));
  assert.match(flow, /ensureGatewayKey\(\)/);
  assert.match(flow, /if \(!resume \|\| gatewaySignInBusy\) return;/);
  assert.match(flow, /gatewaySignInBusy = true;/);
  assert.match(flow, /finally.*gatewaySignInBusy = false/s);
  assert.match(flow, /refreshTeamModelCatalog\(auth\)/);
  assert.match(flow, /resume\(\)/);
  assert.match(flow, /gatewayAccountRecovery = true/);
  assert.match(flow, /if \(isLoggedIn\(\)\) await loadTeams\(\)/);
  assert.match(source, /buildTeamSwitch\(teamView, teamSwitchActions\(dismissGatewaySignInPrompt\), cols, rows\)/);
});

test('the home telemetry row reports and respects an environment-forced opt-out', async () => {
  const source = await mainSource();
  const menu = source.slice(source.indexOf('const telemetryForcedOff'), source.indexOf("{ id: 'home-menu-quit'"));
  assert.match(menu, /isTelemetryEnvironmentOptedOut\(\)/);
  assert.match(menu, /'off \(env\)'/);
  assert.match(menu, /disabled: telemetryForcedOff/);
});

test('account list requests cannot overwrite a newer close, sign-out, or account operation', async () => {
  const source = await mainSource();
  const load = source.slice(source.indexOf('async function loadTeams'), source.indexOf('// Commit a picked team'));
  assert.match(load, /const operation = teamOperations\.begin\(\)/);
  assert.match(load, /!operation\.isCurrent\(\) \|\| !accountSurfaceOpen\(\)/);
  for (const start of ['function dismissGatewaySignInPrompt', 'function closeTeamSwitch', 'function teamSwitchChangeAccount', 'function teamSwitchSignOut']) {
    const body = source.slice(source.indexOf(start), source.indexOf('\n}', source.indexOf(start)) + 2);
    assert.match(body, /teamOperations\.invalidate\(\)/, `${start} must invalidate older account work`);
  }
  assert.match(source, /setTeamSwitchTeams\(\[\], null\)/);
  const pick = source.slice(source.indexOf('function pickTeamChoice'), source.indexOf('// The switch-error'));
  assert.match(pick, /const operation = teamOperations\.begin\(\)/);
  assert.match(pick, /useTeam\(team, isCurrent\)/);
  assert.match(pick, /refreshTeamModelCatalog\(auth, isCurrent\)/);

  const gateway = await gatewaySource();
  const use = gateway.slice(gateway.indexOf('export async function useTeam'), gateway.indexOf('// Delete the stored session'));
  assert.match(use, /mintKey\(candidate, team, true, false, false\)/);
  assert.match(use, /if \(!isCurrent\(\)\) return null;.*writeAuth\(candidate\);.*process\.env\[ENV_KEY\] = key;/s);
  const available = gateway.slice(gateway.indexOf('export async function availableTeams'), gateway.indexOf('// Stage a team'));
  assert.match(available, /cachedSession\('if-current'\)/);
  assert.match(available, /ensureUsername\(auth, false\)/);
});

test('the Gateway overlay rebuilds at the new terminal geometry', async () => {
  const source = await mainSource();
  const resize = source.slice(source.indexOf("process.stdout.on('resize'"), source.indexOf('// Resolve the AI Gateway key'));
  assert.match(resize, /ui\.resize\(cols, rows\);/);
  assert.match(resize, /if \(gatewaySignInResume\) refreshGatewaySignInOverlay\(\);/);
});

test('the shared sign-in gate blocks underlying keyboard and pointer input', async () => {
  const source = await mainSource();
  const keys = source.slice(source.indexOf('function onKeyImpl'), source.indexOf('function onMouseImpl'));
  assert.match(keys, /if \(gatewaySignInResume\).*dismissGatewaySignInPrompt\(\).*ui\.handleKey\(ev\).*return;/s);
  assert.match(keys, /gatewayAccountRecovery.*ui\.handleKey\(ev\)/s);
  const mouse = source.slice(source.indexOf('function onMouseImpl'), source.indexOf('const parse ='));
  assert.match(mouse, /gatewaySignInResume \|\| failureNotice \|\| failureResume/);
});

test('Tutorial practice games stay local and real-model steps remain optional', async () => {
  const source = await mainSource();
  const tutorial = source.slice(source.indexOf('function showTutorialChapter'), source.indexOf('function closeTutorialPopups'));
  assert.match(tutorial, /pokerMatch\.start\(\[\{ kind: 'human' \}, \{ kind: 'bot' \}, \{ kind: 'bot' \}\]\)/);
  assert.match(tutorial, /\{ kind: 'bot', color: 'blue' \}/);
  assert.match(tutorial, /\{ kind: 'bot', color: 'orange' \}/);
  assert.doesNotMatch(tutorial, /kind: 'ai'/);
  assert.match(source, /step\.requires !== 'gateway' \|\| Boolean\(process\.env\.AI_GATEWAY_API_KEY\)/);
});
