// Parses the raw stdin byte stream into keyboard and mouse events. Sequences can
// arrive split across chunks, so any unparsed tail is buffered until the next
// chunk completes it.

export type Key =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'escape'
  | 'quit'
  | (string & {});

export interface MouseEvent {
  type: 'down' | 'up' | 'drag' | 'move' | 'wheel';
  button: number;
  x: number;
  y: number;
  /** -1 = wheel up, +1 = wheel down. Only set for `wheel` events. */
  wheel?: -1 | 1;
}

export interface Handlers {
  onKey?: (key: Key) => void;
  onMouse?: (event: MouseEvent) => void;
}

const MOUSE_SEQ = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

export function createInputParser(handlers: Handlers): (chunk: string) => void {
  let pending = '';

  return (chunk: string) => {
    let s = pending + chunk;
    pending = '';

    while (s.length > 0) {
      if (s.startsWith('\x1b[<')) {
        const m = MOUSE_SEQ.exec(s);
        if (!m) {
          // Incomplete mouse sequence — wait for the rest.
          pending = s;
          return;
        }
        handlers.onMouse?.(decodeMouse(Number(m[1]), Number(m[2]), Number(m[3]), m[4]));
        s = s.slice(m[0].length);
        continue;
      }

      if (s.startsWith('\x1b[')) {
        if (s.length < 3) {
          pending = s;
          return;
        }
        const arrow = { A: 'up', B: 'down', C: 'right', D: 'left' }[s[2]];
        if (arrow) handlers.onKey?.(arrow);
        s = s.slice(3);
        continue;
      }

      const ch = s[0];
      s = s.slice(1);
      if (ch === '\x03') handlers.onKey?.('quit'); // Ctrl-C (no SIGINT in raw mode)
      else if (ch === '\x1b') handlers.onKey?.('escape');
      else handlers.onKey?.(ch);
    }
  };
}

function decodeMouse(cb: number, x: number, y: number, terminator: string): MouseEvent {
  const button = cb & 3;
  const isMotion = (cb & 32) !== 0;
  const isWheel = (cb & 64) !== 0;

  if (isWheel) {
    return { type: 'wheel', button, x, y, wheel: button === 0 ? -1 : 1 };
  }
  if (isMotion) {
    // button === 3 means no button is held, so it's a bare move, not a drag.
    return { type: button === 3 ? 'move' : 'drag', button, x, y };
  }
  return { type: terminator === 'M' ? 'down' : 'up', button, x, y };
}
