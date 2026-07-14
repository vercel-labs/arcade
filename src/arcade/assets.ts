// Locate the arcade's bundled assets (textures, meshes, the model catalog) by a
// path RELATIVE TO THIS MODULE rather than the process working directory. The app
// reads these with readFileSync at load / first use, and must find them no matter
// where it's launched from: `pnpm dev` runs from the repo root, but a published
// `npx @vercel/arcade` runs in the user's cwd. Every asset read goes through
// asset() — nothing should hardcode a 'assets/...' cwd-relative path again.
//
// Layout assumption: this file is <root>/src/arcade/assets.ts and the assets live
// at <root>/assets, so '../../assets' from here is the assets root.
// A future bundle/publish step must preserve that offset (ship assets at the
// package root with the entry point two dirs deep) or adjust this base.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS_ROOT = fileURLToPath(new URL('../../assets', import.meta.url));

/** Absolute path to a file under assets, e.g. asset('logos/openai.png'). */
export function asset(rel: string): string {
  return join(ASSETS_ROOT, rel);
}
