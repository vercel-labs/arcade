'use client';

import {
  CommandPromptContent,
  CommandPromptCopy,
  CommandPromptList,
  CommandPromptPrefix,
  CommandPromptRoot,
  CommandPromptSurface,
  CommandPromptTrigger,
  CommandPromptTriggerDivider,
  CommandPromptViewport,
} from '@vercel/geistdocs/components/command-prompt';
import { QuickTerminalButton } from '@/components/quick-terminal';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const PrismTerminal = dynamic(
  () => import('./prism-terminal').then((module) => module.PrismTerminal),
  { ssr: false },
);

const NPM_COMMAND = 'npm i -g @vercel/arcade';
const CURL_COMMAND = 'curl -fsSL https://vercel-arcade.vercel.app/install | sh';

export const Hero = () => (
  <section className="hero-shell mt-(--fd-nav-height)">
    <div aria-hidden="true" className="hero-prism-field">
      <PrismTerminal className="hero-prism-terminal" />
    </div>
    <div className="hero-stage mx-auto w-full max-w-[1200px] px-5">
      <div className="hero-copy">
        <h1>arcade</h1>
        <p className="hero-lede">
          3D games rendered in the terminal. Play people or AI models, then use the same TypeScript
          renderer and TUI to build your own.
        </p>

        <div className="hero-command">
          <CommandPromptRoot defaultValue="npm">
            <CommandPromptList>
              <CommandPromptTrigger className="min-w-[64px]" value="npm">
                npm
              </CommandPromptTrigger>
              <CommandPromptTriggerDivider />
              <CommandPromptTrigger className="min-w-[64px]" value="curl">
                curl
              </CommandPromptTrigger>
            </CommandPromptList>
            <CommandPromptSurface>
              <CommandPromptPrefix>$</CommandPromptPrefix>
              <CommandPromptViewport>
                <CommandPromptContent copyValue={NPM_COMMAND} value="npm">
                  {NPM_COMMAND}
                </CommandPromptContent>
                <CommandPromptContent copyValue={CURL_COMMAND} value="curl">
                  {CURL_COMMAND}
                </CommandPromptContent>
              </CommandPromptViewport>
              <CommandPromptCopy />
            </CommandPromptSurface>
          </CommandPromptRoot>
        </div>

        <div className="hero-actions">
          <QuickTerminalButton className="hero-launch-button">
            <span aria-hidden="true">›_</span>
            Open Arcade
          </QuickTerminalButton>
          <Link className="hero-docs-link" href="/docs">
            Read the docs <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>

    </div>
  </section>
);
