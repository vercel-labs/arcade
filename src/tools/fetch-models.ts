// Bake the AI Gateway model catalog + provider logos for the match-setup picker.
// Fetches the public model list, keeps the language models, groups them by
// provider, and writes assets/models.json. Then bakes each provider's logo
// PNG to assets/logos/<slug>.png (the wisp + picker load these). Run:
//
//   pnpm exec tsx src/tools/fetch-models.ts
//
// Re-run to refresh the catalog when the gateway adds models/providers. The JSON
// and PNGs are committed so the app loads instantly and offline.
import { mkdirSync, writeFileSync } from 'node:fs';
import { logoUrl } from '../arcade/scenes/logos.ts';

const MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models';
const ASSET_DIR = 'assets';
const LOGO_DIR = `${ASSET_DIR}/logos`;

// Nicely-cased provider labels; any slug not listed falls back to Title Case.
const LABELS: Record<string, string> = {
  openai: 'OpenAI',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  moonshotai: 'Moonshot AI',
  'arcee-ai': 'Arcee AI',
  bytedance: 'ByteDance',
  zai: 'Z.AI',
  minimax: 'MiniMax',
  nvidia: 'NVIDIA',
  stepfun: 'StepFun',
};
function label(slug: string): string {
  return LABELS[slug] ?? slug.split(/[-_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

interface ApiModel {
  id: string;
  name?: string;
  type?: string;
  owned_by?: string;
}

const res = await fetch(MODELS_URL);
if (!res.ok) {
  console.error(`fetch failed: ${res.status} ${res.statusText} (${MODELS_URL})`);
  process.exit(1);
}
const json = (await res.json()) as { data: ApiModel[] };
const language = json.data.filter((m) => m.type === 'language');

// Group by provider (slug = id prefix), models sorted by display name.
const byProvider = new Map<string, { id: string; name: string }[]>();
for (const m of language) {
  const slug = m.id.split('/')[0];
  const list = byProvider.get(slug) ?? [];
  list.push({ id: m.id, name: m.name ?? m.id.split('/')[1] });
  byProvider.set(slug, list);
}

const providers = [...byProvider.entries()]
  .map(([slug, models]) => ({
    slug,
    name: label(slug),
    models: models.sort((a, b) => a.name.localeCompare(b.name)),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

mkdirSync(ASSET_DIR, { recursive: true });
writeFileSync(`${ASSET_DIR}/models.json`, `${JSON.stringify({ providers }, null, 2)}\n`);
console.log(`models.json: ${language.length} language models across ${providers.length} providers`);

// Bake each provider's logo (skip — with a warning — any without a CDN URL).
mkdirSync(LOGO_DIR, { recursive: true });
const missing: string[] = [];
for (const { slug } of providers) {
  const url = logoUrl(slug);
  if (!url) {
    missing.push(slug);
    continue;
  }
  const r = await fetch(url);
  if (!r.ok) {
    missing.push(slug);
    continue;
  }
  writeFileSync(`${LOGO_DIR}/${slug}.png`, new Uint8Array(await r.arrayBuffer()));
}
console.log(`logos: baked ${providers.length - missing.length}/${providers.length}`);
if (missing.length) console.log(`  no logo for: ${missing.join(', ')} (picker still lists them; HUD shows no wisp)`);
