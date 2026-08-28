# Arcade site agent-readiness audit

Last updated: 2026-08-28

## Initial preview

- Preview: `https://vercel-arcade-198m610nj.labs.vercel.dev`
- Audit: `https://is-agentic.com/scan/vercel-arcade-198m610nj.labs.vercel.dev`
- Score: 52/100

## Actionable findings

- Advertise and negotiate Markdown content for the home page and docs.
- Add explicit “when to use” and “when not to use” guidance.
- Publish an OpenAPI description for the real installer and prism-stream endpoints.
- Version the HTTP surface and expose a truthful, read-only capability status response.
- Return structured JSON when the prism upstream fails.
- Add canonical, Open Graph, and accepted software identity metadata.
- Add project-level About, Privacy, Contact, and useful not-found guidance.

## Intentionally out of scope

Arcade is a library, CLI, game application, and documentation site—not a hosted model
execution service. The audit's remote action API, function-calling, A2A, pricing, and MCP
checks are therefore not launch requirements. We do not create fake endpoints or an MCP
server solely to improve a score. Search-engine indexing checks may also remain incomplete
until the public site has been crawled.

## First 95/100 rescan

- Preview: `https://vercel-arcade-30bn0o92l.labs.vercel.dev`
- Inspector: `https://vercel.com/vercel-labs/vercel-arcade/AGiTojDTpj4PvsiwW31bGd2yvw3J`
- Audit: `https://is-agentic.com/scan/vercel-arcade-30bn0o92l.labs.vercel.dev`
- Score: 95/100 (76.7/80 essential, 15.1/20 recommended, +3.1 bonus)

The final audit passed Markdown negotiation, structured JSON API errors, OpenAPI
discovery, metadata, trust pages, explicit usage guidance, and a versioned API surface.
Remaining failures are brand/search indexing, an Organization schema that would require
invented corporate contact/address data, and rate-limit headers for endpoints that do not
currently have an application-level quota. Those are not papered over for the score.

The homepage is server-rendered with more than 1,800 characters, an H1, and multiple H2
sections, but the scanner still labels its heading structure “flat”; this remains a partial
heuristic rather than a launch blocker.

## Final release-candidate rescan

- Preview: `https://vercel-arcade-2ks99xwmy.labs.vercel.dev`
- Inspector: `https://vercel.com/vercel-labs/vercel-arcade/DwRTdvuinMoCJRRien643hZ23BiB`
- Audit: `https://is-agentic.com/scan/vercel-arcade-2ks99xwmy.labs.vercel.dev`
- Score: 95/100 — Strong technical baseline

This rescan covers the release candidate with the live renderer and retained-TUI examples,
expanded source-backed documentation, packed-consumer smoke test, and final metadata
cleanup. It confirms that the earlier agent-readiness improvements remain present after the
browser examples and documentation expansion.

The remaining failed checks are not honest metadata-only fixes:

- brand/search indexing for the preview deployment,
- Organization JSON-LD requiring real physical contact information,
- rate-limit headers without an application-level limiter.

Partial checks include the scanner's flat-heading heuristic, transient developer-resource
indexing, API-schema/function-calling heuristics despite typed OpenAPI response schemas and
operation IDs, its deprecation-policy heuristic despite the documented
`Deprecation`/`Sunset` policy, and the absence of a live MCP server. Arcade does not publish
fabricated organization data, fake quotas, hidden keyword content, or a hollow MCP endpoint
to increase the score. A real credential-safe, rate-limited browser model-session boundary
is tracked in Linear as `AIG-706`.
