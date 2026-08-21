# Arcade site

The front door for the `@vercel/arcade` CLI: a one-page landing/docs page and the
`curl … | sh` installer it points at.

```
curl -fsSL vercel-arcade.vercel.app/install | sh
```

## Layout

| File | What it is |
| -- | -- |
| `index.html` | the whole page — inline CSS/JS, no external requests, no images |
| `install.sh` | the installer, served verbatim at `/install` (and `/install.sh`) |
| `build.mjs` | writes the static `.vercel/output` tree (Build Output API v3) |

The installer is deliberately thin: it checks for Node 20+, then runs
`npm i -g @vercel/arcade@latest`. The "here's how to run it" banner comes from the
package's own postinstall ([src/arcade/install-banner.ts](../../src/arcade/install-banner.ts)),
so install-time output lives in exactly one place.

Because Arcade is a private `@vercel` package, the installer cannot supply registry
auth — it detects npm's 401/403/404 and points at `npm login --scope=@vercel`.

## Preview

`index.html` is self-contained, so opening the file is the preview:

```bash
open apps/site/index.html
```

## Deploy

Live at **https://vercel-arcade.vercel.app** (also `vercel-arcade.labs.vercel.dev`, the
team's deployment suffix). Its own Vercel project — `vercel-arcade` in **vercel-labs**,
separate from `ascii-prisms` (the curl prism) and the telemetry proxy.

- **Root Directory:** `apps/site`. Nothing outside it is read, so "Include source files
  outside of the Root Directory" stays off.
- **Build:** this directory's `vercel.json` runs `build.mjs` with install skipped (zero
  deps). Its `ignoreCommand` skips the build unless something under `apps/site` changed.
- **Git:** connected to `vercel-labs/arcade`, so a push to `main` deploys.
- **Domain:** `arcade.vercel.app` is taken by an unrelated project, so the project is
  named for the host it claims. The URL is written in `index.html` and in `install.sh`'s
  header comment — change both if the domain ever moves.

For a manual deploy, run from the **repo root** (not this directory) and let Vercel build:

```bash
VERCEL_ORG_ID=team_nO2mCG4W8IxPIeKoSsqwAxxB \
VERCEL_PROJECT_ID=prj_18Xs1G6aSWGBVtCEb3x3zi53gwTQ \
  vercel deploy --prod --scope vercel-labs
```

The env vars aim the repo-root checkout (linked to `ascii-prisms`) at this project. Two
traps make `--prebuilt` the wrong tool here: the CLI resolves the Root Directory relative
to the working directory, so running it from `apps/site` looks for `apps/site/apps/site`;
and running it from the repo root uploads the root `.vercel/output` — the prism's build —
instead of this one.
