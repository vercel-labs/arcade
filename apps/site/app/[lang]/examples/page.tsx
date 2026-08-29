import type { Metadata } from 'next';
import Link from 'next/link';
import { CatanTileExample, ChessBoardExample, PrismExample, RenderExample, TuiExample } from './components/live-examples';

export const metadata: Metadata = {
  title: 'Interactive examples',
  description: 'Focused CPU-renderer, retained-TUI, and ANSI-stream examples built from Arcade package exports.',
};

export default function ExamplesPage() {
  return <main className="examples-page mt-(--fd-nav-height)">
    <header className="examples-intro">
      <span>Arcade examples</span>
      <h1>Inspect the system while it runs.</h1>
      <p>These examples use the same package exports and ANSI streams as the terminal app. Arcade owns geometry, rasterization, retained layout, cells, and state.</p>
      <nav><a href="#renderer">Renderer</a><a href="#tui">TUI</a><a href="#prism">Prism stream</a><Link href="/#play">Live CLI</Link><Link href="/docs/examples">Read the guide</Link></nav>
    </header>
    <section id="game-scenes" className="example-grid"><ChessBoardExample /><CatanTileExample /></section>
    <section id="renderer"><RenderExample /></section>
    <section id="tui"><TuiExample /></section>
    <section id="prism"><PrismExample /></section>
    <section className="examples-next">
      <span>Complete application</span>
      <h2>Run Arcade on the home page.</h2>
      <p>The live shell runs the actual packaged CLI in an isolated PTY. Type <code>arcade</code> for the launcher, or use the miniature filesystem to read docs and examples.</p>
      <Link href="/#play">Open the live terminal →</Link>
    </section>
  </main>;
}
