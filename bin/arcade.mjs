#!/usr/bin/env node
// The published CLI entry (`arcade` / `npx @vercel/arcade`). The app is authored in
// TypeScript and run through tsx's on-the-fly transpiler, so the package ships the
// source tree as-is — the assets offset (src/arcade → ../../assets) stays identical
// to `pnpm dev`, and no build step is needed. tsImport runs main.ts (which starts the
// app on import) with the tsx loader active for its whole import graph.
import { tsImport } from 'tsx/esm/api';

await tsImport('../src/arcade/main.ts', import.meta.url);
