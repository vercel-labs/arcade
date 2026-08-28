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

const CURL_COMMAND = 'curl -fsSL vercel-arcade.vercel.app/install | sh';
const NPM_COMMAND = 'npm i -g @vercel/arcade';

export const Hero = () => (
  <section className="mt-(--fd-nav-height) px-4 pt-16 pb-16 text-center @min-[640px]:pt-24">
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <h1 className="text-balance text-center font-mono font-bold text-[40px]! leading-[1.1] tracking-tight @min-[640px]:text-6xl!">
        arcade
      </h1>
      <p className="mx-auto max-w-2xl text-balance text-gray-900 leading-relaxed @min-[640px]:text-xl">
        3D games in your terminal, played by frontier AI models.
      </p>
    </div>

    <div className="mx-auto mt-10 aspect-video w-full max-w-4xl overflow-hidden rounded-xl border bg-black">
      <PrismTerminal className="h-full w-full" />
    </div>

    <div className="mx-auto mt-8 w-full max-w-xl">
      <CommandPromptRoot defaultValue="curl">
        <CommandPromptList>
          <CommandPromptTrigger className="min-w-[70px]" value="curl">
            curl
          </CommandPromptTrigger>
          <CommandPromptTriggerDivider />
          <CommandPromptTrigger className="min-w-[70px]" value="npm">
            npm
          </CommandPromptTrigger>
        </CommandPromptList>
        <CommandPromptSurface>
          <CommandPromptPrefix>$</CommandPromptPrefix>
          <CommandPromptViewport>
            <CommandPromptContent copyValue={CURL_COMMAND} value="curl">
              {CURL_COMMAND}
            </CommandPromptContent>
            <CommandPromptContent copyValue={NPM_COMMAND} value="npm">
              {NPM_COMMAND}
            </CommandPromptContent>
          </CommandPromptViewport>
          <CommandPromptCopy />
        </CommandPromptSurface>
      </CommandPromptRoot>
    </div>
  </section>
);
