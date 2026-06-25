import { spawn } from 'node:child_process';

// Copy text to the system clipboard via the platform's clipboard command
// (pbcopy / clip / xclip). The child reads our piped stdin — it never touches the
// terminal — so it's safe to call from the raw-mode TTY app. Failures (tool not
// installed, etc.) are swallowed; clipboard access is best-effort.
export function copyToClipboard(text: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['pbcopy', []]
      : process.platform === 'win32'
        ? ['clip', []]
        : ['xclip', ['-selection', 'clipboard']];
  try {
    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => {}); // command missing — ignore
    child.stdin.on('error', () => {});
    child.stdin.end(text);
  } catch {
    // ignore — best effort
  }
}
