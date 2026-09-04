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
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const WHITE = '\x1b[38;2;237;237;237m';
const MUTED = '\x1b[38;2;161;161;161m';
const SHADOW = '\x1b[38;2;63;63;63m';

// Press Start 2P's stepped 7px silhouette, reduced to the six glyphs this fixed
// wordmark needs. The OFL face is based on 1980s Namco arcade lettering. Keeping
// the bitmap here (rather than loading a font at install time) makes postinstall
// deterministic and dependency-free. A one-pixel down-right graphite copy gives
// it cabinet-title depth without overpowering the instructions below it.
const WORDMARK: Record<string, readonly string[]> = {
  A: ['0011100', '0110110', '1100011', '1100011', '1111111', '1100011', '1100011'],
  R: ['1111110', '1100011', '1100011', '1111110', '1101100', '1100110', '1100011'],
  C: ['0011110', '0110011', '1100011', '1100000', '1100000', '0110011', '0011110'],
  D: ['1111100', '1100110', '1100011', '1100011', '1100011', '1100110', '1111100'],
  E: ['1111111', '1100000', '1100000', '1111110', '1100000', '1100000', '1111111'],
};
const PLAIN_HALF = [' ', '▄', '▀', '█'];

export interface BannerOpts {
  color?: boolean;
  env?: NodeJS.ProcessEnv;
  platform?: string;
}

function wordmark(color: boolean): string[] {
  const glyphs = [...'ARCADE'].map((letter) => WORDMARK[letter]);
  const letterGap = 2;
  const face = glyphs.map((glyph) => glyph[0].length).reduce(
    (sum, width) => sum + width,
    letterGap * (glyphs.length - 1),
  );
  const pixels = Array.from({ length: 8 }, () => Array<number>(face + 1).fill(0));
  let left = 0;
  for (const glyph of glyphs) {
    for (let y = 0; y < 7; y++) for (let x = 0; x < glyph[y].length; x++) {
      if (glyph[y][x] !== '1') continue;
      pixels[y + 1][left + x + 1] = 1; // shadow
      pixels[y][left + x] = 2; // face wins where the layers overlap
    }
    left += glyph[0].length + letterGap;
  }

  const coloredHalf = (top: number, bottom: number): string => {
    const char = top === 1 && bottom === 1
      ? '█'
      : top > 0 && bottom > 0 && top !== bottom
        ? '▀'
        : PLAIN_HALF[((top > 0 ? 1 : 0) << 1) | (bottom > 0 ? 1 : 0)];
    if (top === 0 || bottom === 0 || top === bottom) {
      const ink = top || bottom;
      if (!ink) return ' ';
      return `${ink === 2 ? WHITE : SHADOW}${char}${RESET}`;
    }
    const fg = top === 2 ? '237;237;237' : '63;63;63';
    const bg = bottom === 2 ? '237;237;237' : '63;63;63';
    return `\x1b[38;2;${fg};48;2;${bg}m${char}${RESET}`;
  };

  return Array.from({ length: 4 }, (_, row) => pixels[2 * row].map((top, x) => {
    const bottom = pixels[2 * row + 1][x];
    if (color) return coloredHalf(top, bottom);
    if (top === 1 && bottom === 1) return '░';
    if (top > 0 && bottom > 0 && top !== bottom) return '▀';
    return PLAIN_HALF[((top > 0 ? 1 : 0) << 1) | (bottom > 0 ? 1 : 0)];
  }).join('').trimEnd());
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
  const cmd = (text: string): string => paint(`${BOLD}${WHITE}`, text);
  const note = (text: string): string => paint(MUTED, text);

  const lines = ['', ...wordmark(color), ''];
  lines.push(note('  The 3D game engine built for agents.'), '');
  lines.push(`  ${cmd('arcade')}${note('           launch Arcade')}`);
  lines.push(`  ${cmd('arcade --help')}${note('    view commands and options')}`);
  lines.push('');
  lines.push(note('  first launch signs you in with Vercel. the tutorial is available from the menu.'));
  lines.push(note('  AI usage is billed to the team you select.'));
  lines.push(note('  docs: https://ascii-arcade.vercel.app/docs'));

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
