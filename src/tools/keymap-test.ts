// Headless checks for the Phase 5 keyboard stack: the input parser's KeyEvent
// classification and the layered Keymap (precedence, modal swallowing, the
// named-command surface). No TTY, no snapshot — pure assertions, exit non-zero
// on failure. This is the "no test runner" stand-in the plan calls for.
//
//   pnpm exec tsx src/tools/keymap-test.ts

import { createInputParser, type KeyEvent } from '../platform/input.ts';
import { Keymap, eventToChord } from '../tui/index.ts';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
  } else {
    console.log(`  ✓ ${msg}`);
  }
}

// Drive a raw byte string through the parser, collecting the KeyEvents it emits.
function parseKeys(raw: string): KeyEvent[] {
  const out: KeyEvent[] = [];
  const parse = createInputParser({ onKey: (ev) => out.push(ev) });
  parse(raw);
  return out;
}

console.log('input parser → KeyEvent:');
{
  const [q] = parseKeys('q');
  ok(q.name === 'q' && !q.shift && !q.ctrl && q.raw === 'q', "'q' → name q");
  const [Q] = parseKeys('Q');
  ok(Q.name === 'q' && Q.shift && Q.raw === 'Q', "'Q' → name q, shift, raw Q (case folded)");
  const [up] = parseKeys('\x1b[A');
  ok(up.name === 'up' && up.raw === '', "ESC[A → up");
  const [stab] = parseKeys('\x1b[Z');
  ok(stab.name === 'tab' && stab.shift, 'ESC[Z → tab + shift');
  const [tab] = parseKeys('\t');
  ok(tab.name === 'tab' && !tab.shift, 'TAB → tab');
  const [enter] = parseKeys('\r');
  ok(enter.name === 'enter', 'CR → enter');
  const [space] = parseKeys(' ');
  ok(space.name === 'space' && space.raw === ' ', 'SPACE → space (raw preserved)');
  const [esc] = parseKeys('\x1b');
  ok(esc.name === 'escape', 'ESC → escape');
  const [ctrlc] = parseKeys('\x03');
  ok(ctrlc.name === 'c' && ctrlc.ctrl, 'Ctrl-C → ctrl+c');
  ok(eventToChord(ctrlc) === 'ctrl+c', 'eventToChord(ctrl-c) === "ctrl+c"');
  ok(eventToChord(Q) === 'q', 'eventToChord(Q) === "q" (shift folded for letters)');
  ok(eventToChord(stab) === 'shift+tab', 'eventToChord(shift-tab) === "shift+tab"');
}

console.log('keymap precedence + modal:');
{
  const fired: string[] = [];
  const km = new Keymap();
  for (const id of ['app.quit', 'view.cycleRenderMode', 'nav.demo', 'chess.resetView', 'chess.cancelPromotion']) {
    km.register({ id, run: () => fired.push(id) });
  }
  km.bind('global', { key: 'q', cmd: 'app.quit' });
  km.bind('global', { key: 'escape', cmd: 'app.quit' });
  km.bind('global', { key: 'm', cmd: 'view.cycleRenderMode' });
  km.bind('prism', { key: 'd', cmd: 'nav.demo' });
  km.bind('chess', { key: 'r', cmd: 'chess.resetView' });
  km.bind('promoting', { key: 'escape', cmd: 'chess.cancelPromotion' });

  const send = (raw: string): boolean => km.handle(parseKeys(raw)[0]);

  km.setBase('prism');
  fired.length = 0;
  ok(send('d') && fired[0] === 'nav.demo', "prism: 'd' → nav.demo");
  fired.length = 0;
  ok(send('m') && fired[0] === 'view.cycleRenderMode', "prism: 'm' → global cycle");
  fired.length = 0;
  ok(send('r') === false && fired.length === 0, "prism: 'r' not bound → no command");

  km.setBase('chess');
  fired.length = 0;
  ok(send('r') && fired[0] === 'chess.resetView', "chess: 'r' → resetView");
  fired.length = 0;
  ok(send('d') === false, "chess: 'd' (prism-only) not bound");

  // Modal: 'promoting' shadows escape and swallows everything else.
  km.pushContext('promoting', true);
  fired.length = 0;
  ok(send('\x1b') && fired[0] === 'chess.cancelPromotion', "promoting: escape → cancel (shadows quit)");
  fired.length = 0;
  ok(send('q') === true && fired.length === 0, "promoting: 'q' swallowed (modal), no quit");
  fired.length = 0;
  ok(send('r') === true && fired.length === 0, "promoting: 'r' swallowed (modal)");
  km.popContext('promoting');
  fired.length = 0;
  ok(send('q') && fired[0] === 'app.quit', "after pop: 'q' → quit again");

  ok(km.commands().length === 5, 'commands() catalog lists all 5 registered ids');
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall keymap/input assertions passed');
