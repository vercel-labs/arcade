# Private-beta model allowlist

> **Status: fallback only.** A signed-in launch fetches the team's own catalog from
> `/v1/models?include_availability` (`src/arcade/match/team-model-catalog.ts`) and hides
> only the rows Gateway marks durably ineligible for that team. The allowlist below is
> reached only when that fetch is unavailable (signed out, offline, error), and it is a
> frozen snapshot of the AIG-183 audit; the regeneration recipe further down is historical.
> Default seats come from `src/arcade/match/default-seats.ts`, resolved against whichever
> catalog is in use.

The match-setup picker (chess + poker) offers a curated set of models for the
private beta rather than the full ~200-model catalog. This keeps a beta user's
first pick from landing on a model that can't play — provider-restricted,
timed out, or unreliable at producing a legal move.

## What's in it

`src/arcade/match/beta-allowlist.ts` exports `BETA_MODEL_ALLOWLIST`, built in two
layers:

- **`AUDITED`** — generated from the first-hand compatibility audit
  (`docs/model-compat.vercel-internal-playground.json`, from AIG-183). Every
  entry played **both chess and poker via native structured output** on the
  internal-playground team. Currently **105** models.
- **`EXCLUDED`** — models that pass the audit but are held back for another
  reason (hand-maintained; survives regeneration). Currently: `openai/gpt-5.5-pro`
  (a reasoning "pro" model whose poker moves exceed the move-time budget — it
  times out / is unacceptably slow in play).

Net allowlist: **104** models.

**Exclude-first policy.** For the beta we ship only models that pass cleanly.
Text / normalizer-fallback models (they play, but via a lower rung of the
`ModelPlayer` fallback ladder) and provider-restricted / timeout / error models
are omitted for now and revisited as the text-output fallback improves. A
selected model still runs the full fallback ladder; the allowlist only governs
what the picker *offers*.

## Speed: keep-but-warn, don't exclude

Passing the audit (STRUCTURED) is necessary but not sufficient — some models
answer correctly but slowly. Policy: **exclude only models that time out**
(broken move → random fallback); models that are merely slow are **kept** (faithful
to the gateway) and flagged with a dim `slow` hint next to them in the picker.

`SLOW_MODELS` in `beta-allowlist.ts` drives that hint. Chess is uniformly fast
(median-of-3 max ~13s); **poker is the bottleneck**, so the set is poker-based.

**Single-run latency is noisy** — a model can measure 21s one run and 2s the next
(server load / cold starts). So `SLOW_MODELS` is classified by the **median of 3
audit runs**, threshold poker ≥ 30s. Current set: kimi-k2.6 (~61s), seed-1.6,
seed-1.8, qwen3-next-80b-a3b-thinking, o3-pro. (Lowering to ≥20s would add
gpt-5.2-pro, gpt-5-nano, minimax-m2.5, gpt-5, gemini-2.5-pro.)

Eyeball one run's latency with the report's timing view (single-team only — the
per-game summary shows median / slowest / count ≥20s, and each cell is coloured
green <10s / yellow 10–20s / red ≥20s, with a `slow` tag):

```bash
pnpm models:report --team=vercel-internal-playground --sort=slow
```

To re-derive `SLOW_MODELS`, run the audit three times to separate dirs and take
the **median** poker `ms` per model:

```bash
for d in a b c; do pnpm models:audit allowlist --team=vercel-internal-playground --out=/tmp/run-$d; done
node -e '
const F="/model-compat.vercel-internal-playground.json";
const [a,b,c]=["a","b","c"].map(d=>require("/tmp/run-"+d+F).models);
const med=x=>x.slice().sort((m,n)=>m-n)[1];
const at=(rows,id,g)=>rows.find(r=>r.id===id)?.[g]?.ms??0;
const ids=a.map(r=>r.id);
const slow=ids.map(id=>[id,med([a,b,c].map(rs=>at(rs,id,"poker")))]).filter(([,m])=>m>=30000).sort((x,y)=>y[1]-x[1]);
for(const [id,m] of slow) console.log((m/1000).toFixed(1)+"s", id);
'
```

Then update the `SLOW_MODELS` set by hand (it is a curated judgement, not auto-generated).

## Team assumption

Derived for the **internal-playground** team — the team beta users authenticate
with. That team's provider allowlist gates ~80 catalog models, so the reachable
set differs on other teams. This static list is an interim stand-in for a **live
per-team availability signal** (AIG-105 in Arcade, backed by the `/v1/models`
availability work in AIG-187), which will replace it.

## How it's wired

`src/arcade/match/models.ts`:

- `creators()` / `modelsFor()` — the **full** catalog (minus fully-unsupported
  creators). Used by the audit/probe tools and direct lookups.
- `pickerCreators()` / `pickerModelsFor()` — the allowlisted subset. Used by the
  chess and poker setup pickers.

**Escape hatch:** `ARCADE_ALL_MODELS=1` makes the picker offer the full catalog
(local dev, or playing on a different team).

## Regenerating

After a fresh audit of the target team, re-verify and regenerate:

```bash
# 1. Re-run the audit for the current allowlist (or `all`) on the beta team:
pnpm models:audit allowlist --team=vercel-internal-playground

# 2. Regenerate the AUDITED array from the full report (EXCLUDED is preserved):
node -e '
const fs=require("fs");
const d=require("./docs/model-compat.vercel-internal-playground.json");
const ok=r=>r.chess?.status==="STRUCTURED"&&r.poker?.status==="STRUCTURED"&&r.chess?.structured==="yes"&&r.poker?.structured==="yes";
const ids=d.models.filter(ok).map(r=>r.id).sort();
const body=ids.map(id=>`  ${JSON.stringify(id)},`).join("\n");
const f="src/arcade/match/beta-allowlist.ts";
fs.writeFileSync(f, fs.readFileSync(f,"utf8").replace(/const AUDITED: readonly string\[\] = \[[\s\S]*?\];/, `const AUDITED: readonly string[] = [\n${body}\n];`));
console.log("updated AUDITED:", ids.length);
'
```

Then `pnpm type-check && pnpm test`. To widen the criteria later (e.g. include
text-fallback models once that path is solid), relax the `ok` predicate; to drop
sluggish models, add them to `EXCLUDED`.
