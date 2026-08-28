// The "you installed it, here's how to run it" banner, printed by the package's
// postinstall after a global install (`npm i -g @vercel/arcade`).
//
// Two non-obvious constraints shape this file:
//   1. Package managers run lifecycle scripts with stdout piped, not attached to the
//      terminal, and discard what they capture (npm's `foreground-scripts` is off by
//      default). So the banner goes to /dev/tty — the terminal device itself — and
//      falls back to stdout for the `--foreground-scripts` case.
//   2. A postinstall that throws fails the install, so nothing here may throw.
//
// Only a global install prints. A dev checkout (`pnpm install` at the repo root) and
// `npx @vercel/arcade` stay silent: neither leaves an `arcade` on PATH to describe.

import { closeSync, openSync, writeSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { asciiFontLines } from '../tui/index.ts';

// The prism's dispersion, sampled across the wordmark's columns: violet through red,
// so the letters read as one beam split by glass.
const SPECTRUM: ReadonlyArray<readonly [number, number, number]> = [
  [168, 130, 240],
  [110, 150, 245],
  [90, 205, 225],
  [130, 215, 150],
  [240, 200, 110],
  [235, 130, 130],
];

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

export interface BannerOpts {
  color?: boolean;
  env?: NodeJS.ProcessEnv;
  platform?: string;
}

function truecolor([r, g, b]: readonly [number, number, number]): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

function spectrumAt(t: number): readonly [number, number, number] {
  const p = Math.max(0, Math.min(t, 1)) * (SPECTRUM.length - 1);
  const i = Math.min(Math.floor(p), SPECTRUM.length - 2);
  const f = p - i;
  const a = SPECTRUM[i];
  const b = SPECTRUM[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

// Block letters from the same 8x8 font as the arcade's in-app banners, tinted by
// column so every row shares one hue ramp.
function wordmark(color: boolean): string[] {
  const lines = asciiFontLines('ARCADE');
  const width = Math.max(...lines.map((l) => l.length));
  if (!color) return lines;
  return lines.map((line) => {
    let out = '';
    let hue = '';
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      if (ch === ' ') {
        out += ch;
        continue;
      }
      const next = truecolor(spectrumAt(x / (width - 1)));
      if (next !== hue) {
        out += next;
        hue = next;
      }
      out += ch;
    }
    return out + RESET;
  });
}

// The global bin directory, when the installer said where it is. `npm_config_prefix`
// comes from the npm actually running the install (bins land in `<prefix>/bin`, or in
// `<prefix>` itself on Windows), so it wins over PNPM_HOME — which is exported by the
// user's shell whether or not pnpm is the installer here.
function globalBinDir(env: NodeJS.ProcessEnv, platform: string): string | null {
  const prefix = env.npm_config_prefix?.trim();
  if (prefix) return platform === 'win32' ? prefix : posix.join(prefix, 'bin');
  return env.PNPM_HOME?.trim() || null;
}

function onPath(dir: string | null, env: NodeJS.ProcessEnv, platform: string): boolean {
  if (!dir) return true; // unknown prefix — don't cry wolf
  // Parse PATH with the target platform's rules, not the host's, so the check is the
  // same on a Windows install as it is under test elsewhere.
  const api = platform === 'win32' ? win32 : posix;
  const entries = (env.PATH ?? env.Path ?? '').split(api.delimiter).filter(Boolean);
  const norm = (s: string): string => {
    const abs = api.resolve(s);
    return platform === 'win32' ? abs.toLowerCase() : abs;
  };
  return entries.some((entry) => norm(entry) === norm(dir));
}

export function bannerLines(opts: BannerOpts = {}): string[] {
  const { color = true, env = process.env, platform = process.platform } = opts;
  const paint = (code: string, text: string): string => (color ? `${code}${text}${RESET}` : text);
  const cmd = (text: string): string => paint(BOLD, text);
  const note = (text: string): string => paint(DIM, text);

  const lines = ['', ...wordmark(color), ''];
  lines.push(note('  3D games in your terminal, played by frontier AI models.'), '');
  lines.push(`  ${cmd('arcade')}${note('           # Run it, from any directory')}`);
  lines.push(`  ${cmd('arcade --help')}${note('    # Flags and subcommands')}`);
  lines.push('');
  lines.push(note('  First launch signs you in to Vercel and asks which team to bill AI usage to.'));
  lines.push(note('  Docs: https://github.com/vercel-labs/arcade'));

  const bin = globalBinDir(env, platform);
  if (!onPath(bin, env, platform)) {
    lines.push('', note(`  ${bin} is not in your PATH — add it there to run \`arcade\` by name.`));
  }
  lines.push('');
  return lines;
}

// Print for a global install only, and only at a log level that asked for output.
export function shouldPrint(env: NodeJS.ProcessEnv = process.env): boolean {
  const truthy = (v?: string): boolean => Boolean(v) && v !== '0' && v !== 'false';
  if (!truthy(env.npm_config_global)) return false;
  if (truthy(env.CI) || truthy(env.ARCADE_NO_BANNER)) return false;
  if (truthy(env.npm_config_silent)) return false;
  const level = env.npm_config_loglevel;
  return level !== 'silent' && level !== 'error' && level !== 'warn';
}

// /dev/tty first (the captured stdout is discarded), stdout second. No controlling
// terminal — a container, cron, a piped install — throws ENXIO/ENOENT here, which is
// exactly the case with no one to read it.
function emit(text: string): void {
  try {
    const fd = openSync(process.platform === 'win32' ? 'CONOUT$' : '/dev/tty', 'w');
    try {
      writeSync(fd, text);
    } finally {
      closeSync(fd);
    }
    return;
  } catch {
    // no terminal device; try the pipe
  }
  try {
    process.stdout.write(text);
  } catch {
    // a banner is never worth failing an install over
  }
}

export function printInstallBanner(): void {
  if (!shouldPrint()) return;
  const color = Boolean(process.env.FORCE_COLOR) || !process.env.NO_COLOR;
  emit(`${bannerLines({ color }).join('\n')}\n`);
}
