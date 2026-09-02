# Arcade package boundaries

The public beta uses one npm package, `@vercel/arcade`. Keeping one artifact preserves
development velocity and lets the CLI and reusable libraries ship together. The package
has three different kinds of code; only one is a supported consumer contract.

## 1. Supported package imports

These paths are intentionally documented, smoke-tested from a packed tarball, and covered
by compatibility expectations:

- `@vercel/arcade`
- `@vercel/arcade/engine` and `/engine/png`
- `@vercel/arcade/tui`
- `@vercel/arcade/platform`
- `@vercel/arcade/rules`, `/rules/chess`, `/rules/islanders`, and `/rules/poker`
- `@vercel/arcade/harness`, `/harness/communication`, `/harness/islanders`,
  `/harness/chess`, `/harness/poker`, and `/harness/records`
- `@vercel/arcade/game-visuals` and its `/islanders`, `/chess`, and `/poker` subpaths
- `@vercel/arcade/web`

Consumers should import only these package subpaths—not `@vercel/arcade/src/...`.

## 2. Compiled package implementation

Publishing runs `pnpm build:package`, which compiles the complete runtime graph from
TypeScript into ESM under `dist/`. The tarball does not contain raw `src/` files and does
not require `tsx` at runtime. The `arcade` executable imports
`dist/arcade/main.js`, so a clean Node customer can run the installed CLI directly.

The compiler emits private CLI dependencies such as auth, voice, telemetry, and product UI
because the executable needs them. Physical presence in `dist/` is not an API promise.
Node's `exports` map remains the consumer boundary: code can ship for the CLI without being
an importable package subpath.

The following remain implementation details:

- `auth/`: Vercel device login, team selection, and Gateway key derivation. Library users
  supply their own AI SDK model or `Player`; the harness must not assume Arcade auth.
- `telemetry/`: Arcade's opt-out delivery, durable outbox, and hosted proxy contract.
  Canonical record shapes are public under `harness/records`; consumers decide whether
  to store, transform, or publish them. The Node-specific hashing, UUID generation,
  serialization envelope, and upload transport stay in `telemetry/`.
- `voice/`: used by the CLI, but not exported while browser/terminal platform coverage,
  native speaker behavior, and echo cancellation remain launch decisions.
- `arcade/`: the concrete product UI and lifecycle.
- `cinematic/`: shared implementation used by CLI and browser, but not a supported package
  subpath yet. Its compatibility surface is exposed through `/web` where needed; a dedicated
  export can follow after the API settles.

## 3. Repository-only apps and tools

`apps/site/`, `apps/telemetry-proxy/`, deployment configuration, snapshots, audits, and
match-lab commands are maintained in the repository but are not npm library APIs.
`src/tools/` is explicitly excluded from the package.

## Why the harness is public but auth is not

The agentic loop is reusable: a consumer can implement a `GameState`, provide one or more
`Player` objects, and call `runMatch`. `ModelPlayer` accepts an AI SDK model or model id, so
it works with the caller's provider and authentication choices. Islanders and Poker helpers
package the same production prompts and headless session behavior used by Arcade.

Arcade auth answers a narrower product question: which Vercel account/team should this CLI
bill, and how should its key be cached or re-derived? Exporting that as a general library
would couple consumers to Arcade's account UX and security policy. It stays a replaceable
app adapter.

## Publication policy

- Add a package export only when it is useful outside the Arcade app, has a coherent name,
  and can be exercised from a clean packed-package consumer.
- Prefer a small barrel that exposes the intended contract over exporting an internal
  directory wholesale.
- Moving code below `arcade/` does not automatically make it public; the `exports` map does.
- Do not split `engine`, `tui`, and `harness` into separate npm packages before beta unless
  independent release cadence or dependency weight becomes a demonstrated problem.
- Keep the package root browser-safe. It exports the renderer, browser-safe TUI primitives,
  and browser adapters. The stdout-backed TUI `Renderer`, terminal platform, and harness APIs
  are available only from explicit subpaths.
- Before publishing, the packed-package smoke test must execute every documented subpath and
  the CLI with plain Node, compile a TypeScript consumer, and bundle both the root and
  `@vercel/arcade/web` for the browser.
