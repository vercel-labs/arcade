// Build the Vercel Build Output API tree (.vercel/output) for the arcade-telemetry proxy:
// three ingest functions. Mirrors the prism's prebuilt approach — esbuild bundles each
// .ts entry (including the shared ../../../src/telemetry/records.ts privacy guard, which
// the default @vercel/node build can't resolve across the .ts specifier + root-dir
// boundary) into one self-contained .mjs, so Vercel ships finished output.
//
// Manual deploy:
//   node apps/telemetry-proxy/build.mjs   (or `pnpm build` in this dir)
//   vercel deploy --prebuilt --prod --scope <team>   (from apps/telemetry-proxy)
//
// Deploy note: the Vercel project's Root Directory is apps/telemetry-proxy, so enable
// "Include source files outside of the Root Directory in the Build Step" — the bundle
// reaches ../../../src. Install is skipped (zero npm deps); esbuild is fetched via pnpm dlx.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ESBUILD = 'esbuild@0.23.1';
const root = dirname(fileURLToPath(import.meta.url)); // apps/telemetry-proxy
const outDir = join(root, '.vercel/output');

const ROUTES = [
  { path: 'v1/events', entry: 'api/v1/events.ts' },
  { path: 'v1/matches', entry: 'api/v1/matches.ts' },
  { path: 'v1/poker-hands', entry: 'api/v1/poker-hands.ts' },
];

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'config.json'),
  JSON.stringify({ version: 3, routes: ROUTES.map((r) => ({ src: `/${r.path}`, dest: `/${r.path}` })) }, null, 2) + '\n',
);

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
for (const r of ROUTES) {
  const funcDir = join(outDir, `functions/${r.path}.func`);
  mkdirSync(funcDir, { recursive: true });
  writeFileSync(
    join(funcDir, '.vc-config.json'),
    JSON.stringify(
      {
        runtime: 'nodejs22.x',
        handler: 'index.mjs',
        launcherType: 'Nodejs',
        shouldAddHelpers: false,
        supportsResponseStreaming: false,
        maxDuration: 10, // validate + one downstream POST; never the prism's 300
      },
      null,
      2,
    ) + '\n',
  );
  const args = ['dlx', ESBUILD, r.entry, '--bundle', '--platform=node', '--format=esm', '--target=node22', `--outfile=${join(funcDir, 'index.mjs')}`];
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    try {
      execFileSync('pnpm', args, { stdio: 'inherit', cwd: root });
      ok = true;
    } catch (err) {
      if (attempt === 3) throw err;
      console.error(`\nesbuild ${r.entry} attempt ${attempt}/3 failed — retrying in ${attempt}s…`);
      sleepSync(attempt * 1000);
    }
  }
}

console.log('\n✓ wrote .vercel/output for arcade-telemetry (3 functions)');
