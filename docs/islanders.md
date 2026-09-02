# ISLANDERS — rules, phases, and implementation design

The research + design reference for adding **Islanders** (base game, 3–4 players) to the
arcade as the third harness game (after chess and poker). Written before the code so the
rules engine is coded against a spec, not guesswork.

**Status:** headless base-game harness implemented. The code under
[`src/rules/islanders/`](../src/rules/islanders) implements board topology and setup plus the full
authoritative phase machine: initial placement, production, robber/discards, building,
maritime and optional domestic trade, development cards, special awards, and victory.
[`src/harness/games/islanders/islanders-setup.ts`](../src/harness/games/islanders/islanders-setup.ts) exposes both a
full-match runner and the setup-only benchmark runner. The board UI can integrate through
the generic `state()` / `playMove(action)` scene seam; it is not a dependency of the rules.

Scope is the **base 3–4 player game**. The 5–6 player extension, Seafarers, and Cities &
Knights are out of scope (noted only where they clarify what "base game" excludes). The
rules below follow the official *ISLANDERS Game Rules & Almanac* (5th English edition, ©
2015/2020 Islanders GmbH & Islanders Studio), which supersedes all earlier printings; digital-flow
and edge-case notes are cross-checked against colonist.io and the official base-game FAQ.
Full citations are in [Sources](#sources).

---

## Table of contents

- [Part I — Rules reference](#part-i--rules-reference)
- [Part II — Phases & interaction (digital lessons)](#part-ii--phases--interaction-digital-lessons)
- [Part III — Implementation design (mapping to the harness)](#part-iii--implementation-design-mapping-to-the-harness)
- [Part IV — Phasing plan](#part-iv--phasing-plan)
- [Sources](#sources)

---

# Part I — Rules reference

## 1. Components & counts

| Component | Count | Notes |
|---|---|---|
| Terrain hexes | 19 | 4 forest, 4 pasture, 4 fields, 3 hills, 3 mountains, 1 desert |
| Number tokens | 18 | one each of 2 and 12; two each of 3–6, 8–11; **no 7** |
| Harbor pieces | 9 | **4 generic 3:1** + **5 specific 2:1** (one per resource) |
| Resource cards | 95 | 19 each of brick, grain, lumber, ore, wool (also the bank/supply) |
| Development cards | 25 | **14 knights + 5 victory-point + 6 progress** (2 road building, 2 year of plenty, 2 monopoly) |
| Settlements | 20 | 5 per player (4 colors) |
| Cities | 16 | 4 per player |
| Roads | 60 | 15 per player |
| Special cards | 2 | Longest Road, Largest Army (2 VP each) |
| Robber | 1 | starts in the desert |
| Dice | 2 | 2d6 |

### Terrain → resource

| Terrain | Count | Produces |
|---|---|---|
| Forest | 4 | Lumber |
| Hills | 3 | Brick |
| Pasture | 4 | Wool |
| Fields | 4 | Grain |
| Mountains | 3 | Ore |
| Desert | 1 | — (robber start) |

### Number tokens & dice odds

One `2`, one `12`; two each of `3,4,5,6,8,9,10,11`. **6 and 8 are the "red numbers"**
(most pips, most frequent) and get an adjacency restriction at setup (§2). Roll
probabilities out of 36:

| Roll | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| /36 | 1 | 2 | 3 | 4 | 5 | 6 | 5 | 4 | 3 | 2 | 1 |

7 (probability 6/36 ≈ 17%) rolls the robber, not production.

### Development-card deck (25)

- **14 Knight/Soldier** — move the robber + steal; played knights count toward Largest Army.
- **5 Victory Point** — each worth 1 VP, kept hidden (Library, Market, Chapel, Great Hall, University).
- **6 Progress** — 2 Road Building, 2 Year of Plenty, 2 Monopoly.

### Harbors (9)

- **4 generic 3:1** — trade any 3 identical cards for 1 of any resource.
- **5 specific 2:1** — one per resource (brick / lumber / ore / grain / wool); trade 2 of
  *that* resource for 1 of any. A 2:1 harbor gives no discount on other resources.

A harbor requires a settlement/city **on one of the harbor's two coastal intersections** to use.

## 2. Board setup

- **Beginner (fixed):** the published balanced layout of hexes, tokens, harbors, and
  starting pieces. Recommended for a first game.
- **Experienced (variable):** shuffle the 19 terrain hexes and place them randomly.
- **Number tokens (variable):** use the current rulebook's alphabetical method: arrange the
  tokens in A–R order, start at any corner, and place them counterclockwise in an outside-in
  spiral, **skipping the desert**. This corresponds to
  `5,2,6,3,8,10,9,12,11,4,8,10,9,4,5,6,3,11`. Earlier rules also documented a fully
  random alternative with no adjacent red 6/8 tokens; the engine intentionally uses the
  current official spiral instead.
- **Harbors:** one on each of the 9 marked coastal positions on the sea frame.
- **Robber:** starts on the desert.

**Topology basics:** settlements/cities sit on **intersections (vertices)** where up to 3
hexes meet (coastal vertices touch 1–2); roads sit on **paths (edges)** where 2 hexes meet
(or a hex meets the sea) — 1 road per path.

## 3. Initial placement (snake order)

Two rounds, serpentine order; each player ends with **2 settlements + 2 roads** and thus
**2 starting VP**.

1. **First player:** highest dice roll (variable setup) / oldest player (beginner). Others
   follow clockwise.
2. **Round 1:** each player, in order, places 1 settlement (any legal vertex) + 1 adjacent
   road. The **distance rule** applies from the very first settlement.
3. **Round 2 (reverse order):** the last player of round 1 places first; each places their
   second settlement + road. The second settlement need not connect to the first.
4. **Starting resources:** immediately after placing the **second** settlement, take **1
   resource per adjacent terrain hex** (1–3 cards). The first settlement grants none.
5. The player who placed last takes the first regular turn.

## 4. Turn structure

On your turn, in order (you may play **1 dev card at any point**, including before the roll):

**(a) Roll → production.** Roll 2d6. **Every** player with a settlement (1 card) or city (2
cards) on an intersection bordering a hex with the rolled number collects that resource —
unless the robber sits on the hex (blocked).

> **Bank shortage:** if the bank can't pay *all* claimants a given resource, *no one* gets
> that resource this turn — **except** if exactly one player is owed it, they take whatever
> remains. Other resources are unaffected.

**(b) On a 7 → robber (replaces production):**
1. **Discard:** every player with **8+ cards** discards **⌊half⌋** (their choice). 8→4,
   9→4, 10→5, 11→5, 12→6. One discard resolves it (no repeat). Triggered by a rolled 7
   **only**, never by a played Knight.
2. **Move robber:** the roller **must** move it to a **different** hex (or the desert).
3. **Steal:** take 1 **random** card from an opponent with a building on the new hex
   (roller chooses if several qualify; nothing if the victim is empty). No trading until
   the robber has moved.

**(c) Trade.** Domestic (with players) and/or maritime (with the bank). See §7.

**(d) Build / buy.** Roads, settlements, cities, dev cards, in any order, as much as
affordable (subject to piece limits and supply).

Then pass the dice left.

## 5. Building costs

| Build | Cost | VP |
|---|---|---|
| Road | 1 brick + 1 lumber | — (Longest Road only) |
| Settlement | 1 brick + 1 lumber + 1 wool + 1 grain | 1 |
| City (upgrade a settlement) | 3 ore + 2 grain | 2 |
| Development card | 1 ore + 1 wool + 1 grain | — (VP cards: 1) |

Spent resources return to the bank.

## 6. Building rules

- **Road:** must connect to your own road/settlement/city; 1 per path; may run along the
  coast. Cap 15.
- **Settlement:** (1) connects to your own road; (2) **distance rule** — all 3 neighboring
  intersections must be vacant (yours included). Cap 5; to build a 6th you must first
  upgrade one to a city to free the piece.
- **City:** upgrade only (settlement → city on the same vertex; the settlement returns to
  your supply). Produces double. Cap 4.
- **Longest-road interruption:** an opponent's new settlement placed on a vacant vertex
  **along your road** splits it into two runs and can cost you the Longest Road card (§8).

## 7. Trading

Only during the **active** player's turn; others never trade among themselves.

- **Domestic:** any resources at any negotiated ratio with any other player, any number of
  trades. **No gifting**, **no like-for-like** (e.g. 2 wool for 1 wool), **no dev-card
  trades**, no 3-way/secret/on-credit trades.
- **Maritime:** 4:1 with the bank always; 3:1 at a generic harbor you occupy; 2:1 at a
  specific harbor you occupy (that resource only).

## 8. Special cards (2 VP each)

- **Longest Road:** first player to reach a continuous run of **≥5 roads** (only the single
  longest branch; forks don't add). Transfers immediately when someone builds a **strictly
  longer** run. If a break leaves you tied for longest you **keep** it; if you lose the lead
  and 2+ players tie (or none has ≥5), the card is **set aside** until one player again has
  a unique longest ≥5.
- **Largest Army:** first player with **3+ played knights**. Transfers on **strictly more**.

## 9. Victory

**First to 10 VP, on your own turn.** Sources: settlement 1, city 2, Longest Road 2,
Largest Army 2, each VP dev card 1. VP cards stay hidden; reveal them on your turn to reach
10. A 10th point gained off-turn (e.g. a special-card transfer during an opponent's turn)
does **not** win — you must wait for your turn (and it can be lost again first). If multiple
players are ≥10, the active player wins.

## 10. Edge-case rulings (to encode)

These are the ones a naive rulebook reading gets wrong — sourced from the official base-game
FAQ/Almanac and colonist.io:

| Situation | Ruling |
|---|---|
| Play a dev card **and** build same turn? | Yes — separate actions. |
| Knight before the roll? | Yes (even if the robber isn't on your hex). But that's your 1 card for the turn. |
| Dev card the turn you bought it? | No — except VP cards. |
| Win on another player's turn? | No — victory is checked only on your own turn. |
| Largest Army / Longest Road tie | Bonus **stays with the current owner**; only a strict excess takes it. Only *played* knights count. |
| Longest Road broken | Holder keeps it if still (tied-)longest; transfers to a new **sole** leader; set aside if 2+ tie or none has ≥5. |
| Must the robber move to a new hex? | Yes — a different hex; may go to the desert (never the sea). |
| Steal with no valid target / empty victim | Steal nothing. |
| Discard rounding / repeats | 8+ → ⌊half⌋, once; rolled-7 only, not on a Knight. |
| Bank empty during production | No one gets that resource unless a single player is owed it (takes the remainder). |
| Year of Plenty vs empty bank | Take only what physically remains. |
| Monopoly | Name one resource; every opponent hands over **all** they hold of it (none → nothing). |
| Trade for a resource you have 0 of / that the robber blocks | Allowed — the robber only blocks *production*, not trading. |
| Road Building with only one legal road | Place the one legal road; you can't bank the unplaced road. |
| Dev deck exhausted | Can't buy (25 cards exist, ever). |

---

# Part II — Phases & interaction (digital lessons)

How well-made digital clients (primarily **colonist.io**, cross-checked against Islanders
Universe / Board Game Arena) sequence the phases and make it legible *whose* input is
needed and *for what*. These lessons drive the terminal presentation later, and the phase
model drives the engine now.

## The per-turn state sequence (active player)

1. **Pre-roll** — only legal actions are playing **one** dev card (esp. a Knight to move
   the robber before production). Primary affordance: **Roll** (colonist binds it to space).
2. **Roll** — 2 dice animate; a hard gate.
3. **Production** — an animated, all-players-at-once event, not interactive.
4. **The 7 branch** (if rolled, or a Knight is played) — a multi-actor sub-machine:
   **discard** (every over-limit player, blocking) → **move robber** (roller) → **steal
   target** (roller, if several qualify).
5. **Main phase** — trade and build interleaved freely, any number of times; plus play a
   dev card if not already played.
6. **End turn** — explicit; nothing auto-advances.

## The pivotal insight: phase = "what may each player do now"

colonist's biggest architectural lesson (from building their real-time "Rush" mode): stop
thinking of a single global turn cursor and instead model **the set of legal actions per
player at this instant**. Even for a strictly turn-based terminal game, deriving the prompt
from *the current legal-action set for the awaited player* keeps the display honest and
makes AI/observer output trivial. This maps directly onto the engine design in Part III
(`toPlay` decoupled from `turnOwner`; `isLegalAction()` as the authoritative validator,
with finite actions enumerated for the harness).

## Discard-on-7 is a hard blocking barrier

A 7 can force **several** players to act before the turn continues. colonist classifies
discard as a **"forced action"** that must fully resolve before anything else — they tried
interleaving other play during discards and it "created too much chaos" (someone plays
Monopoly or steals the cards you're mid-discard eyeing). Model it as a barrier: enqueue one
discard prompt per over-limit player (seating order), resolve all, *then* move the robber.

## Trading UX (the hardest interaction)

- **Two channels, split in the UI:** bank/maritime (its own tab; rates printed on the
  cards) vs. domestic player offers.
- **Simultaneous responses:** when you post an offer, each opponent shows an
  accept/reject/waiting status; you watch it resolve asynchronously. Counteroffers work
  even from players lacking the requested resource; others can "jump in," then the proposer
  picks whom to trade with.
- **Wildcard offers** ("1 sheep for anything") are first-class and shrink the space — very
  terminal-friendly (a give-set + a receive-set, either possibly "any").
- **Embargo** lets you block a specific player.
- **Prune stale state:** rejected/unaffordable offers vanish so the visible set equals the
  actionable set.
- Base Islanders bounds this: only the active player initiates; no 3-way/secret/credit trades;
  every trade is a concrete give-and-take.

## Initial placement flow

Snake order, sequential (not simultaneous — you watch neighbors take spots you wanted).
Valid intersections/edges are highlighted; invalid spots aren't offered. The **second**
settlement immediately seeds your opening hand (1 per adjacent hex), shown right away. Hexes
display probability "dots" (a 6/8 = 5 dots) as a board-reading aid.

## What makes phase communication good (terminal-transferable)

1. Model phase as per-player legal actions, not one global cursor.
2. Make "we're waiting on **you**, for **this**" impossible to miss — a loud, persistent
   status line naming the awaited player, the exact action, and any deadline (colonist users
   *still* missed their turn with only subtle highlighting).
3. One clearly-labeled primary action per state (Roll / End Turn are the spine).
4. Distinguish **forced** prompts (discard) from **optional** ones (trade/build).
5. Encode direction & quantity consistently (give vs. receive), annotate bank rates at the
   point of decision.
6. Carry decision-relevant context *in* the prompt (steal-target candidates' hand sizes/VP;
   a trade's net effect on your counts).

---

# Part III — Implementation design (mapping to the harness)

How Islanders fits the arcade's OpenSpiel-style harness ([`src/rules/game.ts`](../src/rules/game.ts)),
informed by a comparative study of open-source engines (islandersatron is the reference).

## 3.1 The harness contract

- One **`IslandersState` = one full game** (to 10 VP). Unlike poker (where a `HoldemState` is
  one hand and the session lives in the driver), a Islanders game is a single state's lifetime —
  closer to `ChessState`.
- It implements **`ImperfectInfoState<IslandersAction>`**: dev cards, the dev-deck order, and
  opponents' exact hand composition are hidden. `informationStateString(player)` is the
  per-seat observation an AI is prompted on; `toString()` is the full (spectator) view.
- Players are seat indices `0..n-1`. `returns()` is a per-seat vector (e.g. +1 winner, −1
  others, or a VP-normalized payoff — TBD, but per-seat like poker's).

## 3.2 Chance handling — resolve internally (like poker)

**Decision: dice rolls, dev-card draws, and robber steals resolve internally via an
injected seeded RNG; `isChanceNode()` always returns `false`.** This deliberately follows
poker (`HoldemState` deals internally) rather than the "explicit CHANCE node" some engines
(islandersatron notwithstanding, it also resolves internally) or a search-first design would
prefer.

Rationale, specific to this codebase: the generic match loop
([`src/harness/match.ts`](../src/harness/match.ts) `runMatch`) reads `currentPlayer()` and asks
`players[idx]` — it **cannot resolve chance nodes**. `game.ts` documents exactly this: a
game "may deal internally and never surface a chance node." Surfacing dice as chance nodes
would require changing the match loop; internal resolution keeps Islanders drop-in compatible
with `runMatch`, `ModelPlayer`, and the human player, unchanged.

Consequences:
- The **"roll dice" is a normal action** of the current player; `applyAction` samples 2d6
  from the injected RNG and distributes production.
- Keep the RNG **injectable and seeded** (`rng?: () => number`, defaulting to `Math.random`,
  exactly like `HoldemOpts.rng` + `shuffle` in [`poker/cards.ts`](../src/rules/poker/cards.ts))
  so setup and games are reproducible in tests/snapshots.
- The deterministic core stays separable: a future search/MCTS player can `clone()` and
  drive outcomes itself. We note but do not adopt explicit chance nodes now.

## 3.3 Board topology — static, integer-indexed, computed once

The defining difficulty is that vertices and edges are **shared** between hexes; model each
as a single canonical object or adjacency and longest-road break. The engine computes the
topology **once** and then does O(1) lookups.

- **Hexes** 0–18, with axial coords `{q, r}` (radius-2 hexagon = 1 + 6 + 12 = 19).
- **Nodes** (vertices) 0–53, **edges** 0–71. (Euler check: 54 − 72 + 19 + 1 = 2. ✓)
- **Dedup by canonical geometric key** (no floats): every vertex is the meeting of a
  *triple* of hex positions (self + two angularly-adjacent neighbors, some possibly
  off-board); every edge is a *pair* of hex positions (self + one neighbor). Sorting each
  key and interning it in a `Map` yields exactly 54 nodes and 72 edges with correct sharing
  — the integer-ID version of islandersatron's construction-time dedup, without hand-listing
  arrays.
- **Precomputed adjacency** (plain `number[][]`, frozen): `nodeNodes`, `nodeEdges`,
  `nodeHexes`, `edgeNodes` (exactly 2), `edgeEdges`, `hexNodes` (6), `hexEdges` (6), plus
  `nodeProduction[node] → Partial<Record<Resource, number>>` (expected yield) and coastal
  flags for harbor placement.

This is [`board-topology.ts`](../src/rules/islanders/board-topology.ts) — pure, deterministic,
serializable, tested against the 19/54/72 counts and incidence invariants.

## 3.4 Game state model

Split public from hidden:

- **Public:** board (buildings `Map<node,{color,type}>`, roads `Map<edge,color>`, robber
  hex), bank as a 5-int **freqdeck** `[brick, grain, lumber, ore, wool]`, each player's
  **counts** of resources / dev cards / pieces / VP, Longest Road & Largest Army holders,
  and per-turn flags (such as `playedDevCardThisTurn` and cards bought this turn).
- **Hidden:** each player's exact resource identities, each player's dev cards, the ordered
  dev-card deck. `informationStateString(p)` reveals p's own hidden holdings + all public
  info; opponents' hidden hands surface only as counts (optionally min/max belief bounds
  later — an idea worth stealing from `settlers_of_islanders_RL`).
- **Bank as freqdeck** (order-free histogram) but the **dev deck as an ordered array**
  (draw order is real hidden information).
- **`clone()` is first-class and cheap** (structural, typed arrays where possible) — needed
  for legality checks and any future search, exactly as chess/poker clone.

## 3.5 Phase / turn state machine

Model the turn as an explicit **prompt** discriminated union plus a **pending-actor queue**;
`toPlay` (who must act now) is **decoupled** from `turnOwner` (whose turn it is). This is
how the discard-on-7 (and any interrupt) works: a 7 enqueues one `Discard` prompt per
over-limit player, then `MoveRobber` (whose action also names any victim), before returning
to `PlayTurn`. `currentPlayer()` returns `toPlay`, which may not be the turn owner — the match
loop already supports this (it just asks `players[currentPlayer()]`).

```ts
type Prompt =
  | { kind: 'InitialSettlement'; player: number } | { kind: 'InitialRoad'; player: number }
  | { kind: 'Roll'; player: number }
  | { kind: 'Discard'; player: number }        // one per over-limit player, in seating order
  | { kind: 'MoveRobber'; player: number }
  | { kind: 'PlayTurn'; player: number }        // trade/build/play-dev/end
  | { kind: 'RespondTrade'; player: number; offer: TradeOffer }   // domestic (gated, off by default for AI)
  | { kind: 'DecideAcceptees'; player: number };
```

The prompt gates roll-vs-build; turn flags mirror islandersatron for one dev card per turn
(`playedDevCardThisTurn`), and cards bought this turn aren't playable this turn (tracked by
type). Road Building is represented atomically as its one- or two-edge action.

## 3.6 Action space

`isLegalAction(action)` is the authoritative validator over a rich discriminated union.
`legalActions()` enumerates the ordinary finite choices. Two combinatorial families are
also exposed structurally through `legalActionFamilies()`: domestic offers (open-ended
negotiated quantities) and unusually large discard multisets. This follows islandersatron's
choice to special-case/exclude negotiated trades from its flattened RL action space rather
than exploding the mask. `parameterizedActionExamples()` gives the generic model fallback
and normalizer an executable representative; the LLM receives the full accepted format.

```ts
type IslandersAction =
  | { type: 'roll' }
  | { type: 'buildRoad'; edge: number } | { type: 'buildSettlement'; node: number } | { type: 'buildCity'; node: number }
  | { type: 'buyDevCard' }
  | { type: 'playKnight'; robberHex: number; victim: number | null }
  | { type: 'playRoadBuilding'; edges: number[] } | { type: 'playYearOfPlenty'; resources: Resource[] } | { type: 'playMonopoly'; resource: Resource }
  | { type: 'moveRobber'; hex: number; victim: number | null }
  | { type: 'discard'; resources: Resource[] }
  | { type: 'maritimeTrade'; via: 'bank'; give: Resource; get: Resource }
      // bank is always 4:1
  | { type: 'maritimeTrade'; via: 'port'; rate: 2 | 3; give: Resource; get: Resource }
      // every applicable owned port rate remains selectable
  | { type: 'offerTrade'; give: FreqDeck; receive: FreqDeck } | { type: 'acceptTrade' } | { type: 'rejectTrade' } | { type: 'confirmTrade'; with: number } | { type: 'cancelTrade' }
  | { type: 'initialSettlement'; node: number } | { type: 'initialRoad'; edge: number }
  | { type: 'endTurn' };
```

- **Domestic trade is gated behind a flag, off by default for AI.** Every source agrees
  trading is the hard part; islandersatron's RL space omits it entirely and RL agents flail with
  it. We keep it first-class in the rules but disable it for the initial AI harness (human
  vs. human can use it).
- A separate **encoding/mask layer** (flat index↔action, or factored type-head + param-head
  with an action mask) is optional and lives outside the rules core — only if/when we do RL.
  The LLM player uses the text observation + `actionToString`/`actionFromString`, validated
  against `legalActions`, like `ModelPlayer` does for poker.
- Exact discard combinations are enumerated up to 256 representatives. Normal hands fit
  well below the cap; pathological 95-card hands remain fully legal through the typed
  family validator without materializing nearly 100,000 strings.

## 3.7 AI & observation

- `informationStateString(p)` — compact authoritative observation: p's hand, VP, pieces
  left, ports; the board (hexes with resource/number/robber, occupied nodes/edges by
  color); bank counts; opponents' public counts; and the current prompt. It never leaks
  hidden hands or the deck.
- `decisionContextString(p)` — a separate model-facing envelope included by `ModelPlayer`
  on the first attempt. It supplies the exact canonical legal actions plus neutral facts
  for evaluating them. Setup settlements include local yield and, on the reverse pick,
  the resulting two-settlement portfolio: combined production, resource and number
  coverage, repeated numbers, newly added resources, starting cards, and port-production
  relationships. Setup roads include their reachable expansion frontiers. Keeping this
  separate lets chess retain its no-legal-list evaluation flow.
- `actionToString` / `actionFromString` — canonical notation + a lenient parser for model
  answers (re-prompt on `null`), mirroring poker.
- **Bot ladder** (recommended order, per islandersatron's benchmarks): (1) random (respecting
  the mask — also the fuzz-tester); (2) heuristic greedy on a `nodeProduction`-based value
  function; (3) flat value function + shallow **2-ply** search — the best strength per
  effort (islandersatron found 3-ply *worse* than 2-ply; value function > deeper search); (4)
  optional determinized MCTS; LLM/RL last. Trading off by default throughout.

## 3.8 Testing strategy

- **Deterministic:** fixed seed → fixed transcript. Rules use the injected state RNG;
  `createIslandersSetupModelPlayer` also uses a deterministic legal fallback by default and
  accepts `fallbackRng` when a seeded randomized fallback is desired.
- **Replay:** `transcript()` includes the initial board/harbors, initial development deck,
  sampled random tape, configuration, actions, and dice/draw/steal outcomes;
  `IslandersState.replay()` reconstructs the exact state without a UI snapshot.
- **Topology invariants:** 19 hexes / 54 nodes / 72 edges; every edge has exactly 2
  endpoints; node incidence 1–3 hexes; Σ hex→node incidences = 6·19; adjacency symmetry.
- **Setup invariants:** correct terrain multiset (4/4/4/3/3/1), token multiset (no 7, one
  2/one 12), the official A–R counterclockwise outside-in spiral (which keeps 6/8 apart),
  and 9 harbors on distinct coastal edges.
- **Rules invariants (as they land):** resource conservation (bank + all hands = 19 per
  resource, always); longest-road recompute matches a brute-force check on random boards;
  `legalActions` never returns an action `applyAction` rejects; piece caps; VP totals.

---

# Part IV — Phasing plan

Mirrors how poker shipped (`git log`: imperfect-info harness + card primitives → 3D
table/graphics test bed → playable rules → chips/voice/HUD polish). Each phase is
independently reviewable and additive.

**Current checkpoint:** Phase 1's headless rules core and the model-facing action contract
are playable end to end. `IslandersState` owns all legality and transitions, resolves seeded
chance internally, records dice/dev-draw/steal outcomes for replay, and exposes a
private-safe observation plus exact canonical legal actions and neutral portfolio facts.
`runIslandersMatch` drives generic `Player`/`ModelPlayer` seats to victory; `runHeadlessIslandersMatch`
requires no renderer; `runIslandersInitialPlacement` remains available for setup-only studies.
Domestic trade is complete but opt-in because its negotiation branching is undesirable in
many model/RL evaluations. Full-match runners default to a 10,000-action safety cap and
raise a typed error when a legal but inert policy never reaches victory. Presentation work
now consumes this API rather than completing it.

- **Phase 0 — foundation (complete).** Research + this doc; `src/rules/islanders/`
  board topology, core types, board setup, and harness-contract scaffolding.
- **Phase 1 — playable rules core (complete).** `legalActions`/`applyAction` for every phase
  (initial placement → roll/production → robber/discard/steal → build/buy → dev cards →
  maritime/domestic trade → awards → victory), **domestic trade off by default**, with
  focused seeded tests and replayable stochastic outcomes. Broader randomized invariant
  fuzzing remains worthwhile hardening rather than an integration blocker.
- **Phase 2 — graphics / cover test bed.** An iterative visual pass on the board render
  (the hex/number/harbor/robber/piece look), like poker's "3D table" bed — for the graphics
  iteration loop, before wiring gameplay to it.
- **Phase 3 — presentation scene + human input.** `arcade/games/islanders/` scene + HUD, the
  legibility lessons from Part II (loud "your move / this action" status, forced-vs-optional
  prompts), and human interaction (highlighted legal placements, build/trade UI).
- **Phase 4 — AI wiring (core complete).** Full-game observation/notation, legal decision
  context, generic AI-vs-AI/full-headless runners, and structured portfolio accessors are
  wired. Remaining optional work is richer per-action diagnostics and the bot ladder from
  §3.7.
- **Phase 5 — integration & polish.** Activate the game registry (**AIG-205** — Islanders is
  the third game that motivates it), canonical game records → telemetry, and polish.

Linear: team **AI Gateway**, project **Arcade**, **Islanders** milestone. AIG-205 (registry
activation) already exists and lands in Phase 5.

---

# Sources

### Rules (base game)

- [Official ISLANDERS Base Game Rules & Almanac (5th ed., 2020 PDF), islanders.com](https://www.islanders.com/sites/default/files/2021-06/islanders_base_rules_2020_200707.pdf) — primary source for components, setup, initial placement, turn structure, costs, dev cards, robber, trading, special cards, victory, and almanac edge-case rulings.
- [ISLANDERS Game Rules hub, islanders.com](https://www.islanders.com/understand-islanders/game-rules) — official index confirming the current base edition.
- [Official ISLANDERS Base Game FAQ/Almanac, islanders.com](https://www.islanders.com/faq/basegame) — definitive edge-case rulings (dev-card-plus-build, knight-before-roll, no-card-same-turn-bought, win-only-on-your-turn, Largest Army/Longest Road transfer & ties, robber-must-move/desert-allowed, empty-hand steal, discard rounding, empty-bank production, Monopoly honesty, trading restrictions).
- [Wikipedia: Islanders](https://en.wikipedia.org/wiki/Islanders) — cross-check for terrain→resource, production, robber, trade ratios, dev cards, 10-VP victory.
- [IslandersBoard setup guide](https://islandersboard.com/setup) — cross-check for per-type hex distribution and harbor split (4× 3:1 + 5× 2:1, per the official components list).

### Digital flow (colonist.io + others)

- [colonist.io/islanders-rules](https://colonist.io/islanders-rules) — colonist's base-game rules: turn order, production, 7/robber/discard, trade rates, costs/limits, dev-card restrictions, special cards, snake setup, second-settlement resources.
- [Improving the colonist trade system](https://blog.colonist.io/improving-the-colonist-trade-system/) — the definitive trade-UX writeup: vertical give/receive model, bank tab, on-card rates, per-player accept/reject status, counteroffers, jump-in, wildcard offers, embargo.
- [colonist Rush development](https://blog.colonist.io/colonist-rush-development/) — the "what may each player do now" state-machine reframe, forced/blocking actions (discard), stale-offer pruning, sequential-placement rationale, self-identified UX gaps.
- [colonist updated timers](https://blog.colonist.io/updated-timers/) — five speed presets and per-action timer durations.
- [colonist 101: how to play](https://blog.colonist.io/colonist-101-how-to-play/) — game modes, room settings, Ready/Start, Ranked placement.
- [Guide to Islanders starting strategies (colonist)](https://blog.colonist.io/guide-to-islanders-starting-strategies/) — snake-order detail, highlighted valid placements, probability "dots", second-settlement seeding.
- [Board Game Arena: Islanders help](https://en.doc.boardgamearena.com/Gamehelpislanders) — corroborating turn structure, robber-to-new-terrain, trade types, dev-card timing, tie-keeps-owner, win-only-on-your-turn.

### Implementations & AI

- [islandersatron (GitHub)](https://github.com/bcollazo/islandersatron) and [docs](https://islandersatron.readthedocs.io/en/latest/islandersatron.models.html) — the reference Python engine: cube-coord hexes + integer node/edge IDs, construction-time dedup, `ActionPrompt` state machine, `current_player_index` vs `current_turn_index`, freqdeck bank + ordered dev deck, longest-road caches, bot ladder.
- [islandersatron gym action_space.py](https://raw.githubusercontent.com/bcollazo/islandersatron/master/islandersatron/islandersatron/gym/envs/action_space.py) — flattened action enumeration and per-type counts (328 for 1v1 base); confirms domestic trade excluded from the RL space.
- ["5 Ways NOT to Build a Islanders AI" (bcollazo, Medium)](https://medium.com/@bcollazo2010/5-ways-not-to-build-a-islanders-ai-e01bc491af17) — AlphaBeta n=2 strongest; 3-ply worse than 2-ply; value function > deeper search.
- [settlers-rl.github.io](https://settlers-rl.github.io/) and [settlers_of_islanders_RL (GitHub)](https://github.com/henrycharlesworth/settlers_of_islanders_RL) — deep-RL design: attention encoder over tiles, min/max hidden-info belief encoding, factored action heads + masking, recurrent trade heads, "trading never mastered."
- [m-l.dev: building a Islanders board with NetworkX](https://m-l.dev/islanders-board/) — graph board via `hexagonal_lattice_graph` + `minimum_cycle_basis`; dedup-for-free; "push adjacency complexity to construction."
- [Szita, Chaslot & Spronck 2009, "MCTS in Settlers of Islanders"](https://link.springer.com/chapter/10.1007/978-3-642-12993-3_3) — canonical high-branching + stochastic benchmark; determinized MCTS.
- [Red Blob Games: Hexagonal Grids](https://www.redblobgames.com/grids/hexagons/) — the standard reference for hex coordinate systems (cube/axial/offset).
- [OriGoldfrydCS/Settlers-of-Islanders (C++)](https://github.com/OriGoldfrydCS/Settlers-of-Islanders) — 1–54 numbered intersections, clean `canPlace*/place*` rules API.
- [nbelle1/strategy-game-agents](https://github.com/nbelle1/strategy-game-agents) — a fork adding an `LLM` player to islandersatron (compact text obs + validated actions).
