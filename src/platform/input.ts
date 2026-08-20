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
  super?: boolean; // Command/Super when the terminal's keyboard protocol reports it
  eventType: 'press';
}

export interface MouseEvent {
  type: 'down' | 'up' | 'drag' | 'move' | 'wheel';
  button: number;
  x: number;
  y: number;
  /** -1 = up/left, +1 = down/right. Only set for `wheel` events. */
  wheel?: -1 | 1;
  /** SGR wheel buttons 64/65 are vertical; 66/67 are horizontal. */
  wheelAxis?: 'vertical' | 'horizontal';
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

function csiModifiers(value: number): Partial<KeyEvent> {
  const bits = Math.max(0, value - 1);
  return {
    shift: (bits & 1) !== 0,
    meta: (bits & 2) !== 0 || (bits & 32) !== 0,
    ctrl: (bits & 4) !== 0,
    super: (bits & 8) !== 0,
  };
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
        // CSI key sequences may include an xterm/Kitty modifier parameter:
        // ESC[1;3D = Option-Left, ESC[1;5D = Ctrl-Left, ESC[1;9D =
        // Command/Super-Left. Keep an incomplete sequence for the next chunk.
        const m = /^\x1b\[([0-9;]*)([A-Za-z~])/.exec(s);
        if (!m) {
          pending = s;
          return;
        }
        const params = m[1] ? m[1].split(';').map(Number) : [];
        const final = m[2];
        const modifier = params.length > 1 ? params[params.length - 1] : 1;
        const mods = csiModifiers(modifier);
        const arrow = { A: 'up', B: 'down', C: 'right', D: 'left' }[final];
        let name = arrow;
        if (final === 'H' || (final === '~' && (params[0] === 1 || params[0] === 7))) name = 'home';
        else if (final === 'F' || (final === '~' && (params[0] === 4 || params[0] === 8))) name = 'end';
        else if (final === '~' && params[0] === 3) name = 'delete';
        if (name) handlers.onKey?.(seqKey(name, m[0], mods));
        else if (final === 'Z') handlers.onKey?.(seqKey('tab', m[0], { ...mods, shift: true })); // Shift+Tab
        s = s.slice(m[0].length);
        continue;
      }

      // Traditional terminal encoding for Option/Alt plus a character is an ESC
      // prefix in the same chunk (not a CSI modifier). This is how
      // Option-Backspace commonly arrives on macOS.
      if (s.startsWith('\x1b') && s.length > 1) {
        const ev = charKey(s[1]);
        handlers.onKey?.({ ...ev, meta: true, sequence: s.slice(0, 2) });
        s = s.slice(2);
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
    return {
      type: 'wheel',
      button,
      x,
      y,
      wheel: button % 2 === 0 ? -1 : 1,
      wheelAxis: button < 2 ? 'vertical' : 'horizontal',
      ...mods,
    };
  }
  if (isMotion) {
    // button === 3 means no button is held, so it's a bare move, not a drag.
    return { type: button === 3 ? 'move' : 'drag', button, x, y, ...mods };
  }
  return { type: terminator === 'M' ? 'down' : 'up', button, x, y, ...mods };
}
