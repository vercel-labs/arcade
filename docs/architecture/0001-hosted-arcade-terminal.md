# ADR 0001: Hosted Arcade terminal

- Status: accepted
- Date: 2026-08-28
- Scope: `apps/site`, the published CLI, and public package boundaries

## Context

The Arcade website needs to show the same application users run in a terminal. A
browser-specific recreation can share rules and rendering primitives, but it still creates a
second launcher, input loop, lifecycle, and presentation path. Small differences quickly make
the website feel unlike the installed product.

Two strategies were evaluated:

1. **Browser-native recreation** — run browser-safe engine, TUI, and rules modules in the page
   and rebuild the app-level lifecycle around DOM input.
2. **Hosted PTY** — install the actual Arcade package in an isolated Linux environment, run its
   CLI, and connect its stdin/stdout to xterm.js.

## Decision

Use a hosted PTY for the homepage. xterm.js is only the terminal display and input device:

```text
browser input → xterm.js → WebSocket → isolated PTY → actual arcade CLI
browser cells ← xterm.js ← ANSI bytes ←──────────────┘
```

Before the site builds, it packs the current root workspace into an npm tarball. The deployment
bundles that exact artifact, installs it into a reusable Sandbox image keyed by the deployment
revision, seeds a small docs/examples filesystem, and snapshots the base. Each visitor receives
a temporary fork with its own shell and filesystem. Typing `arcade` invokes the packaged binary;
`ls`, `cd docs`, and `cat README.md` are ordinary shell operations rather than website
simulations.

Browser-native engine and TUI specimens remain useful under `/examples`. They demonstrate the
reusable package subpaths, but they are not presented as the full Arcade application.

## Credential and process boundary

- The visitor shell runs as an unprivileged Linux user.
- The Arcade process runs as a separate unprivileged user through one exact sudo command.
- The browser and visitor shell never receive the real AI Gateway credential.
- Arcade receives a random placeholder credential. The Sandbox network policy replaces it only
  for a matching request to `ai-gateway.vercel.sh`.
- General session egress is denied. Without a hosted credential, all egress is denied and Arcade
  still works without model play.
- `ARCADE_HOSTED_TERMINAL=1` is the only condition under which the CLI accepts an inherited key;
  normal local launches continue to ignore inherited keys and use Vercel device authentication.
- `ARCADE_TELEMETRY=0` is set for every hosted session.
- Sessions expire automatically and are not a persistence or remote game-control API.

## Consequences

- The homepage exercises the real package, launcher, games, terminal renderer, input parsing,
  and UI instead of maintaining a lookalike.
- A base snapshot avoids reinstalling the package for every visitor, while per-session forks
  preserve isolation.
- The site now has server compute, WebSocket, abuse-control, and capacity responsibilities.
- Package exports remain important for third-party authors and the `/examples` gallery, but the
  full website demo no longer depends on an alternate browser app orchestrator.
- A deployment must expose Vercel Sandbox access and a server-side Gateway credential (or OIDC)
  before AI model play is available in the hosted terminal.
