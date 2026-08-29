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
import Link from 'next/link';
import { HeroAsciiScene } from './hero-ascii-scene';

const NPM_COMMAND = 'npm i -g @vercel/arcade';
const CURL_COMMAND = 'curl -fsSL https://vercel-arcade.vercel.app/install | sh';

export const Hero = () => (
  <section className="hero-shell mt-(--fd-nav-height)">
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

      <div className="hero-art" aria-label="Live Arcade renderer preview">
        <div className="hero-art-header">
          <span>render / ascii</span>
          <span>cpu / live</span>
        </div>
        <div className="hero-art-viewport">
          <HeroAsciiScene />
        </div>
        <div className="hero-art-footer">
          <span>@vercel/arcade/engine</span>
          <span>ascii · pixel · hybrid</span>
        </div>
      </div>
    </div>
  </section>
);
