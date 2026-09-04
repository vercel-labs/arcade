import type * as PageTree from 'fumadocs-core/page-tree';

const page = (name: string, url: string): PageTree.Item => ({ type: 'page', name, url });
const separator = (name: string): PageTree.Separator => ({ type: 'separator', name });
const section = (name: string, url: string, children: PageTree.Node[]): PageTree.Folder => ({
  type: 'folder',
  name,
  index: page(name, url),
  children,
});

export const DOCS_PAGE_TREE: PageTree.Root = {
  $id: 'arcade-docs',
  name: 'Arcade documentation',
  children: [
    page('Overview', '/docs'),
    page('Getting started', '/docs/getting-started'),
    section('Using Arcade', '/docs/app', [
      page('Controls and tutorial', '/docs/app/controls'),
      page('Models and billing', '/docs/app/models'),
    ]),
    section('Games', '/docs/games', [
      separator('Playable games'),
      page('Chess', '/docs/games/chess'),
      page('Poker', '/docs/games/poker'),
      page('Islanders', '/docs/games/islanders'),
      separator('Shared systems'),
      page('Rules', '/docs/rules'),
      page('Communication', '/docs/games/communication'),
    ]),
    page('Engine', '/docs/engine'),
    page('Rendering pipeline', '/docs/renderer-pipeline'),
    page('Game visuals', '/docs/game-visuals'),
    page('Terminal platform', '/docs/platform'),
    page('Terminal UI', '/docs/tui'),
    page('Components', '/docs/components'),
    page('Game harness', '/docs/game-harness'),
    page('Agentic tooling', '/docs/tools'),
    section('Browser integration', '/docs/web', [
      page('Hosted CLI', '/docs/browser-host'),
    ]),
    section('Guides', '/docs/guides', [
      separator('Graphics'),
      page('Render a scene', '/docs/guides/render-scene'),
      separator('Applications'),
      page('Build a terminal app', '/docs/guides/terminal-app'),
      separator('Agents and games'),
      page('Custom game', '/docs/guides/custom-game'),
      separator('Testing'),
      page('Visual verification', '/docs/guides/visual-testing'),
    ]),
    page('Package API', '/docs/package-api'),
    section('API Reference', '/docs/reference', [
      separator('Engine'),
      page('RenderTarget', '/docs/reference/engine/render-target'),
      page('Material and rasterize', '/docs/reference/engine/material'),
      page('Surface and presenters', '/docs/reference/engine/surface'),
      page('Camera and resources', '/docs/reference/engine/camera-resources'),
      separator('TUI'),
      page('Screen', '/docs/reference/tui/screen'),
      page('Nodes and layout', '/docs/reference/tui/layout-nodes'),
      page('Renderer and Keymap', '/docs/reference/tui/renderer-keymap'),
      separator('Components'),
      page('Input', '/docs/reference/components/input'),
      page('Select and Dropdown', '/docs/reference/components/select-dropdown'),
      page('Slider', '/docs/reference/components/slider'),
      page('Table and ScrollBox', '/docs/reference/components/table-scrollbox'),
      page('Modal, Dialog, and Tooltip', '/docs/reference/components/overlays'),
      separator('Reference'),
      page('Symbol index', '/docs/reference/symbols'),
    ]),
  ],
};
