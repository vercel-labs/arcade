import type { Metadata } from 'next';
import { InfoPage } from '@/components/info-page';

export const metadata: Metadata = {
  title: 'About',
  description: 'How Arcade turns terminal cells into a reusable CPU-rendered game platform.',
  alternates: { canonical: '/about' },
};

export default function AboutPage() {
  return <InfoPage eyebrow="About the project" title="A game engine built from terminal cells.">
    <p>Arcade is a pure-TypeScript experiment in treating a terminal as a real graphics and interaction surface. Its CPU renderer transforms meshes, shades triangles, samples frames into ASCII, pixel, or hybrid cells, and composes those cells with a retained-mode interface. Chess, Poker, and Islanders use the same underlying layers rather than carrying separate renderers or UI systems.</p>
    <h2>Why it exists</h2>
    <p>The project explores what happens when model-driven games are watchable, inspectable, and playful instead of hidden behind a text transcript. Humans can play directly, models act through validated game commands, and match-lab can run the same rules without the visual host while preserving detailed local traces. The browser playground demonstrates that the renderer is reusable beyond ANSI: it paints the canonical Arcade Surface into Canvas without recreating Chess rules in React.</p>
    <h2>Current status</h2>
    <p>Arcade is approaching a public beta. The repository and intended module boundaries are available for review, while the package, assets, licensing, and packed-consumer experience are still being audited. The public API is deliberately small: engine, TUI, rules, and browser-host subpaths should remain reusable, and application code must not leak back into those libraries. Follow progress or contribute through the <a href="https://github.com/vercel-labs/arcade">Arcade repository on GitHub</a>.</p>
  </InfoPage>;
}
