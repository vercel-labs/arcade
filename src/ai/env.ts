import { readFileSync } from 'node:fs';

// Minimal .env loader (zero-dep): the arcade runs under `tsx`, which does not
// auto-load env files, and the AI SDK reads `AI_GATEWAY_API_KEY` from
// `process.env`. Reads `.env.local` (gitignored) then `.env`, setting only keys
// not already present in the environment, so a real env var always wins. Lines
// are `KEY=value`; `#` comments and blanks are skipped; surrounding quotes are
// stripped. Missing files are silently ignored.
export function loadEnv(files: string[] = ['.env.local', '.env']): void {
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // file absent — fine
    }
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      if (!key || key in process.env) continue;
      let val = line.slice(eq + 1).trim();
      if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val[val.length - 1] === val[0]) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}
