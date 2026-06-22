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

let active = false;
let cleanupRegistered = false;

export function enter(): void {
  if (active) return;
  active = true;
  process.stdout.write(ALT_SCREEN_ON + CURSOR_HIDE + MOUSE_ON);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  registerCleanup();
}

export function leave(): void {
  if (!active) return;
  active = false;
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdout.write(MOUSE_OFF + CURSOR_SHOW + ALT_SCREEN_OFF);
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
