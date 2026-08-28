import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Served at /install (and /install.sh via next.config's rewrite) for
// `curl -fsSL <host>/install | sh`. Reads the same script the repo ships, so
// there's exactly one copy of the installer to keep in sync.
const script = readFileSync(join(process.cwd(), 'install.sh'), 'utf8');

export function GET(): Response {
  return new Response(script, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
