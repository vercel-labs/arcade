# Arcade telemetry (Tinybird)

Anonymous, opt-out usage counts for the Arcade CLI. The client is
[`src/telemetry/index.ts`](../src/telemetry/index.ts) — a ~40-line fire-and-forget POST to
a [Tinybird Events API](https://www.tinybird.co/docs/get-data-in/ingest-apis/events-api)
datasource. No pipeline, no `vercel/api` PR, no infra in this repo.

**The data lives on Tinybird's cloud, not here.** This directory only holds the client
(in `src/`), the reference schema (`arcade_events.datasource`), and this doc. Think of it
like any hosted database: the DB is elsewhere; the repo just talks to it.

## What's collected

Counts and outcomes only — never prompts, board positions, or hole cards.

| event | fields | why |
|---|---|---|
| `session_start` | colorMode, authed, cols, rows, node | launches, terminal capability |
| `match_started` | game, mode, models[], humans, stack | which models get picked |
| `match_ended` | game, mode, models[], winner | chess results (win/loss/draw by model) |
| `hand_ended` | game, winners[], pot | poker results per hand |
| `model_fallback` | game, model, reason | which models can't produce a legal move |

Every event also carries `session` (random per run), `install` (a random anonymous id
persisted at `~/.config/arcade/telemetry.json`), `env` (`dev` when `ARCADE_DEV=1`, else
`prod`), `version`, and `ts`. This is the same data the leaderboard needs — start it now,
graduate it later.

## One-time setup

1. **Create a workspace** at [tinybird.co](https://www.tinybird.co) (or reuse one). Note
   its region — the ingest host must match. US East → `https://api.us-east.tinybird.co`.
2. **(Optional) pin the schema.** The Events API auto-creates `arcade_events` on the first
   event, inferring columns. To enforce types + sorting instead, install the
   [Tinybird CLI](https://www.tinybird.co/docs/cli), `tb auth` into the workspace, and
   `tb push tinybird/arcade_events.datasource`.
3. **Mint a scoped, append-only token.** In the Tinybird UI → Tokens → create a token
   scoped to `DATASOURCES:APPEND` on `arcade_events` only. **Not** an admin or read token —
   this one ships in the client, so it must only be able to append to this one datasource.
4. **Give it to the client** via `ARCADE_TELEMETRY_TOKEN`. Set `ARCADE_TELEMETRY_ENDPOINT`
   too if the workspace isn't US East (full URL incl. `?name=arcade_events`).

```bash
# local dev
ARCADE_TELEMETRY_TOKEN=p.xxxxx pnpm dev
```

## Enabling it in the published `npx` build

A distributed CLI can't read a shell env var on someone else's machine, so pick one:

- **Bake the append-only token** as the default in `src/telemetry/index.ts`. Acceptable
  for this internal, `restricted` package because the token can only append to
  `arcade_events` — it grants no read access and no blast radius. (Secret scanners will
  flag a committed `p.` token; that's the tradeoff.)
- **Proxy it (hardening).** Stand up a tiny function that holds the token server-side and
  forwards to Tinybird, then point `ARCADE_TELEMETRY_ENDPOINT` at it. No secret in the
  client at all. Do this if/when the beta widens.

Either way, `ARCADE_TELEMETRY=0` (or `off`/`false`/`no`) opts a user out entirely, and the
first enabled run prints a one-line notice.

## Reading the data

Build a Tinybird Pipe over `arcade_events` and publish it as an endpoint. Example — wins
by model in chess:

```sql
SELECT winner AS model, count() AS wins
FROM arcade_events
WHERE event = 'match_ended' AND game = 'chess' AND env = 'prod' AND winner != 'draw'
GROUP BY model ORDER BY wins DESC
```

`models`/`winners` are stored as JSON-array strings — use `JSONExtractArrayRaw` /
`arrayJoin` to unpack when querying by participant.
