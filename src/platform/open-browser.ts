import { spawn } from 'node:child_process';

// Open a URL in the user's default browser via the platform opener (open /
// xdg-open / start). Best-effort and non-blocking: the child is detached and
// unref'd so it never holds the arcade open, and every failure (no GUI, headless
// box, opener missing) is swallowed. Callers MUST also print the URL so login
// still works when this no-ops.
export function openBrowser(url: string): void {
  if (process.env.ARCADE_HOSTED_TERMINAL === '1') {
    process.stdout.write(`\x1b]778;open=${encodeURIComponent(url)}\x07`);
    return;
  }
  const [cmd, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? // `start` is a cmd builtin; the empty "" is its (ignored) window title,
          // so a URL with `&` isn't mistaken for one.
          ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {}); // opener missing — caller printed the URL
    child.unref();
  } catch {
    // ignore — URL was printed for manual open
  }
}
