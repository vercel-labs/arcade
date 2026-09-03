# The tutorial

An interactive walkthrough launched from its own cover on the home screen. It runs on the
real game screens — the chess board, the poker table, the island — with a
guide panel docked on the right edge. Each chapter is a checklist: the panel watches the
app for the things it asked you to do and ticks them off as they happen, and the control it
wants you to reach for pulses gently until you do. A chapter advances only once every step
is green (or you skip it).

Source: `src/arcade/tutorial/` — `chapters.ts` (the content, pure data) and `tutorial.ts`
(the controller + the panel builder). The offline practice bots are the `bot` seat kind on
each driver (`match/poker-driver.ts`, `match/islanders-driver.ts`), built on
`harness/policy-player.ts`. `main.ts` wires the panel into the shell, routes signals, and
stages each chapter's screen.

## Shape

- **Cover**: `Tutorial`, right after the three games in the cover flow. Art is the Noto
  🎓 graduation cap, baked by `src/tools/fetch-games.ts` like every other cover.
- **Launch**: the usual cover flip, then the Welcome chapter opens on the chess board.
- **Panel**: a 36-column rail on the right. The scene viewport and every game HUD are
  inset by that width (the same mechanism the chat rails use), so nothing is covered.
  Header: `tutorial · 3 of 8` and a ✕ (exit). Chapter dots. Chapter title + one or two
  lines of intro. The checklist (✓ green done · ▸ current · ○ pending). A hint for the
  current step. Footer: `‹ back` (previous chapter, fresh checklist) and `skip chapter ›`.
  When every step is done the list turns green and a `continue →` button pulses; nothing
  advances on its own. The rail's fill sits a shade above the games' own sidebars so the two
  read as neighbours, not one slab.
- **Attention pulse**: a core TUI addition — `Style.pulse` / `Screen.setAttention(ids)`
  breathes a node's resting colors toward a target on a slow sine (filled pills pulse
  their background; outlined buttons their border + label). Hover/focus/pressed still win.
  The tutorial pulses the current step's target control(s), wherever they were built.
- **Exit**: the panel ✕, or the closing chapter's `end tutorial`, returns to the home screen. Esc keeps its
  normal meaning (inside a game it asks "return to home screen?" — confirming exits the
  tutorial too). Any route home (☰ home, quit) ends the tutorial.
- **Offline by default**: no model calls. Poker and Islanders chapters seat you against
  local practice bots (`{ kind: 'bot' }` seats, a new kind on both drivers); telemetry is
  not recorded for those games. The poker bots say one in-character line per action and
  a grey system line explains the table, so the chat thread fills like a model table's; each
  bot's notebook opens with sample notes on the other seats, so the notes pill has content.
  Clicking a poker bot's flame still opens the model picker and seats a real model in its place.

## Chapters

Signals are the event names the controller listens for; the app emits them from the
places the real feature fires (so detection can't drift from behavior).

| # | Chapter | Screen | Steps (signal) |
|---|---------|--------|----------------|
| 1 | **Welcome** | chess (start position) | no checklist — what the tutorial is, how to skip/exit; `begin` |
| 2 | **Camera** | chess | scroll to zoom (`camera.zoom`) · drag to rotate (`camera.orbit`) · right-drag or shift-drag to pan (`camera.pan`) · arrow keys pan (`camera.panKey`) · `r` resets (`camera.reset`) · shrink the terminal font three times (`terminal.denser` ×3) · grow it back three times (`terminal.coarser` ×3) |
| 3 | **Menu** | chess | open ☰ / `m` (`ui.menuOpen`) · cycle through the display styles (`ui.display` ×3) · switch through the color modes (`ui.color` ×2) · turn on the eval bar (`chess.evalBar`) · open *controls* (`ui.controls`) · esc closes the menu (`ui.menuClose`) |
| 4 | **Chess** | chess | click a white piece — legal squares light up (`chess.select`) · click a lit square to move (`chess.move` / `chess.capture`) · `h` or the *moves* pill hides/shows the history (`chess.history`) · *new match* opens the model picker (`chess.setup`) · pick a side and a model, start — a real match, billed through AI Gateway, with the normal health-check popups (`chess.matchStarted`, gateway) · click a wisp to swap its model (`chess.swap`, gateway) |
| 5 | **Poker** | poker vs two bots | hover a hole card to peek (`poker.peek`) · click it to lift (`poker.lift`) · check or call (`poker.checkCall`) · size a raise (slider, chips, −/+) and bet (`poker.raise`) · fold a hand (`poker.fold`) · open chat `c` (`poker.chat`) · open reads (`poker.reads`) |
| 6 | **Keyboard** | poker (same table, still running) | `?` controls (`key.?`) · esc backs out — cancel the prompt (`key.escape`) · `d` through all three display styles (`key.d` ×3) · `m` menu (`key.m`); `q` / ctrl+c are only mentioned, since a step whose default confirm quits the app is a trap |
| 7 | **Islanders** | island vs two bots (seeded) | zoom or rotate to look around (`camera.zoom` / `camera.orbit`) · place a settlement at a tile intersection (`islanders.settlement`) · a road beside it (`islanders.road`) · finish setup — second settlement + road (`islanders.setupDone`) · roll (`islanders.roll`) · build something — your hand is stocked (`islanders.build`) · trade 4:1 with the bank from your hand (`islanders.trade`) · end your turn (`islanders.endTurn`) |
| 8 | **Done** | islanders (same game, still running) | no checklist: a closing card, with `‹ back` and `end tutorial` (returns home, like ✕) |

Steps within a chapter can be completed in any order (the checklist just ticks whatever
you did); the current step is the first unticked one, and it owns the hint and the pulse. A
step may ask for its signal several times (`count`) and shows its tally (`0/3` … `3/3`) as it goes. Steps marked
`requires: 'gateway'` (the real model match) are shown dimmed with "sign in to try this" and
left out of the chapter's arithmetic when no AI Gateway key is present. The screens are never
gated by the tutorial: every control stays live, and a match started from the chapter is a
real one — billed to the team, with the same health-check popups as anywhere else.

## Detection

- Camera gestures are signaled from the shared pointer handler (wheel / drag / right-drag)
  and from the keymap's pan/reset commands. Font size is read off the terminal's resize
  event (the emulator never forwards ⌘−/⌘+): a resize that adds cells is one `denser` step,
  one that removes cells a `coarser` step, with events within 200 ms folded into one step.
  The shortcut in the copy is chosen by platform; a window drag counts too, and says so.
- Chess exposes `onEvent` (`select` / `move` / `capture`).
- Poker: peek via `tableView().seats[0].cards`, lift via a new `heroCardLifted()`; actions
  via the HUD handlers; chat via the toggle.
- Islanders: the human's `state.actionRecords()` entries, polled each frame. The hand is
  stocked with six of each resource (`IslandersState.grantResources`, bank-conserving) once
  initial placement ends so every build and a bank trade are possible on the first turn. The
  chapter's fixed rng seed opens with a 9, never a 7, so the big hand isn't discarded first.
- Menu / display / color / controls / eval / history / setup / nav: signaled from the
  functions that perform them in `main.ts`. Keys: every key press signals `key.<name>`.

## Verification

`pnpm snapshot:png tutorial [cols] [rows] [chapter] [menu]` renders a chapter's panel over
its screen (see `docs/verifying-output.md`). Controller logic is unit-tested in
`src/arcade/tutorial/tutorial.test.ts`.
