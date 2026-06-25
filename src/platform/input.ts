// Parses the raw stdin byte stream into keyboard and mouse events. Sequences can
// arrive split across chunks, so any unparsed tail is buffered until the next
// chunk completes it.

// A keyboard event. `name` is the normalized key for bindings/dispatch — letters
// are lowercased with `shift` carrying the case, named keys are spelled out
// ('up', 'escape', 'enter', 'tab', 'space', 'backspace'). `raw` is the literal
// character typed (use it for text input — preserves case/punctuation); for pure
// escape sequences (arrows, shift-tab) `raw` is '' and `sequence` is the bytes.
export interface KeyEvent {
  name: string;
  raw: string;
  sequence: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  eventType: 'press';
}

export interface MouseEvent {
  type: 'down' | 'up' | 'drag' | 'move' | 'wheel';
  button: number;
  x: number;
  y: number;
  /** -1 = wheel up, +1 = wheel down. Only set for `wheel` events. */
  wheel?: -1 | 1;
  /** Modifier keys held during the event (SGR mouse encoding). */
  shift: boolean;
  /** Meta/Alt (Option on macOS; some terminals also map ⌘ here). */
  meta: boolean;
  ctrl: boolean;
}

export interface Handlers {
  onKey?: (event: KeyEvent) => void;
  onMouse?: (event: MouseEvent) => void;
}

const MOUSE_SEQ = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

// Build a KeyEvent for a pure escape sequence (arrows, shift-tab) — no literal
// char, so `raw` is empty and `sequence` carries the bytes.
function seqKey(name: string, sequence: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { name, raw: '', sequence, ctrl: false, shift: false, meta: false, eventType: 'press', ...mods };
}

// Classify a single literal character into a KeyEvent. Control chars (ctrl-a..z),
// named keys (enter/tab/space/escape/backspace), and letter case→shift are
// normalized into `name`; `raw` keeps the byte as typed for text input.
function charKey(ch: string): KeyEvent {
  const code = ch.charCodeAt(0);
  let name = ch;
  let ctrl = false;
  let shift = false;
  if (ch === '\r' || ch === '\n') name = 'enter';
  else if (ch === '\t') name = 'tab';
  else if (ch === ' ') name = 'space';
  else if (ch === '\x1b') name = 'escape';
  else if (ch === '\x7f' || ch === '\b') name = 'backspace';
  else if (code >= 1 && code <= 26) {
    name = String.fromCharCode(code + 96); // ctrl-a..z → 'a'..'z'
    ctrl = true;
  } else if (ch >= 'A' && ch <= 'Z') {
    name = ch.toLowerCase();
    shift = true;
  }
  return { name, raw: ch, sequence: ch, ctrl, shift, meta: false, eventType: 'press' };
}

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
        if (arrow) handlers.onKey?.(seqKey(arrow, s.slice(0, 3)));
        else if (s[2] === 'Z') handlers.onKey?.(seqKey('tab', '\x1b[Z', { shift: true })); // Shift+Tab
        s = s.slice(3);
        continue;
      }

      const ch = s[0];
      s = s.slice(1);
      handlers.onKey?.(charKey(ch));
    }
  };
}

function decodeMouse(cb: number, x: number, y: number, terminator: string): MouseEvent {
  const button = cb & 3;
  const isMotion = (cb & 32) !== 0;
  const isWheel = (cb & 64) !== 0;
  // Modifier bits per the SGR mouse encoding.
  const mods = { shift: (cb & 4) !== 0, meta: (cb & 8) !== 0, ctrl: (cb & 16) !== 0 };

  if (isWheel) {
    return { type: 'wheel', button, x, y, wheel: button === 0 ? -1 : 1, ...mods };
  }
  if (isMotion) {
    // button === 3 means no button is held, so it's a bare move, not a drag.
    return { type: button === 3 ? 'move' : 'drag', button, x, y, ...mods };
  }
  return { type: terminator === 'M' ? 'down' : 'up', button, x, y, ...mods };
}
