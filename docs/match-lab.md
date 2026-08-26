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

For Catan communication runs, print every speech proposal alongside Arcade's surfaced or
suppressed decision with:

```bash
pnpm match:comms -- .runs/<run>
pnpm match:comms -- --all .runs/<run> # include explicit model-chosen silence
```

Raw model attempts and commentary are diagnostic local data. Do not upload `.runs/` or
feed it to production telemetry. A future benchmark pipeline should add explicit origin
metadata and separate leaderboard filtering first.

Catan supports `--communication=autoreply` (the compatibility default: a public line
after every model action) and `--communication=ambient` (host-policy gating with explicit
silence). The mode and local communication decisions are persisted in the run trace;
the final Catan checkpoint summarizes overall, direct-response, domestic-trade, and
routine roll/end speech rates plus average message length. Production telemetry still
receives no chat, prompts, or private reasoning.

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
