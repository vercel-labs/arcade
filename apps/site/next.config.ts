import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// The site consumes browser-safe subpaths from the parent @vercel/arcade package.
// Keep Turbopack rooted at the repository so it can follow that deliberate link;
// package exports prevent the browser graph from reaching Node-only app modules.
const siteRoot = dirname(fileURLToPath(import.meta.url));
const root = dirname(dirname(siteRoot));

const config: NextConfig = {
  turbopack: { root },
  transpilePackages: ['@vercel/arcade'],
  async headers() {
    return [{
      source: '/:path*',
      headers: [{
        key: 'Link',
        value: '</llms.txt>; rel="alternate"; type="text/markdown", </openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
      }],
    }];
  },
  async rewrites() {
    return [{ source: '/install.sh', destination: '/install' }];
  },
};

export default config;
