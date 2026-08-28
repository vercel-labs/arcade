import type { Metadata } from 'next';
import Link from 'next/link';
import { RenderExample, TuiExample } from './components/live-examples';

export const metadata: Metadata = {
  title: 'Interactive examples',
  description: 'Live CPU-renderer and retained-TUI examples that import Arcade source instead of recreating it in the site.',
};

export default function ExamplesPage() {
  return <main className="examples-page mt-(--fd-nav-height)">
    <header className="examples-intro">
      <span>Arcade examples</span>
      <h1>Inspect the system while it runs.</h1>
      <p>These canvases use the same package exports as the terminal app. The web page owns presentation and DOM input; Arcade still owns geometry, rasterization, retained layout, cells, and state.</p>
      <nav><a href="#renderer">Renderer</a><a href="#tui">TUI</a><Link href="/#play">Playable Chess</Link><Link href="/docs/examples">Read the guide</Link></nav>
    </header>
    <section id="renderer"><RenderExample /></section>
    <section id="tui"><TuiExample /></section>
    <section className="examples-next">
      <span>Complete vertical slice</span>
      <h2>Play Chess on the home page.</h2>
      <p>The launcher and board use the authoritative ChessState, legal move parsing, CPU 3D scene, camera picking, display modes, and CanvasSurfaceHost.</p>
      <Link href="/#play">Open playable Arcade →</Link>
    </section>
  </main>;
}
