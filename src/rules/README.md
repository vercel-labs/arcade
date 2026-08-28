# Game harness

Turn-based game logic for the arcade — separate from rendering (`arcade/`) and
the renderer (`engine/`). The design follows DeepMind **OpenSpiel** (a `Game` /
`State` split) and is shaped to be **AI-ready** the way Kaggle **Game Arena**
wraps games (a player is just `observation → action`), without committing to any
AI yet.

## The contract (`game.ts`)

- **`Game<S, A>`** — immutable: `type` metadata + `newInitialState()`.
- **`GameState<A>`** — the mutable position. Core methods:
  `currentPlayer()`, `legalActions()`, `applyAction(a)`, `isTerminal()`,
  `returns()` (per-player +1/-1/0), `clone()`, `toString()`,
  `actionToString(a)` / `actionFromString(s)`.

`registry.ts` maps a short name → factory; games self-register at module load.

## Adding a game

Make a folder `rules/<name>/` and implement `Game` + `GameState`. Call
`registerGame('<name>', () => yourGame)`. No central edits needed.

## Chess (`rules/chess/`)

Implemented from scratch (zero deps), 0x88 board:

- `types.ts` — squares/pieces/move encoding and 0x88 helpers.
- `board.ts` — `Board`: position, FEN load/save, `applyMove`, repetition key.
- `attacks.ts` — `isSquareAttacked` (check detection, castle-through-check).
- `movegen.ts` — pseudo-legal generation + legal filter (make-on-clone), castling,
  en passant, promotion. `isInCheck`.
- `san.ts` — `Move` ↔ UCI and ↔ SAN (with disambiguation and `+`/`#`).
- `chess.ts` — `ChessState`/`chessGame`: terminal detection (checkmate, stalemate,
  50-move, threefold, insufficient material) and the `GameState` impl.

Actions are `Move` objects; `actionFromString` accepts SAN **or** UCI (matched
against the legal list). Players: `0` = White, `1` = Black.

Correctness is verified by **perft** (`src/tools/perft.ts`) against reference node
counts for the start and "kiwipete" positions.

## Catan (`rules/catan/`)

Base 3–4 player game. **Phase 1 in progress** — topology and board setup are done, and the
initial snake placement is playable through `legalActions`/`applyAction` and the generic
model harness. Regular roll/build/trade turns remain staged. The full rules, phase model,
and harness-mapping design (plus the phasing plan and sources) are in
[docs/catan.md](../../docs/catan.md).

- `types.ts` — resources, terrain, pieces, ports, dev cards, the resource **freqdeck**,
  costs, and the `CatanAction` / `Prompt` unions.
- `board-topology.ts` — the static board graph: 19 hexes / 54 nodes / 72 edges with
  canonical (float-free) dedup of shared vertices/edges, adjacency tables, and the coastal
  perimeter ring for harbors. Pure, computed once, frozen.
- `setup.ts` — seeded "variable setup": terrain, number tokens (enforcing the 6/8-not-
  adjacent rule), and harbors; plus `nodeProduction` (expected per-roll yield per vertex).
- `placement.ts` — shared settlement-distance, city-upgrade, and road-connectivity rules.
- `catan.ts` — `CatanState` (implements `ImperfectInfoState`) + `catanGame` + registration.
  Initial placement enforces the `0..n-1,n-1..0` snake, an adjacent road after each
  settlement, and starting resources from each second settlement. Its typed placement
  options expose pips, resource diversity, ports, and road expansion frontiers to bots.
  One state = one full game to 10 VP. Chance (dice/draws/steals) resolves **internally**
  via an injected seeded RNG, so no chance node is surfaced (compatible with `runMatch`).

One state = one whole game (like chess), not one hand (like poker). Players are seat indices
`0..n-1`; `returns()` is +1 winner / −1 others.
