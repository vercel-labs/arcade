import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyModelError } from './model-errors.ts';

// Fixtures mirror the exact error shapes captured from the AI Gateway when probing
// `thinkingmachines/inkling` (AIG-181): the gateway wraps the provider's HTTP error
// as `.cause`, so status + JSON body live one level down from the top error.

// Access-restricted team (Vercel Labs): the model routes to a provider the team
// can't use. Top = GatewayInternalServerError(statusCode 403), cause = APICallError.
function accessError(): unknown {
  const cause = Object.assign(new Error('no providers'), {
    name: 'AI_APICallError',
    statusCode: 403,
    responseBody: JSON.stringify({
      error: { message: 'Your team has restricted access to this provider. Providers considered: baseten', type: 'no_providers_available' },
    }),
  });
  return Object.assign(new Error('Your team has restricted access to this provider. Providers considered: baseten'), {
    name: 'GatewayInternalServerError',
    statusCode: 403,
    cause,
  });
}

// Early-access team: the provider serves the model but can't emit the JSON schema.
// Top = AI_NoObjectGeneratedError, cause = AI_JSONParseError.
function schemaError(): unknown {
  const cause = Object.assign(new Error('JSON parsing failed: Unexpected non-whitespace character after JSON'), { name: 'AI_JSONParseError' });
  return Object.assign(new Error('No object generated: could not parse the response.'), { name: 'AI_NoObjectGeneratedError', cause });
}

test('classify: 403 no_providers_available → access (with status + gateway type)', () => {
  const c = classifyModelError(accessError());
  assert.equal(c.kind, 'access');
  assert.equal(c.status, 403);
  assert.equal(c.gatewayType, 'no_providers_available');
});

test('classify: NoObjectGenerated / JSONParse → schema', () => {
  assert.equal(classifyModelError(schemaError()).kind, 'schema');
});

test('classify: responseFormat-not-supported prose → schema', () => {
  const e = new Error('The feature "responseFormat" is not supported. JSON response format schema is only supported with structuredOutputs');
  assert.equal(classifyModelError(e).kind, 'schema');
});

test('classify: AbortSignal.timeout error → timeout', () => {
  assert.equal(classifyModelError(Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })).kind, 'timeout');
  assert.equal(classifyModelError(Object.assign(new Error('aborted'), { name: 'AbortError' })).kind, 'timeout');
});

test('classify: 503 with no schema/access markers → transient', () => {
  const e = Object.assign(new Error('service unavailable'), { name: 'GatewayError', statusCode: 503 });
  assert.equal(classifyModelError(e).kind, 'transient');
});

test('classify: unrecognized error → unknown', () => {
  const failure = classifyModelError(new Error('something odd happened'));
  assert.equal(failure.kind, 'unknown');
  assert.equal(failure.gatewayFailure, false);
});

test('classify: Gateway billing and quota types remain actionable', () => {
  assert.equal(classifyModelError(gatewayError(402, 'insufficient_funds')).kind, 'billing');
  assert.equal(classifyModelError(gatewayError(403, 'customer_verification_required')).kind, 'billing');
  assert.equal(classifyModelError(gatewayError(429, 'quota_for_entity_exceeded')).kind, 'quota');
  assert.equal(classifyModelError(gatewayError(401, 'authentication_error')).kind, 'authentication');
});

test('classify: typed AI SDK Gateway errors preserve their direct type', () => {
  assert.deepEqual(
    classifyModelError(Object.assign(new Error('Authentication failed'), {
      name: 'GatewayAuthenticationError',
      type: 'authentication_error',
      statusCode: 401,
    })),
    {
      kind: 'authentication',
      status: 401,
      gatewayType: 'authentication_error',
      gatewayFailure: true,
      message: 'Authentication failed',
    },
  );
  assert.equal(classifyModelError(Object.assign(new Error('Model not found'), {
    name: 'GatewayModelNotFoundError',
    type: 'model_not_found',
    statusCode: 404,
  })).kind, 'model');
});

test('classify: bare HTTP 401 remains a persistent authentication failure', () => {
  const classified = classifyModelError(Object.assign(new Error('Unauthorized'), { statusCode: 401 }));
  assert.equal(classified.kind, 'authentication');
  assert.equal(classified.gatewayFailure, true);
});

test('classify: a specific nested Gateway type overrides a generic SDK wrapper', () => {
  const cause = Object.assign(new Error('out of credit'), {
    name: 'AI_APICallError',
    statusCode: 402,
    responseBody: JSON.stringify({ error: { type: 'insufficient_funds', message: 'out of credit' } }),
  });
  const error = Object.assign(new Error('Gateway request failed'), {
    name: 'GatewayInternalServerError',
    type: 'internal_server_error',
    statusCode: 402,
    cause,
  });
  const failure = classifyModelError(error);
  assert.equal(failure.gatewayType, 'insufficient_funds');
  assert.equal(failure.kind, 'billing');
});

function gatewayError(statusCode: number, type: string): unknown {
  const responseBody = JSON.stringify({ error: { type, message: type } });
  const cause = Object.assign(new Error(type), { name: 'AI_APICallError', statusCode, responseBody });
  return Object.assign(new Error(type), { name: 'GatewayInternalServerError', statusCode, cause });
}

test('classify: message is single-line and redacts key-shaped tokens', () => {
  const e = new Error('bad request with key vck_abcdEFGH12345678 in\nheader');
  const c = classifyModelError(e);
  assert.ok(!/\n/.test(c.message), 'message is single-line');
  assert.ok(!/vck_abcdEFGH12345678/.test(c.message), 'credential redacted');
});
