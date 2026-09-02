import { readFileSync } from 'node:fs';
import { COVER_FLOW_LAUNCH_TOTAL, CoverFlowRenderer } from '../../cinematic/scenes/cover-flow.ts';
import { decodePng } from '../../engine/texture.ts';
import type { Texture } from '../../engine/texture-data.ts';
import { asset } from '../assets.ts';
import { MENU_ITEMS } from './menu.ts';

export const LAUNCH_TOTAL = COVER_FLOW_LAUNCH_TOTAL;

const textureCache = new Map<string, Texture | null>();
function coverTexture(id: string): Texture | null {
  const cached = textureCache.get(id);
  if (cached !== undefined) return cached;
  let texture: Texture | null = null;
  try {
    texture = decodePng(readFileSync(asset(`games/${id}.png`)));
  } catch {
    texture = null;
  }
  textureCache.set(id, texture);
  return texture;
}

/** Terminal adapter for the shared Cover Flow renderer. */
export class CoverFlowScene extends CoverFlowRenderer {
  constructor() {
    super(MENU_ITEMS, coverTexture);
  }
}
