export interface DocsNavItem { href: string; label: string; group?: string; drillIn?: boolean }

const group = (name: string): DocsNavItem => ({ href: '', label: '', group: name });

export const ROOT_DOCS_NAV: DocsNavItem[] = [
  { href: '/docs', label: 'Overview' },
  { href: '/docs/getting-started', label: 'Getting started' },
  { href: '/docs/app', label: 'Using Arcade', drillIn: true },
  { href: '/docs/games', label: 'Games', drillIn: true },
  { href: '/docs/engine', label: 'Engine' },
  { href: '/docs/renderer-pipeline', label: 'Rendering pipeline' },
  { href: '/docs/game-visuals', label: 'Game visuals' },
  { href: '/docs/platform', label: 'Terminal platform' },
  { href: '/docs/tui', label: 'Terminal UI' },
  { href: '/docs/components', label: 'Components' },
  { href: '/docs/game-harness', label: 'Game harness' },
  { href: '/docs/tools', label: 'Agentic tooling' },
  { href: '/docs/web', label: 'Browser integration', drillIn: true },
  { href: '/docs/guides', label: 'Guides', drillIn: true },
  { href: '/docs/package-api', label: 'Package API' },
  { href: '/docs/reference', label: 'API Reference', drillIn: true },
  { href: '/docs/motivation', label: 'Motivation' },
];

const SECTION_DOCS_NAV: Record<string, { title: string; items: DocsNavItem[] }> = {
  app: {
    title: 'Using Arcade',
    items: [
      { href: '/docs/app', label: 'Overview' },
      { href: '/docs/app/controls', label: 'Controls and tutorial' },
      { href: '/docs/app/models', label: 'Models and billing' },
    ],
  },
  games: {
    title: 'Games',
    items: [
      { href: '/docs/games', label: 'Overview' },
      group('Playable games'),
      { href: '/docs/games/chess', label: 'Chess' },
      { href: '/docs/games/poker', label: 'Poker' },
      { href: '/docs/games/islanders', label: 'Islanders' },
      group('Shared systems'),
      { href: '/docs/rules', label: 'Rules' },
      { href: '/docs/games/communication', label: 'Communication' },
    ],
  },
  web: {
    title: 'Browser integration',
    items: [
      { href: '/docs/web', label: 'Overview' },
      { href: '/docs/browser-host', label: 'Hosted CLI' },
    ],
  },
  guides: {
    title: 'Guides',
    items: [
      { href: '/docs/guides', label: 'Overview' },
      group('Graphics'),
      { href: '/docs/guides/render-scene', label: 'Render a scene' },
      group('Applications'),
      { href: '/docs/guides/terminal-app', label: 'Build a terminal app' },
      group('Agents and games'),
      { href: '/docs/guides/custom-game', label: 'Custom game' },
      group('Testing'),
      { href: '/docs/guides/visual-testing', label: 'Visual verification' },
    ],
  },
  reference: {
    title: 'API Reference',
    items: [
      { href: '/docs/reference', label: 'Overview' },
      group('Engine'),
      { href: '/docs/reference/engine/render-target', label: 'RenderTarget' },
      { href: '/docs/reference/engine/material', label: 'Material and rasterize' },
      { href: '/docs/reference/engine/surface', label: 'Surface and presenters' },
      { href: '/docs/reference/engine/camera-resources', label: 'Camera and resources' },
      group('TUI'),
      { href: '/docs/reference/tui/screen', label: 'Screen' },
      { href: '/docs/reference/tui/layout-nodes', label: 'Nodes and layout' },
      { href: '/docs/reference/tui/renderer-keymap', label: 'Renderer and Keymap' },
      group('Components'),
      { href: '/docs/reference/components/input', label: 'Input' },
      { href: '/docs/reference/components/select-dropdown', label: 'Select and Dropdown' },
      { href: '/docs/reference/components/slider', label: 'Slider' },
      { href: '/docs/reference/components/table-scrollbox', label: 'Table and ScrollBox' },
      { href: '/docs/reference/components/overlays', label: 'Modal, Dialog, and Tooltip' },
      group('Reference'),
      { href: '/docs/reference/symbols', label: 'Symbol index' },
    ],
  },
};

function docsPath(pathname: string): string {
  const start = pathname.indexOf('/docs');
  const path = start >= 0 ? pathname.slice(start) : pathname;
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

export function navigationForPathname(pathname: string): { active: string; items: DocsNavItem[]; sectionTitle: string | null } {
  const active = docsPath(pathname);
  const section = active === '/docs/app' || active.startsWith('/docs/app/')
    ? 'app'
    : active === '/docs/games' || active.startsWith('/docs/games/') || active === '/docs/rules'
      ? 'games'
      : active === '/docs/web' || active === '/docs/browser-host'
        ? 'web'
        : active === '/docs/guides' || active.startsWith('/docs/guides/')
          ? 'guides'
          : active === '/docs/reference' || active.startsWith('/docs/reference/')
            ? 'reference'
            : null;
  if (!section) return { active, items: ROOT_DOCS_NAV, sectionTitle: null };
  const navigation = SECTION_DOCS_NAV[section]!;
  return { active, items: navigation.items, sectionTitle: navigation.title };
}
