# Arcade telemetry proxy

The public `@vercel/arcade` CLI ships **no credentials**. It POSTs anonymous gameplay
telemetry to this proxy, which is the trust boundary: it validates every record, re-checks
the privacy boundary server-side, rate-limits, and forwards to Tinybird holding the only
credential (a resource-scoped append token in the proxy's env — never in any client).

```
arcade CLI (no keys) → this proxy → Tinybird Events API (Vercel_AI workspace)
```

## Routes

One trusted record kind per route — the route decides the type, never the client body.

| Route | Record kind | Tinybird datasource | Source |
| -- | -- | -- | -- |
| `POST /v1/events` | product/session events | `arcade_events_v1` | fire-and-forget |
| `POST /v1/matches` | canonical chess/poker match records | `arcade_match_records_v1` | durable outbox |
| `POST /v1/poker-hands` | complete poker hand records | `arcade_poker_hand_records_v1` | durable outbox |

Body is NDJSON (one JSON object per line; the client posts one row today). The sink forwards
a request's rows as a single Events-API call with `wait=true`, and treats any
`quarantined_rows > 0` (schema drift) as a failure so the client keeps the record queued.

## Responses

- `200` — accepted and durably committed to Tinybird (the client deletes the record).
- `400` — invalid shape, mismatched record type, or a privacy-forbidden field (client drops it).
- `403` — the client IP is blocklisted.
- `413` — record or request over the size cap (client drops it).
- `429` — rate limited by IP or playerKey (client keeps it queued, retries later).
- `503` — Tinybird unavailable / a row was quarantined (client keeps it queued, retries later).

## Abuse protection

- Per-IP rate-limit + blocklist and a tighter per-`playerKey` limit, KV-backed
  (Upstash / Vercel-KV REST) so enforcement is shared across serverless instances; falls
  back to an in-memory backstop, and **fails open** on KV errors. The platform WAF
  rate-limit rule is the hard backstop that makes fail-open acceptable.
- IP is read from the platform-trusted `x-vercel-forwarded-for` / `x-real-ip`.
- Request/record size caps; server-side re-run of the client's privacy guard.

## Layout

- `lib/ingest.ts` — transport-agnostic core (limits → validation → sink). Fully unit-tested.
- `lib/validation.ts` — per-route validation; reuses the client's `isPrivacySafeRecord`.
- `lib/sink.ts` — `Sink` interface, `consoleSink` (local/preview default), and `createTinybirdSink`.
- `lib/rate-limit.ts` — in-memory + KV-REST limiters with a blocklist; `rateLimiterFromEnv`.
- `lib/deps.ts` — builds the sink + limiters from env (Tinybird token, KV creds).
- `lib/http.ts` — Node-style Vercel handler adapter.
- `api/v1/*.ts` — one-line route entrypoints.
- `build.mjs` — esbuild prebuild → `.vercel/output` (three functions, `maxDuration 10`).

## Deploy

Its own Vercel project, isolated from the prism (`ascii-prisms`) project. First deploy is
manual; after that it auto-deploys on push to `main` (the `ignoreCommand` above rebuilds only
when the proxy or the shared record guard changed).

Provisioning checklist (one-time):

1. **Claim the name early.** Create the Vercel project `arcade-telemetry` (Vercel Labs team)
   before the first deploy so the production hostname is reserved.
2. **Root Directory** `apps/telemetry-proxy`, and enable **"Include source files outside of
   the Root Directory in the Build Step"** — the bundle reaches `../../../src/telemetry/records.ts`.
3. **Disable Deployment Protection.** This is a public unauthenticated endpoint by design; the
   CLI posts with no credential.
4. **Env vars:** `TINYBIRD_TOKEN` (append-only, scoped to only the three `arcade_*_v1`
   datasources — never a workspace-admin token), `TINYBIRD_HOST` (the workspace region host),
   and `KV_REST_API_URL` / `KV_REST_API_TOKEN` (Upstash / Vercel-KV REST). With no
   `TINYBIRD_TOKEN` the proxy uses `consoleSink`, so local/preview runs need no credential.
5. **WAF rate-limit rule.** Add a platform WAF rate-limit rule on the project as the hard
   backstop. The KV limiter fails *open* on KV errors, so the WAF rule is what makes fail-open
   acceptable — it caps a flood even when KV is down.

## Data trust (leaderboard posture)

Because the client is open source and ships no credential, **records are forgeable** — anyone
can POST a well-formed row. Treat the datasets as **adversarial and non-authoritative**: the
proxy enforces shape, size, privacy, and rate limits, but cannot attest that a record reflects
a real game. The leaderboard that reads these tables must therefore filter at query time
(dedupe by `recordId`, sanity-bound counts, ignore implausible rows) and never present raw
per-player stats as ranked/authoritative. Trustworthy "ranked" personal stats would need
server-side identity or an HMAC the client can't hold — deliberately deferred past the private
beta.
