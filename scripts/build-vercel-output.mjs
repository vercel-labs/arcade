// Build the Vercel Build Output API tree (.vercel/output) for the streaming
// prism endpoint, so it can be shipped with `vercel deploy --prebuilt`.
//
// Why prebuilt: api/index.ts imports project source through .ts-extension
// specifiers (e.g. ../src/engine/index.ts), which Vercel's default @vercel/node
// build can't bundle. So we esbuild it into a single .mjs ourselves and hand
// Vercel the finished output. `.vercel/` is gitignored, so this script
// regenerates the whole tree from source on any machine — no shared .vercel, no
// copy-paste.
//
// Manual deploy:
//   pnpm build:vercel
//   vercel deploy --prebuilt --prod --scope <team>
//
// GitHub auto-deploy (the `ascii-prisms` project): vercel.json points Vercel's
// build at this script (buildCommand) with install skipped (installCommand), so a
// push that touches the prism builds the same output tree. To keep the arcade's
// daily churn from redeploying the prism, set the project's Ignored Build Step
// (Settings → Git) to the prism's exact dependency closure:
//   git diff --quiet HEAD^ HEAD -- api src/engine src/prism
// (Vercel: exit 0 → skip the build, exit 1 → build. So a commit that changes none
// of those paths is skipped; one that touches the closure redeploys.)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pinned: the version that produced the shipped bundle. Run via npx so the build
// needs no `pnpm install` (avoids compiling the native `speaker` dep, which the
// prism endpoint doesn't use).
const ESBUILD = 'esbuild@0.23.1';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.vercel/output');
const funcDir = join(outDir, 'functions/index.func');
mkdirSync(funcDir, { recursive: true });

// Routes: /help renders the help text; everything else streams the animation.
writeFileSync(
  join(outDir, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '/help', dest: '/index?help=1' },
        { src: '/(.*)', dest: '/index' },
      ],
    },
    null,
    2,
  ) + '\n',
);

// Function runtime: Node 22, response streaming on, 300s max (the stream length).
writeFileSync(
  join(funcDir, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      maxDuration: 300,
    },
    null,
    2,
  ) + '\n',
);

// Bundle api/index.ts (pure TS, zero npm deps in its import graph) into one .mjs.
// Run from `root` with relative paths so the output is reproducible.
execFileSync(
  'npx',
  [
    '-y',
    ESBUILD,
    'api/index.ts',
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--target=node22',
    '--outfile=.vercel/output/functions/index.func/index.mjs',
  ],
  { stdio: 'inherit', cwd: root },
);

console.log('\n✓ wrote .vercel/output (config.json, index.func/.vc-config.json, index.func/index.mjs)');
console.log('  next: vercel deploy --prebuilt --prod --scope <team>');
