#!/usr/bin/env node
// Postinstall entry: prints the install banner after a global install. The banner
// itself is TypeScript (src/arcade/install-banner.ts) run through tsx, exactly like
// bin/arcade.mjs, so the published package still needs no build step.
//
// The `npm_config_global` gate is repeated here, ahead of the import, so the common
// case — `pnpm install` in a checkout — costs a few milliseconds instead of a tsx
// boot. install-banner.ts re-checks it along with the rest of the conditions.
//
// Everything is swallowed: a failed banner must never fail an install.
const global = process.env.npm_config_global;
if (global && global !== '0' && global !== 'false') {
  try {
    const { tsImport } = await import('tsx/esm/api');
    const mod = await tsImport('../src/arcade/install-banner.ts', import.meta.url);
    mod.printInstallBanner();
  } catch {
    // no banner; the install itself is unaffected
  }
}
