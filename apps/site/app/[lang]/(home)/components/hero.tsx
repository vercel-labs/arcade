'use client';

import {
  CommandPromptContent,
  CommandPromptCopy,
  CommandPromptPrefix,
  CommandPromptRoot,
  CommandPromptSurface,
  CommandPromptViewport,
} from '@vercel/geistdocs/components/command-prompt';
import dynamic from 'next/dynamic';

// xterm.js touches browser-only globals (`self`) at module load time, so it must
// never enter the server bundle at all — `ssr: false` skips it there entirely,
// rather than just deferring the effect inside an already-server-rendered client
// component.
const ArcadeTerminal = dynamic(() => import('./arcade-terminal').then((m) => m.ArcadeTerminal), {
  ssr: false,
});

const NPM_COMMAND = 'npm i -g @vercel/arcade';

export const Hero = () => (
  <section className="hero-shell mt-(--fd-nav-height)">
    <div className="hero-intro mx-auto w-full max-w-[1080px] px-5">
      <div className="hero-copy">
        <h1>Arcade</h1>
        <p className="hero-lede">
          3D games rendered in your terminal. Play against people or AI models, or use the TypeScript
          renderer and TUI to build your own.
        </p>

        <div className="mt-8 w-full max-w-xl">
          <CommandPromptRoot defaultValue="npm">
            <CommandPromptSurface>
              <CommandPromptPrefix>$</CommandPromptPrefix>
              <CommandPromptViewport>
                <CommandPromptContent copyValue={NPM_COMMAND} value="npm">{NPM_COMMAND}</CommandPromptContent>
              </CommandPromptViewport>
              <CommandPromptCopy />
            </CommandPromptSurface>
          </CommandPromptRoot>
        </div>
      </div>
    </div>

    <div className="hero-terminal-wrap mx-auto w-full max-w-[1080px] px-5">
      <ArcadeTerminal />
      <div className="hero-terminal-meta">
        <span>Live shell</span>
        <span>Actual @vercel/arcade CLI · isolated session</span>
      </div>
    </div>
  </section>
);
