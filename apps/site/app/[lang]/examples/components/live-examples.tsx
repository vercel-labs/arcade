'use client';

import type { BrowserMiniSceneId } from '@vercel/arcade/web';
import dynamic from 'next/dynamic';
import { ArcadeSceneEmbed } from '../../../../components/arcade-scene-embed';

const PrismTerminal = dynamic(
  () => import('../../(home)/components/prism-terminal').then((module) => module.PrismTerminal),
  { ssr: false },
);

export interface SceneExampleDefinition {
  id: string;
  title: string;
  description: string;
  scene: BrowserMiniSceneId;
  source: string;
  imports: string;
  cols?: number;
  rows?: number;
}

export function SceneExample({ definition }: { definition: SceneExampleDefinition }) {
  return <ExampleShell
    description={definition.description}
    imports={definition.imports}
    source={definition.source}
    title={definition.title}
  >
    <ArcadeSceneEmbed
      ariaLabel={`Interactive ${definition.title} example`}
      cols={definition.cols ?? 58}
      rows={definition.rows ?? 34}
      scene={definition.scene}
    />
  </ExampleShell>;
}

export function PrismExample() {
  return <ExampleShell
    description="The same read-only ANSI stream served by the standalone prism deployment, displayed with terminal cell semantics in xterm.js."
    imports="@xterm/xterm · /api/v1/prism-stream"
    source="src/prism/prism-stream.ts"
    title="Prism stream"
  ><PrismTerminal className="live-example__terminal" /></ExampleShell>;
}

function ExampleShell({ children, description, imports, source, title }: {
  children: React.ReactNode;
  description: string;
  imports: string;
  source: string;
  title: string;
}) {
  return <article className="live-example">
    <div className="live-example__stage">{children}</div>
    <div className="live-example__body">
      <header><h2>{title}</h2><code>{imports}</code></header>
      <p>{description}</p>
      <footer><code>{source}</code><a href="https://github.com/vercel-labs/arcade" rel="noreferrer" target="_blank">Source ↗</a></footer>
    </div>
  </article>;
}
