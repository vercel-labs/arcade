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
  let input = '';
  let authorization = '';
  const catalog = await fetchTeamModelCatalog('team-key', {
    fetchImpl: (async (request, init) => {
      input = String(request);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify({ data: [model('openai/text-ok', 'http')] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  });

  assert.equal(input, 'https://ai-gateway.vercel.sh/v1/models?include_availability');
  assert.equal(authorization, 'Bearer team-key');
  assert.equal(catalog.source, 'team');
});

test('team catalog fetch falls back when the availability endpoint fails', async () => {
  const catalog = await fetchTeamModelCatalog('team-key', {
    fetchImpl: (async () => new Response('nope', { status: 503 })) as typeof fetch,
  });

  assert.equal(catalog.source, 'fallback');
  assert.equal(catalog.fallbackReason, 'HTTP 503');
  assert.ok(catalog.textCreators.length > 0);
});
