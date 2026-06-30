// Run the EXACT production prism handler locally over HTTP, so you can test the
// deployed experience — help page, ?truecolor, the browser xterm.js page, frame
// caching — before shipping. The handler is shared with the Vercel function
// (src/arcade/prism-stream.ts ← api/index.ts); this just wraps it in a plain
// Node http server. Output-only (no input), looped.
//
//   pnpm exec tsx src/tools/serve-prism.ts [port]
//   curl -sN "http://localhost:8080?cols=$(tput cols)&rows=$(tput lines)"
//   curl -sN "http://localhost:8080?truecolor=1"   # 24-bit color
//   curl -sN "http://localhost:8080/help"          # options page
//   open "http://localhost:8080"                    # browser xterm.js page
//
// curl doesn't report terminal size, so cols/rows come from the query (with a
// sensible default). Runs on any long-lived host (Fly, Railway, a VM) too.
import { createServer } from 'node:http';
import { streamPrism } from '../arcade/prism-stream.ts';

const PORT = Number(process.argv[2]) || 8080;

const server = createServer((req, res) => {
  void streamPrism(req, res);
});

server.listen(PORT, () => {
  console.log(`ascii-prism streaming on http://localhost:${PORT}`);
  console.log(`try:          curl -sN http://localhost:${PORT}`);
  console.log(`truecolor:    curl -sN "http://localhost:${PORT}?truecolor=1"`);
  console.log(`fill window:  curl -sN "http://localhost:${PORT}?cols=$COLUMNS&rows=$LINES"`);
});
