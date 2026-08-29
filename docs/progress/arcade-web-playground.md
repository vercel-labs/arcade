# Arcade web playground and developer site

Last updated: 2026-08-29

## Goal

Turn the Arcade landing page into a browser-playable, agent-readable open-source developer
site while preserving the terminal product and the one-way library import graph.

## Architecture

- Hosted PTY runs the actual packaged Arcade CLI; xterm.js is only its display/input device.
- Focused game-visual examples import browser-safe `@vercel/arcade` subpaths.
- Site-specific React, CSS, docs navigation, and marketing copy stay under `apps/site`.
- The browser and visitor shell never receive the real model credential; Sandbox network policy performs a request-scoped replacement.
- Hosted sessions are temporary, telemetry-disabled, and network-denied except for matching Gateway calls.

See [ADR 0001](../architecture/0001-hosted-arcade-terminal.md).

## Delivery phases

- [x] Reconcile the merged Catan branch and existing Geistdocs site work.
- [x] Research VGPU/skills.sh patterns and existing Linear package/docs work.
- [x] Ship an initial local Chess browser vertical slice, then replace the homepage clone with the actual CLI.
- [x] Add live game-visual examples backed by public package imports.
- [x] Publish detailed engine, pipeline, TUI, component, harness, tools, browser-host,
  and example documentation.
- [x] Add agent discovery surfaces (`llms.txt`, `agents.md`, machine-readable examples).
- [x] Validate package shape with a packed external consumer, browser build, accessible
  controls, reduced-motion behavior, and local interaction.
- [x] Deploy and inspect a branch preview.
- [x] Run an initial `is-agentic` audit against the preview.
- [x] Address actionable findings, redeploy, and record the final audit (95/100).

Final branch preview: <https://vercel-arcade-pwb2okkqv.labs.vercel.dev>

Final audit: <https://is-agentic.com/scan/vercel-arcade-pwb2okkqv.labs.vercel.dev>

The remaining audit deductions are not honest code-only fixes: preview-domain search
indexing, organization address/contact metadata that should not be invented, rate-limit
headers without a real limiter, and a live MCP server outside this read-only site's scope.
OpenAPI already has typed response schemas, operation IDs, URL versioning, and a documented
Deprecation/Sunset policy; the audit still reports those as partial.

Agent-readiness follow-up is tracked under Linear issue `AIG-705`; existing package and
open-source work remains under `AIG-589` through `AIG-598` rather than duplicated here.
Credential-safe AI sessions and browser expansion beyond local Chess are tracked under
`AIG-706` with the required server auth, rate-limit, privacy, and lifecycle boundary.

## Delivered browser surface

- Arcade-native hero and installation affordance.
- Actual packaged launcher and games through a temporary Linux PTY, plus a miniature
  navigable docs/examples filesystem.
- The production Chess board and imported knight, all 6 Catan terrain systems, the Poker
  starting-chip stack, and the prism stream in `/examples`.
- One browser-safe mini-scene contract shared by the package and site instead of React replicas.
- Static, crawlable docs and machine-readable agent indexes.
- Browser-safe exports for `engine`, `tui`, `rules/chess`, and `web` proven from the packed
  tarball, not only through workspace aliases.

## Deliberately deferred

- Additional browser-native game specimens such as the complete Catan board, cards, table,
  cover flow, and HUD. The complete application already runs through the hosted CLI, so
  browser adapters should exist only when they teach a reusable package API.
- Production capacity, abuse controls, and credential provisioning for the hosted terminal;
  see `AIG-706` and [ADR 0001](../architecture/0001-hosted-arcade-terminal.md).
- Public npm claims. The package remains restricted until the source, asset, license, and
  packed-consumer release audits are complete.

## Guardrails

- Keep `/install`, curl prism, CLI startup, and telemetry opt-out unchanged.
- Never include run artifacts, credentials, prompts, or private model traces in the site.
- Prefer one public package with explicit `engine`, `tui`, `rules`, and `web` subpaths until
  consumer evidence justifies splitting packages.
