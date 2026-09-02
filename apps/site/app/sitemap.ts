import type { MetadataRoute } from 'next';

const ORIGIN = 'https://vercel-arcade.vercel.app';
const paths = ['', '/docs', '/docs/engine', '/docs/tui', '/docs/game-harness', '/docs/browser-host', '/docs/renderer-pipeline', '/docs/components', '/docs/tools', '/about', '/privacy', '/contact'];

export default function sitemap(): MetadataRoute.Sitemap {
  return paths.map((path, index) => ({
    url: `${ORIGIN}${path}`,
    changeFrequency: index === 0 ? 'weekly' : 'monthly',
    priority: index === 0 ? 1 : path === '/docs' ? 0.9 : 0.75,
  }));
}
