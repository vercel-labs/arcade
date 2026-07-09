// Headless render of a frame to a PPM image (convert to PNG with `sips`). Lets
// rendered output be viewed as an image instead of a live TTY.
//
//   pnpm exec tsx src/tools/snapshot.ts [cols] [rows] [t] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts chess [cols] [rows] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts ui [cols] [rows] [hover=<id>|focus=<id>] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts overlay [chess|chess-game|prism] [cols] [rows] [out.ppm]
import { writeFileSync } from 'node:fs';
import { bloom, downsample, halfBlockToSurface, RenderTarget, shapeGlyphToSurface, Surface } from '../engine/index.ts';
import { FONT } from '../engine/font8x8.ts';
import { PrismScene, SplashScene } from '../prism/index.ts';
import { ChessScene } from '../arcade/games/chess/turntable.ts';
import { ChessGameScene } from '../arcade/games/chess/scene.ts';
import { LogosScene } from '../arcade/scenes/logos-scene.ts';
import { AudioScene } from '../arcade/scenes/audio-scene.ts';
import { CoverFlowScene } from '../arcade/shell/coverflow.ts';
import { MENU_ITEMS } from '../arcade/shell/menu.ts';
import { buildBar, buildGameOver, buildPromotion, type Mode } from '../arcade/shell/bars.ts';
import { buildShowcase, mountShowcase } from '../arcade/scenes/ui-showcase.ts';
import { buildChessGameRoot, mountChessHud, refreshMoveHistory } from '../arcade/games/chess/hud.ts';
import { type ChatMessage, clearChat, pushChatMessage } from '../arcade/games/chess/chat.ts';
import { evaluate } from '../rules/chess/eval.ts';
import { buildMatchSetup, mountMatchSetup } from '../arcade/match/setup.ts';
import { providers } from '../arcade/match/models.ts';
import { CardsScene, type CardsMode } from '../arcade/games/poker/cards-scene.ts';
import { buildPokerRoot, mountPokerHud } from '../arcade/games/poker/hud.ts';
import { PokerGameScene, type PokerSeatView } from '../arcade/games/poker/poker-scene.ts';
import { buildPokerGameRoot, clearPokerChat, mountPokerGameHud, pushPokerChat } from '../arcade/games/poker/poker-hud.ts';
import { buildPokerSetup, mountPokerSetup } from '../arcade/match/poker-setup.ts';
import { HoldemState } from '../rules/poker/holdem.ts';
import { mulberry32 } from '../arcade/scenes/wisp.ts';
import { RANK_LABELS, type Suit, SUIT_LETTERS } from '../rules/poker/cards.ts';
import type { Color } from '../rules/chess/types.ts';
import { Box, Button, Dropdown, layout, paint, Screen, type PaintState } from '../tui/index.ts';
import { buildTeamSwitch, markSwitchSucceeded, mountTeamSwitch, setTeamSwitchTeams } from '../arcade/shell/team-switch.ts';

type Rgb = [number, number, number];
// One terminal cell rasterizes to CW×CH pixels; the 8x8 glyph stamps top-left.
const CW = 8;
const CH = 8;

// Rasterize a Surface to a PPM at 8×8 px/cell: optionally fill each cell's two
// half-block background colors (the scene behind a transparent overlay), then
// stamp the bitmap-font glyph for opaque cells on top. Shared by the ui and
// overlay snapshots so their pixel output can't drift. `bgAt` returning null (or
// omitted) leaves the cell on the black background.
function surfaceToPpm(
  surf: Surface,
  cols: number,
  rows: number,
  out: string,
  bgAt?: (cx: number, cy: number) => { top: Rgb; bot: Rgb } | null,
): void {
  const W = cols * CW;
  const H = rows * CH;
  const body = Buffer.alloc(W * H * 3); // black background
  const put = (px: number, py: number, c: Rgb): void => {
    const i = (py * W + px) * 3;
    body[i] = Math.max(0, Math.min(255, c[0]));
    body[i + 1] = Math.max(0, Math.min(255, c[1]));
    body[i + 2] = Math.max(0, Math.min(255, c[2]));
  };
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const bg = bgAt?.(cx, cy) ?? null;
      if (bg) {
        // Scene first: top half = upper pixel, bottom half = lower pixel.
        for (let py = 0; py < CH; py++) {
          for (let px = 0; px < CW; px++) put(cx * CW + px, cy * CH + py, py < CH / 2 ? bg.top : bg.bot);
        }
      }
      const cell = surf.getCell(cx, cy);
      if (!cell || !cell.opaque) continue; // transparent → background shows through
      const glyph = FONT[cell.ch];
      for (let py = 0; py < CH; py++) {
        const bits = glyph?.[py] ?? '';
        for (let px = 0; px < CW; px++) {
          const on = glyph ? bits[px] === '1' : blockBits(cell.ch, px, py);
          put(cx * CW + px, cy * CH + py, on ? cell.fg : cell.bg);
        }
      }
    }
  }
  writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii'), body]));
  console.log(`wrote ${out} (${W}x${H})`);
}

// Rasterize a full-color display buffer (post downsample/bloom) straight to a
// PPM — the emissive/scene path, no Surface glyphs. Shared by every scene
// snapshot so the clamp + PPM header can't drift between them.
function writeDisplayPpm(display: RenderTarget, out: string): void {
  const W = display.width;
  const H = display.height;
  const body = Buffer.alloc(W * H * 3);
  const c = display.color;
  for (let i = 0; i < W * H * 3; i++) body[i] = c[i] <= 0 ? 0 : c[i] >= 255 ? 255 : Math.round(c[i]);
  writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii'), body]));
  console.log(`wrote ${out} (${W}x${H})`);
}

// The 8x8 ASCII font has no block/box-drawing glyphs, so for those chars we
// synthesize the pixel pattern procedurally — otherwise half-blocks, lines,
// borders, and the slider/scrollbar render blank in snapshots (they'd be fine in
// a real terminal). Covers the glyphs the TUI components actually emit. px/py are
// 0..7 within the cell; mid = the central 2 rows/cols (3,4).
function blockBits(ch: string, px: number, py: number): boolean {
  // Braille (U+2800..28FF): a 2×4 dot grid. Map the 8×8 cell to dots — col by x<4,
  // row by quarters of y — and test the dot's bit. Lets the menu's silhouettes show.
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0x2800 && cp <= 0x28ff) {
    const col = px < 4 ? 0 : 1;
    const row = py < 2 ? 0 : py < 4 ? 1 : py < 6 ? 2 : 3;
    const dot = [
      [0x01, 0x02, 0x04, 0x40],
      [0x08, 0x10, 0x20, 0x80],
    ][col][row];
    return ((cp - 0x2800) & dot) !== 0;
  }
  const midX = px === 3 || px === 4;
  const midY = py === 3 || py === 4;
  switch (ch) {
    case '█':
      return true;
    case '▀':
      return py < 4;
    case '▄':
      return py >= 4;
    case '▌':
      return px < 4;
    case '▐':
      return px >= 4;
    case '░':
      return (px + py) % 4 === 0;
    case '▒':
      return (px + py) % 2 === 0;
    case '▓':
      return (px + py) % 4 !== 0;
    case '─':
    case '━':
      return midY;
    case '│':
    case '┃':
      return midX;
    case '●':
      return (px - 3.5) ** 2 + (py - 3.5) ** 2 <= 7;
    case '•':
      return (px - 3.5) ** 2 + (py - 3.5) ** 2 <= 3;
    case '╭':
    case '┌':
      return (midY && px >= 3) || (midX && py >= 3);
    case '╮':
    case '┐':
      return (midY && px <= 4) || (midX && py >= 3);
    case '╰':
    case '└':
      return (midY && px >= 3) || (midX && py <= 4);
    case '╯':
    case '┘':
      return (midY && px <= 4) || (midX && py <= 4);
    case '⚙': {
      // No gear in the 8×8 font — approximate it as a hubbed ring (annulus) so the
      // settings snapshot shows a recognizable knob rather than a blank pill.
      const r2 = (px - 3.5) ** 2 + (py - 3.5) ** 2;
      return r2 <= 10 && r2 >= 2;
    }
    case '💬':
      // No emoji in the 8×8 font — approximate the speech balloon as a filled
      // rounded bubble body with a small tail at the bottom-left.
      return (px >= 1 && px <= 6 && py >= 0 && py <= 4) || (py === 5 && px >= 1 && px <= 2);
    case '✓':
      // Checkmark: a short down-stroke (lower-left) meeting a long up-stroke.
      return (px >= 1 && px <= 3 && Math.abs(py - (px + 2)) <= 0.6) || (px >= 3 && px <= 6 && Math.abs(py - (8 - px)) <= 0.6);
    case '✕':
    case '✗':
      // Cross: the two diagonals of the cell.
      return Math.abs(px - py) <= 1 || Math.abs(px + py - 7) <= 1;
    default:
      return false;
  }
}

const noop = (): void => {};
const barActions = { back: noop, reset: noop, mode: noop, quit: noop, aiMatch: noop, resetGame: noop, illegalMoves: noop, evalBar: noop, audioModel: noop, pokerAI: noop, pokerNewMatch: noop, pokerSeat: noop };

// Render a scene full-height, then composite that screen's button bar over it —
// proving the bar sits ON TOP of the 3D scene (opaque pills overwrite it;
// transparent gaps show it through).
function overlaySnapshot(): void {
  const scene = (process.argv[3] as Mode) ?? 'chess';
  const cols = Number(process.argv[4]) || 110;
  const rows = Number(process.argv[5]) || 40;
  const out = process.argv[6] ?? `.snapshots/overlay-${scene}.ppm`;
  const SS = 3;

  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  if (scene === 'chess') new ChessScene().renderScene(target);
  else if (scene === 'chess-game') new ChessGameScene().renderScene(target);
  else new PrismScene().renderScene(target, 0.6);
  const display = downsample(target, SS);
  if (scene === 'prism') bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });

  const root = buildBar(scene, 'ascii', barActions);
  const surf = new Surface(cols, rows);
  layout(root, { x: 0, y: rows - 2, w: cols, h: 1 });
  paint(root, surf, { hoverId: 'reset', focusId: null, pressedId: null });

  const dc = display.color; // cols × (rows*2), RGB floats
  const at = (x: number, y: number): Rgb => {
    const i = (y * cols + x) * 3;
    return [dc[i], dc[i + 1], dc[i + 2]];
  };
  surfaceToPpm(surf, cols, rows, out, (cx, cy) => ({ top: at(cx, cy * 2), bot: at(cx, cy * 2 + 1) }));
}

// Rasterize the button-bar tree (laid out + painted onto a Surface) to a PPM.
// Verifies layout, centering, wide chars, and hover/focus styling without a TTY.
function uiSnapshot(): void {
  const args = process.argv.slice(3);
  const cols = Number(args[0]) || 110;
  const rows = Number(args[1]) || 44;
  const stateArg = args.find((a) => a.includes('=')) ?? '';
  const out = args.find((a) => a.endsWith('.ppm')) ?? '.snapshots/ui.ppm';

  const state: PaintState = { hoverId: null, focusId: null, pressedId: null };
  const [k, v] = stateArg.split('=');
  if (k === 'hover') state.hoverId = v;
  else if (k === 'focus') state.focusId = v;
  else if (k === 'pressed') state.pressedId = v;

  const root = buildBar('chess-game', 'ascii', barActions);
  const surf = new Surface(cols, rows);
  layout(root, { x: 0, y: rows - 2, w: cols, h: 1 });
  paint(root, surf, state);

  surfaceToPpm(surf, cols, rows, out);
}

function sceneSnapshot(): void {
  const a0 = process.argv[2];
  const scene = a0 === 'chess' || a0 === 'chess-game' || a0 === 'logos' ? a0 : null;
  const args = scene ? process.argv.slice(3) : process.argv.slice(2);
  const cols = Number(args[0]) || 110;
  const rows = Number(args[1]) || 44;
  const t = Number(args[2]) || 0.6;
  const out = args[3] || `.snapshots/${scene ?? 'prism'}.ppm`;
  const SS = 3;

  const target = new RenderTarget(cols * SS, (rows - 1) * 2 * SS);
  if (scene === 'chess') {
    new ChessScene().renderScene(target);
  } else if (scene === 'chess-game') {
    const cg = new ChessGameScene();
    if (process.argv.includes('match')) {
      // Spin up the AI HUD and play a few opening moves (applied directly — no
      // animation wait) so the still shows a live board with the side-to-move
      // wisp pulsing.
      cg.beginMatch();
      for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']) {
        const m = cg.state().actionFromString(san);
        if (m) cg.state().applyAction(m);
      }
    }
    cg.renderScene(target, t);
  } else if (scene === 'logos') {
    new LogosScene().renderScene(target, t);
  } else {
    new PrismScene().renderScene(target, t);
  }
  const display = downsample(target, SS);
  // Bloom the emissive screens (prism + logo wisps); skip for solid chess geometry.
  if (!scene || scene === 'logos') bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });

  writeDisplayPpm(display, out);
}

// One line per subcommand; keep in sync as handlers are added/removed.
const HELP = `snapshot — render one frame headlessly to a .ppm (convert with sips, then Read the PNG)

  pnpm snapshot [cols] [rows] [t] [out.ppm]        prism scene (default; t = seconds)
  pnpm snapshot <chess|chess-game|logos> [cols] [rows] [t] [out]   a named 3D scene
      (chess-game also accepts 'match' to play a few opening plies first)

  pnpm snapshot ui [cols] [rows] [hover=<id>|focus=<id>|pressed=<id>] [out]   button bar
  pnpm snapshot overlay [chess|chess-game|prism] [cols] [rows] [out]   bar over a scene
  pnpm snapshot unified [prism|chess|chess-game|logos] [cols] [rows] [out]   unified compositing path
  pnpm snapshot showcase [cols] [rows] [focus=<id>] [out]   the UI component playground
  pnpm snapshot modal [cols] [rows] [out]          promotion modal over chess
  pnpm snapshot chess-overlay [cols] [rows] [min|empty|illegal|short] [eval] [out]   match HUD + moves panel
  pnpm snapshot setup [cols] [rows] [out] [open|models]   AI match setup modal
  pnpm snapshot gameover [cols] [rows] [out]       result popup over a finished board
  pnpm snapshot king-anim [cols] [rows] [out]      king caught mid-castle (wisp tracking)
  pnpm snapshot audio [cols] [rows] [out]          realtime audio scene (provider wisp)
  pnpm snapshot splash [cols] [rows] [t] [out]     boot splash at time t
  pnpm snapshot coverflow|menu [cols] [rows] [pos] [hover] [out]   Cover Flow carousel
  pnpm snapshot settings [cols] [rows] [open [loading|switched]] [out]   menu settings gear (open → team-switch modal)
  pnpm snapshot launch [cols] [rows] [index] [t] [out]   Cover Flow flip-to-title splash
  pnpm snapshot prism-prompt [cols] [rows] [t] [out]    prism loading screen + press-any-key marquee
  pnpm snapshot cards [single|hand|deck] [cols] [rows] [state] [out]   the cards screen
      (single: a code like Kh/10s/As · hand: peek|up · deck: shuffle|deal)
  pnpm snapshot poker [cols] [rows] [preflop|flop|river|showdown] [players=N] [hud] [spectate] [color] [out]   the poker table

Convert + view:  sips -s format png .snapshots/<name>.ppm --out .snapshots/<name>.png -Z 1000`;

// Dispatch at the bottom so the module-level consts above are initialized before
// a subcommand function runs (function declarations hoist; const/let do not).
if (process.argv[2] === 'help' || process.argv[2] === '--help' || process.argv[2] === '-h') {
  console.log(HELP);
} else if (process.argv[2] === 'ui') {
  uiSnapshot();
} else if (process.argv[2] === 'overlay') {
  overlaySnapshot();
} else if (process.argv[2] === 'unified') {
  unifiedSnapshot();
} else if (process.argv[2] === 'modal') {
  modalSnapshot();
} else if (process.argv[2] === 'showcase') {
  showcaseSnapshot();
} else if (process.argv[2] === 'chess-overlay') {
  chessOverlaySnapshot();
} else if (process.argv[2] === 'gameover') {
  gameOverSnapshot();
} else if (process.argv[2] === 'setup') {
  setupSnapshot();
} else if (process.argv[2] === 'king-anim') {
  kingAnimSnapshot();
} else if (process.argv[2] === 'audio') {
  audioSnapshot();
} else if (process.argv[2] === 'splash') {
  splashSnapshot();
} else if (process.argv[2] === 'settings') {
  settingsSnapshot();
} else if (process.argv[2] === 'menu' || process.argv[2] === 'coverflow') {
  coverflowSnapshot();
} else if (process.argv[2] === 'launch') {
  launchSnapshot();
} else if (process.argv[2] === 'prism-prompt') {
  prismPromptSnapshot();
} else if (process.argv[2] === 'cards') {
  cardsSnapshot();
} else if (process.argv[2] === 'poker') {
  pokerSnapshot();
} else {
  sceneSnapshot();
}

// The poker table with a dealt hand at a chosen street, presented through the app's
// default ASCII path (plus the projected stack/pot overlay).
//   pnpm exec tsx src/tools/snapshot.ts poker [cols] [rows] [preflop|flop|river|showdown] [players=N] [color] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts poker idle [cols] [rows] [<t>] [color] [out.ppm]
//     idle: no session running — 4 chairs + the centre deck at loop time <t>
//           seconds (a decimal, e.g. 1.0 for the riffle; default 1.0).
function pokerSnapshot(): void {
  const args = process.argv.slice(3);
  const cols = Number(args.find((a) => /^\d+$/.test(a))) || 150;
  const rows = Number(args.filter((a) => /^\d+$/.test(a))[1]) || 46;
  const street = (['preflop', 'flop', 'river', 'showdown'].find((s) => args.includes(s)) ?? 'flop') as string;
  const players = Number(args.find((a) => /^players=\d+$/.test(a))?.split('=')[1]) || 2;
  const out = args.find((a) => a.endsWith('.ppm')) ?? `.snapshots/poker-${street}.ppm`;
  const SS = 3;

  // Idle: construct the scene WITHOUT a session, advance the shuffle-loop clock
  // to time `t` (a decimal arg), and snapshot the empty-table state (4 chairs + deck).
  if (args.includes('idle')) {
    const tTarget = Number(args.find((a) => /^\d+\.\d+$/.test(a))) || 1.0;
    const idleScene = new PokerGameScene();
    const idleOut = args.find((a) => a.endsWith('.ppm')) ?? '.snapshots/poker-idle.ppm';
    const buf = new RenderTarget(cols * SS, rows * 2 * SS);
    let t = 0;
    for (let acc = 0; acc <= tTarget + 1e-9; acc += 1 / 30) {
      idleScene.renderScene(buf, t);
      t += 1 / 30;
    }
    if (args.includes('color')) {
      writeDisplayPpm(downsample(buf, SS), idleOut);
    } else {
      const surf = new Surface(cols, rows);
      shapeGlyphToSurface(surf, buf, cols, rows, { color: true, hybrid: true });
      surfaceToPpm(surf, cols, rows, idleOut);
    }
    return;
  }

  // `spectate` → every seat is an AI (all hole cards visible, no hero controls); otherwise
  // seat 1 is the human hero (only their own cards show).
  const spectate = args.includes('spectate');
  const scene = new PokerGameScene();
  // Route game events into the chat thread (grey lines) so the `hud` snapshot shows them.
  clearPokerChat();
  scene.setEventSink((text) => pushPokerChat({ text, model: '', event: true }));
  const provs = providers().map((p) => p.slug);
  const seatViews: PokerSeatView[] = [];
  for (let s = 0; s < players; s++) {
    if (s === 0 && !spectate) seatViews.push({ kind: 'human', label: 'You' });
    else seatViews.push({ kind: 'ai', label: `AI ${s + 1}`, provider: provs[s % provs.length] });
  }
  scene.beginSession(seatViews);

  const state = new HoldemState({ stacks: new Array(players).fill(1000), button: 0, smallBlind: 10, bigBlind: 20, rng: mulberry32(0x90ce7) });
  scene.beginHand(state);
  // Drive a few scripted actions to reach the requested street (everyone calls/checks).
  // Route through scene.playMove (not state.applyAction) so each seat's last action is
  // captured for its HUD strip; the returned promise is fire-and-forget in this still.
  const advanceTo = (target: number): void => {
    let guard = 0;
    while (state.street() < target && !state.isTerminal() && guard++ < 100) {
      const toCall = state.toCall(state.toActSeat());
      void scene.playMove(toCall > 0 ? { type: 'call' } : { type: 'check' });
    }
  };
  if (street === 'flop') advanceTo(1);
  else if (street === 'river') advanceTo(3);
  else if (street === 'showdown') {
    let guard = 0;
    while (!state.isTerminal() && guard++ < 200) {
      const toCall = state.toCall(state.toActSeat());
      void scene.playMove(toCall > 0 ? { type: 'call' } : { type: 'check' });
    }
  }

  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  let t = 0.05;
  const step = (): void => {
    scene.renderScene(target, t);
    t += 1 / 30;
  };
  // Settle the animations so a street snapshot shows the fully-dealt board: the opening
  // hole-card deal (up to ~12 cards) runs first, then the community cards fly out.
  for (let i = 0; i < 220; i++) step();
  // `peek` reveals the hero's own hole cards in the top-right hand panel by hovering each
  // (the panel latches a card as "seen" once it has bent up past the peek threshold).
  if (args.includes('peek')) {
    const hp = (scene as unknown as { heroPeek?: { setHovered(i: number): void } }).heroPeek;
    if (hp) {
      hp.setHovered(0);
      for (let i = 0; i < 12; i++) step();
      hp.setHovered(1);
      for (let i = 0; i < 12; i++) step();
      hp.setHovered(-1);
      for (let i = 0; i < 6; i++) step();
    }
  }
  if (args.includes('color')) {
    writeDisplayPpm(downsample(target, SS), out);
    return;
  }
  const region = { x: 0, y: 0, w: cols, h: rows };
  // `setup` composites the poker setup modal over the table (like the chess setup still).
  if (args.includes('setup')) {
    const screen = new Screen(cols, rows);
    mountPokerSetup(screen);
    screen.setRoot(buildPokerSetup(region, { onStart: noop, onCancel: noop }), region);
    const surf2 = screen.snapshot((s) => shapeGlyphToSurface(s, target, cols, rows, { color: true, hybrid: true }));
    surfaceToPpm(surf2, cols, rows, out);
    return;
  }
  // `hud` composites the betting HUD over the table with the hero to act (Fold /
  // Call / raise slider / All-in visible). Fire a human-move request to flip the
  // scene into "hero to act" so the controls render.
  if (args.includes('hud')) {
    if (!spectate) void scene.requestHumanMove(); // sets heroToAct (fire-and-forget in this still)
    const screen = new Screen(cols, rows);
    mountPokerGameHud(screen);
    const st = state;
    // Seed a few table-talk lines so the right-rail chat renders alongside the game events.
    for (const m of [
      { text: "checking to the raiser - let's see what you've got.", model: 'openai/gpt-5.4' },
      { text: 'feeling good about this one. bumping it up.', model: 'anthropic/claude-opus-4.8' },
      { text: "that's a big number. giving it a think.", model: 'google/gemini-3-pro' },
    ])
      pushPokerChat(m);
    const hero = {
      toAct: !spectate,
      toCall: st.toCall(0),
      minRaiseTo: st.minRaiseTo(0),
      maxRaiseTo: st.maxRaiseTo(0),
      stack: st.stackOf(0),
      pot: st.potTotal(),
      canRaise: st.maxRaiseTo(0) > st.currentBetAmount(),
    };
    screen.setRoot(
      buildPokerGameRoot(region, buildBar('poker', 'ascii', barActions, { label: 'pause', active: true }), {
        hero,
        blinds: '10/20',
        commentary: null,
        t: 0,
        status: spectate ? 'Spectating' : 'Your move',
        table: scene.tableView(),
        active: true,
        chatOpen: !args.includes('chatclosed'),
        onToggleChat: noop,
      }),
      region,
    );
    const surf2 = screen.snapshot((s) => {
      shapeGlyphToSurface(s, target, cols, rows, { color: true, hybrid: true });
    });
    surfaceToPpm(surf2, cols, rows, out);
    return;
  }
  const surf = new Surface(cols, rows);
  shapeGlyphToSurface(surf, target, cols, rows, { color: true, hybrid: true });
  surfaceToPpm(surf, cols, rows, out);
}

// The cards screen in one of its three modes, presented through the app's default
// ASCII (shape-glyph) path so the still matches the terminal.
//   pnpm exec tsx src/tools/snapshot.ts cards [single|hand|deck] [cols] [rows] [state] [out.ppm]
//     single state: a card code like "Kh", "10s", "As" (default "As")
//     hand   state: "peek" | "up" (default: flat)
//     deck   state: "shuffle" | "deal" (default: full stack)
function cardsSnapshot(): void {
  const args = process.argv.slice(3);
  const mode = (['single', 'hand', 'deck'].includes(args[0]) ? args[0] : 'single') as CardsMode;
  const cols = Number(args.find((a, i) => i > 0 && /^\d+$/.test(a))) || 150;
  const rows = Number(args.filter((a) => /^\d+$/.test(a))[1]) || 46;
  const out = args.find((a) => a.endsWith('.ppm')) ?? `.snapshots/cards-${mode}.ppm`;
  const state = args.find((a) => !/^\d+$/.test(a) && !a.endsWith('.ppm') && a !== mode) ?? '';
  const SS = 3;

  const scene = new CardsScene();
  scene.setMode(mode);
  let frames = 1;
  if (mode === 'single') {
    const m = state.match(/^(10|[a2-9jqk])([shdc])$/i);
    if (m) {
      const rank = RANK_LABELS.findIndex((r) => r.toLowerCase() === m[1].toLowerCase());
      const suit = SUIT_LETTERS.indexOf(m[2].toLowerCase() as (typeof SUIT_LETTERS)[number]);
      if (rank >= 0 && suit >= 0) scene.setCard({ rank, suit: suit as Suit });
    }
    if (args.includes('back')) scene.orbit(-262, 0); // ~180° azimuth → view the card's back, upright
  } else if (mode === 'hand') {
    if (state === 'peek') {
      scene.setHovered(0);
      frames = 20;
    } else if (state === 'up') {
      scene.flipCard(0);
      scene.flipCard(1);
      frames = 40;
    }
  } else if (mode === 'deck') {
    if (state === 'shuffle') {
      scene.shuffle();
      frames = 14; // ~mid riffle
    } else if (state === 'deal') {
      scene.deal();
      frames = 60; // a few cards out
    }
  }

  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  let t = 0.05;
  for (let i = 0; i < frames; i++) {
    scene.renderScene(target, t);
    t += 1 / 30;
  }
  // `color` presents through the half-block path (truer color) instead of the
  // default ASCII shape-glyph, for judging the card art.
  if (args.includes('color')) {
    writeDisplayPpm(downsample(target, SS), out);
    return;
  }
  // `hud` composites the poker control panel + bar over the scene via a real
  // Screen (so the dropdown Slots expand), like the setup / chess-overlay stills.
  if (args.includes('hud')) {
    const screen = new Screen(cols, rows);
    mountPokerHud(screen);
    (screen.component('poker-mode') as Dropdown | undefined)?.pick(['single', 'hand', 'deck'].indexOf(mode)); // match panel controls to the mode
    const region = { x: 0, y: 0, w: cols, h: rows };
    screen.setRoot(buildPokerRoot(region, buildBar('cards', 'ascii', barActions)), region);
    const surf2 = screen.snapshot((s) => shapeGlyphToSurface(s, target, cols, rows, { color: true, hybrid: true }));
    surfaceToPpm(surf2, cols, rows, out);
    return;
  }
  const surf = new Surface(cols, rows);
  shapeGlyphToSurface(surf, target, cols, rows, { color: true, hybrid: true });
  surfaceToPpm(surf, cols, rows, out);
}

// The realtime audio scene: the active model's provider wisp in 3D (speaking, so
// the flame is lively). Verifies the wisp loads + renders; the conversation
// overlay is plain text drawn over the composite in the live app.
//   pnpm exec tsx src/tools/snapshot.ts audio [cols] [rows] [out.ppm]
function audioSnapshot(): void {
  const cols = Number(process.argv[3]) || 140;
  const rows = Number(process.argv[4]) || 50;
  const out = process.argv[5] ?? '.snapshots/audio.ppm';
  const SS = 3;
  const scene = new AudioScene();
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  scene.renderScene(target, 0.7);
  const display = downsample(target, SS);
  writeDisplayPpm(display, out);
}

// Cover Flow carousel of game covers. `pos` is the continuous carousel position
// (fractional = mid-rotation, to check the slant + ease look).
//   pnpm exec tsx src/tools/snapshot.ts coverflow [cols] [rows] [pos] [out.ppm]
function coverflowSnapshot(): void {
  const cols = Number(process.argv[3]) || 140;
  const rows = Number(process.argv[4]) || 44;
  const pos = Number(process.argv[5]) || 0;
  const out = process.argv.find((a) => a.endsWith('.ppm')) ?? '.snapshots/coverflow.ppm';
  const SS = 3;
  // `hover` flag previews the focused cover's moused-over highlight.
  const hover = process.argv.includes('hover');
  const sel = Math.round(pos);
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new CoverFlowScene().renderScene(target, pos, hover ? sel : -1);
  // Present through the live ASCII (shape-glyph) path — the app's default render
  // mode — so the snapshot matches what the terminal actually shows, then draw the
  // title + hint chrome on top (mirrors drawCoverChrome in main.ts).
  const surf = new Surface(cols, rows);
  shapeGlyphToSurface(surf, target, cols, rows, { color: true });
  const item = MENU_ITEMS[sel];
  if (item) {
    const title = item.enabled ? item.title : `${item.title}   coming soon`;
    surf.drawText(Math.max(0, Math.floor((cols - title.length) / 2)), rows - 4, title, [240, 244, 255], [10, 12, 18]);
  }
  const hint = '< > select   enter play   esc back';
  surf.drawText(Math.max(0, Math.floor((cols - hint.length) / 2)), rows - 2, hint, [120, 126, 142], [8, 10, 16]);
  surfaceToPpm(surf, cols, rows, out);
  console.log(`wrote ${out} (${cols}x${rows})`);
}

// The menu's settings gear over the Cover Flow scene, or — with `open` — the
// team-switch modal it opens (composited via a real Screen so the list Slot
// expands, seeded with sample teams and a current selection). Mirrors the live
// menu chrome (title + hint) so placement reads in context.
//   pnpm exec tsx src/tools/snapshot.ts settings [cols] [rows] [open] [out.ppm]
function settingsSnapshot(): void {
  const args = process.argv.slice(3);
  const cols = Number(args[0]) || 150;
  const rows = Number(args[1]) || 46;
  const open = args.includes('open');
  const out = args.find((a) => a.endsWith('.ppm')) ?? '.snapshots/settings.ppm';
  const SS = 3;
  const sel = 0;

  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new CoverFlowScene().renderScene(target, 0, -1);

  const screen = new Screen(cols, rows);
  mountTeamSwitch(screen);
  const region = { x: 0, y: 0, w: cols, h: rows };
  if (open) {
    // A long list (more than the viewport) so the still shows the fixed-height,
    // scrollable list — the current team ● marked and preselected.
    const teams = [
      { id: 't1', slug: 'acme', name: 'Acme Corp' },
      { id: 't2', slug: 'vercel-labs', name: 'Vercel Labs' },
      { id: 't3', slug: 'personal', name: 'personal' },
      { id: 't4', slug: 'skunkworks', name: 'Skunkworks' },
      { id: 't5', slug: 'moonshot', name: 'Moonshot Inc' },
      { id: 't6', slug: 'nightly', name: 'Nightly' },
      { id: 't7', slug: 'orbit', name: 'Orbit' },
      { id: 't8', slug: 'zephyr', name: 'Zephyr' },
      { id: 't9', slug: 'atlas', name: 'Atlas' },
      { id: 't10', slug: 'nova', name: 'Nova' },
    ];
    setTeamSwitchTeams(teams, teams[1]); // current = Vercel Labs (● marked, preselected)
    if (args.includes('switched')) markSwitchSucceeded(teams[3]); // ✓ on a just-switched team
    const view = args.includes('loading')
      ? { kind: 'loading' as const }
      : args.includes('error')
        ? { kind: 'error' as const, message: 'Could not create AI Gateway key (403 forbidden)', canReturn: true }
        : { kind: 'loaded' as const };
    screen.setRoot(buildTeamSwitch(view, { onClose: noop, onSignIn: noop, onBack: noop }), region);
  } else {
    const gear = { padding: [0, 1] as [number, number], background: [28, 30, 40] as Rgb, color: [200, 205, 220] as Rgb };
    const overlay = Box({ width: cols, height: rows }, [Box({ position: 'absolute', top: 1, right: 2 }, [Button({ id: 'menu-settings', label: '⚙ settings', style: gear })])]);
    screen.setRoot(overlay, region);
  }
  const surf = screen.snapshot((s) => {
    shapeGlyphToSurface(s, target, cols, rows, { color: true });
    const item = MENU_ITEMS[sel];
    if (item) {
      const title = item.enabled ? item.title : `${item.title}   coming soon`;
      s.drawText(Math.max(0, Math.floor((cols - title.length) / 2)), rows - 4, title, [240, 244, 255], [10, 12, 18]);
    }
    const hint = '< > select   enter play   esc back';
    s.drawText(Math.max(0, Math.floor((cols - hint.length) / 2)), rows - 2, hint, [120, 126, 142], [8, 10, 16]);
  });
  surfaceToPpm(surf, cols, rows, out);
}

// A frame of the launch flip-to-title splash for cover `index` at time `t` (s).
//   pnpm exec tsx src/tools/snapshot.ts launch [cols] [rows] [index] [t] [out.ppm]
function launchSnapshot(): void {
  const cols = Number(process.argv[3]) || 150;
  const rows = Number(process.argv[4]) || 44;
  const index = Number(process.argv[5]) || 2;
  const t = process.argv[6] !== undefined ? Number(process.argv[6]) : 0.5;
  const out = process.argv.find((a) => a.endsWith('.ppm')) ?? '.snapshots/launch.ppm';
  const SS = 3;
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new CoverFlowScene().renderLaunch(target, index, t);
  // ASCII (shape-glyph) path — the app's default render mode — so the snapshot
  // matches the terminal.
  const surf = new Surface(cols, rows);
  shapeGlyphToSurface(surf, target, cols, rows, { color: true });
  surfaceToPpm(surf, cols, rows, out);
  console.log(`wrote ${out} (${cols}x${rows})`);
}

// The prism loading screen (prism + the press-any-key marquee). `t` honors the blink (visible at t=0, hidden at t≈0.8).
//   pnpm exec tsx src/tools/snapshot.ts prism-prompt [cols] [rows] [t] [out.ppm]
function prismPromptSnapshot(): void {
  const cols = Number(process.argv[3]) || 140;
  const rows = Number(process.argv[4]) || 40;
  const t = Number(process.argv[5]) || 0;
  const out = process.argv.find((a) => a.endsWith('.ppm')) ?? '.snapshots/prism-prompt.ppm';
  const SS = 3;
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new PrismScene().renderScene(target, 0.6);
  const display = downsample(target, SS);
  bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });
  const surf = new Surface(cols, rows);
  halfBlockToSurface(surf, display);
  const text = 'press any key to start';
  const alpha = 0.42 + 0.5 * (0.5 + 0.5 * Math.sin(t * Math.PI * 1.2)); // matches drawPrismPrompt
  const x0 = Math.max(0, Math.floor((cols - text.length) / 2));
  const y = rows - 2;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ' ') surf.setCellWithAlphaBlending(x0 + i, y, text[i], [205, 210, 230, alpha], [0, 0, 0, 0]);
  }
  surfaceToPpm(surf, cols, rows, out);
}

// A single frame of the boot splash at time `t` (the intro animation). Mirrors the
// prism still (downsample + bloom) so each phase can be rendered to a PNG.
//   pnpm exec tsx src/tools/snapshot.ts splash [cols] [rows] [t] [out.ppm]
function splashSnapshot(): void {
  const cols = Number(process.argv[3]) || 110;
  const rows = Number(process.argv[4]) || 44;
  const t = Number(process.argv[5]) || 0.5;
  const out = process.argv[6] ?? '.snapshots/prism.ppm';
  const SS = 3;
  const target = new RenderTarget(cols * SS, (rows - 1) * 2 * SS);
  new SplashScene().renderScene(target, t);
  const display = downsample(target, SS);
  bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });
  writeDisplayPpm(display, out);
}

// The 'ui' component playground composited over the chess scene via the real
// Screen (so Slots expand to their live components). `focus=<id>` focuses one
// component so its focused styling (caret/highlight/thumb) shows.
function showcaseSnapshot(): void {
  const args = process.argv.slice(3);
  const cols = Number(args[0]) || 110;
  const rows = Number(args[1]) || 40;
  const focusArg = args.find((a) => a.startsWith('focus='));
  const out = args.find((a) => a.endsWith('.ppm')) ?? '.snapshots/showcase.ppm';
  const SS = 3;

  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new ChessScene().renderScene(target);

  const screen = new Screen(cols, rows);
  mountShowcase(screen);
  if (focusArg) screen.setFocus(focusArg.split('=')[1]);
  const region = { x: 0, y: 0, w: cols, h: rows };
  screen.setRoot(buildShowcase(region, buildBar('ui', 'ascii', barActions)), region);
  const surf = screen.snapshot((s) => shapeGlyphToSurface(s, target, cols, rows, { color: true, hybrid: true }));
  surfaceToPpm(surf, cols, rows, out);
}

// The chess-game match overlay composited over the board via the real Screen
// (so the move-history Slot expands): the AI HUD wisps + bar 'play/stop ai'
// button + the collapsible Moves panel. Pass 'min' to render the collapsed panel.
//   pnpm exec tsx src/tools/snapshot.ts chess-overlay [cols] [rows] [min] [eval] [out.ppm]
function chessOverlaySnapshot(): void {
  const args = process.argv.slice(3);
  const cols = Number(args[0]) || 140;
  const rows = Number(args[1]) || 50;
  const minimized = args.includes('min');
  const out = args.find((a) => a.endsWith('.ppm')) ?? `.snapshots/chess-overlay${minimized ? '-min' : ''}.ppm`;
  const SS = 3;
  const t = 0.7;

  const cg = new ChessGameScene();
  cg.beginMatch();
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) {
    const m = cg.state().actionFromString(san);
    if (m) cg.state().applyAction(m);
  }
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  cg.renderScene(target, t);

  const screen = new Screen(cols, rows);
  mountChessHud(screen);
  // 'empty' shows the just-spawned panel (autoHeight → header only, no empty box);
  // 'illegal' a game with illegal-toggle plies (flagged red); 'short' a few-move
  // list (panel grown to fit, no scrollbar); otherwise a long game so the panel
  // caps and the scrollbar is visible (gapless-thumb check).
  const sans = process.argv.includes('empty')
    ? []
    : process.argv.includes('illegal')
    ? ['e4', 'Nbf6', 'Bcd3', 'Nxd5', 'Qe2', 'Nxc3']
    : process.argv.includes('short')
      ? ['c4', 'c5', 'Nf3']
      : [
          'e4', 'c5', 'Nf3', 'Nc6', 'Bb5', 'Nd4', 'Nxd4', 'cxd4', 'Bxd7+', 'Qxd7', 'O-O', 'Qh3', 'gxh3', 'Bxh3', 'Qf3', 'Bg2',
          'Qxf7+', 'Kxf7', 'Kxg2', 'd3', 'cxd3', 'Nf6', 'e5', 'Ne4', 'e6+', 'Kxe6', 'dxe4', 'Rb8', 'e5', 'Kxe5', 'Re1+', 'Kf5',
          'Rxe7', 'Bxe7', 'f4', 'Kxf4', 'Rxe7', 'Kg5', 'Re5+', 'Kh6', 'Rh5+', 'Kg6', 'b4', 'a5', 'bxa5', 'Rb2+',
        ];
  // Flag the illegal-toggle plies (b8-knight to f6, c1-bishop to d3) red.
  const illegalFlags = process.argv.includes('illegal') ? [false, true, true, false, false, false] : [];
  refreshMoveHistory(sans, illegalFlags);
  // 'eval' shows the right-edge eval bar, scored from the live board.
  const evalVisible = process.argv.includes('eval');
  // 'chat' shows the right-edge model-DM chat panel, seeded with a few messages;
  // add 'empty' to leave it empty (shows the centered placeholder).
  const chatVisible = process.argv.includes('chat');
  if (chatVisible && !process.argv.includes('empty')) {
    clearChat();
    const seed: ChatMessage[] = [
      { text: 'e4 - grabbing the center. Classic and principled.', model: 'openai/gpt-5.4' },
      { text: 'c5, the Sicilian. I refuse to play symmetrically against you today.', model: 'anthropic/claude-opus-4.8' },
      { text: "Nf3, developing and eyeing d4. Let's open this up.", model: 'openai/gpt-5.4' },
      { text: 'Nc6. Fighting for the center squares, holding my ground.', model: 'anthropic/claude-opus-4.8' },
      { text: 'Bb5 — a Rossolimo. Pinning your knight and slowing the queenside.', model: 'openai/gpt-5.4' },
    ];
    for (const m of seed) pushChatMessage(m);
  }
  const region = { x: 0, y: 0, w: cols, h: rows };
  screen.setRoot(
    buildChessGameRoot(region, buildBar('chess-game', 'ascii', barActions, { label: 'pause ai', active: true }, false, evalVisible), {
      minimized,
      onToggle: noop,
      onCopy: noop,
      commentary: { text: 'developing toward the Ruy Lopez', model: 'openai/gpt-5.4', until: 99 },
      t,
      evalVisible,
      evalCp: evalVisible ? evaluate(cg.state().board) : 0,
      evalResult: cg.state().result(),
      chatVisible,
      onToggleChat: noop,
      chatActive: false,
    }),
    region,
  );
  const surf = screen.snapshot((s) => shapeGlyphToSurface(s, target, cols, rows, { color: true, hybrid: true }));
  surfaceToPpm(surf, cols, rows, out);
}

// Captures a king mid-move (white castling, ~halfway through the animation) to
// verify the HUD wisp tracks the king's interpolated position rather than
// teleporting at settle. Both wisps render; the white one should sit above the
// king as it slides e1→g1.
//   pnpm exec tsx src/tools/snapshot.ts king-anim [cols] [rows] [out.ppm]
function kingAnimSnapshot(): void {
  const cols = Number(process.argv[3]) || 140;
  const rows = Number(process.argv[4]) || 50;
  const out = process.argv[5] ?? '.snapshots/king-anim.ppm';
  const SS = 3;
  const cg = new ChessGameScene();
  cg.beginMatch();
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']) {
    const m = cg.state().actionFromString(san);
    if (m) cg.state().applyAction(m);
  }
  const castle = cg.state().actionFromString('O-O');
  if (castle) void cg.playMove(castle);
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  // Pump fewer than ANIM_FRAMES (9) so the king is caught mid-slide.
  for (let i = 0; i < 4; i++) cg.renderScene(target, i / 30);
  const display = downsample(target, SS);
  writeDisplayPpm(display, out);
}

// The AI match setup modal composited over the chess scene via the real Screen
// (so the provider/model Slots expand). Commits a model for each side so Start is
// enabled; pass `open` to also expand White's provider dropdown to show the list.
//   pnpm exec tsx src/tools/snapshot.ts setup [cols] [rows] [out.ppm] [open]
function setupSnapshot(): void {
  const cols = Number(process.argv[3]) || 120;
  const rows = Number(process.argv[4]) || 40;
  const out = process.argv[5] ?? '.snapshots/setup.ppm';
  const SS = 3;
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new ChessGameScene().renderScene(target, 0.6);
  const screen = new Screen(cols, rows);
  mountMatchSetup(screen);
  // The modal's module defaults already pre-commit a model per side (Start enabled).
  // Optionally open a dropdown to show the expanded, scrollable picker floating
  // over the rest of the modal. `open` opens White's provider list; `models`
  // selects Google then opens White's MODEL list (long names wrap onto 2 lines).
  if (process.argv.includes('models')) {
    const wp = screen.component('setup-white-provider') as Dropdown | undefined;
    const g = providers().findIndex((p) => p.slug === 'google');
    if (g >= 0) wp?.pick(g); // switch White to Google (repopulates + clears its model)
    (screen.component('setup-white-model') as Dropdown | undefined)?.onKey?.({ name: 'enter', raw: '', sequence: '', ctrl: false, shift: false, meta: false, eventType: 'press' });
  } else if (process.argv.includes('open')) {
    const enter = { name: 'enter', raw: '', sequence: '', ctrl: false, shift: false, meta: false, eventType: 'press' as const };
    (screen.component('setup-white-provider') as Dropdown | undefined)?.onKey?.(enter);
  }
  const region = { x: 0, y: 0, w: cols, h: rows };
  screen.setRoot(buildMatchSetup(region, { onStart: noop, onCancel: noop }), region);
  const surf = screen.snapshot((s) => shapeGlyphToSurface(s, target, cols, rows, { color: true, hybrid: true }));
  surfaceToPpm(surf, cols, rows, out);
}

// The game-over result popup composited over a finished board (fool's mate, so
// the result is a real checkmate). Verifies the centered card + scrim.
//   pnpm exec tsx src/tools/snapshot.ts gameover [cols] [rows] [out.ppm]
function gameOverSnapshot(): void {
  const cols = Number(process.argv[3]) || 140;
  const rows = Number(process.argv[4]) || 50;
  const out = process.argv[5] ?? '.snapshots/gameover.ppm';
  const SS = 3;
  const cg = new ChessGameScene();
  for (const san of ['f3', 'e5', 'g4', 'Qh4']) {
    const m = cg.state().actionFromString(san);
    if (m) cg.state().applyAction(m);
  }
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  cg.renderScene(target, 0.7);
  const screen = new Screen(cols, rows);
  const region = { x: 0, y: 0, w: cols, h: rows };
  screen.setRoot(buildGameOver({ title: 'Black wins', subtitle: 'by checkmate', tint: [184, 126, 74] }, noop, noop), region);
  const surf = screen.snapshot((s) => shapeGlyphToSurface(s, target, cols, rows, { color: true, hybrid: true }));
  surfaceToPpm(surf, cols, rows, out);
}

// The promotion modal composited over the chess scene via the unified path:
// scene → Surface (shape-glyph), then the Modal's scrim dims it in place while
// the popup paints crisp on top. Proves the translucent-scrim effect.
function modalSnapshot(): void {
  const cols = Number(process.argv[3]) || 110;
  const rows = Number(process.argv[4]) || 40;
  const out = process.argv[5] ?? '.snapshots/modal.ppm';
  const SS = 3;
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new ChessGameScene().renderScene(target);
  const surf = new Surface(cols, rows);
  shapeGlyphToSurface(surf, target, cols, rows, { color: true, hybrid: true });
  const root = buildPromotion(0 as Color, () => {}); // WHITE
  layout(root, { x: 0, y: 0, w: cols, h: rows });
  paint(root, surf, { hoverId: 'promo-queen', focusId: 'promo-queen', pressedId: null });
  surfaceToPpm(surf, cols, rows, out);
}

// The unified compositing path (ASCII mode): the scene paints into the SAME
// Surface as the bar via shapeGlyphToSurface, then the bar paints over it — one
// composited cell grid, rasterized straight from the Surface. Verifies the
// scene-into-Surface port + over-the-scene compositing in one image.
function unifiedSnapshot(): void {
  const scene = (process.argv[3] as Mode) ?? 'prism';
  const cols = Number(process.argv[4]) || 110;
  const rows = Number(process.argv[5]) || 40;
  const out = process.argv[6] ?? `.snapshots/unified-${scene}.ppm`;
  const SS = 3;

  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  if (scene === 'chess') new ChessScene().renderScene(target);
  else if (scene === 'chess-game') new ChessGameScene().renderScene(target);
  else if (scene === 'logos') new LogosScene().renderScene(target, 0.6);
  else new PrismScene().renderScene(target, 0.6);

  const surf = new Surface(cols, rows);
  shapeGlyphToSurface(surf, target, cols, rows, { color: true, hybrid: scene !== 'prism' && scene !== 'logos' });
  const root = buildBar(scene, 'ascii', barActions);
  layout(root, { x: 0, y: rows - 2, w: cols, h: 1 });
  paint(root, surf, { hoverId: 'reset', focusId: null, pressedId: null });

  surfaceToPpm(surf, cols, rows, out);
}
