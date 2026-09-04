import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchTeamModelCatalog,
  parseTeamModelCatalog,
} from './team-model-catalog.ts';

function model(
  id: string,
  runtime: 'http' | 'realtime_websocket',
  status: 'eligible' | 'ineligible' | 'unknown' = 'eligible',
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name: id.split('/').at(-1),
    owned_by: id.split('/')[0],
    type: 'language',
    model_eligibility: {
      evaluated_runtime: runtime,
      status,
      ...(status === 'ineligible' ? { category: 'policy', reason: 'plan_restricted' } : {}),
    },
    ...extra,
  };
}

test('team catalog separates text and realtime models and keeps conservative availability states', () => {
  const catalog = parseTeamModelCatalog({
    availability_status: 'partial',
    catalog_status: 'complete',
    request_context_availability: { http: { status: 'available' } },
    data: [
      model('openai/text-ok', 'http'),
      model('openai/text-unknown', 'http', 'unknown'),
      model('anthropic/text-transient', 'http', 'ineligible', {
        model_eligibility: {
          evaluated_runtime: 'http',
          status: 'ineligible',
          category: 'transient',
          reason: 'rate_limit_paused',
        },
      }),
      model('google/text-config', 'http', 'ineligible', {
        model_eligibility: {
          evaluated_runtime: 'http',
          status: 'ineligible',
          category: 'configuration',
          reason: 'model_not_found',
        },
      }),
      model('xai/text-denied', 'http', 'ineligible'),
      model('openai/image-only', 'http', 'eligible', { tags: ['image-generation'] }),
      model('openai/realtime', 'realtime_websocket'),
    ],
  });

  assert.ok(catalog);
  assert.equal(catalog.source, 'team');
  assert.equal(catalog.availabilityStatus, 'partial');
  assert.deepEqual(
    catalog.textCreators.flatMap((creator) => creator.models.map((entry) => entry.id)).sort(),
    ['anthropic/text-transient', 'google/text-config', 'openai/text-ok', 'openai/text-unknown'],
  );
  assert.deepEqual(
    catalog.realtimeCreators.flatMap((creator) => creator.models.map((entry) => entry.id)),
    ['openai/realtime'],
  );
});

test('team catalog follows virtual aliases when checking Arcade text compatibility', () => {
  const catalog = parseTeamModelCatalog({
    data: [
      model('openai/base', 'http'),
      {
        id: 'private/custom-alias',
        name: 'Custom Alias',
        type: 'virtual',
        model_slug: 'openai/base',
        model_eligibility: { evaluated_runtime: 'http', status: 'eligible' },
      },
    ],
  });

  assert.ok(catalog);
  assert.deepEqual(
    catalog.textCreators.flatMap((creator) => creator.models.map((entry) => entry.id)).sort(),
    ['openai/base', 'private/custom-alias'],
  );
});

test('legacy or malformed model responses do not replace the baked fallback', () => {
  assert.equal(parseTeamModelCatalog(null), null);
  assert.equal(parseTeamModelCatalog({ data: [] }), null);
  assert.equal(parseTeamModelCatalog({ data: [{ id: 'openai/no-annotation', type: 'language' }] }), null);
});

test('team catalog fetch authenticates the availability request', async () => {
  const inputs: string[] = [];
  let authorization = '';
  const catalog = await fetchTeamModelCatalog('team-key', {
    fetchImpl: (async (request, init) => {
      const input = String(request);
      inputs.push(input);
      if (input.endsWith('/coding-agent/v1/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'openai/text-ok' }] }), { status: 200 });
      }
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify({ data: [model('openai/text-ok', 'http')] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  });

  assert.deepEqual(inputs.sort(), [
    'https://ai-gateway.vercel.sh/coding-agent/v1/models',
    'https://ai-gateway.vercel.sh/v1/models?include_availability',
  ]);
  assert.equal(authorization, 'Bearer team-key');
  assert.equal(catalog.source, 'team');
});

test('team catalog fetch falls back when the availability endpoint fails', async () => {
  const catalog = await fetchTeamModelCatalog('team-key', {
    fetchImpl: (async (request) => String(request).includes('include_availability')
      ? new Response('nope', { status: 503 })
      : new Response(JSON.stringify({ data: [] }), { status: 200 })) as typeof fetch,
  });

  assert.equal(catalog.source, 'fallback');
  assert.equal(catalog.fallbackReason, 'HTTP 503');
  assert.ok(catalog.textCreators.length > 0);
});

test('team catalog remains available when the optional popularity request fails', async () => {
  const catalog = await fetchTeamModelCatalog('team-key', {
    fetchImpl: (async (request) => {
      if (String(request).endsWith('/coding-agent/v1/models')) throw new Error('popularity unavailable');
      return new Response(JSON.stringify({
        data: [model('openai/zulu', 'http'), model('openai/alpha', 'http')],
      }), { status: 200 });
    }) as typeof fetch,
  });

  assert.equal(catalog.source, 'team');
  assert.deepEqual(catalog.textCreators[0].models.map(({ id }) => id), [
    'openai/alpha',
    'openai/zulu',
  ]);
});

test('malformed or stalled popularity never discards or delays valid availability', async () => {
  for (const popularity of [
    () => new Response('{not json', { status: 200 }),
    () => new Promise<Response>(() => {}),
  ]) {
    const catalog = await fetchTeamModelCatalog('team-key', {
      timeoutMs: 20,
      fetchImpl: (async (request) => String(request).endsWith('/coding-agent/v1/models')
        ? popularity()
        : new Response(JSON.stringify({ data: [model('openai/text-ok', 'http')] }), { status: 200 })) as typeof fetch,
    });
    assert.equal(catalog.source, 'team');
  }
});

test('team catalog follows Gateway popularity and groups fast variants with their base', () => {
  const catalog = parseTeamModelCatalog({
    data: [
      model('openai/alpha', 'http'),
      model('openai/base-fast', 'http'),
      model('openai/base', 'http'),
      model('openai/zulu', 'http'),
    ],
  }, ['openai/zulu', 'openai/base-fast', 'openai/base']);

  assert.ok(catalog);
  assert.deepEqual(catalog.textCreators[0].models.map(({ id }) => id), [
    'openai/zulu',
    'openai/base',
    'openai/base-fast',
    'openai/alpha',
  ]);
});

test('team catalog keeps the request-wide billing verdict and counts plan-restricted text models', () => {
  const catalog = parseTeamModelCatalog({
    request_context_availability: { http: { status: 'unavailable', reason: 'customer_verification_required' }, realtime_websocket: { status: 'available' } },
    data: [
      model('openai/text-ok', 'http'),
      model('openai/text-paid', 'http', 'ineligible'),
      model('anthropic/text-paid', 'http', 'ineligible'),
      model('openai/realtime-paid', 'realtime_websocket', 'ineligible'),
      model('openai/image-paid', 'http', 'ineligible', { tags: ['image-generation'] }),
      model('xai/text-denied', 'http', 'ineligible', {
        model_eligibility: { evaluated_runtime: 'http', status: 'ineligible', category: 'policy', reason: 'model_not_allowlisted' },
      }),
    ],
  });
  assert.ok(catalog);
  assert.deepEqual(catalog.requestAvailability, { status: 'unavailable', reason: 'customer_verification_required' });
  assert.equal(catalog.planRestrictedCount, 2);
  assert.deepEqual(catalog.textCreators.flatMap((creator) => creator.models.map((entry) => entry.id)), ['openai/text-ok']);

  const bare = parseTeamModelCatalog({ data: [model('openai/text-ok', 'http')] });
  assert.equal(bare?.requestAvailability, undefined);
  assert.equal(bare?.planRestrictedCount, 0);
  assert.equal(parseTeamModelCatalog({ request_context_availability: { http: { status: 'later' } }, data: [model('openai/text-ok', 'http')] })?.requestAvailability, undefined);
});
