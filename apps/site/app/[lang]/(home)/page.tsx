import type { Metadata } from 'next';
import Link from 'next/link';
import { Hero } from './components/hero';

const structuredData = {
  '@context': 'https://schema.org',
  '@type': ['SoftwareApplication', 'SoftwareSourceCode'],
  name: 'Arcade',
  description: 'A pure-TypeScript CPU 3D renderer, retained TUI, and agent-playable game harness.',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Node.js 20+ and modern browsers',
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
      <div className="mx-auto w-full max-w-[1120px] px-5">
        <p className="section-kicker">One stack, multiple hosts</p>
        <h2 className="section-heading">The renderer is the product. The terminal is one adapter.</h2>
        <div className="feature-grid">
          <article className="feature-card"><code>@vercel/arcade/engine</code><h3>CPU 3D renderer</h3><p>Meshes, materials, cameras, picking, animation, supersampling, bloom, and three terminal display modes—without a GPU or native dependency.</p></article>
          <article className="feature-card"><code>@vercel/arcade/tui</code><h3>Retained-mode TUI</h3><p>Flex layout, components, hit testing, focus, compositing, and a canonical cell Surface shared by terminal snapshots and the browser host.</p></article>
          <article className="feature-card"><code>arcade match:run</code><h3>Agent game harness</h3><p>Run models through legal game actions, persistent traces, communication policy, self-play, and model compatibility audits—with telemetry off by default.</p></article>
        </div>
      </div>
    </section>

    <section className="site-section">
      <div className="mx-auto w-full max-w-[1120px] px-5">
        <p className="section-kicker">Learn by taking it apart</p>
        <h2 className="section-heading">Docs for the engine, the interface, and the agents inside it.</h2>
        <div className="docs-grid">
          <Link className="docs-link" href="/docs/engine"><span>01 / Core</span><strong>Render a scene</strong></Link>
          <Link className="docs-link" href="/docs/tui"><span>02 / Interface</span><strong>Compose terminal UI</strong></Link>
          <Link className="docs-link" href="/docs/game-harness"><span>03 / Games</span><strong>Build an agentic loop</strong></Link>
          <Link className="docs-link" href="/docs/examples"><span>04 / Gallery</span><strong>Explore visual primitives</strong></Link>
        </div>
      </div>
    </section>

    <section className="site-section">
      <div className="mx-auto grid w-full max-w-[1120px] gap-8 px-5 md:grid-cols-2">
        <div><p className="section-kicker">Install</p><h2 className="mt-4 text-4xl font-semibold tracking-tight">Play the full terminal Arcade.</h2></div>
        <div className="space-y-4 text-gray-900 leading-7"><p><code>npx @vercel/arcade@latest</code> runs the latest build. The current package remains Vercel-internal while the source, asset, and license audit is completed.</p><p>Requires Node 20+. Best in a truecolor terminal; Arcade detects support and safely falls back to 256 colors.</p><p className="text-sm">Telemetry records anonymous usage and canonical game records only—never prompts, reasoning, chat, voice, or account identity. Disable it with <code>ARCADE_TELEMETRY=0</code>.</p><p className="site-resource-links"><Link href="/about">About</Link><Link href="/privacy">Privacy</Link><Link href="/contact">Contact</Link><a href="/openapi.json">OpenAPI</a><a href="/llms.txt">For agents</a></p></div>
      </div>
    </section>
  </main>
);

export default HomePage;
