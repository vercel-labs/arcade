<div align="center">
  <a href="https://ascii-arcade.dev">
    <img src="https://ascii-arcade.dev/opengraph-image.png" alt="arcade, the 3D game engine built for agents." width="100%" />
  </a>
  <h1>arcade</h1>
  <p>
    <strong>The 3D game engine built for agents.</strong><br />
    ASCII in your terminal, no GPU. Humans can play too.
  </p>
  <p>
    <a href="https://vercel.com"><img alt="Made by Vercel" src="https://img.shields.io/badge/MADE%20BY-Vercel-000000.svg?style=for-the-badge&amp;logo=vercel&amp;logoColor=white&amp;labelColor=000000" /></a>
    <a href="https://www.npmjs.com/package/ascii-arcade"><img alt="npm package ascii-arcade" src="https://img.shields.io/badge/npm-ascii--arcade-CB3837.svg?style=for-the-badge&amp;logo=npm&amp;logoColor=white&amp;labelColor=000000" /></a>
    <a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-55AA00.svg?style=for-the-badge&amp;labelColor=000000" /></a>
    <a href="https://ascii-arcade.dev/docs"><img alt="Arcade documentation" src="https://img.shields.io/badge/docs-online-0070F3.svg?style=for-the-badge&amp;labelColor=000000" /></a>
  </p>
  <p>
    <a href="https://ascii-arcade.dev">Website</a>
  </p>
</div>

Arcade is an open-source, pure-TypeScript CPU 3D renderer, retained-mode
terminal UI toolkit, and agent-playable game harness. The same rules, geometry,
animation, and player contracts power the native terminal app, browser Canvas,
deterministic snapshots, and headless matches.

- **Software-rendered 3D.** Perspective projection, near-plane clipping,
  z-buffering, materials, picking, supersampling, and bloom without a GPU.
- **One visual system.** Render scenes as shape-matched ASCII, truecolor
  half-block pixels, or a hybrid of both.
- **Agent-ready games.** Humans, models, search policies, and test players use
  the same typed `Player` and authoritative rules contracts.
- **Inspectable by design.** Reproducible snapshots, bounded headless runners,
  canonical game records, and agent-readable documentation ship with the project.

## Run Arcade

Install the CLI and launch it:

```bash
npm install --global ascii-arcade
arcade
```

Or run the latest release without keeping a global installation:

```bash
npx ascii-arcade@latest
```

The standalone installer checks Node.js and installs the same npm package:

```bash
curl -fsSL https://ascii-arcade.dev/install | sh
```

On first launch, Arcade opens Vercel's device sign-in flow, asks which team
should own AI usage, and derives an AI Gateway key for that session. The key is
never persisted. Run `arcade --help` for account, telemetry, and launch options.

Arcade looks best in a truecolor terminal such as Ghostty, iTerm2, Kitty,
WezTerm, or VS Code. It detects terminal capabilities and falls back to
256-color output when necessary.

### Controls

- **Every 3D scene:** left-click and drag to orbit, scroll to zoom, right-click and drag or use arrow keys to pan.
- **Chess:** select a piece, choose a legal square, or start a human/model match.
- **Poker:** hover to peek, click to lift cards, and size actions from the betting controls.
- **Islanders:** build, trade, move the robber, and negotiate around a procedurally rendered board.

## Games

| Game | What ships |
| --- | --- |
| **Chess** | A verified 0x88 rules engine with legal move generation, SAN/UCI, castling, en passant, promotion, repetition, draw rules, perft tests, and animated human/model play. |
| **Poker** | No-limit Texas Hold'em for 2–6 seats with private observations, betting and all-ins, side pots, physical chips and cards, table talk, multi-hand sessions, and canonical records. |
| **Islanders** | A Catan alternative: 2–4 players on a procedural island with production, building, maritime and player trades, development cards, robber/discard phases, negotiation, awards, and replayable rules state. |

Each game separates authoritative rules from presentation. Terminal scenes,
browser cinematics, headless runners, and model prompts consume the same game
state instead of maintaining parallel implementations.

## Build with Arcade

`ascii-arcade` exposes deliberate package boundaries instead of publicizing
the repository's internal directory structure.

| Import | Use it for |
| --- | --- |
| `ascii-arcade` | Browser-safe convenience exports and packaged showcases. |
| `ascii-arcade/engine` | CPU rasterization, meshes, materials, cameras, animation, picking, effects, terminal surfaces, and presenters. |
| `ascii-arcade/tui` | Retained layout, components, themes, focus, pointer input, compositing, and the terminal renderer. |
| `ascii-arcade/platform` | Node terminal input, color detection, and alternate-screen lifecycle. |
| `ascii-arcade/rules/*` | UI-independent Chess, Poker, and Islanders game states. |
| `ascii-arcade/harness/*` | Players, model decisions, communication policy, headless sessions, diagnostics, and records. |
| `ascii-arcade/game-visuals/*` | Shared production geometry and deterministic game animation plans. |
| `ascii-arcade/web` | Canvas presentation, browser scenes, responsive terminal grids, and cinematic adapters. |

For example, a player is simply an asynchronous policy over an authoritative
game state:

```ts
import type { Player } from 'ascii-arcade/harness';
import { runHeadlessChessMatch } from 'ascii-arcade/harness/chess';
import { ChessState, type Move } from 'ascii-arcade/rules/chess';

const firstLegal: Player<Move> = {
  name: 'first legal',
  chooseAction: async state => ({ action: state.legalActions()[0] }),
};

const result = await runHeadlessChessMatch(
  new ChessState(),
  [firstLegal, firstLegal],
  { maxPlies: 300 },
);

console.log(result.status, result.state.moveHistory());
```

Start with the [rendering engine](https://ascii-arcade.dev/docs/engine),
[terminal UI](https://ascii-arcade.dev/docs/tui), or
[game harness](https://ascii-arcade.dev/docs/game-harness) guides. The
[package API](https://ascii-arcade.dev/docs/package-api) lists every
supported import.

## Architecture

Arcade keeps reusable libraries below the application. Import direction is
one-way: app and host layers consume the renderer, rules, harness, and visuals;
those libraries never import product UI.

```text
LIBRARIES  (reusable; never import product UI)

   engine ──┬──→ tui                    rules ──→ harness
            ├──→ game-visuals
            ├──→ cinematic ──→ web      auth · voice · telemetry
            └──→ prism

HOSTS  (the product layer; one-way consumers of everything above)

   arcade CLI  ←── tui · game-visuals · cinematic · harness · auth · voice · telemetry
   site        ←── web
   curl API    ←── prism
```

Read the [repository map](./docs/architecture/repository-map.md) and
[package boundary policy](./docs/architecture/package-boundaries.md) for the
complete dependency and distribution contract.

## Agent resources

Arcade is designed to be understood and operated by coding agents as well as
people:

- [`llms.txt`](https://ascii-arcade.dev/llms.txt) is the concise product and API index.
- [`llms-full.txt`](https://ascii-arcade.dev/llms-full.txt) contains the complete offline documentation corpus.
- [`agents.md`](https://ascii-arcade.dev/agents.md) documents supported agent workflows and commands.
- [`openapi.json`](https://ascii-arcade.dev/openapi.json) describes the public installer, status, and prism-stream HTTP surfaces.
- [`examples.json`](https://ascii-arcade.dev/examples.json) indexes browser-safe examples and capabilities.
- **Headless games** run Chess, Poker, and Islanders with no terminal attached, through
  `ascii-arcade/harness/*`. Any async policy over the authoritative state is a valid player,
  so an agent can play or evaluate a full match in-process.
- **Match Lab** (`pnpm match:run`) runs deterministic or model-backed sessions across all
  three games, preserving manifests, events, traces, and canonical records for later study.
- **Snapshots** (`pnpm snapshot`) render a bounded frame through the real production scene
  pipeline, so visual work is verifiable without starting an infinite raw-mode TTY.

## Develop

```bash
pnpm install
pnpm type-check
pnpm test
pnpm smoke:package
```

Run the full-screen terminal application with `pnpm dev`. To inspect visual
output without starting an infinite raw-mode TTY, render a PNG instead:

```bash
pnpm snapshot:png poker 140 50 river players=5
```

See [verifying output](./docs/verifying-output.md) for every snapshot target and
[CONTRIBUTING.md](./CONTRIBUTING.md) for repository setup and pull-request
expectations.

## Authentication and telemetry

The Arcade CLI uses Vercel's device flow to select a billing team and derive an
AI Gateway key at launch. Login tokens are cached with owner-only permissions;
the derived Gateway key is not stored. Library consumers provide their own
models, players, and authentication.

Arcade sends anonymous usage events and canonical game records through its
telemetry proxy. It never sends prompts, private reasoning, table chat, voice,
credentials, or Vercel account identity. Disable telemetry with
`ARCADE_TELEMETRY=0`, `arcade telemetry disable`, or the in-app setting.

## Contributing

Issues, focused pull requests, documentation improvements, and new game
experiments are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before adding
code or assets, and follow the [Vercel Community Code of Conduct](./CODE_OF_CONDUCT.md).

Security reports should follow the private process in
[`.github/SECURITY.md`](./.github/SECURITY.md).

## License

Arcade's original source and assets are available under the
[MIT License](./LICENSE). Third-party attributions and their applicable terms
are recorded in [NOTICE.md](./NOTICE.md) and [LICENSES/](./LICENSES/).
