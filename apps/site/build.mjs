// Build the Vercel Build Output API tree (.vercel/output) for the arcade site: a
// static landing page plus the `curl … | sh` installer. No functions, no bundler —
// the page is one self-contained HTML file and the installer is copied verbatim, so
// the served script is byte-for-byte the one in this directory.
//
// `install` is served extensionless (`/install`), so config.json's `overrides` pins
// its content type — otherwise a curl-piped-to-sh download arrives as a file to save
// rather than a script to read.
//
// Manual deploy:
//   node apps/site/build.mjs   (or `pnpm build` in this dir)
//   vercel deploy --prebuilt --prod --scope <team>   (from apps/site)
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)); // apps/site
const staticDir = join(root, '.vercel/output/static');
mkdirSync(staticDir, { recursive: true });

copyFileSync(join(root, 'index.html'), join(staticDir, 'index.html'));
copyFileSync(join(root, 'install.sh'), join(staticDir, 'install'));

writeFileSync(
  join(root, '.vercel/output/config.json'),
  JSON.stringify(
    {
      version: 3,
      overrides: { install: { contentType: 'text/plain; charset=utf-8' } },
      routes: [{ src: '/install\\.sh', dest: '/install' }],
    },
    null,
    2,
  ) + '\n',
);

console.log('✓ wrote .vercel/output for the arcade site (index.html, install)');
