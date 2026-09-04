'use client';

import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { ARCADE_UNICODE_VERSION, arcadeUnicodeProvider } from '@vercel/arcade/web';
import { useEffect, useRef, useState } from 'react';
import { HOSTED_SHELL_GUIDE, TerminalModeDetector, TerminalModeOutputFilter, hostedBrowserUrl, terminalFontGeometry, terminalFontSize, type HostedTerminalMode } from './terminal-mode';
import { acquireArcadeTerminalSession, prepareArcadeTerminalSession, warmArcadeTerminalBase } from './terminal-session-client';
import { pinchWheelSteps, sgrMouse, terminalCell } from './terminal-touch';

export { prepareArcadeTerminalSession, warmArcadeTerminalBase };

type ConnectionState = 'connecting' | 'ready' | 'ended' | 'unavailable';

const encoder = new TextEncoder();

/**
 * xterm is only the display and input device. The bytes come from a real PTY
 * running the packaged Arcade CLI in an isolated Vercel Sandbox session.
 */
export function ArcadeTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [mode, setMode] = useState<HostedTerminalMode>('shell');
  const [portrait, setPortrait] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const abort = new AbortController();
    const portraitQuery = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    setPortrait(portraitQuery.matches);
    const fontSize = terminalFontSize(window.innerWidth, coarsePointer.matches);
    const fontGeometry = terminalFontGeometry(fontSize);
    const resolvedMono = getComputedStyle(document.documentElement).getPropertyValue('--font-geist-mono').trim();
    const terminal = new Terminal({
      allowProposedApi: true,
      allowTransparency: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: resolvedMono || 'Geist Mono, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize,
      letterSpacing: fontGeometry.letterSpacing,
      lineHeight: fontGeometry.lineHeight,
      scrollback: 1_000,
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
    terminal.unicode.register(arcadeUnicodeProvider);
    terminal.unicode.activeVersion = ARCADE_UNICODE_VERSION;
    const fit = new FitAddon();
    let socket: WebSocket | null = null;
    let started = false;
    let resizeTimer = 0;
    const modeDetector = new TerminalModeDetector();
    const outputFilter = new TerminalModeOutputFilter();
    const outputDecoder = new TextDecoder();
    let terminalMode: HostedTerminalMode = 'shell';
    let shellCommand = '';
    const touches = new Map<number, { x: number; y: number }>();
    let touchStart: { id: number; x: number; y: number; moved: boolean } | null = null;
    let pinchDistance = 0;
    let longPressTimer = 0;
    let longPressed = false;
    let firstPtyOutput = false;
    let pendingInput = '';
    let inputFrame = 0;

    terminal.loadAddon(fit);
    terminal.open(container);
    const bufferDisposable = terminal.onWriteParsed(() => {
      syncInputMode(terminal.buffer.active.type === 'alternate' ? 'arcade' : 'shell');
    });
    const modeDisposable = terminal.parser.registerOscHandler(777, (data) => {
      if (data === 'arcade=1') syncInputMode('arcade');
      else if (data === 'arcade=0') syncInputMode('shell');
      else return false;
      return true;
    });
    const browserDisposable = terminal.parser.registerOscHandler(778, (data) => {
      const url = hostedBrowserUrl(data);
      if (!url) return false;
      setAuthUrl(url);
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    });
    terminal.write(HOSTED_SHELL_GUIDE);

    const fitTerminal = () => {
      if (abort.signal.aborted || !terminal.element?.isConnected || container.clientWidth <= 0) return;
      try {
        const nextFontSize = terminalFontSize(window.innerWidth, coarsePointer.matches);
        const nextGeometry = terminalFontGeometry(nextFontSize);
        terminal.options.fontSize = nextFontSize;
        terminal.options.letterSpacing = nextGeometry.letterSpacing;
        terminal.options.lineHeight = nextGeometry.lineHeight;
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

    const syncInputMode = (next: HostedTerminalMode) => {
      // The browser action is only a fallback while device authorization is pending.
      // Re-entering Arcade proves that flow finished (or ended), so stale auth chrome
      // must not cover the app's own menu and chat controls or reappear after exit.
      if (next === 'arcade') setAuthUrl(null);
      if (next === terminalMode) return;
      terminalMode = next;
      setMode(next);
      const textarea = terminal.textarea;
      if (!textarea) return;
      textarea.inputMode = next === 'arcade' ? 'none' : 'text';
      textarea.setAttribute('enterkeyhint', next === 'arcade' ? '' : 'send');
      if (next === 'arcade') textarea.blur();
    };

    const writePtyOutput = (data: Uint8Array | string) => {
      const text = typeof data === 'string' ? data : outputDecoder.decode(data, { stream: true });
      const filtered = outputFilter.push(text);
      syncInputMode(filtered.mode === 'shell' ? modeDetector.push(filtered.output) : filtered.mode);
      if (filtered.output) {
        if (!firstPtyOutput) { terminal.clear(); firstPtyOutput = true; setConnection('ready'); }
        terminal.write(filtered.output);
      }
    };

    const flushInput = () => {
      inputFrame = 0;
      if (!pendingInput || socket?.readyState !== WebSocket.OPEN || !started) return;
      socket.send(encoder.encode(pendingInput));
      pendingInput = '';
    };

    const dataDisposable = terminal.onData((data) => {
      if (terminalMode === 'shell') {
        if (data === '\r' || data === '\n') {
          if (/^\s*arcade(?:\s|$)/.test(shellCommand)) syncInputMode('arcade');
          shellCommand = '';
        } else if (data === '\x7f') shellCommand = shellCommand.slice(0, -1);
        else if (!data.startsWith('\x1b')) shellCommand += data;
      }
      pendingInput += data;
      if (!inputFrame) inputFrame = requestAnimationFrame(flushInput);
    });

    const connect = async () => {
      try {
        const session = await acquireArcadeTerminalSession(terminal.cols, terminal.rows, abort.signal);
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
          flushInput();
          if (terminal.textarea) terminal.textarea.inputMode = 'text';
          // Desktop users can type immediately. On phones, wait for an explicit
          // shell tap so opening the panel does not summon the software keyboard.
          if (!window.matchMedia('(pointer: coarse)').matches) terminal.focus();
        });
        socket.addEventListener('message', async (event) => {
          if (event.data instanceof ArrayBuffer) {
            writePtyOutput(new Uint8Array(event.data));
            return;
          }
          if (event.data instanceof Blob) {
            writePtyOutput(new Uint8Array(await event.data.arrayBuffer()));
            return;
          }
          handleControlMessage(terminal, String(event.data), setConnection, writePtyOutput);
        });
        socket.addEventListener('close', () => {
          if (abort.signal.aborted) return;
          started = false;
          setConnection('ended');
          terminal.writeln('\r\n\x1b[2mSession ended. Close and reopen the terminal to start a new shell.\x1b[0m');
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
      }
    };

    fitTerminal();
    void connect();
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (abort.signal.aborted) return;
      requestAnimationFrame(() => {
        if (abort.signal.aborted) return;
        fitTerminal();
        if (started && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      });
    });

    const focus = (event: PointerEvent) => {
      if (terminalMode === 'arcade') {
        terminal.textarea?.blur();
        return;
      }
      // Shell mode deliberately preserves tap-to-type for commands such as
      // `arcade`, `ls`, and `help`.
      if (event.pointerType === 'touch' || document.activeElement !== terminal.textarea) terminal.focus();
    };
    const sendMouse = (kind: Parameters<typeof sgrMouse>[0], clientX: number, clientY: number) => {
      if (!started || socket?.readyState !== WebSocket.OPEN) return;
      const rect = terminal.element?.getBoundingClientRect() ?? container.getBoundingClientRect();
      const cell = terminalCell(clientX, clientY, { left: rect.left, top: rect.top, width: rect.width, height: rect.height, cols: terminal.cols, rows: terminal.rows });
      socket.send(encoder.encode(sgrMouse(kind, cell.x, cell.y)));
    };
    const clearLongPress = () => { window.clearTimeout(longPressTimer); longPressTimer = 0; };
    const onTouchPointerDown = (event: PointerEvent) => {
      if (terminalMode !== 'arcade' || event.pointerType !== 'touch') return;
      event.preventDefault(); event.stopPropagation();
      container.setPointerCapture(event.pointerId);
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      longPressed = false;
      if (touches.size === 1) {
        touchStart = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        sendMouse('left-down', event.clientX, event.clientY);
        longPressTimer = window.setTimeout(() => {
          if (!touchStart || touchStart.moved || touches.size !== 1) return;
          sendMouse('left-up', touchStart.x, touchStart.y);
          sendMouse('right-down', touchStart.x, touchStart.y);
          sendMouse('right-up', touchStart.x, touchStart.y);
          longPressed = true;
        }, 520);
      } else if (touches.size === 2) {
        clearLongPress();
        if (touchStart) sendMouse('left-up', touchStart.x, touchStart.y);
        touchStart = null;
        const [a, b] = [...touches.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const onTouchPointerMove = (event: PointerEvent) => {
      if (terminalMode !== 'arcade' || event.pointerType !== 'touch' || !touches.has(event.pointerId)) return;
      event.preventDefault(); event.stopPropagation();
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const steps = pinchWheelSteps(pinchDistance, distance);
        if (steps) {
          const kind = steps > 0 ? 'wheel-up' : 'wheel-down';
          for (let index = 0; index < Math.abs(steps); index++) sendMouse(kind, (a.x + b.x) / 2, (a.y + b.y) / 2);
          pinchDistance += steps * 18;
        }
        return;
      }
      if (!touchStart || touchStart.id !== event.pointerId || longPressed) return;
      if (Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y) > 6) { touchStart.moved = true; clearLongPress(); }
      if (touchStart.moved) sendMouse('left-drag', event.clientX, event.clientY);
    };
    const onTouchPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !touches.has(event.pointerId)) return;
      event.preventDefault(); event.stopPropagation();
      const wasPrimary = touchStart?.id === event.pointerId;
      touches.delete(event.pointerId); clearLongPress();
      if (wasPrimary && !longPressed) sendMouse('left-up', event.clientX, event.clientY);
      touchStart = null; pinchDistance = 0; longPressed = false;
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
    };
    const onViewportResize = () => {
      setPortrait(portraitQuery.matches);
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        fitTerminal();
        if (started && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      }, 80);
    };
    container.addEventListener('pointerdown', focus);
    container.addEventListener('pointerdown', onTouchPointerDown, { capture: true });
    container.addEventListener('pointermove', onTouchPointerMove, { capture: true });
    container.addEventListener('pointerup', onTouchPointerUp, { capture: true });
    container.addEventListener('pointercancel', onTouchPointerUp, { capture: true });
    window.addEventListener('orientationchange', onViewportResize);
    window.visualViewport?.addEventListener('resize', onViewportResize);
    portraitQuery.addEventListener('change', onViewportResize);
    return () => {
      abort.abort();
      if (inputFrame) cancelAnimationFrame(inputFrame);
      window.clearTimeout(resizeTimer);
      observer.disconnect();
      dataDisposable.dispose();
      bufferDisposable.dispose();
      modeDisposable.dispose();
      browserDisposable.dispose();
      container.removeEventListener('pointerdown', focus);
      container.removeEventListener('pointerdown', onTouchPointerDown, { capture: true });
      container.removeEventListener('pointermove', onTouchPointerMove, { capture: true });
      container.removeEventListener('pointerup', onTouchPointerUp, { capture: true });
      container.removeEventListener('pointercancel', onTouchPointerUp, { capture: true });
      window.removeEventListener('orientationchange', onViewportResize);
      window.visualViewport?.removeEventListener('resize', onViewportResize);
      portraitQuery.removeEventListener('change', onViewportResize);
      socket?.close();
      terminal.dispose();
    };
  }, []);

  return (
    <div
      aria-busy={connection === 'connecting'}
      aria-label={`Interactive Arcade command line. ${connectionLabel(connection)}`}
      className={`arcade-terminal is-${mode}`}
      data-terminal-mode={mode}
    >
      <div className="arcade-terminal__viewport" ref={containerRef} />
      {authUrl ? (
        <a className="arcade-terminal__auth-link" href={authUrl} rel="noopener noreferrer" target="_blank" onClick={() => setAuthUrl(null)}>
          Continue Vercel sign-in ↗
        </a>
      ) : null}
      {mode === 'arcade' && portrait ? (
        <div aria-live="polite" className="arcade-terminal__rotate-hint">
          <span aria-hidden="true">↻</span>
          Rotate for the full Arcade layout
        </div>
      ) : null}
    </div>
  );
}

function handleControlMessage(
  terminal: Terminal,
  raw: string,
  setConnection: (state: ConnectionState) => void,
  writeOutput: (data: string) => void,
): void {
  try {
    const message = JSON.parse(raw) as { type?: string; exitCode?: number };
    if (message.type === 'exit') {
      setConnection('ended');
      terminal.writeln(`\r\n\x1b[2mShell exited${typeof message.exitCode === 'number' ? ` (${message.exitCode})` : ''}.\x1b[0m`);
    }
  } catch {
    writeOutput(raw);
  }
}

function connectionLabel(state: ConnectionState): string {
  if (state === 'ready') return 'Live shell · type help for commands';
  if (state === 'ended') return 'Session ended';
  if (state === 'unavailable') return 'Terminal unavailable';
  return 'Starting shell…';
}
