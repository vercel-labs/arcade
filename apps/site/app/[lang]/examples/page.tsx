import type { Metadata } from 'next';
import Link from 'next/link';
import { PrismExample, SceneExample, type SceneExampleDefinition } from './components/live-examples';

export const metadata: Metadata = {
  title: 'Examples',
  description: 'Focused browser examples built from the same Arcade renderer, assets, and terminal cells as the CLI.',
};

const CHESS: SceneExampleDefinition[] = [
  {
    id: 'chess-board',
    title: 'Chess board',
    description: 'The browser-safe Chess rules and renderer with the production board and imported piece set.',
    scene: 'chess-board',
    source: 'src/web/browser-chess.ts',
    imports: '@vercel/arcade/web',
  },
  {
    id: 'chess-knight',
    title: 'Knight',
    description: 'A production Wavefront asset loaded, normalized, shaded, and presented by Arcade without another 3D library.',
    scene: 'chess-knight',
    source: 'assets/chess_blender/knight.obj',
    imports: '@vercel/arcade/game-visuals/chess',
  },
];

const ISLANDERS: SceneExampleDefinition[] = [
  ['fields', 'Fields'], ['forest', 'Forest'], ['pasture', 'Pasture'],
  ['hills', 'Hills'], ['mountains', 'Mountains'], ['desert', 'Desert'],
].map(([id, title]) => ({
  id: `islanders-${id}`,
  title,
  description: `The production ${title.toLowerCase()} tile, including its procedural terrain and animated overlay where applicable.`,
  scene: `islanders-${id}` as SceneExampleDefinition['scene'],
  source: `src/game-visuals/islanders/tiles/${id}`,
  imports: '@vercel/arcade/game-visuals/islanders',
}));

const POKER: SceneExampleDefinition[] = [{
  id: 'poker-chips',
  title: 'Chip stack',
  description: 'The production 1,000-chip starting stack with real denominations, pile layout, geometry, and table lighting.',
  scene: 'poker-chips',
  source: 'src/game-visuals/poker/chips.ts',
  imports: '@vercel/arcade/game-visuals/poker',
}];

function Group({ id, title, description, examples }: {
  id: string;
  title: string;
  description: string;
  examples: SceneExampleDefinition[];
}) {
  return <section className="example-group" id={id}>
    <header className="example-group__header"><div><span>{id}</span><h2>{title}</h2></div><p>{description}</p></header>
    <div className="example-gallery">{examples.map((example) => <SceneExample definition={example} key={example.id} />)}</div>
  </section>;
}

export default function ExamplesPage() {
  return <main className="examples-page mt-(--fd-nav-height)">
    <header className="examples-intro">
      <span>Examples</span>
      <h1>Parts of Arcade, in isolation.</h1>
      <p>Every preview is rendered by Arcade. The site supplies a canvas and input lifecycle; the package owns the geometry, assets, camera, rasterization, animation, and terminal cells.</p>
      <nav><a href="#chess">Chess</a><a href="#islanders">Islanders</a><a href="#poker">Poker</a><a href="#system">System</a><Link href="/docs/examples">Implementation guide</Link></nav>
    </header>
    <Group id="chess" title="Chess" description="Imported assets and the complete board renderer." examples={CHESS} />
    <Group id="islanders" title="Islanders" description="The 6 terrain systems used to assemble the island." examples={ISLANDERS} />
    <Group id="poker" title="Poker" description="Reusable table primitives extracted from the game presentation." examples={POKER} />
    <section className="example-group" id="system">
      <header className="example-group__header"><div><span>system</span><h2>Terminal stream</h2></div><p>The standalone render surface shared with the curl endpoint.</p></header>
      <div className="example-gallery"><PrismExample /></div>
    </section>
    <section className="examples-next"><span>Complete application</span><h2>Run the packaged CLI.</h2><p>The home-page terminal starts the packed Node application in an isolated PTY. It is the full Arcade shell—not a browser reimplementation.</p><Link href="/#play">Open Arcade →</Link></section>
  </main>;
}
