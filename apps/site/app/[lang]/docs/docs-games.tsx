import type { ReactNode } from 'react';
import { CodeBlock } from './docs-code';
import type { DocPage } from './docs-content';

const REPO = 'https://github.com/vercel-labs/arcade/blob/main/';
const Code = ({ children, title }: { children: string; title?: string }) => <CodeBlock title={title}>{children}</CodeBlock>;
const Source = ({ path, children }: { path: string; children?: ReactNode }) => <a className="source-link" href={`${REPO}${path}`} rel="noreferrer" target="_blank">{children ?? path} ↗</a>;
const Note = ({ children }: { children: ReactNode }) => <aside className="doc-note">{children}</aside>;
const Api = ({ rows }: { rows: [string, string][] }) => <div className="api-list">{rows.map(([name, description]) => <div key={name}><code>{name}</code><p>{description}</p></div>)}</div>;

export const GAME_DOCS: DocPage[] = [
  {
    slug: 'games', label: 'Games', title: 'Games',
    summary: 'Study complete games as worked examples: their rules authority, graphics, animation, player-safe observations, model decisions, and reusable seams.',
    sections: [
      {
        heading: 'Learn from a complete game',
        body: <><p>Arcade’s layers make the most sense when followed through a real game. Each case study begins with the rules a player needs, then traces the same state into graphics, interaction, AI observations, decisions, and canonical records. Use these pages as references when adding a game rather than treating the shipped games as opaque demos.</p><div className="doc-cards">
          <a href="/docs/games/chess"><strong>Chess</strong><span>Legal movement, SAN, imported OBJ pieces, captures, castling, and public-information model play</span></a>
          <a href="/docs/games/poker"><strong>Poker</strong><span>No-limit Hold’em, private cards, procedural textures, card bending, chips, wisps, and table talk</span></a>
          <a href="/docs/games/islanders"><strong>Islanders</strong><span>Building and trading rules, procedural terrain, board assembly, dice, private inventories, and negotiation</span></a>
        </div></>,
      },
      {
        heading: 'The common anatomy',
        body: <><Api rows={[
          ['rules/<game>', 'Owns authoritative state, legal actions, chance outcomes, terminal results, cloning, notation, and player-safe observations. It has no renderer dependency.'],
          ['harness/games/<game>', 'Turns observations and legal actions into model decisions, communication opportunities, bounded sessions, and canonical records.'],
          ['game-visuals/<game>', 'Owns renderer-neutral geometry, layouts, asset loading, and deterministic motion that can be shared by terminal and browser hosts.'],
          ['arcade/games/<game>', 'Composes the production scene, HUD, input, cameras, sound cues, and match lifecycle. It remains application code, not a package API.'],
        ]} /><Code title="Architecture">{`authoritative rules ──> player-safe observation ──> Player decision
        │                                      │
        ├──> canonical action ──> record       │
        └──> visual plan ───────> scene + HUD <┘`}</Code><p>The invariant is one action authority. Humans, models, headless policies, and visual playback all pass through the same legal-action and apply-action boundary.</p></>,
      },
      {
        heading: 'Choose a game to borrow from',
        body: <Api rows={[
          ['Chess', 'Best reference for perfect information, compact notation, imported mesh assets, deterministic move choreography, and a small two-seat match loop.'],
          ['Poker', 'Best reference for imperfect information, repeated rounds, chance deals, variable player counts, flexible geometry, private reasoning, and public speech.'],
          ['Islanders', 'Best reference for a large phase machine, procedural board topology, resource economies, negotiation, public/private state, and long-running records.'],
        ]} />,
      },
      {
        heading: 'Build a fourth game',
        body: <><p>Start with a presentation-free state and make it replayable before drawing it. Then add the narrowest reusable visual primitives, a model-facing observation, one bounded runner, and finally the production scene.</p><Code title="Checklist">{`1. Define State + Action and enumerate legalActions()
2. Make applyAction(), clone(), terminal results, and chance replayable
3. Separate spectator state from each seat's observation
4. Add notation or a typed decision schema
5. Record requested action, applied action, outcome, and diagnostics
6. Build geometry and motion in game-visuals/<game>
7. Compose the scene and HUD in arcade/games/<game>
8. Add headless, rules, snapshot, and cross-host parity checks`}</Code><p>Continue to <a href="/docs/guides/custom-game">Add an agent-playable game</a> for the implementation sequence and <a href="/docs/game-visuals">Game visuals</a> for the package boundary.</p></>,
      },
    ],
  },
  {
    slug: 'games/chess', label: 'Chess', title: 'Chess: rules, pieces, and model play', navParent: 'games', navGroup: 'Playable games',
    summary: 'A complete perfect-information case study: orthodox chess rules, algebraic notation, imported 3D pieces, cinematic move plans, and model decisions.',
    sections: [
      {
        heading: 'Rules at a glance',
        body: <><p>Chess is played by White and Black on an 8×8 board. White moves first. A move is legal only when it follows the piece’s movement and does not leave its own king in check.</p><Api rows={[
          ['Pawn', 'Moves one square forward, or two from its starting rank when clear; captures one square diagonally. Promotion is required on the final rank. En passant is available only immediately after the adjacent two-square pawn move.'],
          ['Knight', 'Moves in an L: two squares on one axis and one on the other. It is the only piece that can jump over occupied squares.'],
          ['Bishop', 'Slides any clear distance diagonally.'],
          ['Rook', 'Slides any clear distance along a rank or file.'],
          ['Queen', 'Combines bishop and rook movement.'],
          ['King', 'Moves one adjacent square that is not attacked. Castling also moves a rook, requires unmoved pieces and a clear path, and cannot begin in, cross, or end in check.'],
        ]} /><p>Checkmate ends the game with a winner. Arcade also detects stalemate, fifty-move draws, threefold repetition, and insufficient material. For a formal external reference, see the <a href="https://handbook.fide.com/chapter/E012023" rel="noreferrer" target="_blank">FIDE Laws of Chess</a>.</p><Note>This page explains the orthodox mode. Arcade also has an optional loose-move presentation mode that deliberately bypasses legality; it is not part of <code>ChessState.legalActions()</code>.</Note></>,
      },
      {
        heading: 'The rules authority',
        body: <><p><code>ChessState</code> owns the board, side to move, repetition keys, SAN history, legal-action cache, and result. Move generation operates on a 0x88 board representation; the scene never decides whether a move is legal.</p><Code title="TypeScript">{`import { ChessState } from '@vercel/arcade/rules/chess'

const game = new ChessState()
const move = game.actionFromString('Nf3')
if (!move) throw new Error('ambiguous or illegal move')

game.applyAction(move)
console.log(game.fen())
console.log(game.moveHistory()) // 1. Nf3`}</Code><p>The parser accepts canonical SAN and UCI. Its soft pass tolerates common model mistakes such as <code>0-0</code>, a missing capture marker, or promotion formatting only when the result identifies one unique legal move.</p><Source path="src/rules/chess/chess.ts" /><Source path="src/rules/chess/movegen.ts" /><Source path="src/rules/chess/san.ts" /></>,
      },
      {
        heading: 'From OBJ files to terminal pieces',
        body: <><p>The six piece families begin as OBJ assets. The shared loader parses each source into an indexed <code>Mesh</code>, measures its bounds, and exposes transport-injected loading so Node and browser hosts can fetch the same geometry differently. The production scene applies color, lighting, board scale, and camera composition at draw time.</p><Code title="TypeScript">{`import {
  fetchChessPieceMeshes,
  measureChessPieceMeshes
} from '@vercel/arcade/game-visuals/chess'

const meshes = await fetchChessPieceMeshes(loadText)
const metrics = measureChessPieceMeshes(meshes)
// Scene code chooses transforms and materials; assets stay host-neutral.`}</Code><p>This is the pattern to copy for authored 3D assets: keep parsing and metrics reusable, inject transport, and leave scene meaning outside the asset module.</p><Source path="src/game-visuals/chess/pieces.ts" /><Source path="assets/chess_blender/pawn.obj" /><Source path="src/arcade/games/chess/scene.ts" /></>,
      },
      {
        heading: 'One move becomes a cinematic plan',
        body: <><p><code>planChessMove()</code> translates a rules move into renderer-neutral segments. Ordinary moves have one segment. Castling adds a rook segment. Captures identify the removed piece and destination; en passant hides a different square. Each segment can travel linearly or on a piece-appropriate arc, while the scene handles selection, jail placement, camera, and wisp tracking.</p><Code title="TypeScript">{`const plan = planChessMove(state.board, move)

for (const segment of plan.segments) {
  const position = chessMovePosition(segment, progress)
  drawMovingPiece(segment.piece, position)
}

for (const square of plan.hideSq) hideStaticPiece(square)`}</Code><p>Planning motion before mutating or rendering protects object identity: the browser and terminal can animate the same castling, capture, promotion, and knight-hop semantics with different rasterizers.</p><Source path="src/game-visuals/chess/move-animation.ts" /></>,
      },
      {
        heading: 'What the model sees',
        body: <><p>Chess is perfect information, so both seats can receive the complete position. The harness adds the current board narrative, numbered SAN move history, move-format instructions, and optional public conversation. The model returns a structured move and spectator-facing rationale; Arcade validates the move against the legal list before applying it.</p><Code title="Model context (abridged)">{`Position: <current board / FEN-derived view>
Move history: 1. e4 e5 2. Nf3 Nc6
Return one move in standard algebraic notation.
Examples: "Nf3", "e4", "O-O", "exd5"`}</Code><p>If structured output fails, the shared player retries a strict text format. Invalid responses are re-prompted, and exhausted attempts fall back to a recorded legal move so a match cannot deadlock.</p><Source path="src/harness/games/chess/chess-session.ts" /><Source path="src/harness/model-player.ts" /></>,
      },
      {
        heading: 'Extend the case study',
        body: <ul><li>Add a new piece look as a <code>Material</code>, not scene-specific raster code.</li><li>Add move semantics in rules first, then update the shared move plan and parity tests.</li><li>Keep evaluation engines or search players behind the generic <code>Player&lt;Move&gt;</code> contract.</li><li>Use <a href="/docs/tools">bounded snapshots</a> to review board readability, captures, camera framing, and terminal-cell output.</li></ul>,
      },
    ],
  },
  {
    slug: 'games/poker', label: 'Poker', title: 'Poker: hidden information at a 3D table', navParent: 'games', navGroup: 'Playable games',
    summary: 'A no-limit Texas Hold’em case study spanning betting authority, hand ranking, private observations, procedural cards, physical shuffling, chips, and table talk.',
    sections: [
      {
        heading: 'Rules at a glance',
        body: <><p>Arcade plays no-limit Texas Hold’em. Each seat receives two private hole cards. Five community cards arrive over the flop (three), turn (one), and river (one). The strongest five-card hand available from a player’s seven cards wins at showdown; a player can also win earlier when every opponent folds.</p><Api rows={[
          ['Action order', 'The dealer button moves between hands. The small and big blinds seed the pot. Preflop action begins left of the big blind; later streets begin with the first active seat left of the button.'],
          ['Check / call', 'Check when nothing is owed. Call commits enough chips to match the current street bet, capped by the player’s stack.'],
          ['Bet / raise', 'Amounts are total street commitments. A full raise must reach the current bet plus the previous full raise increment; a short all-in does not reset that minimum.'],
          ['All-in', 'Commits the remaining stack. Side pots preserve each player’s eligible share when stacks differ. Folded cards cannot win a pot.'],
          ['Round completion', 'A street ends after every non-folded, non-all-in player has responded to the latest full raise and matched the bet.'],
        ]} /><p>The default tournament begins at 10/20 blinds and advances through configured levels every 15 completed hands. For another concise rules reference, see the <a href="https://www.pokerstars.com/poker/learn/how-to-play/" rel="noreferrer" target="_blank">PokerStars rules guide</a>.</p></>,
      },
      {
        heading: 'Hand ranking',
        body: <><p>From strongest to weakest: straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, pair, and high card. Arcade’s evaluator encodes the category and ordered kickers into one comparable integer, so ties are exact integer equality and split pots remain deterministic. Aces are high except in the A–2–3–4–5 wheel.</p><Code title="TypeScript">{`import { evaluate, parseCard } from '@vercel/arcade/rules/poker'

const cards = ['As', 'Ac', 'Kh', 'Qh', 'Jh', '9h', '2h']
  .map(card => parseCard(card)!)
const hand = evaluate(cards)
// Flush: A, K, Q, J, 9. The pair of aces is not the best five-card hand.`}</Code><Source path="src/rules/poker/hand-eval.ts" /></>,
      },
      {
        heading: 'Betting is authoritative and forgiving',
        body: <><p><code>HoldemState</code> owns stacks, commitments, current bet, minimum raise, folded/all-in seats, board cards, action order, pots, and the complete mechanical record. <code>legalActions()</code> gives models a finite menu: fold, check or call, plus representative minimum, pot-sized, and all-in raises. Human sliders may request any amount; <code>applyAction()</code> normalizes it to a legal effective action.</p><Code title="TypeScript">{`const hand = new HoldemState({ players: 3, startingStack: 1000 })

for (const action of hand.legalActions()) {
  console.log(hand.actionToString(action))
}

// A too-small raise is clamped to the minimum unless it is a short all-in.
hand.applyAction({ type: 'raise', to: 25 })`}</Code><p>The record keeps both requested and effective actions. That distinction is useful for replay, model-quality analysis, and explaining why a UI request changed.</p><Source path="src/rules/poker/holdem.ts" /><Source path="src/rules/poker/blinds.ts" /></>,
      },
      {
        heading: 'Cards made from pixels and geometry',
        body: <><p>A playing card is a double-sided textured billboard with visible stock thickness. Number cards are generated from rank labels and suit masks; court artwork and suit shapes are loaded from PNG assets, decoded into textures, tinted, scaled, and stamped onto the procedural face. The browser-safe module accepts an asset loader instead of importing Node file APIs.</p><Code title="TypeScript">{`await preparePokerCardTextures(loadTexture)

const face = pokerCardFaceTexture(card)
const back = pokerCardBackTexture()
drawCard(target, viewProjection, model, card, back)`}</Code><p><code>drawPeekCard()</code> and <code>drawArchCard()</code> subdivide the same card into strips, bending the geometry while keeping texture coordinates continuous. That one primitive supports a player peeking at hole cards and the deck flexing during a shuffle.</p><Source path="src/game-visuals/poker/cards.ts" /><Source path="src/game-visuals/poker/card-render.ts" /><Source path="assets/poker/spade.png" /></>,
      },
      {
        heading: 'A shuffle is a physical timeline',
        body: <><p><code>DeckShuffle</code> models a complete riffle → bridge → cascade → rest cycle. The deck splits into packets, inner edges lift, cards interleave one by one, the joined deck arches, then each card cascades flat. Card identity and orientation persist throughout the cycle. Between hands, the production scene gathers cards, awards chips, plays two shuffle cycles, and deals again.</p><Code title="TypeScript">{`const shuffle = new DeckShuffle(cardBack, tableCenter)
shuffle.setClock(elapsed)
shuffle.draw(target, viewProjection)

const at = pokerChipFlight(seatStack, pot, progress)
drawChipColumn(at.x, at.lift, at.z)`}</Code><p>Chip motion follows the same object-permanence rule: carried stacks become bets, bets become the pot, and awards return to winner stacks instead of values teleporting between arrays.</p><Source path="src/game-visuals/poker/deck-shuffle.ts" /><Source path="src/game-visuals/poker/chip-motion.ts" /><Source path="src/arcade/games/poker/poker-scene.ts" /></>,
      },
      {
        heading: 'What each model sees',
        body: <><p>Poker is imperfect information. A seat sees its own hole cards, community cards, street, blinds, pot, own stack in chips and big blinds, amount to call, minimum raise-to, all-in ceiling, public seat states, and public action log. It never sees another live seat’s hole cards.</p><Code title="Model observation (abridged)">{`No-Limit Texas Hold'em, 4 players. You are seat 2.
Your hole cards: A♠ Q♠
Community: J♠ 8♦ 2♠ — flop
Blinds: 10/20. Pot: 150. Your stack: 920 (46 BB).
To call: 40. Min raise to: 120. All-in to: 960.
Seats: …
Action: …`}</Code><p>Private thinking, the selected move, and public speech are separate fields. This gives strategy a private home while table talk stays optional and cannot casually leak hole cards. Model creators can also appear as seat wisps; the scene marks the acting wisp as speaking without making the visual avatar part of game authority.</p><Source path="src/harness/games/poker/poker-session.ts" /><Source path="src/arcade/scenes/wisp.ts" /></>,
      },
      {
        heading: 'Reuse the pattern',
        body: <ul><li>Use Poker as the template for any game where seats observe different state.</li><li>Record chance outcomes and hidden values for replay, but project a separate public record for spectators or opponent memory.</li><li>Use strip-deformed textured geometry for paper, cloth, banners, or any thin flexible object.</li><li>Keep communication as a bounded optional decision, never as an unstructured source of game actions.</li></ul>,
      },
    ],
  },
  {
    slug: 'games/islanders', label: 'Islanders', title: 'Islanders: a procedural world with agents', navParent: 'games', navGroup: 'Playable games',
    summary: 'Arcade’s broadest case study: a Catan-style building and trading game with procedural topology, animated terrain, private economies, negotiation, and long-horizon model context.',
    sections: [
      {
        heading: 'What Islanders is',
        body: <><p>Islanders is Arcade’s original presentation of the familiar hex-island building-and-trading ruleset popularized by Catan. It is not affiliated with or endorsed by Catan Studio. Arcade uses its own name, visuals, code, public labels, and model-facing vocabulary; the mechanical reference remains useful to people who already know that family of games.</p><p>Two to four players settle a randomized island, collect five kinds of resources, connect roads, trade, buy development cards, and race to 10 victory points. For comparison with the established tabletop rules, see the official <a href="https://www.catan.com/sites/default/files/2021-06/catan_base_rules_2020_200707.pdf" rel="noreferrer" target="_blank">Catan base-game rules</a>.</p><Note>When the external rules and Arcade behavior differ, <code>IslandersState</code> is authoritative for Arcade. The legal-action tests protect exact turn, trade, award, and replay semantics.</Note></>,
      },
      {
        heading: 'Setup, production, and winning',
        body: <><Api rows={[
          ['Board', 'Nineteen terrain hexes receive resource types and number tokens; the desert produces nothing and begins with the robber. Nine coastal harbors provide specialized 2:1 or generic 3:1 trade access.'],
          ['Initial placement', 'Players place one settlement and adjacent road in seating order, then a second pair in reverse order. Resources adjacent to the second settlement seed that player’s hand.'],
          ['Production', 'A normal turn begins with two dice. Every unblocked matching hex pays adjacent settlements one resource and cities two, limited by the shared bank.'],
          ['Building costs', 'Road: brick + lumber. Settlement: brick + lumber + wool + grain. City: three ore + two grain. Development card: ore + wool + grain.'],
          ['Placement', 'Settlements require an empty node at least two edges from another building and a connection to the player’s road after setup. Cities upgrade the player’s own settlement. Roads extend from the player’s network unless blocked by an opponent building.'],
          ['Victory', 'Settlements are 1 VP; cities 2 VP. Longest Road and Largest Army are 2 VP each. Hidden victory-point cards count for their owner. A player wins at 10 on their own turn.'],
        ]} /></>,
      },
      {
        heading: 'Robber, development cards, and trade',
        body: <><Api rows={[
          ['Rolled 7', 'Players above seven resource cards discard half, rounded down, in seating order. The turn owner then moves the robber and may steal one random resource from an adjacent opponent. No terrain produces.'],
          ['Knight', 'Move the robber and optionally steal. Three played knights can claim Largest Army; a development card bought this turn cannot be played immediately.'],
          ['Road Building', 'Place up to two legal roads without paying their normal cost.'],
          ['Year of Plenty / Monopoly', 'Take two available bank resources, or name one resource and collect all copies held by opponents.'],
          ['Maritime trade', 'The bank rate is 4:1. A generic harbor improves it to 3:1; the matching resource harbor gives 2:1. Bulk trades are represented as one replayable action.'],
          ['Domestic trade', 'The active player proposes an exact give/receive bundle. Other seats may accept, reject, or counter; the offerer confirms one partner or cancels. Offers are first-class actions, not chat side effects.'],
        ]} /><p>The rules layer models interrupting decisions as prompts. A rolled seven can temporarily transfer action authority to several discarding opponents before returning it to the turn owner for the robber move.</p><Code title="Prompt state machine">{`initialSettlement → initialRoad → … → roll
roll 7 → discard* → moveRobber → playTurn
normal roll → production → playTurn
offerTrade → respondTrade* → decideAcceptees → playTurn
playTurn → build | trade | development card | endTurn`}</Code><Source path="src/rules/islanders/types.ts" /><Source path="src/rules/islanders/islanders.ts" /></>,
      },
      {
        heading: 'The island is generated, not imported',
        body: <><p>Islanders demonstrates building a complete 3D world from TypeScript geometry. Axial hex coordinates map rules topology to world positions. Terrain builders combine flat-shaded faces, ridges, foliage, crops, ore, dunes, and animated details. Roads, settlements, cities, the robber, dice, water, coast, piers, boats, cargo, and harbors are separate meshes composed by the scene.</p><Api rows={[
          ['Topology', 'Canonical hex, node, and edge IDs live with the rules. Visual helpers map those IDs to world coordinates without redefining adjacency.'],
          ['Deterministic variety', 'Seeded hashes vary terrain details and port cargo while keeping a board reproducible for snapshots and replay.'],
          ['Coast and water', 'A continuous sandy apron follows the outer edge ring. Traveling wave fields drive surf and swash around the island rather than outlining every tile.'],
          ['Living terrain', 'Wind and time animate crop fields, trees, and wool-producing sheep while the authoritative tile and token remain unchanged.'],
        ]} /><Source path="src/game-visuals/islanders/tiles/index.ts" /><Source path="src/game-visuals/islanders/coast.ts" /><Source path="src/game-visuals/islanders/board.ts" /><Source path="src/game-visuals/islanders/port/index.ts" /></>,
      },
      {
        heading: 'Assembly and action choreography',
        body: <><p>The setup cinematic is data, not a hand-authored frame sequence. Nineteen tiles hop from a stack into topology order, the coast grows around them, and nine harbors arrive in staggered poses. The same pattern drives dice and robber motion.</p><Code title="TypeScript">{`const tileProgress = islandersTilePlacementProgress(elapsed, tileIndex)
const coastProgress = islandersCoastProgress(elapsed)
const harborProgress = islandersHarborProgress(elapsed, harborIndex)

const dice = cinematicDiceState(progress)
const robber = robberFlightPoint(from, to, moveProgress)`}</Code><p>Rules outcomes supply dice values and stolen resources; choreography supplies only positions, timing, and camera-friendly phases. This separation keeps snapshots deterministic and prevents an animation from becoming a second game state.</p><Source path="src/game-visuals/islanders/setup-choreography.ts" /><Source path="src/game-visuals/islanders/dice-choreography.ts" /><Source path="src/game-visuals/islanders/robber-motion.ts" /></>,
      },
      {
        heading: 'What an Islanders model sees',
        body: <><p>Each seat receives its own exact resources, development cards, actual and public VP, production portfolio, ports, and remaining pieces. Opponents are summarized by public VP, total resource-card count, hidden development-card count, played knights, and road length—never exact hand contents. The observation also includes every public hex, building, road, award, recent turn, trade history, and current role.</p><Code title="Model context (abridged)">{`YOU ARE: model-a.
PLAYER REQUIRED TO ACT NOW: model-a (YOU).
Your hand: … Your development cards: …
Opponents: model-b: 4 public VP, 6 resource cards, 2 hidden dev cards…
Board hexes: H0 [public hex: Amber Pasture]=pasture/6, …
Buildings: … Roads: … Awards: …
Your portfolio: production pips …; ports …; pieces left …
Legal actions (choose exactly one canonical action shown below).`}</Code><p>A separate decision context enumerates exact canonical actions and neutral option facts. During initial placement it includes resource diversity, pips, adjacent terrain and numbers, harbor access, and road expansion frontiers. The model chooses; the context does not rank choices for it.</p><Source path="src/harness/games/islanders/islanders-setup.ts" /><Source path="src/arcade/match/islanders-driver.ts" /></>,
      },
      {
        heading: 'Negotiation without leaking state',
        body: <><p>Trade mechanics and table speech are deliberately separate. The canonical action records exact bundles and responses. Public conversation can negotiate, react, or answer a directed message, but policy forbids exact private inventories, development-card identities, hidden VP, and detailed private calculations.</p><p>A communication coordinator scores moments by importance, limits monologues and reply chains, tracks who was addressed, and can require one bounded response without turning conversation into an endless agent loop. This is the pattern to copy for any social game.</p><Source path="src/harness/games/islanders/islanders-communication.ts" /><Source path="src/harness/communication/coordinator.ts" /></>,
      },
      {
        heading: 'Replay and extend the world',
        body: <><p>An <code>IslandersTranscript</code> stores the board, initial development deck, random tape, action outcomes, and every applied action. That makes random setup, rolls, draws, robber steals, builds, and trade negotiations reproducible without recording model prompts or private reasoning.</p><ul><li>Add a terrain as a procedural mesh under <code>game-visuals/islanders/tiles</code>; preserve topology IDs from rules.</li><li>Add a development card by extending the action union, legal phase, outcome/record shape, observation, and focused replay tests before adding animation.</li><li>Add a social mechanic as canonical actions first; use communication only to present or discuss those actions.</li><li>Use <code>pnpm islanders:check capture</code> and <code>pnpm islanders:check</code> to prove refactors preserve all 24 protected views.</li></ul></>,
      },
    ],
  },
];
