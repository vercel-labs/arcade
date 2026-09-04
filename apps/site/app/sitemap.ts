import type { MetadataRoute } from 'next';

const ORIGIN = 'https://ascii-arcade.vercel.app';
const paths = ['', '/docs', '/docs/getting-started', '/docs/engine', '/docs/renderer-pipeline', '/docs/game-visuals', '/docs/platform', '/docs/tui', '/docs/components', '/docs/game-harness', '/docs/tools', '/docs/web', '/docs/browser-host', '/docs/package-api', '/privacy', '/contact'];
const docsPaths = [
  '/docs/app', '/docs/app/controls', '/docs/app/models',
  '/docs/games', '/docs/games/chess', '/docs/games/poker', '/docs/games/islanders', '/docs/rules', '/docs/games/communication',
  '/docs/guides', '/docs/guides/render-scene', '/docs/guides/terminal-app', '/docs/guides/custom-game', '/docs/guides/visual-testing',
  '/docs/reference', '/docs/reference/engine/render-target', '/docs/reference/engine/material', '/docs/reference/engine/surface', '/docs/reference/engine/camera-resources',
  '/docs/reference/tui/screen', '/docs/reference/tui/layout-nodes', '/docs/reference/tui/renderer-keymap',
  '/docs/reference/components/input', '/docs/reference/components/select-dropdown', '/docs/reference/components/slider', '/docs/reference/components/table-scrollbox', '/docs/reference/components/overlays',
  '/docs/reference/symbols',
];

export default function sitemap(): MetadataRoute.Sitemap {
  return [...paths, ...docsPaths].map((path, index) => ({
    url: `${ORIGIN}${path}`,
    changeFrequency: index === 0 ? 'weekly' : 'monthly',
    priority: index === 0 ? 1 : path === '/docs' ? 0.9 : 0.75,
  }));
}
