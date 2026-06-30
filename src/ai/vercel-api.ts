import type { Fetch } from './vercel-auth.ts';

// Thin Vercel REST client for the two calls the arcade needs after login: list
// the user's teams, and mint an AI Gateway key scoped + billed to a chosen team.
// Every call authorizes with the OAuth access token as a Bearer credential.

const API_BASE = 'https://api.vercel.com';

export interface Team {
  id: string;
  slug: string;
  name: string;
}

export interface VercelUser {
  username: string;
  email?: string;
}

// The teams the signed-in user belongs to. Personal (team-less) accounts are not
// returned here and cannot own a gateway key — the caller surfaces that.
export async function listTeams(token: string, fetchImpl: Fetch = fetch): Promise<Team[]> {
  const res = await fetchImpl(`${API_BASE}/v2/teams?limit=100`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(await apiError(res, 'list teams'));
  const body = (await res.json()) as { teams?: Array<{ id: string; slug: string; name?: string }> };
  return (body.teams ?? []).map((t) => ({ id: t.id, slug: t.slug, name: t.name || t.slug }));
}

// Best-effort identity for a friendly "Signed in as …" line. Never throws — a
// failure just means we skip the greeting.
export async function getUser(token: string, fetchImpl: Fetch = fetch): Promise<VercelUser | null> {
  try {
    const res = await fetchImpl(`${API_BASE}/v2/user`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: { username?: string; email?: string } };
    return body.user?.username ? { username: body.user.username, email: body.user.email } : null;
  } catch {
    return null;
  }
}

// Mint (or, with `exchange: true`, get-or-create) an AI Gateway API key for the
// team. `exchange` makes this idempotent — one key per (token × team × purpose)
// — so re-running on each launch reuses the same key rather than piling up new
// ones. Billing follows `teamId`. Returns the key string (only ever returned
// here; it can't be read back later).
export async function createGatewayKey(token: string, teamId: string, name: string, fetchImpl: Fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${API_BASE}/v1/api-keys?teamId=${encodeURIComponent(teamId)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ purpose: 'ai-gateway', name, exchange: true }),
  });
  if (!res.ok) throw new Error(await apiError(res, 'create AI Gateway key'));
  const body = (await res.json()) as { apiKeyString?: string };
  if (!body.apiKeyString) throw new Error('AI Gateway key response had no key.');
  return body.apiKeyString;
}

async function apiError(res: Response, action: string): Promise<string> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? '');
  } catch {
    // non-JSON body — fall back to the status
  }
  return `Could not ${action} (HTTP ${res.status})${detail ? `: ${detail}` : ''}.`;
}
