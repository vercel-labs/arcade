// Whether this install has ever reached the home screen. The very first launch lands the
// cover flow on the Tutorial cover (with a "new here?" tail under its title) instead of Chess;
// every launch after that lands on Chess as usual. One boolean in ~/.config/arcade/state.json,
// next to the auth and telemetry stores, honoring XDG_CONFIG_HOME. Best-effort: a read-only
// home just means every launch looks like the first.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

interface State {
  firstMenuAt?: string;
}

function statePath(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return join(base, 'arcade', 'state.json');
}

function readState(): State {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8')) as State;
  } catch {
    return {};
  }
}

export function isFirstRun(): boolean {
  return !readState().firstMenuAt;
}

// Record that the home screen has been seen. Called when the menu first appears, not when the
// tutorial is finished: someone who scrolls past on day one shouldn't be steered to it again.
export function markFirstRunSeen(): void {
  try {
    const path = statePath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({ ...readState(), firstMenuAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    chmodSync(path, 0o600);
  } catch {
    // best-effort — a read-only home shouldn't break launch
  }
}
