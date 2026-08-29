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
  assert.equal(classifyModelError(new Error('something odd happened')).kind, 'unknown');
});

test('classify: message is single-line and redacts key-shaped tokens', () => {
  const e = new Error('bad request with key vck_abcdEFGH12345678 in\nheader');
  const c = classifyModelError(e);
  assert.ok(!/\n/.test(c.message), 'message is single-line');
  assert.ok(!/vck_abcdEFGH12345678/.test(c.message), 'credential redacted');
});
