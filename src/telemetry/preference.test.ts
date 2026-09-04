import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const previous = {
  arcadeDev: process.env.ARCADE_DEV,
  endpoint: process.env.ARCADE_TELEMETRY_ENDPOINT,
  telemetry: process.env.ARCADE_TELEMETRY,
  config: process.env.XDG_CONFIG_HOME,
};
const configRoot = mkdtempSync(join(tmpdir(), 'arcade-telemetry-preference-'));
process.env.ARCADE_DEV = '1';
delete process.env.ARCADE_TELEMETRY_ENDPOINT;
delete process.env.ARCADE_TELEMETRY;
process.env.XDG_CONFIG_HOME = configRoot;

const telemetry = await import('./index.ts');

after(() => {
  rmSync(configRoot, { recursive: true, force: true });
  const restore = (name: string, value: string | undefined): void => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore('ARCADE_DEV', previous.arcadeDev);
  restore('ARCADE_TELEMETRY_ENDPOINT', previous.endpoint);
  restore('ARCADE_TELEMETRY', previous.telemetry);
  restore('XDG_CONFIG_HOME', previous.config);
});

test('the saved telemetry preference remains toggleable while development delivery is suppressed', () => {
  telemetry.initTelemetry();
  assert.equal(telemetry.isTelemetryEnabled(), false);
  assert.equal(telemetry.isTelemetryPreferenceEnabled(), true);
  const path = join(configRoot, 'arcade', 'telemetry.json');
  const external = JSON.parse(readFileSync(path, 'utf8')) as { enabled?: boolean };
  writeFileSync(path, JSON.stringify({ ...external, enabled: false }));
  assert.equal(telemetry.isTelemetryPreferenceEnabled(), true, 'render reads the initialized in-memory preference, not the filesystem');
  telemetry.setTelemetryEnabled(true);

  telemetry.toggleTelemetryPreference();
  assert.equal(telemetry.isTelemetryEnabled(), false, 'development never sends to the production collector');
  assert.equal(telemetry.isTelemetryPreferenceEnabled(), false, 'the first click still saves off');

  telemetry.toggleTelemetryPreference();
  assert.equal(telemetry.isTelemetryEnabled(), false);
  assert.equal(telemetry.isTelemetryPreferenceEnabled(), true, 'a second click saves on again');
});
