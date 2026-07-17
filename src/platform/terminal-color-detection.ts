// Conservative terminal truecolor detection. Strong environment signals avoid
// a round trip for terminals that explicitly advertise 24-bit color. Unknown
// terminals get an invisible SGR status query; anything inconclusive falls back
// to the safe xterm 256-color palette.

export type DetectedTerminalColorMode = 'truecolor' | '256-color';

const PROBE_RED = 1;
const PROBE_GREEN = 2;
const PROBE_BLUE = 3;
const DEFAULT_PROBE_TIMEOUT_MS = 90;

// Set an unusual background color, ask the terminal to report its current SGR
// state, then reset immediately. Setting SGR state paints no cells by itself, so
// this sequence is invisible even before Arcade enters the alternate screen.
const TRUECOLOR_PROBE =
  `\x1b[48;2;${PROBE_RED};${PROBE_GREEN};${PROBE_BLUE}m` +
  '\x1bP$qm\x1b\\' +
  '\x1b[0m';

export function environmentAdvertisesTruecolor(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const colorTerm = env.COLORTERM?.trim().toLowerCase();
  if (colorTerm === 'truecolor' || colorTerm === '24bit') return true;

  const term = env.TERM?.trim().toLowerCase() ?? '';
  if (
    term === 'xterm-kitty' ||
    term === 'xterm-ghostty' ||
    term === 'wezterm' ||
    term.endsWith('-truecolor') ||
    term.endsWith('-direct')
  ) {
    return true;
  }

  const termProgram = env.TERM_PROGRAM?.trim().toLowerCase();
  if (
    termProgram === 'iterm.app' ||
    termProgram === 'wezterm' ||
    termProgram === 'ghostty' ||
    termProgram === 'vscode' ||
    termProgram === 'hyper' ||
    termProgram === 'warpterminal'
  ) {
    return true;
  }

  // Windows Terminal sets this to a per-session GUID.
  return Boolean(env.WT_SESSION);
}

// Multiplexers sit between Arcade and the real terminal. Their inherited
// COLORTERM/TERM_PROGRAM values can describe the outer terminal even when the
// multiplexer is not configured to forward truecolor, so require an active
// confirmation instead of trusting those values directly.
function isMultiplexed(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.TMUX || env.STY);
}

/**
 * Parse a DECRQSS SGR response.
 *
 * Returns null until a complete response is present, true when the terminal
 * reports the exact RGB value we set, and false when it responds but reports a
 * downgraded/unsupported color. Terminals may normalize semicolon SGR syntax to
 * either colon form, including the optional empty color-space field.
 */
export function parseTruecolorProbeResponse(response: string): boolean | null {
  const match = /(?:\x1bP|\x90)([01])\$r([\s\S]*?)(?:\x1b\\|\x9c)/.exec(response);
  if (!match) return null;
  if (match[1] !== '1') return false;

  const sgr = match[2];
  const exactColor = new RegExp(
    `48[;:]2[;:]{1,2}${PROBE_RED}[;:]${PROBE_GREEN}[;:]${PROBE_BLUE}(?:[;:]|m|$)`,
  );
  return exactColor.test(sgr);
}

export async function probeTerminalTruecolor(
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') return false;

  const wasRaw = input.isRaw;
  const wasPaused = input.isPaused();

  return new Promise<boolean>((resolve) => {
    let response = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (supported: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      input.off('data', onData);
      if (!wasRaw) input.setRawMode(false);
      if (wasPaused) input.pause();
      resolve(supported);
    };

    const onData = (chunk: Buffer | string): void => {
      response += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      // Bound unexpected input while still retaining far more than a normal
      // terminal response. A timeout remains the safe result if no reply parses.
      if (response.length > 4096) response = response.slice(-4096);
      const result = parseTruecolorProbeResponse(response);
      if (result !== null) finish(result);
    };

    if (!wasRaw) input.setRawMode(true);
    input.on('data', onData);
    input.resume();
    output.write(TRUECOLOR_PROBE);
    timer = setTimeout(() => finish(false), timeoutMs);
  });
}

export interface DetectTerminalColorOptions {
  env?: NodeJS.ProcessEnv;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  probe?: () => Promise<boolean>;
}

export async function detectTerminalColorMode(
  options: DetectTerminalColorOptions = {},
): Promise<DetectedTerminalColorMode> {
  const env = options.env ?? process.env;
  const stdinIsTTY = options.stdinIsTTY ?? Boolean(process.stdin.isTTY);
  const stdoutIsTTY = options.stdoutIsTTY ?? Boolean(process.stdout.isTTY);
  if (!stdinIsTTY || !stdoutIsTTY) return '256-color';

  const advertised = environmentAdvertisesTruecolor(env);
  if (advertised && !isMultiplexed(env)) return 'truecolor';

  const supported = await (options.probe ?? probeTerminalTruecolor)();
  return supported ? 'truecolor' : '256-color';
}
