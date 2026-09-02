// Low-level terminal state management. Entering "game mode" switches to the
// alternate screen, hides the cursor, puts stdin in raw mode, and enables
// motion mouse reporting. Every one of these MUST be undone on exit — leaving
// mouse mode 1003 on, for example, floods the user's shell with garbage bytes.

const ALT_SCREEN_ON = '\x1b[?1049h';
const ALT_SCREEN_OFF = '\x1b[?1049l';
const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
// 1003 = report any mouse motion; 1006 = SGR extended coordinates (no 223 cap).
const MOUSE_ON = '\x1b[?1003h\x1b[?1006h';
const MOUSE_OFF = '\x1b[?1006l\x1b[?1003l';
// OSC 11 sets the terminal's default background color; OSC 111 resets it to the
// user's configured color. We force black so unpainted regions (margins, the
// reserved bottom row, empty cells in ASCII mode) match the scene instead of
// showing the user's theme background. Set inside the alt screen and reset on
// leave, so it can never leak into the user's shell.
const BG_BLACK = '\x1b]11;#000000\x07';
const BG_RESET = '\x1b]111\x07';
// Hosted xterm uses this private OSC event to suppress its mobile keyboard only
// while Arcade owns raw input. Normal local terminals never receive it.
const HOSTED_MODE_OSC = 777;
const hostedMode = (active: boolean): string => process.env.ARCADE_HOSTED_TERMINAL === '1'
  ? `\x1b]${HOSTED_MODE_OSC};arcade=${active ? '1' : '0'}\x07`
  : '';

let active = false;
let cleanupRegistered = false;

export function enter(): void {
  if (active) return;
  active = true;
  process.stdout.write(hostedMode(true) + ALT_SCREEN_ON + CURSOR_HIDE + MOUSE_ON + BG_BLACK);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  registerCleanup();
}

export function leave(): void {
  if (!active) return;
  active = false;
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdout.write(BG_RESET + MOUSE_OFF + CURSOR_SHOW + ALT_SCREEN_OFF + hostedMode(false));
}

function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  process.on('exit', leave);
  process.on('SIGINT', () => {
    leave();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    leave();
    process.exit(0);
  });
  process.on('uncaughtException', (err) => {
    leave();
    console.error(err);
    process.exit(1);
  });
}
