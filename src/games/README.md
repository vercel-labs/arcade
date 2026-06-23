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

Make a folder `games/<name>/` and implement `Game` + `GameState`. Call
`registerGame('<name>', () => yourGame)`. No central edits needed.

## Chess (`games/chess/`)

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
