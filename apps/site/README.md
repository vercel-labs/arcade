# Arcade site

The front door for the `@vercel/arcade` CLI: the hero page and the
`curl … | sh` installer it points at.

```
curl -fsSL vercel-arcade.vercel.app/install | sh
```

A Next.js app built on **[`@vercel/geistdocs`](https://github.com/vercel/geistdocs)** —
the shared package behind vgpu.sh, skills.sh, and other Vercel OSS sites — for the
"▲ OSS / product ▾" nav (with the cross-product flyout) and the Vercel-wide footer.
Only the minimal shell is adopted: `Navbar` + `Footer` + a hero page, none of
geistdocs' MDX docs/i18n-content/AI-chat machinery, since there's no docs corpus to
manage yet. A real `/docs` section can adopt that later.

It's its own [pnpm workspace root](pnpm-workspace.yaml) (own lockfile,
own `node_modules`) nested inside the arcade repo, fully decoupled from the CLI's
own dependency graph — `pnpm install`/`pnpm build` here never touches the root
`@vercel/arcade` package or its published `files`.

## Layout

| Path | What it is |
| -- | -- |
| `geistdocs.tsx` | product config: logo, nav links, GitHub repo, title |
| `lib/geistdocs/config.tsx` | `defineConfig(...)` wiring the above into geistdocs |
| `app/[lang]/layout.tsx` | root layout — `Navbar` + `Footer` from `@vercel/geistdocs` |
| `app/[lang]/(home)/page.tsx` | the hero page + the old README-style content sections |
| `app/[lang]/(home)/components/hero.tsx` | wordmark, tagline, the streamed prism, install CTA |
| `app/[lang]/(home)/components/prism-terminal.tsx` | client component: `xterm.js` rendering the streamed prism |
| `app/api/prism-stream/route.ts` | proxies `ascii-prisms.vercel.app`'s stream same-origin (avoids a CORS change to that shared, three-consumer handler) |
| `app/install/route.ts` | serves `install.sh` verbatim at `/install` (and `/install.sh` via a rewrite) |
| `install.sh` | the installer itself — unchanged, still checks Node 20+ then runs `npm i -g @vercel/arcade` |

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

Live at **https://vercel-arcade.vercel.app** (also `vercel-arcade.labs.vercel.dev`).
Project `vercel-arcade` in **vercel-labs**, Root Directory `apps/site`, framework
auto-detected as Next.js — no custom build/install command needed anymore.
`vercel.json`'s `ignoreCommand` still skips the build unless something under
`apps/site` changed. Git-connected to `vercel-labs/arcade`, so a push to `main`
deploys.

`turbopack.root` in `next.config.ts` pins the project root explicitly: Next's
root-detection walks up looking for lockfiles, finds the outer arcade repo's too,
and Turbopack then resolves paths against the wrong root and panics on a symlink
that only makes sense from there. Don't remove it.
