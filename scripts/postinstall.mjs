#!/usr/bin/env node
// Postinstall entry: prints the install banner after a global install. The banner
// is compiled to ordinary JavaScript alongside the published CLI.
//
// The `npm_config_global` gate is repeated here, ahead of the import, so the common
// case — `pnpm install` in a checkout — avoids loading the application bundle.
//
// Everything is swallowed: a failed banner must never fail an install.
const global = process.env.npm_config_global;
if (global && global !== '0' && global !== 'false') {
  try {
    const mod = await import('../dist/arcade/install-banner.js');
    mod.printInstallBanner();
  } catch {
    // no banner; the install itself is unaffected
  }
}
