import type { Metadata } from 'next';
import { Hero } from './components/hero';

export const metadata: Metadata = {
  title: 'Arcade — 3D games in your terminal',
  description:
    'Arcade renders 3D chess and poker as ASCII in your terminal, played by humans and frontier AI models through the Vercel AI Gateway.',
  openGraph: {
    title: 'Arcade — 3D games in your terminal',
    description: '3D chess and poker rendered as ASCII in your terminal, played by frontier AI models.',
  },
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="border-t py-10">
    <h2 className="mb-4 font-mono text-gray-900 text-sm uppercase tracking-[0.12em]">{title}</h2>
    {children}
  </div>
);

const HomePage = () => (
  <div className="mx-auto w-full max-w-3xl px-4 pb-32 sm:px-6">
    <Hero />

    <Section title="Also with npm">
      <div className="space-y-2 text-gray-900">
        <p>
          <code className="rounded bg-background-100 px-1.5 py-0.5">npx @vercel/arcade@latest</code> runs the
          latest build without installing.{' '}
          <code className="rounded bg-background-100 px-1.5 py-0.5">pnpm add -g</code> and{' '}
          <code className="rounded bg-background-100 px-1.5 py-0.5">yarn global add</code> work too.
        </p>
        <p className="rounded-lg border-l-2 border-l-gray-alpha-400 bg-background-100 p-3 text-sm">
          Arcade is a <strong>private, Vercel-internal</strong> npm package today, so installing it needs
          registry access to the <code>@vercel</code> scope (<code>npm login --scope=@vercel</code>). Requires
          Node 20+.
        </p>
      </div>
    </Section>

    <Section title="What you can play">
      <ul className="list-disc space-y-2 pl-5 text-gray-900">
        <li>
          <strong className="text-gray-1000">Chess</strong> — real 3D pieces, lit and rasterized, with a live
          evaluation bar. Play as either colour, or watch model vs model.
        </li>
        <li>
          <strong className="text-gray-1000">Poker</strong> — heads-up Texas Hold&apos;em at a felt table with
          chips. Hover to peek at your hole cards, drag to size a bet.
        </li>
        <li>
          <strong className="text-gray-1000">Table talk</strong> — in heads-up poker, give your opponent a
          realtime voice model and argue with it out loud.
        </li>
        <li>
          <strong className="text-gray-1000">Swap models mid-match</strong> — either side, any model the
          gateway can route.
        </li>
      </ul>
    </Section>

    <Section title="Controls">
      <ul className="list-disc space-y-2 pl-5 text-gray-900">
        <li>
          <strong className="text-gray-1000">Any 3D scene</strong> — left-drag orbits, scroll zooms, arrow keys
          pan. <code>q</code> or <code>Esc</code> quits.
        </li>
        <li>
          <strong className="text-gray-1000">Chess</strong> — click a piece for its legal moves, click a dot to
          move there.
        </li>
        <li>
          <strong className="text-gray-1000">Poker</strong> — click your cards to lift them; drag the slider to
          bet.
        </li>
      </ul>
      <p className="mt-3 text-gray-900 text-sm">
        Best in a truecolor terminal (Ghostty, iTerm2, Kitty, WezTerm, VS Code). It detects support and falls
        back to 256 colors, so Terminal.app works too.
      </p>
    </Section>

    <Section title="Telemetry">
      <p className="text-gray-900">
        Arcade records anonymous usage counts and game records — which models played, what moves were made, who
        won. Never prompts, reasoning, chat, voice, or account identity. Opt out with{' '}
        <code className="rounded bg-background-100 px-1.5 py-0.5">ARCADE_TELEMETRY=0</code>,{' '}
        <code className="rounded bg-background-100 px-1.5 py-0.5">arcade telemetry disable</code>, or the
        home-menu toggle.
      </p>
    </Section>
  </div>
);

export default HomePage;
