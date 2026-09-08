import { APICallError } from 'ai';

// Why a model failed to answer, distilled from the messy error a Gateway/provider
// throws. The AI Gateway wraps the provider's real HTTP error as `.cause` (a
// GatewayInternalServerError carrying an APICallError cause carrying the JSON body),
// so a single `instanceof` or top-level `.message` check misses the actual signal —
// this walks the whole cause chain. Shared by `ModelPlayer` (to route the fallback)
// and `src/tools/model-probe.ts` (to report it). See AIG-181/AIG-183.
export type FailureKind =
  | 'billing'
  | 'quota'
  | 'authentication'
  | 'model'
  // The team/key can't reach this provider at all (403 / no_providers_available).
  // A text retry hits the SAME provider and fails identically — don't bother.
  | 'access'
  // The provider ran the model but couldn't produce the requested JSON schema
  // ("responseFormat not supported", "No object generated"). The model itself may
  // answer fine in prose — the plain-text soft-parse fallback is worth trying.
  | 'schema'
  // Deadline hit (per-model timeout) or the decision was cancelled.
  | 'timeout'
  // Provider hiccup that a retry might clear (5xx, rate limit, overloaded, network).
  | 'transient'
  // Anything we can't place — treated like 'schema' by the fallback (try text).
  | 'unknown';

export interface ClassifiedError {
  kind: FailureKind;
  /** HTTP status if the chain exposed one (e.g. 403). */
  status?: number;
  /** The Gateway error `type` from the JSON body (e.g. "no_providers_available"). */
  gatewayType?: string;
  /** True when the failure came from a Gateway HTTP response, not model output parsing. */
  gatewayFailure: boolean;
  /** A compact, single-line, credential-free description for logs/reports. */
  message: string;
}

const compact = (s: string): string => s.replace(/\s+/g, ' ').trim();

// Defensive: strip anything shaped like an API key/token so a future provider that
// echoes request headers into an error body can't leak a credential into a log.
const redact = (s: string): string =>
  s.replace(/\b(?:vck|sk|key|bearer|token)[-_ ]?[A-Za-z0-9._-]{12,}\b/gi, '<redacted>');

// The error plus every nested error it points at, deduped and capped so a
// self-referential graph can't loop. Errors nest two different ways here, and
// missing either one loses the only copy of the status/type:
//   `.cause`                  — the Gateway wraps the provider's APICallError.
//   `.lastError` / `.errors[]` — the AI SDK's RetryError keeps the attempts it gave
//     up on here and leaves `.cause` null. A rate limit arrives this way (the SDK
//     retries a 429 before surfacing it), so walking only `.cause` sees a bare
//     "Failed after 3 attempts" summary with no statusCode and no gateway type.
function chain(e: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [e];
  while (queue.length && out.length < 12) {
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur as Record<string, unknown>);
    const n = cur as { cause?: unknown; lastError?: unknown; errors?: unknown };
    queue.push(n.cause, n.lastError);
    if (Array.isArray(n.errors)) queue.push(...n.errors);
  }
  return out;
}

export function classifyModelError(e: unknown): ClassifiedError {
  const nodes = chain(e);
  const top = nodes[0] ?? {};
  const name = String(top.name ?? '');
  const topMsg = redact(compact(String((top.message as string) ?? (typeof e === 'string' ? e : '') ?? '')));

  // The gateway wraps the provider's APICallError as a cause, so status + body can
  // live several levels down. Take the first of each found while walking the chain.
  let status: number | undefined;
  let body = '';
  for (const n of nodes) {
    if (status === undefined && typeof n.statusCode === 'number') status = n.statusCode as number;
    const b = (n.responseBody as string) ?? (APICallError.isInstance(n) ? (n as { responseBody?: string }).responseBody : undefined);
    if (!body && typeof b === 'string' && b) body = b;
  }
  // @ai-sdk/gateway typed errors expose the canonical Gateway reason directly
  // on `.type`; older/wrapped APICallErrors retain it only in responseBody JSON.
  // Prefer the typed surface, then fill from the raw response when available.
  const typedGatewayType = nodes
    .map((node) => node.type)
    .find((type): type is string => typeof type === 'string' && type.length > 0);
  let bodyGatewayType: string | undefined;
  if (body) {
    try {
      bodyGatewayType = (JSON.parse(body) as { error?: { type?: string } })?.error?.type;
    } catch {
      /* body wasn't JSON — leave gatewayType undefined */
    }
  }
  // Generic SDK wrapper classes intentionally collapse newer Gateway types to
  // internal_server_error/response_error while preserving the specific server
  // reason in the nested response body. Prefer that specific reason when present.
  const gatewayType = bodyGatewayType ?? typedGatewayType;
  const detail = redact(compact(`${topMsg} ${body}`));
  const haystack = `${name} ${detail} ${gatewayType ?? ''}`;
  const message = topMsg || redact(compact(body)) || String(e);
  const result = (kind: FailureKind): ClassifiedError => ({ kind, status, gatewayType, gatewayFailure: status !== undefined || gatewayType !== undefined, message });

  // Cancellation / deadline first: an aborted call names itself, regardless of status.
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(name)) {
    return { ...result('timeout'), message: message || 'timed out' };
  }
  if (gatewayType === 'insufficient_funds' || gatewayType === 'customer_verification_required' || gatewayType === 'byok_requires_paid_credits') return result('billing');
  if (gatewayType === 'quota_for_entity_exceeded') return result('quota');
  if (status === 401 || gatewayType === 'authentication_error') return result('authentication');
  if (gatewayType === 'model_not_found' || gatewayType === 'model_unavailable_in_region') return result('model');
  // Rate limiting is decided before the access prose below, and on the authoritative
  // signals only. The Gateway's own free-tier rate-limit copy ends "...for unrestricted
  // access", which the access regex would otherwise claim as a permissions failure.
  if (status === 429 || gatewayType === 'rate_limit_exceeded') return result('transient');
  // Access / provider availability: the defining signals are HTTP 403 and the
  // gateway type `no_providers_available`; the prose is a fallback for older bodies.
  // `\brestricted` keeps "unrestricted" from matching "restricted access".
  if (status === 403 || gatewayType === 'no_providers_available' || /\brestricted access|no_providers_available|not authorized|access profile|forbidden/i.test(haystack)) {
    return result('access');
  }
  // Structured-output / schema: the model ran but couldn't emit the JSON schema.
  if (/Object/.test(name) || /could not parse the response|response did not match schema|responseformat|structuredoutputs|json_object|jsonparse|no object generated/i.test(haystack)) {
    return result('schema');
  }
  // Transient serving failures: 5xx or the usual retryable prose.
  if ((status !== undefined && status >= 500) || /rate.?limit|overloaded|temporarily|service unavailable|econnreset|etimedout|network error/i.test(haystack)) {
    return result('transient');
  }
  return result('unknown');
}
