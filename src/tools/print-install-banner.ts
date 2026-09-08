// Prints the postinstall banner straight to this terminal, for eyeballing it while
// iterating on install-banner.ts — the real thing only ever prints during an actual
// global npm/pnpm install (gated by npm_config_global), so there's no other easy way
// to see it. Calls bannerLines() directly rather than printInstallBanner() to skip
// that gate and always print here, regardless of how this script itself was run.
import { bannerLines } from '../arcade/install-banner.ts';

const color = Boolean(process.env.FORCE_COLOR) || !process.env.NO_COLOR;
console.log(bannerLines({ color }).join('\n'));
