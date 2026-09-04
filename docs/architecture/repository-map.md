# Arcade repository map

Arcade is one repository and, for the public beta, one published npm package. The
repository also contains deployable applications and development tools that are not part of
the package's supported import API.

## Top-level deployables

| Path | Purpose | Deployment / distribution |
| --- | --- | --- |
| `src/arcade/` | The full-screen terminal application | `@vercel/arcade` CLI |
| `apps/site/` | Landing page, docs, examples, and hosted terminal | `ascii-arcade` Vercel project |
| `api/` + `src/prism/` | Curlable animated prism | `ascii-prisms` Vercel project |
| `apps/telemetry-proxy/` | Credential-holding telemetry ingress | `arcade-telemetry` Vercel project |
| `src/tools/` | Snapshots, match-lab, audits, and repository development utilities | Repository only; excluded from npm |

## Source layers

```text
rules ─────────────> harness ───────┬──> arcade app <── platform
                                    └──> tools              ↑
engine ──┬──> tui ──────────────────────────────────────────┤
         ├──> game-visuals ─────────────────────────────────┤
         ├──> prism ───────────────> api                     │
         ├──> cinematic ────────────┬──> arcade app           │
         │                          └──> web ─────> apps/site  │
         └──> web <── tui / rules / game-visuals ────────────┘

auth / voice / telemetry ───────────────────────> arcade app
```

- `src/engine/` is the CPU 3D renderer: math, meshes, materials, rasterization, and
  terminal-oriented presentation.
- `src/tui/` is the retained-mode terminal UI toolkit.
- `src/platform/` parses terminal input and manages terminal capabilities/lifecycle.
- `src/rules/` contains UI-independent game states and legal-action authority.
- `src/harness/` connects a rules state to human, model, search, or custom players. It
  owns action selection, model prompting, communication policy, and UI-independent match
  sessions. It does not choose credentials or publish telemetry.
- `src/game-visuals/` contains renderer-only assets and primitives that can be composed by
  Arcade, the web examples, or another application.
- `src/cinematic/` owns platform-neutral timelines, camera choreography, scene transitions,
  display-mode transitions, and shared scene compositions such as Cover Flow. It consumes
  renderer primitives and injected assets, never browser APIs, filesystem APIs, or
  `src/arcade/`.
- `src/web/` adapts browser-safe renderer/TUI/rules pieces to Canvas. It is not a second
  implementation of shared cinematic behavior: browser image decoding, Canvas presentation,
  pointer input, and scroll observation stay here.
- `src/prism/` is a self-contained visual shared by the CLI, curl endpoint, snapshots, and
  the website.
- `src/arcade/` owns product composition: launcher, HUDs, animation pacing, setup panels,
  model catalog choices, auth flow, voice integration, and telemetry delivery.
- `src/telemetry/` converts public canonical records into Arcade's private upload envelope.
  It owns Node-specific hashing/UUID utilities and delivery; `harness/records` does not.

## Dependency rule

Library layers must not import `src/arcade/`. If both the live application and a browser,
headless tool, or other host need the same rules, prompt, player, session, visual, or
choreography, that code belongs below the app—usually in `rules/`, `harness/`,
`game-visuals/`, or `cinematic/`.

The package root is a browser-safe convenience surface. Node-only capabilities such as raw
terminal control and model match execution are intentionally reached through `/platform`
and `/harness/*` rather than pulled into the root import graph.

Repository tools may import supported libraries and explicit app configuration such as the
current model catalog, but reusable match execution must not live under `arcade/`.

## Where new work belongs

- New legal rule or state transition: `rules/<game>/`.
- New agent/player implementation or generic match behavior: `harness/`.
- Renderer-only mesh, animation, or board-game prop: `game-visuals/<game>/`.
- Timeline, deterministic camera pose, match cut, or cross-host scene composition:
  `cinematic/`, with assets supplied by the host.
- HUD, menu, click behavior, or product animation choreography: `arcade/games/<game>/`.
- Snapshot, audit, or batch evaluation command: `tools/` using the harness.
- Credential selection, account state, telemetry delivery, or voice hardware integration:
  product adapter directories, not the public harness.
