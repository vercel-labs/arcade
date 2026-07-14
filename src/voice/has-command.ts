import { spawnSync } from 'node:child_process';

// Cross-platform "is this binary on PATH?" check. POSIX has `which`; Windows has
// no `which` — its equivalent is the `where` command (a real System32 exe, so it
// runs without a shell). Returns true iff the lookup found the binary (exit 0).
// Used to pick an available audio recorder / player (sox, ffmpeg, afplay, …).
export function hasCommand(bin: string): boolean {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(lookup, [bin]).status === 0;
}
