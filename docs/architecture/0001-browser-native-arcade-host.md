# ADR 0001: Browser-native Arcade host

- Status: accepted
- Date: 2026-08-28
- Scope: `src/web`, `apps/site`, public package boundaries

## Context

Arcade currently paints 3D scenes and retained UI into an engine `Surface`, then
serializes changed cells into ANSI for a raw terminal. The public site needs a real,
interactive Arcade experience without maintaining a second set of game rules or a
server-side pseudo-terminal for every visitor.

Two host strategies were evaluated:

1. **Hosted PTY** — run the existing CLI on a server and bridge stdin/stdout through a
   WebSocket terminal emulator.
2. **Browser-native host** — keep the renderer, `Surface`, rules, and game state in the
   browser, replacing only terminal presentation and input adapters.

## Decision

Use a browser-native host. The reusable boundary is the final cell grid plus normalized
pointer/key input:

```text
rules + engine + TUI
        │
        ▼
      Surface
      ├─ terminal host → ANSI diff → stdout
      └─ browser host  → canvas cells → DOM input
```

The first vertical slice is a local two-player Chess experience using Arcade's real
`ChessState`, CPU rasterizer, materials, camera math, picking, and `Surface`. It includes
the launcher, display-mode cycling, orbit/zoom, legal move selection, reset, and complete
terminal-state handling. AI-authenticated matches remain a later server-assisted layer;
the public browser build must never embed Gateway credentials or fabricate model output.

The site consumes `@vercel/arcade/web` through an explicit package subpath. Browser-safe
modules may import `engine`, `tui`, and `rules`; they must not import Node terminal, auth,
telemetry, filesystem asset loaders, or the monolithic CLI orchestrator.

## Why not a hosted PTY

- A durable PTY and WebSocket session is a poor fit for the site's static/serverless
  deployment and would add process lifecycle, tenancy, rate limiting, and abuse controls.
- Every visitor would consume server compute even for local rendering and local games.
- It would make examples and docs screenshots depend on a remote session instead of the
  package users are learning.
- It obscures the actual reusable boundary we want third-party authors to consume.

## Consequences

- Browser-safe imports become a tested architectural property rather than an aspiration.
- Existing terminal gameplay remains untouched; browser work is additive.
- Some app-level scenes still need asset-loading injection before they can run unchanged in
  a browser. The vertical slice proves the host first, then those scenes can migrate one at
  a time without moving rules or renderer logic.
- AI games will require a credential-safe server API and explicit telemetry policy before
  being enabled on the public site.

