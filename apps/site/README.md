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

Its own Vercel project, separate from `ascii-prisms` (the curl prism) and
`arcade-telemetry` (the telemetry proxy):

- **Root Directory:** `apps/site` — nothing outside it is read, so
  "Include source files outside of the Root Directory" can stay off.
- **Build:** `vercel.json` points at `build.mjs` with install skipped (zero deps). Its
  `ignoreCommand` skips deploys unless something under `apps/site` changed.
- **Domain:** `arcade.vercel.app` is taken by an unrelated project, so the project is
  named for the host it should claim: `vercel-arcade` → `vercel-arcade.vercel.app`. A
  custom domain can be added later; the URL appears in `index.html` and in the
  installer's header comment.

Manual deploy from this directory:

```bash
node build.mjs
vercel deploy --prebuilt --prod --scope <team>
```
