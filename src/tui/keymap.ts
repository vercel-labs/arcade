// A declarative, layered keymap over named commands. Instead of a per-screen
// if/else on key strings, an action is registered once as a Command with a
// stable id, and keys are bound to that id within a named layer (a "context"
// like 'attract' or 'chess'). Contexts form a stack; the topmost layer that
// binds a key wins, so a modal context ('promoting') can shadow the screen and
// the global layer beneath it.
//
// The command list is also the app's *named action surface* — the same ids a
// human triggers by key, an AI agent can trigger by id (see commands()). And
// because handle() is pure (KeyEvent in, command-fired out), the whole mapping
// is testable headlessly with synthetic events.

import type { KeyEvent } from '../platform/input.ts';

export interface Command {
  id: string;
  run: () => void;
  title?: string; // human/agent-facing label
}

export interface Binding {
  key: string; // normalized chord, e.g. 'q', 'shift+tab', 'ctrl+c'
  cmd: string; // Command id
}

// Canonical binding string for an event: [ctrl+][shift+][meta+]name. Shift is
// only encoded for named keys (e.g. 'shift+tab'); for printable characters the
// case is already folded into `name` ('Q' → name 'q'), so a binding 'q' matches
// both — matching the old `key === 'q' || key === 'Q'` behavior.
export function eventToChord(ev: KeyEvent): string {
  const parts: string[] = [];
  if (ev.ctrl) parts.push('ctrl');
  if (ev.shift && ev.name.length > 1) parts.push('shift');
  if (ev.meta) parts.push('meta');
  parts.push(ev.name);
  return parts.join('+');
}

interface Context {
  name: string;
  // A modal context is the search floor: keys it doesn't bind are swallowed
  // rather than falling through to the layers beneath it (so 'q' can't quit
  // while a modal picker is up).
  modal: boolean;
}

export class Keymap {
  private commandMap = new Map<string, Command>();
  // layer name → (chord → command id)
  private layers = new Map<string, Map<string, string>>();
  // Active context stack, searched top-down. 'global' is always the base.
  private contexts: Context[] = [{ name: 'global', modal: false }];

  register(cmd: Command): void {
    this.commandMap.set(cmd.id, cmd);
  }

  bind(layer: string, b: Binding): void {
    let m = this.layers.get(layer);
    if (!m) {
      m = new Map();
      this.layers.set(layer, m);
    }
    m.set(b.key, b.cmd);
  }

  // Replace the base context stack (keeps 'global' at the bottom). Used on screen
  // transitions so the active layer matches the current mode.
  setBase(...layers: string[]): void {
    this.contexts = [{ name: 'global', modal: false }, ...layers.map((name) => ({ name, modal: false }))];
  }

  pushContext(name: string, modal = false): void {
    this.contexts.push({ name, modal });
  }

  // Remove the topmost occurrence of `name` (never the 'global' base).
  popContext(name: string): void {
    for (let i = this.contexts.length - 1; i > 0; i--) {
      if (this.contexts[i].name === name) {
        this.contexts.splice(i, 1);
        return;
      }
    }
  }

  hasContext(name: string): boolean {
    return this.contexts.some((c) => c.name === name);
  }

  // The command id bound to this event in the active contexts, or null. Searches
  // from the top of the stack down — the first layer that binds the chord wins,
  // and a modal layer stops the search (its unbound keys don't fall through).
  resolve(ev: KeyEvent): string | null {
    const chord = eventToChord(ev);
    for (let i = this.contexts.length - 1; i >= 0; i--) {
      const c = this.contexts[i];
      const id = this.layers.get(c.name)?.get(chord);
      if (id) return id;
      if (c.modal) break;
    }
    return null;
  }

  // Resolve and run. Returns true if a command fired, OR if a modal context is
  // active (it swallows unbound keys so they don't leak to app handlers).
  handle(ev: KeyEvent): boolean {
    const id = this.resolve(ev);
    if (id) {
      this.commandMap.get(id)?.run();
      return true;
    }
    return this.contexts.some((c) => c.modal);
  }

  // The full command catalog — the surface an AI agent drives the app through.
  commands(): Command[] {
    return [...this.commandMap.values()];
  }
}
