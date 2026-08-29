// Full Node/terminal TUI API. Browser consumers should use the root `tui`
// namespace, which is sourced from browser.ts and excludes the stdout renderer.
export * from './browser.ts';
export { Renderer, type FrameFn, type RendererOpts } from './renderer.ts';
