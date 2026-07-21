# Arcade telemetry proxy

The public `@vercel/arcade` CLI ships **no credentials**. It POSTs anonymous gameplay
telemetry to this proxy, which is the trust boundary: it validates every record, re-checks
the privacy boundary server-side, rate-limits, and forwards to the storage backend holding
the only credential (via Vercel OIDC — never a static key in any client).

```
arcade CLI (no keys) → this proxy → api-o11y-ingestion (VDP) → ClickHouse
                                     [fallback: direct ClickHouse insert]
```

## Routes

One trusted record kind per route — the route decides the type, never the client body.

| Route | Record kind | Source |
| -- | -- | -- |
| `POST /v1/events` | product/session events | fire-and-forget |
| `POST /v1/matches` | canonical chess/poker match records | durable outbox |
| `POST /v1/poker-hands` | complete poker hand records | durable outbox |

Body is NDJSON (one JSON object per line; the client posts one row today).

## Responses

- `200` — accepted and the downstream write was acknowledged (the client deletes the record).
- `400` — invalid shape, mismatched record type, or a privacy-forbidden field (client drops it).
- `413` — record or request over the size cap (client drops it).
- `429` — rate limited (client keeps it queued, retries later).
- `503` — downstream unavailable (client keeps it queued, retries later).

## Layout

- `lib/ingest.ts` — transport-agnostic core (limits → validation → sink). Fully unit-tested.
- `lib/validation.ts` — per-route validation; reuses the client's `isPrivacySafeRecord`.
- `lib/sink.ts` — the downstream interface; `consoleSink` is the local/preview default.
- `lib/rate-limit.ts` — per-instance fixed-window limiter.
- `lib/http.ts` — Node-style Vercel handler adapter.
- `api/v1/*.ts` — one-line route entrypoints.

## Status

Backend wiring (the real `api-o11y-ingestion` sink, OIDC auth, and the Vercel project /
build config) is provisioned in a later step; the default `consoleSink` makes the proxy
runnable and testable on its own until then.
