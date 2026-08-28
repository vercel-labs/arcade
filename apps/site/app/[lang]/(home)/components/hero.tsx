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
import dynamic from 'next/dynamic';

// xterm.js touches browser-only globals (`self`) at module load time, so it must
// never enter the server bundle at all — `ssr: false` skips it there entirely,
// rather than just deferring the effect inside an already-server-rendered client
// component.
const PrismTerminal = dynamic(() => import('./prism-terminal').then((m) => m.PrismTerminal), {
  ssr: false,
});
const ArcadePlayground = dynamic(() => import('./arcade-playground').then((m) => m.ArcadePlayground), {
  ssr: false,
});

const CURL_COMMAND = 'curl -fsSL vercel-arcade.vercel.app/install | sh';
const NPM_COMMAND = 'npm i -g @vercel/arcade';

export const Hero = () => (
  <section className="hero-shell mt-(--fd-nav-height) px-4 pt-12 pb-20 @min-[640px]:pt-20">
    <div className="hero-grid mx-auto w-full max-w-[1240px]">
      <div className="hero-copy">
        <p className="hero-eyebrow">CPU-rendered · agent-playable · open source</p>
        <h1>Build worlds<br />inside text.</h1>
        <p className="hero-lede">
          Arcade is a TypeScript 3D engine, retained TUI, and game harness that turns terminal cells into a
          programmable canvas. Play it here, install the CLI, or import the primitives.
        </p>

        <div className="mt-8 w-full max-w-xl">
          <CommandPromptRoot defaultValue="curl">
            <CommandPromptList>
              <CommandPromptTrigger className="min-w-[70px]" value="curl">curl</CommandPromptTrigger>
              <CommandPromptTriggerDivider />
              <CommandPromptTrigger className="min-w-[70px]" value="npm">npm</CommandPromptTrigger>
            </CommandPromptList>
            <CommandPromptSurface>
              <CommandPromptPrefix>$</CommandPromptPrefix>
              <CommandPromptViewport>
                <CommandPromptContent copyValue={CURL_COMMAND} value="curl">{CURL_COMMAND}</CommandPromptContent>
                <CommandPromptContent copyValue={NPM_COMMAND} value="npm">{NPM_COMMAND}</CommandPromptContent>
              </CommandPromptViewport>
              <CommandPromptCopy />
            </CommandPromptSurface>
          </CommandPromptRoot>
        </div>
      </div>

      <div className="hero-playground">
        <ArcadePlayground />
        <p className="hero-playground__caption">A real browser host: Arcade rules + CPU renderer + Surface. No PTY, no fake model output.</p>
      </div>
    </div>

    <div className="prism-strip mx-auto mt-20 w-full max-w-[1240px]">
      <div className="prism-strip__copy">
        <span>01 / same engine, another surface</span>
        <strong>The curl-able prism is still live.</strong>
      </div>
      <div className="prism-strip__terminal">
        <PrismTerminal className="h-full w-full" />
      </div>
    </div>
  </section>
);
