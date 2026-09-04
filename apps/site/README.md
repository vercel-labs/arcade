# Arcade site

The front door for the `@vercel/arcade` CLI. The hero presents the canonical npm
install command; the curl installer remains available as a standalone endpoint.

```
curl -fsSL ascii-arcade.vercel.app/install | sh
```

A Next.js app built on **[`@vercel/geistdocs`](https://github.com/vercel/geistdocs)** —
the shared package behind vgpu.sh, skills.sh, and other Vercel OSS sites — for the
"▲ OSS / product ▾" nav, docs shell, and Vercel-wide footer. The hero embeds a
real terminal session: xterm.js connects to an isolated Vercel Sandbox PTY that
runs the actual packaged Arcade CLI. The browser does not recreate the launcher
or games.

It's its own [pnpm workspace root](pnpm-workspace.yaml) (own lockfile,
own `node_modules`) nested inside the arcade repo, fully decoupled from the CLI's
own dependency graph. Browser surfaces consume the root package through a workspace
link and public subpath exports rather than copying game or renderer code. The hosted
terminal build packs the current root workspace into a deployment artifact, installs that
exact artifact into a reusable base snapshot, and forks a temporary session for each visitor.
The browser warms only that shared base during page idle. A visitor sandbox is
created on explicit terminal intent (hover, keyboard focus, or pointer-down), and
the terminal reuses that in-flight session when Play opens. This keeps the first
post-deploy install/snapshot work off the click path without allocating a
20-minute sandbox for every page view.

## Layout

| Path | What it is |
| -- | -- |
| `geistdocs.tsx` | product config: logo, nav links, GitHub repo, title |
| `lib/geistdocs/config.tsx` | `defineConfig(...)` wiring the above into geistdocs |
| `app/[lang]/layout.tsx` | root layout — `Navbar` + `Footer` from `@vercel/geistdocs` |
| `app/[lang]/(home)/page.tsx` | product overview, capabilities, install, and privacy sections |
| `app/[lang]/(home)/components/hero.tsx` | product introduction, install CTA, and hosted terminal |
| `app/[lang]/(home)/components/arcade-terminal.tsx` | xterm.js client connected to the isolated Arcade PTY |
| `app/api/terminal/session` | packages the current CLI, provisions the reusable Sandbox base, and opens temporary PTY sessions |
| `scripts/prepare-terminal-package.mjs` | packs the current root workspace for the hosted terminal build |
| `app/[lang]/docs/[[...slug]]` | renderer, TUI, harness, browser-host, and tools documentation |
| `app/install/route.ts` | serves `install.sh` verbatim at `/install` (and `/install.sh` via a rewrite) |
| `public/llms.txt`, `public/llms-full.txt`, `public/agents.md` | agent-readable entry points |
| `public/examples.json`, `public/schemas/examples-v1.json` | compatibility index retained for the public v1 capability contract |
| `install.sh` | the installer itself — checks Node 22+ then runs `npm i -g @vercel/arcade` |

The `[lang]` segment is geistdocs' routing convention; only `en` is configured
(`translations` in `geistdocs.tsx`) — there's no real i18n content here.

## Dev

```bash
cd apps/site
pnpm install
pnpm dev      # http://localhost:3000
pnpm build && pnpm start   # production build
```

## Deploy

Live at **https://ascii-arcade.vercel.app**.
Project `ascii-arcade` in **vercel-labs**, Root Directory `apps/site`, framework
auto-detected as Next.js — no custom build/install command needed anymore.
`vercel.json`'s `ignoreCommand` still skips the build unless something under
`apps/site` changed. Git-connected to `vercel-labs/arcade`, so a push to `main`
deploys.

`turbopack.root` in `next.config.ts` pins the project root explicitly: Next's
root-detection walks up looking for lockfiles, finds the outer arcade repo's too,
and Turbopack then resolves paths against the wrong root and panics on a symlink
that only makes sense from there. Don't remove it.
