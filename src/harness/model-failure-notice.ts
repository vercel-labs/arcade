import type { ClassifiedError } from './model-errors.ts';

export const GATEWAY_TOP_UP_URL = 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dtop-up';
export const GATEWAY_ADD_CARD_URL = 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card';
export const GATEWAY_BILLING_URL = 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fsettings%2Fbilling';

export interface ModelFailureNotice {
  code: string;
  severity: 'warning' | 'error';
  title: string;
  body: string;
  persistent: boolean;
  action?: { label: string; url: string };
}

export class NotifiedModelFailure extends Error {
  constructor(readonly notice: ModelFailureNotice) {
    super(notice.title);
    this.name = 'NotifiedModelFailure';
  }
}

export function modelFailureNotice(failure: ClassifiedError, model: string): ModelFailureNotice | null {
  // Structured-output failures are an internal recovery rung. Surface only if the
  // subsequent text/normalizer request itself fails at the Gateway boundary.
  if (failure.kind === 'schema') return null;
  switch (failure.gatewayType) {
    case 'insufficient_funds': return { code: 'insufficient_funds', severity: 'error', title: 'out of credit', body: 'buy AI Gateway credit to resume model requests.', persistent: true, action: { label: 'buy AI Gateway credit', url: GATEWAY_TOP_UP_URL } };
    case 'customer_verification_required': return { code: 'customer_verification_required', severity: 'error', title: 'payment method required', body: 'add a credit card to unlock AI Gateway requests.', persistent: true, action: { label: 'add credit card', url: GATEWAY_ADD_CARD_URL } };
    case 'byok_requires_paid_credits': return { code: 'byok_requires_paid_credits', severity: 'error', title: 'paid credit required', body: 'buy AI Gateway credit to use this model with BYOK.', persistent: true, action: { label: 'buy AI Gateway credit', url: GATEWAY_TOP_UP_URL } };
    case 'quota_for_entity_exceeded': return { code: 'quota_for_entity_exceeded', severity: 'error', title: 'AI Gateway budget reached', body: 'the team, project, or API key budget must be increased before requests resume.', persistent: true, action: { label: 'manage billing', url: GATEWAY_BILLING_URL } };
    case 'authentication_error': return { code: 'authentication_error', severity: 'error', title: 'AI Gateway authentication failed', body: 'return home and sign in again to refresh Arcade access.', persistent: true };
    case 'model_not_found': return { code: 'model_not_found', severity: 'error', title: 'model unavailable', body: `${model} was not found. choose another model.`, persistent: true };
    case 'model_unavailable_in_region': return { code: 'model_unavailable_in_region', severity: 'error', title: 'model unavailable in this region', body: `${model} cannot serve requests from this region.`, persistent: true };
    case 'rate_limit_exceeded': return { code: 'rate_limit_exceeded', severity: 'warning', title: 'rate limit reached', body: `${model} is temporarily rate limited. Arcade used a legal move.`, persistent: false };
    case 'no_providers_available': return { code: 'no_providers_available', severity: 'error', title: 'model unavailable for this team', body: `${model} could not route to an available provider. choose another model.`, persistent: true };
  }
  // Older Gateway/SDK shapes may retain only the classified kind + HTTP status.
  // Persistent account/access failures must still pause instead of becoming a
  // temporary warning followed by a random legal action.
  if (failure.kind === 'billing') return { code: 'billing_error', severity: 'error', title: 'AI Gateway billing failed', body: 'check AI Gateway billing before retrying this request.', persistent: true, action: { label: 'manage billing', url: GATEWAY_BILLING_URL } };
  if (failure.kind === 'quota') return { code: 'quota_error', severity: 'error', title: 'AI Gateway budget reached', body: 'the team, project, or API key budget must be increased before requests resume.', persistent: true, action: { label: 'manage billing', url: GATEWAY_BILLING_URL } };
  if (failure.kind === 'authentication') return { code: 'authentication_error', severity: 'error', title: 'AI Gateway authentication failed', body: 'return home and sign in again to refresh Arcade access.', persistent: true };
  if (failure.kind === 'model') return { code: 'model_error', severity: 'error', title: 'model unavailable', body: `${model} is unavailable. choose another model.`, persistent: true };
  if (failure.kind === 'access') return { code: 'access_error', severity: 'error', title: 'model unavailable for this team', body: `${model} could not be accessed by this team. choose another model.`, persistent: true };
  if (!failure.gatewayFailure && failure.kind !== 'timeout' && failure.kind !== 'transient') return null;
  if (failure.status === 429) return { code: 'rate_limit', severity: 'warning', title: 'rate limit reached', body: `${model} is temporarily rate limited. Arcade used a legal move.`, persistent: false };
  if (failure.kind === 'timeout' || failure.kind === 'transient') return { code: failure.gatewayType ?? failure.kind, severity: 'warning', title: 'AI Gateway request failed', body: `${model} is temporarily unavailable. Arcade used a legal move.`, persistent: false };
  return { code: failure.gatewayType ?? `http_${failure.status ?? 'error'}`, severity: 'warning', title: 'AI Gateway request failed', body: `${model} returned an error. Arcade used a legal move.`, persistent: false };
}
