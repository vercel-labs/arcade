import assert from 'node:assert/strict';
import test from 'node:test';
import { modelFailureNotice, GATEWAY_TOP_UP_URL, GATEWAY_LOGS_URL } from './model-failure-notice.ts';

test('billing failures map to persistent fixed resolver actions', () => {
  const notice = modelFailureNotice({ kind: 'billing', status: 402, gatewayType: 'insufficient_funds', gatewayFailure: true, message: 'provider text https://evil.example' }, 'openai/gpt');
  assert.equal(notice?.title, 'out of credit');
  assert.equal(notice?.persistent, true);
  assert.equal(notice?.action?.url, GATEWAY_TOP_UP_URL);
  assert.doesNotMatch(JSON.stringify(notice), /evil\.example/);
});

test('model output parsing errors do not produce Gateway notices', () => {
  assert.equal(modelFailureNotice({ kind: 'schema', gatewayFailure: false, message: 'No object generated' }, 'openai/gpt'), null);
});

test('lasting model access failures pause instead of masquerading as temporary errors', () => {
  const notice = modelFailureNotice({ kind: 'access', status: 403, gatewayType: 'no_providers_available', gatewayFailure: true, message: 'restricted' }, 'provider/model');
  assert.equal(notice?.persistent, true);
  assert.equal(notice?.severity, 'error');
});

test('untyped access failures remain persistent', () => {
  const notice = modelFailureNotice({ kind: 'access', status: 403, gatewayFailure: true, message: 'forbidden' }, 'provider/model');
  assert.equal(notice?.persistent, true);
  assert.equal(notice?.code, 'access_error');
});

test('local timeouts can produce temporary notices', () => {
  const notice = modelFailureNotice({ kind: 'timeout', gatewayFailure: false, message: 'timed out' }, 'provider/model');
  assert.equal(notice?.persistent, false);
});

test('a typed rate-limit failure is a caution notice with an AI Gateway logs link', () => {
  const notice = modelFailureNotice({ kind: 'transient', status: 429, gatewayType: 'rate_limit_exceeded', gatewayFailure: true, message: 'rate limited' }, 'provider/model');
  assert.equal(notice?.severity, 'caution');
  assert.equal(notice?.persistent, false);
  assert.equal(notice?.action?.url, GATEWAY_LOGS_URL);
  assert.match(notice?.body ?? '', /free-tier/);
});

test('an untyped 429 (no gatewayType) still gets the same caution notice', () => {
  const notice = modelFailureNotice({ kind: 'transient', status: 429, gatewayFailure: true, message: 'too many requests' }, 'provider/model');
  assert.equal(notice?.code, 'rate_limit');
  assert.equal(notice?.severity, 'caution');
  assert.equal(notice?.action?.url, GATEWAY_LOGS_URL);
});
