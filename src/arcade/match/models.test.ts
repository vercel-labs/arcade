import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  creators,
  modelsFor,
  pickerCreators,
  pickerModelsFor,
} from './models.ts';
import { BETA_MODEL_ALLOWLIST } from './beta-allowlist.ts';

test('picker offers only allowlisted models by default', () => {
  delete process.env.ARCADE_ALL_MODELS;
  const ids = pickerCreators().flatMap((c) => c.models.map((m) => m.id));
  assert.ok(ids.length > 0, 'picker should offer some models');
  for (const id of ids) {
    assert.ok(BETA_MODEL_ALLOWLIST.has(id), `${id} should be in the allowlist`);
  }
});

test('ARCADE_ALL_MODELS=1 offers the full catalog', () => {
  process.env.ARCADE_ALL_MODELS = '1';
  try {
    const picker = pickerCreators()
      .flatMap((c) => c.models.map((m) => m.id))
      .sort();
    const full = creators()
      .flatMap((c) => c.models.map((m) => m.id))
      .sort();
    assert.deepEqual(picker, full);
  } finally {
    delete process.env.ARCADE_ALL_MODELS;
  }
});

test('base lookups stay unfiltered for tools and direct resolution', () => {
  delete process.env.ARCADE_ALL_MODELS;
  // An unsupported creator still resolves by name (used by the audit tools).
  assert.ok(modelsFor('arcee-ai').length > 0);
  // The picker variant applies the allowlist.
  for (const m of pickerModelsFor('anthropic')) {
    assert.ok(BETA_MODEL_ALLOWLIST.has(m.id));
  }
});
