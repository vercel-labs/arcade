// The prism screen — a self-contained visual library shared by three consumers:
// the arcade attract mode (src/arcade), the render tools (src/tools), and the
// `curl`-able streaming endpoint (api/index.ts, via serve-prism.ts locally). It
// depends only on src/engine; nothing app-specific leaks in, which is what lets the
// Vercel function bundle it without dragging in the arcade. Consumers import from
// this barrel; the modules below import each other directly.
export { PrismScene, type PrismIntro, ROT_SPEED, TILT, PLACE_Y } from './prism.ts';
export { SplashScene, SPLASH_END } from './splash.ts';
export { streamPrism } from './prism-stream.ts';
