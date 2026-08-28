import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// This app has its own pnpm-workspace.yaml/lockfile so it stays fully decoupled
// from the outer arcade repo's dependency graph — but Next's root-detection walks
// up looking for lockfiles and finds the outer repo's too, then Turbopack resolves
// paths against the wrong (outer) root and panics on a symlink that only makes
// sense from here. Pin it explicitly so it never looks further up than this app.
const root = dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  turbopack: { root },
  async rewrites() {
    return [{ source: '/install.sh', destination: '/install' }];
  },
};

export default config;
