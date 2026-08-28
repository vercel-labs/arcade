# Arcade web playground and developer site

Last updated: 2026-08-28

## Goal

Turn the Arcade landing page into a browser-playable, agent-readable open-source developer
site while preserving the terminal product and the one-way library import graph.

## Architecture

- Browser-native `Surface` host; no hosted PTY.
- Real Arcade rules and CPU renderer are imported through `@vercel/arcade/web`.
- Site-specific React, CSS, docs navigation, and marketing copy stay under `apps/site`.
- No browser bundle may import terminal, filesystem, auth, telemetry, or model credentials.
- AI play is intentionally deferred until there is a credential-safe server contract.

See [ADR 0001](../architecture/0001-browser-native-arcade-host.md).

## Delivery phases

- [x] Reconcile the merged Catan branch and existing Geistdocs site work.
- [x] Research VGPU/skills.sh patterns and existing Linear package/docs work.
- [x] Ship launcher + complete local Chess browser vertical slice.
- [x] Add live renderer/TUI examples backed by public package imports.
- [x] Publish detailed engine, pipeline, TUI, component, harness, tools, browser-host,
  and example documentation.
- [x] Add agent discovery surfaces (`llms.txt`, `agents.md`, machine-readable examples).
- [x] Validate package shape with a packed external consumer, browser build, accessible
  controls, reduced-motion behavior, and local interaction.
- [x] Deploy and inspect a branch preview.
- [x] Run an initial `is-agentic` audit against the preview.
- [x] Address actionable findings, redeploy, and record the final audit (95/100).

Final branch preview: <https://vercel-arcade-2ks99xwmy.labs.vercel.dev>

Final audit: <https://is-agentic.com/scan/vercel-arcade-2ks99xwmy.labs.vercel.dev>

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
- Real launcher and complete local two-player Chess with legal moves, terminal states,
  resize, pointer picking, camera orbit/zoom, restart, and ASCII/pixel/hybrid modes.
- Live mesh/material and retained-TUI specimens in `/examples`.
- Static, crawlable docs and machine-readable agent indexes.
- Browser-safe exports for `engine`, `tui`, `rules/chess`, and `web` proven from the packed
  tarball, not only through workspace aliases.

## Deliberately deferred

- Poker and actual Catan browser adapters. They should migrate scene/rule dependencies one
  game at a time instead of importing the terminal orchestrator into the site.
- AI/model play in the browser. The client must never hold a Gateway credential; see
  `AIG-706` and [ADR 0001](../architecture/0001-browser-native-arcade-host.md).
- Public npm claims. The package remains restricted until the source, asset, license, and
  packed-consumer release audits are complete.

## Guardrails

- Keep `/install`, curl prism, CLI startup, and telemetry opt-out unchanged.
- Never include run artifacts, credentials, prompts, or private model traces in the site.
- Prefer one public package with explicit `engine`, `tui`, `rules`, and `web` subpaths until
  consumer evidence justifies splitting packages.
