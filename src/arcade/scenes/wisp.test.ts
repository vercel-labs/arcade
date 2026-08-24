import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mulberry32 } from '../../engine/index.ts';
import { analyzeLogo, bakeMarkAlpha, decodePng, markCoverage, type Texture } from '../../engine/index.ts';
import { asset } from '../assets.ts';
import { creators } from '../match/models.ts';
import { deriveTint, FALLBACK_CREATOR_TINT, loadCreatorWisp } from './wisp.ts';

function logo(name: string): Texture {
  return decodePng(readFileSync(asset(`logos/${name}.png`)));
}

// Coverage counts over a decoded logo: total solid mark texels, plus how many
// match a predicate (used to assert a specific colored region survives).
function markStats(tex: Texture, match: (r: number, g: number, b: number) => boolean): { solid: number; matched: number } {
  const cov = markCoverage(tex);
  const d = tex.data;
  let solid = 0;
  let matched = 0;
  for (let i = 0; i < cov.length; i++) {
    if (cov[i] < 0.9) continue;
    solid++;
    if (match(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])) matched++;
  }
  return { solid, matched };
}

test('missing creator logos become first-letter wisps with the neutral fallback tint', () => {
  const wisp = loadCreatorWisp('thinkingmachines', 0, mulberry32(1));
  assert.deepEqual(wisp.tint, FALLBACK_CREATOR_TINT);
  assert.equal(wisp.tex.width, 128);
  assert.equal(wisp.tex.height, 128);

  let opaque = 0;
  for (let i = 3; i < wisp.tex.data.length; i += 4) {
    if (wisp.tex.data[i] > 0) opaque++;
  }
  assert.ok(opaque > 0, 'the generated T mark should contain visible pixels');
  assert.equal(wisp.tex.data[3], 0, 'the generated mark should have a transparent background');
});

test('every selectable creator yields a non-empty wisp mark (logo or fallback initial)', () => {
  for (const { slug } of creators()) {
    const wisp = loadCreatorWisp(slug, 0, mulberry32(1));
    let covered = 0;
    for (let i = 3; i < wisp.tex.data.length; i += 4) if (wisp.tex.data[i] > 128) covered++;
    assert.ok(covered > 200, `${slug} should render a visible mark (got ${covered} covered texels)`);
  }
});

test('repeated creator wisps share one baked texture identity', () => {
  const first = loadCreatorWisp('openai', 0, mulberry32(1));
  const second = loadCreatorWisp('openai', 1, mulberry32(2));
  assert.equal(second.tex, first.tex);
});

test('Anthropic wisps use the iconic Claude mark instead of the company AI mark', () => {
  const wisp = loadCreatorWisp('anthropic', 0, mulberry32(1));
  const claude = bakeMarkAlpha(logo('claude'));
  assert.deepEqual(wisp.tex.data, claude.data);
});

test('ByteDance (transparent multi-color): all bars survive despite the phantom-corner color', () => {
  const tex = logo('bytedance');
  const a = analyzeLogo(tex);
  assert.equal(a.hasAlpha, true, 'ByteDance is a cut-out, so masking is alpha-driven');
  // The mint/cyan bars used to be eroded against the phantom green corner color.
  const { solid, matched } = markStats(tex, (r, g, b) => g > 180 && b > 180 && r < 160);
  assert.ok(solid > 15000, `whole bar chart should be solid mark, got ${solid}`);
  assert.ok(matched > 1500, `the mint/cyan bars must survive, got ${matched} texels`);
  // And its tint reads as a real (chromatic, blue-ish) color, not phantom green.
  const tint = deriveTint(tex);
  assert.ok(Math.max(tint.x, tint.y, tint.z) - Math.min(tint.x, tint.y, tint.z) > 20, `tint should be chromatic: ${JSON.stringify(tint)}`);
  assert.ok(tint.z >= tint.x, `tint should lean blue, not green/red: ${JSON.stringify(tint)}`);
});

test('Cohere (opaque light multi-color): the pale lavender lobe is preserved', () => {
  const tex = logo('cohere');
  const a = analyzeLogo(tex);
  assert.equal(a.hasAlpha, false);
  assert.ok(a.bg.x > 220 && a.bg.y > 220 && a.bg.z > 220, `light tile bg, got ${JSON.stringify(a.bg)}`);
  // The lavender lobe (~200,140,210) sits ~0.25 from the bg — the region the old
  // edge0=0.22 ramp faded out. It must now be solid mark.
  const { matched } = markStats(tex, (r, g, b) => r > 170 && b > 180 && g < r - 20 && g < b - 20);
  assert.ok(matched > 1000, `Cohere's purple lobe should be solid mark, got ${matched} texels`);
});

test('OpenAI (opaque dark monochrome): the mark reads and the tile stays dark', () => {
  const tex = logo('openai');
  const a = analyzeLogo(tex);
  assert.equal(a.hasAlpha, false);
  assert.ok(Math.max(a.bg.x, a.bg.y, a.bg.z) < 20, `dark tile bg, got ${JSON.stringify(a.bg)}`);
  const { solid } = markStats(tex, () => true);
  assert.ok(solid > 5000, `the swirl should be solid mark, got ${solid}`);
});
