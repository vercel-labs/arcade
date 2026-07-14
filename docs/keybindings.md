# Keybindings

The arcade's keyboard controls, per screen. Source of truth is
[`src/arcade/shell/keybindings.ts`](../src/arcade/shell/keybindings.ts) (the command
catalog + per-mode bindings) and the layer engine in
[`src/tui/keymap.ts`](../src/tui/keymap.ts). A few screens intercept keys *before* the
keymap — those are called out below.

## How resolution works

- Keys are bound to **named commands** inside **layers**. An action is registered once
  with a stable id (e.g. `chess.toggleAI`); the same id is what an AI agent drives the
  app through (`keymap.commands()`), so a human key and an agent command hit the same
  `run`.
- Layers form a stack. **`global` is always the floor**, the current screen's layer sits
  above it, and modals push on top. The **topmost layer that binds a chord wins.**
- A **modal** layer is a search floor: keys it doesn't bind are *swallowed*.
- **Pre-keymap intercepts** (top of [`onKeyImpl`](../src/arcade/main.ts)) run first:
  **`ctrl+c` → quit (always, from any state)**; then the boot **splash** (any key skips),
  the **prism** screen (any key → menu, except `esc`), the **poker continue** gate, and
  **audio type-to-talk** (printables feed the prompt).

## Global

| Key | Action |
|---|---|
| `q` | Quit — opens a **confirm popup** (quit / cancel) |
| `ctrl+c` | Quit — **instant, no confirm**; handled before any modal/intercept can swallow it |
| `esc` | **Back one level** (context-dependent — see below) |
| `s` | Sign in / switch Vercel team |
| `?` | Show the **shortcuts** overlay for the current screen |

Render style defaults to **ascii** and changes only via the bar / ☰ menu **"mode"** button —
there is no render-style key (`c`/`l`/`a`/`m`/`j` were removed/repurposed).

## Escape = back one level

`esc` steps back exactly one level, resolved by context:

| Context | `esc` |
|---|---|
| A modal / popup is open | Close that popup |
| In a **game** (chess-game, poker) | Open the **"Return to home screen?"** confirm |
| Other non-menu screens (cards, logos, ui, audio) | → menu |
| Menu (home) | → prism |
| Prism | → **quit** (the last level) |

The game confirm ([`buildConfirmHome`](../src/arcade/shell/bars.ts)) shows **`return`** and
**`cancel`** side by side, with `return` default-focused (Enter confirms); `cancel` (or `esc`
again) stays — so a stray key can't drop a match. Routing lives in `escBack()`
([`main.ts`](../src/arcade/main.ts)).

## Per-screen

**Prism / splash** — any key → menu; `esc` → quit; `ctrl+c` → quit.

**Menu (home)** — `←`/`→` move · `enter`/`space` launch · `esc` → prism · `s` → team-switch ·
`o` → sign out.

**Chess game** (`chess` layer):

| Key | Action |
|---|---|
| `r` | Reset camera |
| `←↑↓→` | Pan camera |
| `p` | Play / pause AI |
| `h` | Toggle move history |
| `c` | Toggle chat |
| `n` | New game |
| `i` | Toggle illegal-moves mode |
| `e` | Toggle eval bar |
| `m` | Toggle the ☰ in-game menu |
| `esc` | Back one level (→ confirm) |

**Poker** (`poker`):

| Key | Action |
|---|---|
| `p` | Play / pause |
| `m` | Toggle the ☰ in-game menu |
| `c` | Toggle table-talk chat |
| `-` / `=` / `+` | Step the raise amount |
| `r` | Reset view · `←↑↓→` Pan |
| `esc` | Back one level (→ confirm) |

**No bottom bar.** Betting actions (fold / check / call / raise / all-in) are **mouse-only**.

**Poker-Test (`cards`)** *(dev)* · **Logos (`logos`)** *(dev)* · **UI (`ui`)** *(dev)* —
`r` reset · `←↑↓→` pan · `esc` → menu · bar carries mode / quit.

**Audio (`audio`)** *(dev)* — type-to-talk: printables → prompt, `enter` send, `backspace`,
`space` toggle listening, `tab` cycle model, `ctrl+v` toggle PTT/hands-free, `esc` → menu,
`←↑↓→` pan.

> Dev/debug screens (audio, ui, logos, poker-test) are slated to be gated behind a dev flag
> for the public build (AIG-127).

## Shortcuts overlay (`?`)

`?` (or a **"shortcuts"** item in the ☰ game menus) opens a popup listing the keys live on the
current screen, split into **"this screen"** and **"general"** (the global keys). `?` toggles it;
`esc` / ✕ close it. The content is **generated** from
[`keymap.activeBindings()`](../src/tui/keymap.ts) — it reads the active non-modal layers, so it's
automatically screen-specific and can never drift from the real bindings (poker shows `p`/`m`/`c`/
`±`; chess shows `h`/`n`/`i`/`e`; etc.). Rendered by
[`buildShortcuts`](../src/arcade/shell/bars.ts); snapshot it with `pnpm snapshot shortcuts [poker|chess]`.

## Modal layers (shadow everything; `esc` dismisses one level)

`confirm-home` (esc cancel / stay) · `confirm-quit` (esc cancel) · `promoting` (esc cancel) · `gameover` (esc close) ·
`setup` (esc cancel) · `swap` (esc cancel) · `teamswitch` (esc close) · `poker-notes` (esc close) ·
**`poker-menu` / `chess-menu`** (esc **or `m`** close — `m` toggles the menu) · `shortcuts` (esc
**or `?`** close). `poker-setup` is non-modal — esc closes it but camera keys + `p` fall through.

Primary actions are default-focused so modals are keyboard-completable with **Enter**:
confirm-home → *return*, game-over → *New game*, promotion → *Queen*, match setup →
*White provider*.

## Agent-only navigation (no user keys)

`nav.audio`, `nav.chessGame`, `nav.ui`, **`nav.poker`**, **`nav.cards`** let an AI
agent jump directly to a screen via `keymap.commands()`. They are intentionally **unbound** —
users navigate only via the home cover-flow (scroll + click). `nav.back` (→ menu) is likewise
an agent verb.

## Deprecated (binding removed, code retained)

| Command id | Was | Note |
|---|---|---|
| `view.cycleRenderMode` | `m` | `m` now toggles the ☰ menu; cycle still runs via the "mode" button. |

## Removed entirely

| What | Was | Note |
|---|---|---|
| `view.setColor/Luminance/Ascii` | `c` `l` `a` | Style is menu-driven; `c` reused for **chat**. |
| `view.toggleJitter` (glyph jitter) | `j` | Gone — the arcade toggle + `JITTER_TEMP` removed; the engine `jitterTemp` presenter param stays (defaults to `0`). |
| `nav.menu` command | — | Unbound exact duplicate of `nav.back`. |
| `nav.back` key | `b` | The key is gone from every layer; the command stays (agent verb). |
| `chess.pan*` / `chess.resetView` ids | — | Renamed to **`camera.*`** (shared by poker/logos/ui/cards/audio, not chess-specific). |

## Candidate changes (remaining)

1. **Poker action hotkeys.** Betting is still mouse-only. Map freed letters (e.g. `f` fold,
   plus check/call/raise/all-in) so the felt is fully keyboard-playable.
2. **Scope `s` (switch team) to the menu.** Hitting `s` mid-game drops into the Vercel team flow.

*(Done: unified `esc` = back one level with the game confirm; `ctrl+c` instant quit + `q` →
quit-confirm popup (shared `buildConfirm`); removed `nav.menu`; added agent `nav.poker`/`nav.cards`;
renamed camera commands; `?` shortcuts overlay.)*
