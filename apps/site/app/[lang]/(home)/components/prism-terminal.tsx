'use client';

import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';

// The hero's centerpiece: the same rendered prism as `curl ascii-prisms.vercel.app`,
// streamed through this app's own `/api/prism-stream` proxy (see that route for why
// it's a proxy rather than a direct cross-origin fetch) and drawn with xterm.js —
// used purely as a faithful ANSI renderer, the same way the prism's own browser
// page already does. No 3D/engine code runs in this app; the frames are rendered
// and cached upstream.
export function PrismTerminal({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      disableStdin: true,
      scrollback: 0,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: { background: '#000000' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    let cancelled = false;
    let controller: AbortController | undefined;
    let sentCols = 0;
    let sentRows = 0;
    let restartTimer: ReturnType<typeof setTimeout> | undefined;

    const restart = () => controller?.abort();

    const run = async () => {
      try {
        fit.fit();
      } catch {
        // layout not settled yet; the next reconcile pass retries
      }
      sentCols = term.cols;
      sentRows = term.rows;
      controller = new AbortController();
      const res = await fetch(`/api/prism-stream?cols=${sentCols}&rows=${sentRows}`, {
        signal: controller.signal,
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        term.write(decoder.decode(value, { stream: true }));
      }
    };

    const loop = async () => {
      while (!cancelled) {
        try {
          await run();
        } catch {
          // aborted by a resize/reconcile, or the stream ended — loop again
        }
        await new Promise((r) => setTimeout(r, 60));
      }
    };

    const reconcile = () => {
      try {
        fit.fit();
      } catch {
        // ignore
      }
      if (term.cols !== sentCols || term.rows !== sentRows) restart();
    };

    const onResize = () => {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(restart, 150);
    };
    window.addEventListener('resize', onResize);

    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void loop();
          setTimeout(reconcile, 400);
          setTimeout(reconcile, 1200);
        });
      });
    });

    return () => {
      cancelled = true;
      controller?.abort();
      clearTimeout(restartTimer);
      window.removeEventListener('resize', onResize);
      term.dispose();
    };
  }, []);

  return <div className={className} ref={containerRef} />;
}
