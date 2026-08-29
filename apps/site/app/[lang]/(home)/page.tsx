import type { Metadata } from 'next';
import Link from 'next/link';
import { Hero } from './components/hero';

const structuredData = {
  '@context': 'https://schema.org',
  '@type': ['SoftwareApplication', 'SoftwareSourceCode'],
  name: 'Arcade',
  description: 'A pure-TypeScript CPU 3D renderer, retained TUI, and agent-playable game harness.',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Node.js 22+ and modern browsers',
  isAccessibleForFree: true,
  codeRepository: 'https://github.com/vercel-labs/arcade',
  programmingLanguage: 'TypeScript',
  runtimePlatform: 'Node.js and Web browsers',
  sameAs: ['https://github.com/vercel-labs/arcade'],
  url: 'https://vercel-arcade.vercel.app',
};

export const metadata: Metadata = {
  title: { absolute: 'Arcade — 3D games in your terminal' },
  description:
    'Arcade renders 3D chess and poker as ASCII in your terminal, played by humans and frontier AI models through the Vercel AI Gateway.',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    title: 'Arcade — 3D games in your terminal',
    description: '3D chess and poker rendered as ASCII in your terminal, played by frontier AI models.',
    images: ['/opengraph-image'],
  },
};

const HomePage = () => (
  <main>
    <script dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} type="application/ld+json" />
    <Hero />

    <section className="site-section">
      <div className="mx-auto w-full max-w-[1080px] px-5">
        <h2 className="section-heading">Built for the terminal.</h2>
        <div className="feature-grid">
          <article className="feature-card"><code>@vercel/arcade/engine</code><h3>CPU renderer</h3><p>Meshes, materials, cameras, picking, animation, and ASCII, pixel, and hybrid output. Pure TypeScript with no native dependencies.</p></article>
          <article className="feature-card"><code>@vercel/arcade/tui</code><h3>Terminal UI</h3><p>Retained layout, input, focus, compositing, and a shared cell surface for the CLI, snapshots, and browser terminals.</p></article>
          <article className="feature-card"><code>arcade match:run</code><h3>Model harness</h3><p>Legal game actions, persistent traces, self-play, model compatibility checks, and communication controls.</p></article>
        </div>
      </div>
    </section>

    <section className="site-section">
      <div className="mx-auto w-full max-w-[1080px] px-5">
        <h2 className="section-heading">Documentation</h2>
        <div className="docs-grid">
          <Link className="docs-link" href="/docs/engine"><strong>Engine</strong><span>Scenes, cameras, materials, and rendering</span></Link>
          <Link className="docs-link" href="/docs/tui"><strong>TUI</strong><span>Layout, components, input, and surfaces</span></Link>
          <Link className="docs-link" href="/docs/game-harness"><strong>Game harness</strong><span>Models, tools, self-play, and traces</span></Link>
          <Link className="docs-link" href="/docs/examples"><strong>Examples</strong><span>Interactive renderer and interface samples</span></Link>
        </div>
      </div>
    </section>

    <section className="site-section">
      <div className="install-grid mx-auto grid w-full max-w-[1080px] gap-8 px-5 md:grid-cols-2">
        <h2 className="section-heading">Install</h2>
        <div className="space-y-4 text-gray-900 leading-7"><p><code>npx @vercel/arcade@latest</code> runs Arcade in a truecolor terminal. The package remains restricted while the source, asset, and license review is completed.</p><p>Requires Node.js 22 or later. Terminal color support is detected automatically.</p><p className="text-sm">Telemetry never includes prompts, reasoning, chat, voice, or account identity. Disable it with <code>ARCADE_TELEMETRY=0</code>.</p><p className="site-resource-links"><Link href="/about">About</Link><Link href="/privacy">Privacy</Link><Link href="/contact">Contact</Link><a href="/openapi.json">OpenAPI</a><a href="/llms.txt">For agents</a></p></div>
      </div>
    </section>
  </main>
);

export default HomePage;
