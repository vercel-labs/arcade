// Vercel function entry for the ascii-prism stream. The handler itself lives in
// src/arcade/prism-stream.ts — shared verbatim with the local server
// (src/tools/serve-prism.ts) so `curl` against either is identical. esbuild bundles
// this entry (see scripts/build-vercel-output.mjs) into the deployed function.
import { streamPrism } from '../src/arcade/prism-stream.ts';

export default streamPrism;
