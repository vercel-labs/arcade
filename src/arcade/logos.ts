// AI Gateway provider/creator logo resolution. Ported from gateway-scout's
// src/lib/logos.ts (itself a port of Vercel's AI Gateway model list,
// front/packages/ai-shared/src/components/model-list/model-logo.tsx). Logos are
// 256x256 RGBA PNGs served from a public, hotlinkable Vercel Blob CDN; bake them
// locally with src/tools/fetch-logo.ts so the arcade stays offline.

import type { RGB } from '../engine/index.ts';

const LOGO_CDN =
  'https://7nyt0uhk7sse4zvn.public.blob.vercel-storage.com/docs-assets/static/docs/ai-gateway/logos';

// Brand hue each provider's wisp is tinted with (0..255). Most gateway logos are
// monochrome marks on a dark tile, so a single signature color reads as "their"
// wisp: OpenAI teal-green, Anthropic clay, Google blue, xAI cool steel.
export const BRAND_HUE: Record<string, RGB> = {
  openai: [16, 163, 127],
  anthropic: [217, 119, 87],
  google: [66, 133, 244],
  xai: [88, 126, 198], // steel blue — deep enough to stay colored, not blow to white
};

const ORG_TO_FILE: Record<string, string> = {
  alibaba: 'alibaba cloud.png',
  amazon: 'amazon bedrock.png',
  anthropic: 'anthropic.png',
  'arcee-ai': 'arcee-ai.png',
  azure: 'azure.png',
  baseten: 'baseten.png',
  bedrock: 'amazon bedrock.png',
  bfl: 'blackforestlabs.png',
  blackforestlabs: 'blackforestlabs.png',
  blackbox: 'blackbox.png',
  bytedance: 'bytedance.png',
  cerebras: 'cerebras.png',
  chutes: 'chutes.png',
  claudeaws: 'anthropic.png',
  cohere: 'cohere.png',
  crusoe: 'crusoe.png',
  deepinfra: 'deepinfra.png',
  deepseek: 'deepseek.png',
  fal: 'fal.png',
  fireworks: 'fireworks.png',
  google: 'google.png',
  groq: 'groq.png',
  inception: 'inception.png',
  inceptron: 'inceptron.png',
  interfaze: 'interfaze.png',
  klingai: 'klingai.png',
  kwaipilot: 'kwaipilot.png',
  meituan: 'meituan.png',
  meta: 'meta.png',
  minimax: 'minimax.png',
  mistral: 'mistral.png',
  moonshotai: 'moonshotai.png',
  morph: 'morph.png',
  nebius: 'nebius.png',
  nvidia: 'nvidia.png',
  novita: 'novita.png',
  openai: 'openai.png',
  parasail: 'parasail.png',
  'prime-intellect': 'prime-intellect.png',
  perplexity: 'perplexity.png',
  prodia: 'prodia.png',
  quiverai: 'quiverai.png',
  recraft: 'recraft.png',
  sambanova: 'sambanova.png',
  stealth: 'stealth.png',
  stepfun: 'stepfun.png',
  streamlake: 'streamlake.png',
  togetherai: 'togetherai.png',
  vercel: 'vercel.png',
  vertex: 'vertex ai.png',
  vertexanthropic: 'vertex ai.png',
  voyage: 'voyage.png',
  xiaomi: 'xiaomi.png',
  xai: 'xai.png',
  zai: 'zai.png',
};

/** All provider/creator keys we have a logo for (handy for tools and demos). */
export const LOGO_NAMES: readonly string[] = Object.keys(ORG_TO_FILE);

function fileFor(name: string): string | null {
  const key = name.toLowerCase().trim();
  const file = ORG_TO_FILE[key] ?? ORG_TO_FILE[key.replace(/[-\s]/g, '')];
  return file ?? null;
}

/** Remote logo URL for an org/provider name, or null if we don't have one. */
export function logoUrl(name: string): string | null {
  const file = fileFor(name);
  return file ? `${LOGO_CDN}/${encodeURIComponent(file)}` : null;
}

/** Creator/lab logo from a model slug, e.g. "alibaba/qwen-3-14b" -> alibaba. */
export function creatorLogo(slug: string): { url: string | null; name: string } {
  const creator = slug.split('/')[0] ?? slug;
  return { url: logoUrl(creator), name: creator };
}

/** Serving-provider logo, e.g. "deepinfra" / "vertex". */
export function providerLogo(provider: string): { url: string | null; name: string } {
  return { url: logoUrl(provider), name: provider };
}
