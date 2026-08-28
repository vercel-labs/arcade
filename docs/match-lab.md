# AI match lab

`pnpm match:run` runs real spectate-AI matches without a TTY. It uses the same rules,
model action parser, normalizer, and canonical Chess/Poker recorders as Arcade. Catan
runs from its replayable rules transcript. Telemetry is forcibly disabled; every artifact
stays under `.runs/` unless `--output` points elsewhere.

```bash
pnpm match:run -- --game chess \
  --models=openai/gpt-5.4-nano,anthropic/claude-haiku-4.5 \
  --games=4 --concurrency=2 --swap-seats

pnpm match:run -- --game catan --games=2 --concurrency=2 --setup-only

pnpm match:run -- --game poker \
  --models=xai/grok-4.1-fast-non-reasoning,anthropic/claude-haiku-4.5,openai/gpt-5.4-nano,google/gemini-2.5-flash \
  --games=2 --concurrency=2 --starting-chips=1000 --max-hands=20
```

The command reuses Arcade's cached Vercel login and selected AI Gateway team. Run
`pnpm dev --login` once if no cached team exists.

## Artifacts

Each run writes:

- `manifest.json`: exact models, bounds, seeds, concurrency, and git commit
- `events.jsonl`: merged chronological diagnostic stream
- `matches/<id>/trace.jsonl`: one match's decisions, actions, checkpoints, and errors
- `matches/<id>/result.json`: concise outcome plus final state
- `matches/<id>/canonical.json`: canonical Chess/Poker records or the replayable Catan transcript
- `summary.json`: aggregate completion, action, winner, and per-model counts
- `errors.jsonl`: failures only

The files are written while matches run, so a second terminal can inspect progress with
`tail -f .runs/<run>/events.jsonl` or a single match with
`tail -f .runs/<run>/matches/0001/trace.jsonl`.

For ambient communication runs, print every speech proposal alongside Arcade's surfaced or
suppressed decision with:

```bash
pnpm match:comms -- .runs/<run>
pnpm match:comms -- --all .runs/<run> # include explicit model-chosen silence
```

Raw model attempts and commentary are diagnostic local data. Do not upload `.runs/` or
feed it to production telemetry. A future benchmark pipeline should add explicit origin
metadata and separate leaderboard filtering first.

All three games accept `--communication=autoreply` or `--communication=ambient`.
Autoreply is the compatibility default and preserves each game's previous public-line
behavior. Ambient uses structured speech proposals plus Arcade host-policy gating and
explicit silence. Catan additionally detects notable game moments and may invite one
affected player to react. The mode and local decisions are persisted in the run trace;
final checkpoints include communication rates where ambient coordination is active.
Production telemetry still receives no chat, prompts, or private reasoning.

## Reproduction and bounds

Rules randomness derives from `--seed`; each match gets a stable derived seed. Model
responses are still external and are not guaranteed deterministic. `--swap-seats` rotates
the model list each match to reduce seat bias. Parallelism is match-level only: turns in
one game remain sequential.

Catan accepts two through four models in the lab. Two-player tables are useful for
testing even though the published base game is normally presented for three or four.

Use `--timeout`, `--max-plies`, `--max-actions`, and `--max-hands` to bound costly runs.
Start at concurrency 1–2 to avoid provider rate limits. `Ctrl-C` aborts in-flight model
calls and leaves completed match artifacts intact.

Poker starts each player with the live Arcade defaults of 1,000 chips and 10/20 blinds,
which increase every 15 completed hands. Override these with `--starting-chips=N`,
`--small-blind=N`, `--big-blind=N`, or `--hands-per-level=N`; the selected values are
stored in the manifest. Set `--max-hands=1`
for one hand, choose any larger N for a bounded session, or use generous hand/action/time
bounds to let a tournament end naturally when only one player has chips.

## Team-wide model game audit

`pnpm models:game-audit` combines the live, team-aware model catalog with the match-lab
adapters. Each target model sits in seat 1 against one stable opponent and must produce
an attributable legal action through Arcade's real `ModelPlayer` ladder:

- Chess: White's first move, followed by one opponent reply.
- Poker: one complete heads-up hand.
- Catan: the target's first settlement and road during initial placement.

```bash
# Inspect the size first; makes no model calls.
pnpm models:game-audit -- --dry-run

# Audit every team-visible text model across all three games.
pnpm models:game-audit -- --concurrency=3

# Cheaper targeted passes while developing.
pnpm models:game-audit -- --games=chess,poker --creator=anthropic
pnpm models:game-audit -- --models=openai/gpt-5.4-nano,anthropic/claude-haiku-4.5
```

The command retries only soft failures serially and classifies the target as
`STRUCTURED`, `TEXT`, `NORMALIZED`, `FALLBACK`, `ACCESS`, `TIMEOUT`, `ERROR`, or
`NO_ACTION`. A completed scenario does not count as compatible if Arcade advanced it
through a random fallback. Results live under `.runs/` with the normal match traces plus
per-scenario `audit.json`, an aggregate `summary.json`, and `report.md`. The live run
requires Gateway availability annotations by default; `--allow-fallback-catalog` must be
explicit when intentionally auditing the baked catalog.
