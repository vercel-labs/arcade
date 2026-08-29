# Arcade site surface

Load this for work under `apps/site`.

## Product role

The site is the front door for the `@vercel/arcade` terminal application and its reusable engine, TUI, game harness, agent tooling, docs, and examples. The visitor should quickly understand what Arcade is, how to run it, and where to learn or inspect more.

## Established direction

- Use the Geistdocs shell shared with Vercel OSS sites for navigation, docs, footer, typography, and theme behavior.
- The wordmark is lowercase `arcade` in Geist Pixel. Do not add a tagline or eyebrow above it merely to fill space.
- Keep the visual language minimal: no gradients, inflated marketing language, or generic "AI-powered" claims.
- The hero should foreground one concise description, install/run commands, documentation access, and a real Arcade visual or terminal experience.
- The hosted terminal must behave like a terminal. Prefer the actual packaged CLI in a PTY rendered by xterm.js over React reimplementations of Arcade's cell renderer or a fake command transcript.
- A floating terminal may feel like a real desktop terminal—draggable, resizable, focusable, and dismissible—but it is a product tool, not an OS simulation.
- Commands and shell help should be discoverable in-context. Keep curl/install variants available without forcing a large curl block into the hero.

## Architecture boundaries

- Keep site-only React, CSS, docs navigation, hosted-terminal lifecycle, and browser adapters under `apps/site`.
- Import browser-safe engine/TUI/package entry points. Do not copy game or renderer logic into site components.
- Preserve the one-way dependency graph described in the root `AGENTS.md`.
- Follow `docs/architecture/0001-hosted-arcade-terminal.md` for the real PTY/xterm path.

## Hero review checklist

- Can a first-time visitor identify the product and primary action in a few seconds?
- Does the page look native to the Vercel OSS family without erasing Arcade's terminal identity?
- Does light mode work as intentionally as dark mode?
- Is the terminal optional, easy to open, and understandable before typing?
- Does the terminal window drag, resize, focus, close, and recover cleanly across viewport sizes?
- Are install commands exact, copyable, and honest about package availability?
- Are docs and examples reachable without competing with the primary path?
- Is all visible copy literal, concise, and free of unsupported claims?
