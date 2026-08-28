// Bake the fallback AI Gateway model catalog + creator logos for match setup.
// Fetches the public model list, keeps the language models, groups them by
// creator, and writes assets/models.json. Then bakes each creator's logo
// PNG to assets/logos/<slug>.png (the wisp + picker load these). Run:
//
//   pnpm exec tsx src/tools/fetch-models.ts
//
// Re-run to refresh the catalog when the gateway adds models/creators. The JSON
// and PNGs are committed so the app loads instantly and offline.
import { mkdirSync, writeFileSync } from 'node:fs';
import { logoUrl } from '../arcade/scenes/logos.ts';

const MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models';
const ASSET_DIR = 'assets';
const LOGO_DIR = `${ASSET_DIR}/logos`;

// Nicely-cased creator labels; any slug not listed falls back to Title Case.
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
  thinkingmachines: 'Thinking Machines',
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

// `owned_by` is the API's explicit creator identity. The model ID prefix is the
// documented creator namespace and remains a compatibility fallback. Warn if the
// two ever diverge so a catalog change cannot silently attach the wrong logo.
const byCreator = new Map<string, { id: string; name: string }[]>();
for (const m of language) {
  const idCreator = m.id.split('/')[0];
  const slug = m.owned_by ?? idCreator;
  if (m.owned_by && m.owned_by !== idCreator) {
    console.warn(`creator mismatch: ${m.id} has owned_by=${m.owned_by}`);
  }
  const list = byCreator.get(slug) ?? [];
  list.push({ id: m.id, name: m.name ?? m.id.split('/')[1] });
  byCreator.set(slug, list);
}

const creators = [...byCreator.entries()]
  .map(([slug, models]) => ({
    slug,
    name: label(slug),
    models: models.sort((a, b) => a.name.localeCompare(b.name)),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

mkdirSync(ASSET_DIR, { recursive: true });
writeFileSync(`${ASSET_DIR}/models.json`, `${JSON.stringify({ creators }, null, 2)}\n`);
console.log(`models.json: ${language.length} language models across ${creators.length} creators`);

// Bake each creator's logo (skip — with a warning — any without a CDN URL).
mkdirSync(LOGO_DIR, { recursive: true });
const missing: string[] = [];
for (const { slug } of creators) {
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
console.log(`logos: baked ${creators.length - missing.length}/${creators.length}`);
if (missing.length) console.log(`  no logo for: ${missing.join(', ')} (picker still lists them; HUD shows no wisp)`);
