'use client';

import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';

interface InteractiveStart {
  command: string;
  args: string[];
  env: string[];
  cwd: string;
  cols: number;
  rows: number;
}

interface TerminalSession {
  url: string;
  token: string;
  start: InteractiveStart;
}

type ConnectionState = 'connecting' | 'ready' | 'ended' | 'unavailable';

const encoder = new TextEncoder();

/**
 * xterm is only the display and input device. The bytes come from a real PTY
 * running the packaged Arcade CLI in an isolated Vercel Sandbox session.
 */
export function ArcadeTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const abort = new AbortController();
    const terminal = new Terminal({
      allowTransparency: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: 'var(--font-geist-mono), Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.08,
      scrollback: 5_000,
      theme: {
        background: '#000000',
        foreground: '#ededed',
        cursor: '#ededed',
        cursorAccent: '#000000',
        selectionBackground: '#333333',
        black: '#000000',
        brightBlack: '#666666',
      },
    });
    const fit = new FitAddon();
    let socket: WebSocket | null = null;
    let started = false;
    let resizeTimer = 0;

    terminal.loadAddon(fit);
    terminal.open(container);
    terminalRef.current = terminal;
    terminal.writeln('\x1b[2mStarting an isolated Arcade shell…\x1b[0m');

    const fitTerminal = () => {
      if (abort.signal.aborted || !terminal.element?.isConnected || container.clientWidth <= 0) return;
      try {
        fit.fit();
      } catch {
        // xterm can briefly report zero dimensions while CSS/fonts settle.
      }
    };

    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        fitTerminal();
        if (started && socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
        }
      }, 40);
    });
    observer.observe(container);

    const dataDisposable = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN && started) socket.send(encoder.encode(data));
    });

    const connect = async () => {
      try {
        const response = await fetch('/api/terminal/session', {
          method: 'POST',
          body: JSON.stringify({ cols: terminal.cols, rows: terminal.rows }),
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          signal: abort.signal,
        });
        if (!response.ok) throw new Error('session unavailable');
        const session = await response.json() as TerminalSession;
        if (abort.signal.aborted) return;

        const url = new URL(session.url);
        url.searchParams.set('token', session.token);
        socket = new WebSocket(url);
        socket.binaryType = 'arraybuffer';
        socket.addEventListener('open', () => {
          if (!socket) return;
          fitTerminal();
          socket.send(JSON.stringify({
            type: 'start',
            ...session.start,
            cols: terminal.cols,
            rows: terminal.rows,
          }));
          started = true;
          setConnection('ready');
          terminal.focus();
        });
        socket.addEventListener('message', async (event) => {
          if (event.data instanceof ArrayBuffer) {
            terminal.write(new Uint8Array(event.data));
            return;
          }
          if (event.data instanceof Blob) {
            terminal.write(new Uint8Array(await event.data.arrayBuffer()));
            return;
          }
          handleControlMessage(terminal, String(event.data), setConnection);
        });
        socket.addEventListener('close', () => {
          if (abort.signal.aborted) return;
          started = false;
          setConnection('ended');
          terminal.writeln('\r\n\x1b[2mSession ended. Use Restart shell to begin again.\x1b[0m');
        });
        socket.addEventListener('error', () => {
          if (!abort.signal.aborted) setConnection('unavailable');
        });
      } catch (error) {
        if (abort.signal.aborted) return;
        console.error('Unable to connect to Arcade terminal:', error);
        setConnection('unavailable');
        terminal.writeln('\r\n\x1b[31mThe hosted terminal is temporarily unavailable.\x1b[0m');
        terminal.writeln('\x1b[2mInstall locally with: npm i -g @vercel/arcade\x1b[0m');
        terminal.writeln('\x1b[2mOr: curl -fsSL https://vercel-arcade.vercel.app/install | sh\x1b[0m');
      }
    };

    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (abort.signal.aborted) return;
      requestAnimationFrame(() => {
        if (abort.signal.aborted) return;
        fitTerminal();
        void connect();
      });
    });

    const focus = () => terminal.focus();
    container.addEventListener('pointerdown', focus);
    return () => {
      abort.abort();
      window.clearTimeout(resizeTimer);
      observer.disconnect();
      dataDisposable.dispose();
      container.removeEventListener('pointerdown', focus);
      socket?.close();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [attempt]);

  return (
    <div className="arcade-terminal" aria-label="Interactive Arcade command line">
      <div className="arcade-terminal__viewport" ref={containerRef} />
      <div className="arcade-terminal__bar">
        <span>{connectionLabel(connection)}</span>
        <div>
          <button onClick={() => terminalRef.current?.focus()} type="button">Focus</button>
          <button onClick={() => {
            setConnection('connecting');
            setAttempt((value) => value + 1);
          }} type="button">Restart shell</button>
        </div>
      </div>
    </div>
  );
}

function handleControlMessage(
  terminal: Terminal,
  raw: string,
  setConnection: (state: ConnectionState) => void,
): void {
  try {
    const message = JSON.parse(raw) as { type?: string; exitCode?: number };
    if (message.type === 'exit') {
      setConnection('ended');
      terminal.writeln(`\r\n\x1b[2mShell exited${typeof message.exitCode === 'number' ? ` (${message.exitCode})` : ''}.\x1b[0m`);
    }
  } catch {
    terminal.write(raw);
  }
}

function connectionLabel(state: ConnectionState): string {
  if (state === 'ready') return 'Live shell · type help for commands';
  if (state === 'ended') return 'Session ended';
  if (state === 'unavailable') return 'Terminal unavailable';
  return 'Starting shell…';
}
