// Headless render of a frame to a PPM image (convert to PNG with `sips`). Lets
// rendered output be viewed as an image instead of a live TTY.
//
//   pnpm exec tsx src/tools/snapshot.ts [cols] [rows] [t] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts chess [cols] [rows] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts ui [cols] [rows] [hover=<id>|focus=<id>] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts overlay [chess|chess-game|prism] [cols] [rows] [out.ppm]
import { writeFileSync } from 'node:fs';
import { bloom, downsample, halfBlockToSurface, mulberry32, RenderTarget, shapeGlyphLayerToSurface, shapeGlyphToSurface, STYLE_BOLD, STYLE_DIM, Surface } from '../engine/index.ts';
import { FONT } from '../engine/font8x8.ts';
import { PrismScene, SplashScene } from '../prism/index.ts';
import { TimedInkTransition } from '../cinematic/transitions/timed-ink-transition.ts';
import { coverFlowIndex } from '../cinematic/scenes/cover-flow.ts';
import { ChessGameScene } from '../arcade/games/chess/scene.ts';
import { LogosScene } from '../arcade/scenes/logos-scene.ts';
import { AudioScene } from '../arcade/scenes/audio-scene.ts';
import { CoverFlowScene } from '../arcade/shell/coverflow.ts';
import { MENU_ITEMS } from '../arcade/shell/menu.ts';
import { buildBar, buildConfirm, buildGameMenu, buildGameOver, buildPromotion, buildShortcuts, mouseControlsFor, type Mode } from '../arcade/shell/bars.ts';
import { installKeymap } from '../arcade/shell/keybindings.ts';
import { buildShowcase, mountShowcase } from '../arcade/scenes/ui-showcase.ts';
import { buildChessGameRoot, chessMoveChat, mountChessHud, refreshMoveHistory } from '../arcade/games/chess/hud.ts';
import { CHAT_WIDTH, type ChatMessage, clearChat, pushChatMessage } from '../arcade/match/chat.ts';
import { evaluate } from '../rules/chess/eval.ts';
import { buildMatchSetup, chessPreviewSides, mountMatchSetup } from '../arcade/match/setup.ts';
import { creators } from '../arcade/match/models.ts';
import { CardsScene, type CardsMode } from '../arcade/games/poker/cards-scene.ts';
import { buildPokerRoot, mountPokerHud } from '../arcade/games/poker/hud.ts';
import { TileScene } from '../arcade/games/islanders/tile-scene.ts';
import { buildIslandersPieceModal, buildIslandersTileRoot, mountIslandersTileHud } from '../arcade/games/islanders/tile-hud.ts';
import {
  adjustIslandersWorkbenchDev,
  adjustIslandersWorkbenchDiscard,
  adjustIslandersWorkbenchHand,
  adjustIslandersWorkbenchTradeStaging,
  bankIslandersResource,
  beginIslandersWorkbenchDevPurchase,
  beginIslandersWorkbenchDevelopmentPlay,
  beginIslandersWorkbenchDiscard,
  beginStagedIslandersWorkbenchBankTrade,
  ISLANDERS_LOCAL_COLOR,
  islandersBankDepartureCell,
  islandersDevDeckDepartureCell,
  islandersDevHandLandingCell,
  islandersHandLandingCell,
  islandersRailVisible,
  islandersSidebarOpen,
  islandersWorkbenchView,
  createIslandersWorkbenchPlayerTrade,
  departIslandersWorkbenchBankResource,
  departIslandersWorkbenchHandResource,
  departIslandersWorkbenchDevCard,
  landIslandersWorkbenchBankResource,
  landIslandersWorkbenchDevCard,
  resetIslandersWorkbenchCards,
  resolveIslandersWorkbenchPlayerTradeOffer,
  setIslandersTradeEditorOpen,
  setIslandersWorkbenchTradeSelection,
  toggleIslandersSidebar,
} from '../arcade/games/islanders/card-hud.ts';
import { type FlyingResource, ResourceFlights } from '../arcade/games/islanders/scene/resource-flight.ts';
import { IslandersGameScene } from '../arcade/games/islanders/game-scene.ts';
import { buildIslandersGameRoot, mountIslandersGameHud } from '../arcade/games/islanders/game-hud.ts';
import { IslandersDriver, type IslandersSeatSpec } from '../arcade/match/islanders-driver.ts';
import { generateBoard } from '../rules/islanders/setup.ts';
import { type IslandersAction, type DevCardType, type PlayerColor, type Resource, resourceIndex, type Terrain, TERRAINS } from '../rules/islanders/types.ts';
import { PokerGameScene, type PokerSeatView } from '../arcade/games/poker/poker-scene.ts';
import { betInput as pokerBetInput, buildPokerGameRoot, buildPokerNotesModal, clearPokerChat, mountPokerGameHud, pushPokerChat } from '../arcade/games/poker/poker-hud.ts';
import { buildPokerSetupPanel, modeDropdown as pokerModeDropdown, mountPokerSetup, playersDropdown as pokerPlayersDropdown, pokerPreviewSeats, pokerStartingStack } from '../arcade/match/poker-setup.ts';
import { HoldemState } from '../rules/poker/holdem.ts';
import { RANK_LABELS, type Suit, SUIT_LETTERS } from '../rules/poker/cards.ts';
import type { Color } from '../rules/chess/types.ts';
import { Box, Button, Dropdown, NoticeToast, insetSceneViewport, layout, paint, Screen, Text, type PaintState } from '../tui/index.ts';
import { buildTeamSwitch, markSwitchSucceeded, mountTeamSwitch, setTeamSwitchTeams } from '../arcade/shell/team-switch.ts';
import { UI_CHROME_PILL } from '../arcade/theme.ts';
import { modelFailureNotice } from '../harness/model-failure-notice.ts';

type Rgb = [number, number, number];
// Terminal cells are roughly twice as tall as they are wide. Rasterize each
// cell at that physical aspect and resample the bundled 8×8 glyph to fill it.
const CW = 8;
const CH = 16;

// Rasterize a Surface to a PPM at 8×16 px/cell: optionally fill each cell's two
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
        const gy = Math.floor((py * 8) / CH);
        const bits = glyph?.[gy] ?? '';
        for (let px = 0; px < CW; px++) {
          const gx = Math.floor((px * 8) / CW);
          const on = glyph ? bits[gx] === '1' : blockBits(cell.ch, gx, gy);
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
    case '◥':
      return px >= py;
    case '◤':
      return px + py <= 7;
    case '◢':
      return px + py >= 7;
    case '◣':
      return px <= py;
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
    case '↑':
      // Single-cell up arrow: a two-pixel stem with a compact three-row head.
      return (midX && py >= 2) || (py <= 2 && Math.abs(px - 3.5) <= py + 0.5);
    case '↓':
      // Mirror the up arrow so terminal UI direction cues remain visible in PNG snapshots.
      return (midX && py <= 5) || (py >= 5 && Math.abs(px - 3.5) <= 7.5 - py);
    case '▯':
      return px === 1 || px === 6 || py === 1 || py === 6;
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
      // legacy gear glyphs still render as a recognizable knob rather than a blank.
      const r2 = (px - 3.5) ** 2 + (py - 3.5) ** 2;
      return r2 <= 10 && r2 >= 2;
    }
    case '☰':
      // Hamburger (menu pill): three evenly-spaced horizontal lines.
      return (py === 1 || py === 4 || py === 6) && px >= 1 && px <= 6;
    case '✓':
      // Checkmark: a short down-stroke (lower-left) meeting a long up-stroke.
      return (px >= 1 && px <= 3 && Math.abs(py - (px + 2)) <= 0.6) || (px >= 3 && px <= 6 && Math.abs(py - (8 - px)) <= 0.6);
    case '✕':
    case '✗':
      // Cross: the two diagonals of the cell.
      return Math.abs(px - py) <= 1 || Math.abs(px + py - 7) <= 1;
    case '↻': {
      // No circular-arrow glyph in the 8×8 font — synthesize a clockwise ring broken
      // at the top-right with a small arrowhead, so the "↻ random" reroll affordance
      // reads as a refresh mark rather than a blank (mirrors the ⚙/☰ approximations).
      const r2 = (px - 3.5) ** 2 + (py - 3.5) ** 2;
      const ring = r2 <= 8 && r2 >= 2.5 && !(py <= 1 && px >= 4); // gap at the top-right
      const head = (px === 4 || px === 5) && py >= 0 && py <= 2; // arrowhead across the gap
      return ring || head;
    }
    default:
      return false;
  }
}

const noop = (): void => {};
const barActions = { back: noop, reset: noop, mode: noop, quit: noop, aiMatch: noop, newGame: noop, audioModel: noop };

// Render a scene full-height, then composite that screen's button bar over it —
// proving the bar sits ON TOP of the 3D scene (opaque pills overwrite it;
// transparent gaps show it through).
function overlaySnapshot(): void {
  const scene = (process.argv[3] as Mode) ?? 'chess-game';
  const cols = Number(process.argv[4]) || 110;
  const rows = Number(process.argv[5]) || 40;
  const out = process.argv[6] ?? `.snapshots/overlay-${scene}.ppm`;
  const SS = 3;

  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  if (scene === 'chess-game') new ChessGameScene().renderScene(target);
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

function noticeSnapshot(): void {
  const args = process.argv.slice(3);
  const cols = Number(args[0]) || 110;
  const rows = Number(args[1]) || 44;
  const out = args.find((a) => a.endsWith('.ppm')) ?? '.snapshots/notice.ppm';
  const focused = args.includes('focus');
  const kind = args.find((arg) => arg.startsWith('kind='))?.slice(5) ?? 'insufficient_funds';
  const fixtures: Record<string, { status: number; type?: string; failureKind?: 'timeout' | 'transient' | 'schema' }> = {
    insufficient_funds: { status: 402, type: 'insufficient_funds' },
    customer_verification_required: { status: 403, type: 'customer_verification_required' },
    byok_requires_paid_credits: { status: 403, type: 'byok_requires_paid_credits' },
    quota_for_entity_exceeded: { status: 429, type: 'quota_for_entity_exceeded' },
    authentication_error: { status: 401, type: 'authentication_error' },
    model_not_found: { status: 404, type: 'model_not_found' },
    model_unavailable_in_region: { status: 403, type: 'model_unavailable_in_region' },
    rate_limit_exceeded: { status: 429, type: 'rate_limit_exceeded' },
    no_providers_available: { status: 403, type: 'no_providers_available' },
    timeout: { status: 504, failureKind: 'timeout' },
    service_unavailable: { status: 503, failureKind: 'transient' },
  };
  const fixture = fixtures[kind] ?? fixtures.service_unavailable;
  const notice = modelFailureNotice({ kind: fixture.failureKind ?? 'unknown', status: fixture.status, gatewayType: fixture.type, gatewayFailure: true, message: kind }, 'anthropic/claude-haiku-4.5');
  if (!notice) throw new Error(`notice fixture ${kind} produced no notice`);
  const screen = new Screen(cols, rows);
  screen.setRoot(Box({ width: cols, height: rows }), { x: 0, y: 0, w: cols, h: rows });
  screen.setGlobalOverlay(NoticeToast({
    id: 'gateway-failure', severity: notice.severity, title: notice.title,
    body: notice.body,
    width: Math.min(48, Math.max(30, cols - 4)),
    actionColor: 'textStrong',
    actionBorderColor: 'textStrong',
    ...(notice.action ? { action: { label: notice.action.label, onClick: () => {} } } : {}), onDismiss: () => {},
  }));
  if (focused) screen.setFocus('gateway-failure-action');
  const surf = screen.snapshot((surface) => surface.fillRect(0, 0, cols, rows, [5, 7, 11]));
  surfaceToPpm(surf, cols, rows, out);
}

function gatewayStatusSnapshot(): void {
  const args = process.argv.slice(3);
  const cols = Number(args[0]) || 100;
  const rows = Number(args[1]) || 32;
  const out = args.find((a) => a.endsWith('.ppm')) ?? '.snapshots/gateway-status.ppm';
  const checking = args.includes('checking');
  const withModal = args.includes('modal');
  const root = checking
    ? Box({ width: cols, height: rows, flexDirection: 'column' }, [
        Box({ flexGrow: 1 }),
        Box({ flexDirection: 'row', alignItems: 'center', gap: 2, padding: [0, 0, 1, 2] }, [
          Button({ id: 'start', label: 'new match', style: { border: 'round', padding: [0, 3], color: [110, 114, 126], borderColor: [110, 114, 126] } }),
          Text({ text: 'checking model health ...', style: { color: 'muted' } }),
        ]),
      ])
    : Box({ width: cols, height: rows, position: 'relative' }, [
        Box({ position: 'absolute', left: 0, bottom: 0, width: cols, justifyContent: 'center' }, [
          Box({ flexDirection: 'row', alignItems: 'center', gap: 2 }, [
            Text({ text: 'game paused, model request failed.', style: { color: 'danger', bold: true } }),
            Button({ id: 'retry', label: 'retry request  ↻', onClick: () => {}, style: { padding: 0, color: 'textPrimary', hover: { color: 'textStrong', bold: true }, focus: { color: 'textStrong', bold: true } } }),
          ]),
        ]),
        ...(withModal ? [{ ...NoticeToast({
          id: 'failure', severity: 'error', title: 'out of credit', body: 'buy AI Gateway credit to resume model requests.',
          action: { label: 'buy AI Gateway credit', onClick: () => {} }, onDismiss: () => {},
        }), style: { position: 'absolute' as const, top: 0, left: 0, width: cols, height: rows, justifyContent: 'center' as const, alignItems: 'center' as const, scrim: 'scrim' as const } }] : []),
      ]);
  const screen = new Screen(cols, rows);
  screen.setRoot(root, { x: 0, y: 0, w: cols, h: rows });
  const surf = screen.snapshot((surface) => surface.fillRect(0, 0, cols, rows, [5, 7, 11]));
  surfaceToPpm(surf, cols, rows, out);
}

function sceneSnapshot(): void {
  const a0 = process.argv[2];
  const scene = a0 === 'chess-game' || a0 === 'logos' ? a0 : null;
  const args = scene ? process.argv.slice(3) : process.argv.slice(2);
  const cols = Number(args[0]) || 110;
  const rows = Number(args[1]) || 44;
  const t = Number(args[2]) || 0.6;
  const out = args[3] || `.snapshots/${scene ?? 'prism'}.ppm`;
  const SS = 3;

  const target = new RenderTarget(cols * SS, (rows - 1) * 2 * SS);
  if (scene === 'chess-game') {
    const cg = new ChessGameScene();
    if (process.argv.includes('match')) {
      // Spin up the AI HUD and play a few opening moves (applied directly — no
      // animation wait) so the still shows a live board with the side-to-move
      // wisp pulsing.
      // `black` → human plays Black vs an AI White, which flips the board 180°.
      cg.beginMatch('anthropic', process.argv.includes('black') ? null : 'openai');
      for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']) {
        const m = cg.state().actionFromString(san);
        if (m) cg.state().applyAction(m);
      }
    }
    cg.renderScene(target, t);
  } else if (scene === 'logos') {
    new LogosScene(process.argv.includes('fallback') ? ['thinkingmachines'] : undefined).renderScene(target, t);
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
  pnpm snapshot <chess-game|logos> [cols] [rows] [t] [out] [fallback]   a named 3D scene
      (chess-game also accepts 'match' to play a few opening plies first)

  pnpm snapshot ui [cols] [rows] [hover=<id>|focus=<id>|pressed=<id>] [out]   button bar
  pnpm snapshot notice [cols] [rows] [focus] [out]   actionable Gateway failure toast
  pnpm snapshot gateway-status [cols] [rows] [checking|modal] [out]   paused model-failure recovery state
  pnpm snapshot overlay [chess-game|prism] [cols] [rows] [out]   bar over a scene
  pnpm snapshot unified [prism|chess|chess-game|logos] [cols] [rows] [out]   unified compositing path
  pnpm snapshot showcase [cols] [rows] [focus=<id>] [query=<text>] [blur] [out]   the UI component playground
  pnpm snapshot modal [cols] [rows] [out]          promotion modal over chess
  pnpm snapshot chess-overlay [cols] [rows] [min|empty|illegal|short] [eval] [chat] [menu] [out]   match HUD + moves panel (menu → ☰ popup)
  pnpm snapshot setup [cols] [rows] [out] [open|models|thinking]   AI match setup modal
  pnpm snapshot gameover [cols] [rows] [out]       result popup over a finished board
  pnpm snapshot confirm-home [cols] [rows] [out]   "return to home screen?" confirm over a game
  pnpm snapshot confirm-quit [cols] [rows] [out]   "quit arcade?" confirm over a game
  pnpm snapshot shortcuts [poker|chess] [cols] [rows] [out]   shortcuts overlay for a screen
  pnpm snapshot king-anim [cols] [rows] [out]      king caught mid-castle (wisp tracking)
  pnpm snapshot audio [cols] [rows] [out]          realtime audio scene (creator wisp)
  pnpm snapshot splash [cols] [rows] [t] [out]     boot splash at time t
  pnpm snapshot coverflow|menu [cols] [rows] [pos] [hover] [out]   Cover Flow carousel
  pnpm snapshot settings [cols] [rows] [open|account [dropdown|loading|switched|error|long]] [out]   home menu button, popup, or account modal
  pnpm snapshot launch [cols] [rows] [index] [t] [out]   Cover Flow flip-to-title splash
  pnpm snapshot prism-prompt [cols] [rows] [t] [out]    prism loading screen + press-any-key marquee
  pnpm snapshot prism-menu-ink [cols] [rows] [progress] [out]   CLI prism → Cover Flow ink transition
  pnpm snapshot cards [single|hand|deck] [cols] [rows] [state] [out]   the cards screen
      (single: a code like Kh/10s/As · hand: peek|up · deck: shuffle|deal)
  pnpm snapshot islanders [sidebar] [discard|trade|trade-port3|trade-port2|trade-empty|player-trade|player-trade-ready|player-trade-mixed] [play-knight|play-road|play-plenty|play-monopoly] [hover=<id>] [hybrid] [shadow-glyphs] [forest|hills|pasture|fields|mountains|desert] [cols] [rows] [<t>] [board|board-cards|pieces|port|edit] [robber|robber-moveN] [fly<roll>@<s>|trade-fly<N>@<s>|dev-fly@<s>] [hud|modal] [out]   a 3D Islanders tile
      (fly5@0.4: freeze the resource cards mid-arc, 0.4s after a roll of 5 pays out — needs hud; the sample board pays on 2, 5 and 10, and a non-paying roll throws nothing)
      (trade-fly2@0.4: freeze both sides of a two-card bank trade mid-arc; add sidebar to use the visible bank row)
      (dev-fly@0.4: freeze a purchased development card mid-arc; add sidebar to launch it from the visible dev pile)
      (robber-move5: preview moving the robber to hex 5 while leaving the current robber in place)
      (<t> a decimal spins the turntable · azN/elN rotate in degrees · zoomN scales camera distance · hud composites the terrain dropdown panel)
      (board modes also take anim<s>|roll[<s>]|build[<s>] to freeze the fly-in, a dice roll, or a build-drop · water<N> sets the current time · varN rerolls the layout · top orbits overhead · modal shows the piece-edit popup)
  pnpm snapshot islanders-game [setup|actions|discard|trade|counter|ai-trade|posted-trade] [spectate] [pov=N] [sidebar] [seats=N] [plies=N] [seed=N] [cols] [rows] [out]   the Islanders game screen
      (default: placement in progress, driven by the rules engine's own legal options — no model calls · setup: the pre-game seat panel)
      (the board is seeded, so the same arguments always render the same hexes; seed=N picks another)
  pnpm snapshot poker [cols] [rows] [preflop|flop|river|showdown] [players=N] [stack=N] [hud|setup|cine|result|menu|notes] [bet=N] [spectate] [longnames] [muck|gather|shuffle] [color] [out]   the poker table
      (muck: fold seats to a burn pile, needs players≥3 · gather/shuffle: the between-hands interlude, mid-sweep / mid-shuffle)

Convert + view:  sips -s format png .snapshots/<name>.ppm --out .snapshots/<name>.png -Z 1000`;

// Dispatch at the bottom so the module-level consts above are initialized before
// a subcommand function runs (function declarations hoist; const/let do not).
if (process.argv[2] === 'help' || process.argv[2] === '--help' || process.argv[2] === '-h') {
  console.log(HELP);
} else if (process.argv[2] === 'ui') {
  uiSnapshot();
} else if (process.argv[2] === 'notice') {
  noticeSnapshot();
} else if (process.argv[2] === 'gateway-status') {
  gatewayStatusSnapshot();
} else if (process.argv[2] === 'overlay') {
  overlaySnapshot();
} else if (process.argv[2] === 'unified') {
  unifiedSnapshot();
} else if (process.argv[2] === 'modal') {
  modalSnapshot();
} else if (process.argv[2] === 'confirm-home') {
  confirmHomeSnapshot();
} else if (process.argv[2] === 'confirm-quit') {
  confirmQuitSnapshot();
} else if (process.argv[2] === 'shortcuts') {
  shortcutsSnapshot();
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
} else if (process.argv[2] === 'prism-menu-ink') {
  prismMenuInkSnapshot();
} else if (process.argv[2] === 'cards') {
  cardsSnapshot();
} else if (process.argv[2] === 'poker') {
  pokerSnapshot();
} else if (process.argv[2] === 'islanders-game') {
  islandersGameSnapshot();
} else if (process.argv[2] === 'islanders') {
  islandersSnapshot();
} else {
  sceneSnapshot();
}

// The Islanders tile test bed: one 3D hex tile for a terrain, on its turntable. Defaults to the
// truer half-block color path (this is a graphics test); `hud` composites the dropdown panel
// + bar through the app's ASCII path; a decimal arg spins the turntable to that time.
// `waterN` captures board-mode current time N so motion can be compared across stills.
//   pnpm exec tsx src/tools/snapshot.ts islanders [forest|hills|pasture|fields|mountains|desert] [cols] [rows] [<t>] [board|board-cards] [waterN] [azN] [elN] [zoomN] [hud] [out.ppm]
function islandersSnapshot(): void {
  const args = process.argv.slice(3);
  const terrain = ((TERRAINS as readonly string[]).find((x) => args.includes(x)) ?? 'forest') as Terrain;
  const nums = args.filter((a) => /^\d+$/.test(a)).map(Number);
  const cols = nums[0] || 120;
  const rows = nums[1] || 44;
  const spinTo = Number(args.find((a) => /^\d+\.\d+$/.test(a))) || 0;
  const waterArg = args.find((a) => /^water[\d.]+$/.test(a));
  const waterTime = waterArg ? Number(waterArg.slice(5)) : 0;
  const out = args.find((a) => a.endsWith('.ppm')) ?? `.snapshots/islanders-${terrain}.ppm`;
  const SS = 4;

  const scene = new TileScene();
  scene.setTerrain(terrain);
  if (args.includes('robber')) scene.setRobber(true);
  if (args.includes('board')) scene.setMode('board');
  if (args.includes('board-cards')) scene.setMode('boardCards');
  if (args.includes('pieces')) scene.setMode('pieces');
  if (args.includes('port')) scene.setMode('port');
  const portKind = (['generic', 'brick', 'grain', 'lumber', 'ore', 'wool'] as const).find((x) => args.includes(x));
  if (portKind) scene.setPortKind(portKind);
  if (args.includes('edit')) {
    scene.setMode('board');
    scene.settle();
    scene.seedDemo();
  }
  // `fly` previews the resource-card arcs, which only exist if the local seat owns pieces to
  // produce from — seed the sample board, and make its corner a city so a paying roll throws the
  // two staggered cards rather than a single one.
  if (args.some((a) => a.startsWith('fly'))) {
    scene.seedDemo();
    scene.upgradeBuilding(0);
  }
  const pieceColor = (['red', 'blue', 'purple', 'orange'] as const).find((x) => args.includes(x));
  if (pieceColor) scene.setActiveColor(pieceColor);
  // `varN` selects procedural variant N (e.g. var2); `top` orbits toward top-down; a decimal
  // rotates the azimuth.
  const varArg = args.find((a) => /^var\d+$/.test(a));
  for (let i = 0; i < (varArg ? Number(varArg.slice(3)) : 0); i++) scene.reroll();
  const portTradeArg = args.includes('trade-port3') ? 'generic' : args.includes('trade-port2') ? 'brick' : null;
  if (portTradeArg) {
    const board = generateBoard(mulberry32(0xc47a));
    scene.adoptBoard(board, false);
    const harbor = board.harbors.find(({ port }) => port.resource === (portTradeArg === 'generic' ? null : 'brick'))!;
    scene.placePiece('building', harbor.nodes[0], ISLANDERS_LOCAL_COLOR);
  }
  if (args.includes('discard')) {
    resetIslandersWorkbenchCards();
    for (let i = 0; i < 5; i++) adjustIslandersWorkbenchHand('brick', 1);
    for (let i = 0; i < 4; i++) adjustIslandersWorkbenchHand('grain', 1);
    beginIslandersWorkbenchDiscard();
    adjustIslandersWorkbenchDiscard('brick', 1);
    adjustIslandersWorkbenchDiscard('grain', 1);
  }
  if (args.includes('top')) scene.orbit(0, 34);
  if (spinTo) scene.orbit(-spinTo * 120, 0);
  const azArg = args.find((a) => /^az-?[\d.]+$/.test(a));
  const elArg = args.find((a) => /^el-?[\d.]+$/.test(a));
  const zoomArg = args.find((a) => /^zoom[\d.]+$/.test(a));
  if (azArg) scene.orbit((-Number(azArg.slice(2)) * Math.PI) / (180 * 0.012), 0);
  if (elArg) scene.orbit(0, (Number(elArg.slice(2)) * Math.PI) / (180 * 0.02));
  if (zoomArg) scene.zoomBy(Number(zoomArg.slice(4)));
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  // `anim<seconds>` (board mode) plays the placement fly-in and captures that instant by
  // stepping frames at 60fps; otherwise a board snapshot settles straight to the finished
  // layout.
  const animArg = args.find((a) => /^anim[\d.]+$/.test(a));
  const boardMode = args.includes('board') || args.includes('board-cards');
  if (boardMode && animArg) {
    scene.reroll();
    const frames = Math.max(1, Math.round(Number(animArg.slice(4)) * 60));
    for (let f = 1; f <= frames; f++) scene.renderScene(target, f / 60);
  } else {
    if (boardMode) scene.settle();
    const robberMoveArg = args.find((a) => /^robber-move\d+$/.test(a));
    if (boardMode && robberMoveArg) {
      const hex = Number(robberMoveArg.slice('robber-move'.length));
      scene.beginRobberMove();
      scene.previewRobberHex(hex);
    }
    scene.renderScene(target, waterTime);
    // `roll` (board mode): roll the dice and step to a chosen time (default past the landing,
    // so the dice rest and the matching chips are lit gold). `roll<seconds>` for a mid-roll.
    const rollArg = args.find((a) => /^roll[\d.]*$/.test(a));
    if (boardMode && rollArg) {
      scene.rollDice();
      const secs = rollArg.length > 4 ? Number(rollArg.slice(4)) : 1.4;
      for (let f = 1; f <= Math.round(secs * 60); f++) scene.renderScene(target, f / 60);
    }
    // `build<seconds>` (board mode): place a settlement and step to a chosen instant of its
    // build-drop (default mid-air) so the elevated → seated animation can be inspected.
    const buildArg = args.find((a) => /^build[\d.]*$/.test(a));
    if (boardMode && buildArg) {
      scene.demoDrop();
      const secs = buildArg.length > 5 ? Number(buildArg.slice(5)) : 0.12;
      for (let f = 1; f <= Math.round(secs * 60); f++) scene.renderScene(target, f / 60);
    }
  }

  const coloredBackground = args.includes('hybrid');
  // The engine's older `hybrid` option fills shadow cells with fallback ramp glyphs. Keep it
  // independently inspectable now that `hybrid` names the user-facing colored-background mode.
  const shadowGlyphs = args.includes('shadow-glyphs');
  if (args.includes('modal')) {
    const screen = new Screen(cols, rows);
    const region = { x: 0, y: 0, w: cols, h: rows };
    screen.setRoot(buildIslandersPieceModal({ road: false, city: false, color: 'blue', onUpgrade: noop, onRemove: noop, onColor: () => {}, onClose: noop }), region);
    const surf = screen.snapshot((s) => shapeGlyphToSurface(s, target, cols, rows, { color: true, coloredBackground }));
    surfaceToPpm(surf, cols, rows, out);
    return;
  }
  if (args.includes('hud')) {
    const developmentPlay = args.includes('play-knight')
      ? 'knight'
      : args.includes('play-road')
        ? 'roadBuilding'
        : args.includes('play-plenty')
          ? 'yearOfPlenty'
          : args.includes('play-monopoly')
            ? 'monopoly'
            : null;
    if (developmentPlay) {
      resetIslandersWorkbenchCards();
      adjustIslandersWorkbenchDev(developmentPlay, 1);
      if (developmentPlay === 'roadBuilding') scene.placePiece('building', 0, ISLANDERS_LOCAL_COLOR);
      beginIslandersWorkbenchDevelopmentPlay(developmentPlay);
      if (developmentPlay === 'knight') scene.beginRobberMove();
      if (developmentPlay === 'roadBuilding') {
        scene.setPlacementGate({ nodes: [], edges: scene.legalRoadEdges(ISLANDERS_LOCAL_COLOR) });
      }
    }
    const screen = new Screen(cols, rows);
    const tradeFlightArg = args.find((arg) => /^trade-fly\d*@\d+(?:\.\d+)?$/.test(arg));
    if (args.includes('trade') || args.includes('trade-port3') || args.includes('trade-port2') || args.includes('trade-empty') || tradeFlightArg) {
      resetIslandersWorkbenchCards();
      const animatedGets = tradeFlightArg ? Number(tradeFlightArg.match(/^trade-fly(\d*)@/)?.[1] || 1) : 1;
      const giveCount = portTradeArg ? scene.maritimeTradeRates(ISLANDERS_LOCAL_COLOR).brick : 4 * animatedGets;
      for (let i = 0; i < giveCount; i++) adjustIslandersWorkbenchHand('brick', 1);
      setIslandersTradeEditorOpen(true);
      if (!args.includes('trade-empty')) {
        setIslandersWorkbenchTradeSelection('brick', 'ore', giveCount);
        for (let i = 1; i < animatedGets; i++) adjustIslandersWorkbenchTradeStaging('receive', 'ore', 1);
      }
    }
    if (args.some((arg) => /^dev-fly@\d+(?:\.\d+)?$/.test(arg))) {
      resetIslandersWorkbenchCards();
      // Leave one further purchase in hand after the animated card is paid for, so the snapshot
      // also verifies that an in-flight card does not disable the trade or buy-dev actions.
      adjustIslandersWorkbenchHand('ore', 2);
      adjustIslandersWorkbenchHand('wool', 2);
      adjustIslandersWorkbenchHand('grain', 2);
    }
    if (args.includes('player-trade') || args.includes('player-trade-ready') || args.includes('player-trade-mixed')) {
      resetIslandersWorkbenchCards();
      const stageOffer = (
        giveCounts: readonly (readonly ['lumber' | 'brick' | 'wool' | 'grain' | 'ore', number])[],
        receive: 'lumber' | 'brick' | 'wool' | 'grain' | 'ore',
        ready: boolean,
      ): void => {
        for (const [resource, count] of giveCounts) {
          for (let i = 0; i < count; i++) {
            adjustIslandersWorkbenchHand(resource, 1);
            adjustIslandersWorkbenchTradeStaging('give', resource, 1);
          }
        }
        adjustIslandersWorkbenchTradeStaging('receive', receive, 1);
        const view = islandersWorkbenchView();
        const id = createIslandersWorkbenchPlayerTrade(view.localPlayer, view.opponents, noop);
        if (id !== null && ready) resolveIslandersWorkbenchPlayerTradeOffer(id);
      };
      if (args.includes('player-trade-mixed')) {
        stageOffer([['lumber', 1]], 'ore', true);
        stageOffer([['lumber', 1], ['brick', 2], ['wool', 3], ['grain', 10]], 'ore', true);
      } else {
        stageOffer(
          [['lumber', 1], ['brick', 2], ['wool', 3], ['grain', 10]],
          'ore',
          args.includes('player-trade-ready'),
        );
      }
    }
    // `sidebar` expands the card rail, which starts collapsed. Note this previews the rail only —
    // the scene stays full width here, where the app also insets the 3D viewport behind it.
    if (args.includes('sidebar') && !islandersSidebarOpen()) toggleIslandersSidebar();
    mountIslandersTileHud(screen);
    (screen.component('islanders-terrain') as Dropdown | undefined)?.pick(TERRAINS.indexOf(terrain));
    (screen.component('islanders-mode') as Dropdown | undefined)?.pick(['tile', 'board', 'boardCards', 'pieces', 'port'].indexOf(scene.currentMode()));
    if (pieceColor) (screen.component('islanders-color') as Dropdown | undefined)?.pick(['red', 'blue', 'purple', 'orange'].indexOf(pieceColor));
    if (portKind) (screen.component('islanders-port') as Dropdown | undefined)?.pick(['generic', 'brick', 'grain', 'lumber', 'ore', 'wool'].indexOf(portKind));
    const region = { x: 0, y: 0, w: cols, h: rows };
    const singlePort = scene.portSailLabel(cols, rows);
    const flightState = islandersFlights(scene, region, args);
    const cardsView = scene.currentMode() === 'boardCards'
      ? islandersWorkbenchView(
          scene.maritimeTradeRates(ISLANDERS_LOCAL_COLOR),
          scene.maritimePortTradeRates(ISLANDERS_LOCAL_COLOR),
        )
      : undefined;
    if (cardsView) cardsView.maritimeTradeBusy = flightState.maritimeTradeBusy;
    if (cardsView && flightState.pendingDevelopmentCards?.length) {
      cardsView.developmentPurchaseBusy = true;
      cardsView.pendingDevelopmentCards = flightState.pendingDevelopmentCards;
    }
    screen.setRoot(buildIslandersTileRoot(region, noop, scene.boardTokens(cols, rows), scene.currentMode(), singlePort ? [singlePort] : scene.boardPortLabels(cols, rows), flightState.active, scene.isMovingRobber(), cardsView), region);
    screen.setHover(args.find((arg) => arg.startsWith('hover='))?.slice(6) ?? null);
    const surf = screen.snapshot(
      (s) => shapeGlyphToSurface(s, target, cols, rows, { color: true, hybrid: shadowGlyphs, coloredBackground }),
      scene.hasForegroundSceneLayer()
        ? (s) => shapeGlyphLayerToSurface(s, target, cols, rows, { color: true, hybrid: shadowGlyphs, coloredBackground })
        : undefined,
    );
    surfaceToPpm(surf, cols, rows, out);
    return;
  }
  writeDisplayPpm(downsample(target, SS), out);
}

// The Islanders GAME screen (not the tile bed): `setup` captures the pre-game panel, and the default
// captures a placement in progress. Placement is driven with the rules engine's own legal options
// rather than models, so the still is reproducible and needs no network. The board is seeded
// (`seed=N` to pick another one), so re-rendering the same arguments lands the same hexes — a
// visual change is then the only thing that can move the pixels.
//   pnpm exec tsx src/tools/snapshot.ts islanders-game [setup|actions|discard|trade|counter|ai-trade|posted-trade] [spectate] [longnames] [pov=N] [sidebar] [seats=N] [plies=N] [seed=N] [cols] [rows] [out.ppm]
function islandersGameSnapshot(): void {
  const args = process.argv.slice(3);
  const nums = args.filter((a) => /^\d+$/.test(a)).map(Number);
  const cols = nums[0] ?? 170;
  const rows = nums[1] ?? 52;
  const seats = Number(args.find((a) => a.startsWith('seats='))?.slice(6) ?? 4);
  const plies = Number(args.find((a) => a.startsWith('plies='))?.slice(6) ?? 5);
  const seed = Number(args.find((a) => a.startsWith('seed='))?.slice(5) ?? 0xca7a4);
  const out = args.find((a) => a.endsWith('.ppm')) ?? `.snapshots/islanders-game.ppm`;
  const region = { x: 0, y: 0, w: cols, h: rows };
  const SS = 3;

  const gameScene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene: gameScene, syncLive: noop });
  if (!args.includes('setup')) {
    if (args.includes('sidebar') && !islandersSidebarOpen()) toggleIslandersSidebar();
    const colors: PlayerColor[] = ['red', 'blue', 'purple', 'orange'].slice(0, seats) as PlayerColor[];
    const counter = args.includes('counter');
    const trade = args.includes('trade');
    const aiTrade = args.includes('ai-trade');
    const postedTrade = args.includes('posted-trade');
    const spectate = args.includes('spectate') || aiTrade || postedTrade;
    const actions = args.includes('actions');
    const discard = args.includes('discard');
    const humanSeat = counter ? 1 : 0;
    const snapshotModels = args.includes('longnames')
      ? ['snapshot/grok-4.1-fast-non-reasoning', 'snapshot/claude-haiku-4.5', 'snapshot/gpt-5.4-nano', 'snapshot/gemini-2.5-flash']
      : colors.map((_color, i) => `snapshot/model-${i}`);
    const specs: IslandersSeatSpec[] = colors.map((color, i) => (!spectate && i === humanSeat
      ? { kind: 'human', color }
      : { kind: 'ai', color, model: snapshotModels[i] }));
    const state = driver.start(specs, { autoRun: false, rng: mulberry32(seed) });
    const pov = Number(args.find((arg) => arg.startsWith('pov='))?.slice(4) ?? 0);
    if (spectate && pov > 0 && pov < seats) gameScene.setViewedSeat(pov);
    gameScene.setResourceFlightLayout(region, seats, islandersRailVisible(cols, rows));
    if (aiTrade || postedTrade) {
      while (!state.initialPlacementComplete()) void gameScene.playMove(state.legalActions()[0]);
      void gameScene.playMove({ type: 'roll' });
      const hands = (state as unknown as { hands: number[][] }).hands;
      hands[0].fill(0);
      hands[1].fill(0);
      hands[0][resourceIndex('brick')] = 3;
      hands[1][resourceIndex('grain')] = 3;
      const offer: IslandersAction = { type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 2, 0, 0, 0] };
      if (aiTrade) gameScene.setActionPreviewDuration(5);
      void gameScene.playMove(offer);
    } else if (counter) {
      while (!state.initialPlacementComplete()) void gameScene.playMove(state.legalActions()[0]);
      void gameScene.playMove({ type: 'roll' });
      const hands = (state as unknown as { hands: number[][] }).hands;
      hands[0] = [2, 0, 0, 0, 0];
      hands[1] = [0, 2, 0, 0, 0];
      void gameScene.playMove({ type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] });
      void gameScene.requestHumanMove();
      gameScene.beginHumanMenu('tradeCounter');
    } else if (discard) {
      while (!state.initialPlacementComplete()) void gameScene.playMove(state.legalActions()[0]);
      const hands = (state as unknown as { hands: number[][] }).hands;
      hands[0].fill(0);
      hands[0][resourceIndex('brick')] = 5;
      hands[0][resourceIndex('grain')] = 4;
      state.applyAction({ type: 'roll' }, { dice: [3, 4] });
      void gameScene.requestHumanMove();
      gameScene.pickHumanMenuResource('brick');
      gameScene.pickHumanMenuResource('grain');
    } else if (trade || actions) {
      while (!state.initialPlacementComplete()) void gameScene.playMove(state.legalActions()[0]);
      void gameScene.playMove({ type: 'roll' });
      const hands = (state as unknown as { hands: number[][] }).hands;
      hands[0].fill(0);
      // Setup resource flights are intentionally still pending in the frozen frame. Seed enough
      // authoritative cards that the viewer-adjusted hand remains positive while the editor is
      // staged, rather than showing a fixture-only negative count.
      hands[0][resourceIndex('brick')] = 9;
      hands[0][resourceIndex('lumber')] = 3;
      hands[0][resourceIndex('wool')] = 3;
      hands[0][resourceIndex('grain')] = 3;
      hands[0][resourceIndex('ore')] = 3;
      void gameScene.requestHumanMove();
      if (trade) {
        gameScene.beginHumanMenu('tradeEditor');
        for (let i = 0; i < 4; i++) gameScene.adjustHumanTradeResource('brick', 'give', 1);
        gameScene.adjustHumanTradeResource('ore', 'receive', 1);
      }
    } else {
      // Walk deterministic first-legal actions without asking a model. Sixteen plies finish setup;
      // larger values exercise the live turn HUD as well.
      for (let i = 0; i < plies && !state.isTerminal(); i++) {
        const action = state.legalActions()[0];
        if (!action) break;
        void gameScene.playMove(action);
      }
      if (state.currentPlayer() === 0) void gameScene.requestHumanMove();
    }
  }
  gameScene.scene.settle();

  const target = new RenderTarget(cols * SS, rows * SS);
  gameScene.renderScene(target, 0.7);
  const screen = new Screen(cols, rows);
  mountIslandersGameHud(screen);
  screen.setRoot(buildIslandersGameRoot(region, {
    driver,
    scene: gameScene,
    tokens: gameScene.scene.boardTokens(cols, rows),
    sails: gameScene.scene.boardPortLabels(cols, rows),
    resourceFlights: gameScene.activeResourceFlights(),
    resourceAdjustments: gameScene.resourceViewAdjustments(),
    onOpenMenu: noop,
    onStart: noop,
  }), region);
  const surf = screen.snapshot((s) => shapeGlyphToSurface(s, target, cols, rows, { color: true, hybrid: false }));
  surfaceToPpm(surf, cols, rows, out);
}

// `fly<roll>@<seconds>` freezes the resource-card animation mid-arc: pay out that roll to the
// local seat and step the flights to that instant. Mirrors what IslandersController does on a landed
// roll — the tool has no controller, so it drives the same two pieces directly.
interface IslandersSnapshotFlightState {
  active: FlyingResource<Resource | DevCardType>[];
  maritimeTradeBusy?: boolean;
  pendingDevelopmentCards?: DevCardType[];
}

function islandersFlights(scene: TileScene, region: { w: number; h: number }, args: string[]): IslandersSnapshotFlightState {
  const devArg = args.find((arg) => /^dev-fly@\d+(?:\.\d+)?$/.test(arg));
  if (devArg) {
    const at = Number(devArg.slice('dev-fly@'.length));
    const card = beginIslandersWorkbenchDevPurchase();
    if (!card) return { active: [] };
    const flights = new ResourceFlights<DevCardType>();
    const layoutRegion = { x: 0, y: 0, ...region };
    const railVisible = islandersRailVisible(region.w, region.h);
    const view = islandersWorkbenchView();
    view.developmentPurchaseBusy = true;
    view.pendingDevelopmentCards = [card];
    flights.spawn(
      card,
      1,
      islandersDevDeckDepartureCell(layoutRegion, view.opponents.length + 1, railVisible),
      islandersDevHandLandingCell(layoutRegion, card, railVisible, view),
      0,
      7,
    );
    for (let f = 0; f <= Math.round(at * 60); f++) {
      const events = flights.advanceWithDepartures(f / 60);
      for (const departed of events.departed) departIslandersWorkbenchDevCard(departed);
      for (const landed of events.landed) landIslandersWorkbenchDevCard(landed);
    }
    return {
      active: flights.active(),
      ...(flights.busy() ? { pendingDevelopmentCards: [card] } : {}),
    };
  }

  const tradeArg = args.find((arg) => /^trade-fly\d*@\d+(?:\.\d+)?$/.test(arg));
  if (tradeArg) {
    const match = tradeArg.match(/^trade-fly(\d*)@(\d+(?:\.\d+)?)$/)!;
    const count = Number(match[1] || 1);
    const at = Number(match[2]);
    const trade = beginStagedIslandersWorkbenchBankTrade();
    if (!trade || trade.gets.length !== count) return { active: [] };
    const incomingFlights = new ResourceFlights();
    const offerFlights = new ResourceFlights();
    const layoutRegion = { x: 0, y: 0, ...region };
    const playerCount = islandersWorkbenchView().opponents.length + 1;
    const railVisible = islandersRailVisible(region.w, region.h);
    offerFlights.spawn(
      trade.give,
      trade.rate * trade.gets.length,
      islandersHandLandingCell(layoutRegion, trade.give),
      islandersBankDepartureCell(layoutRegion, trade.give, playerCount, railVisible),
      0,
      7,
      false,
    );
    for (let order = 0; order < trade.gets.length; order++) {
      const resource = trade.gets[order];
      incomingFlights.spawn(
        resource,
        1,
        islandersBankDepartureCell(layoutRegion, resource, playerCount, railVisible),
        islandersHandLandingCell(layoutRegion, resource),
        order,
        7,
      );
    }
    for (let f = 0; f <= Math.round(at * 60); f++) {
      const incoming = incomingFlights.advanceWithDepartures(f / 60);
      const offered = offerFlights.advanceWithDepartures(f / 60);
      for (const resource of incoming.departed) departIslandersWorkbenchBankResource(resource);
      for (const resource of incoming.landed) bankIslandersResource(resource);
      for (const resource of offered.departed) departIslandersWorkbenchHandResource(resource);
      for (const resource of offered.landed) landIslandersWorkbenchBankResource(resource);
    }
    return {
      active: [...offerFlights.active(), ...incomingFlights.active()],
      maritimeTradeBusy: offerFlights.busy() || incomingFlights.busy(),
    };
  }

  const arg = args.find((a) => /^fly\d+@[\d.]+$/.test(a));
  if (!arg) return { active: [] };
  const [roll, at] = arg.slice(3).split('@').map(Number);
  const flights = new ResourceFlights();
  let thrown = 0;
  for (const source of scene.rollSources(ISLANDERS_LOCAL_COLOR, roll, region.w, region.h)) {
    flights.spawn(source.resource, source.count, source, islandersHandLandingCell({ x: 0, y: 0, ...region }, source.resource), thrown);
    thrown += source.count;
  }
  for (let f = 1; f <= Math.round(at * 60); f++) flights.advance(f / 60);
  return { active: flights.active() };
}

// The poker table with a dealt hand at a chosen street, presented through the app's
// default ASCII path (plus the projected stack/pot overlay).
//   pnpm exec tsx src/tools/snapshot.ts poker [cols] [rows] [preflop|flop|river|showdown] [players=N] [color] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts poker idle [cols] [rows] [<t>] [color] [out.ppm]
//     idle: no session running — 4 chairs + the centre deck at loop time <t>
//           seconds (a decimal, e.g. 1.0 for the riffle; default 1.0).
//   pnpm exec tsx src/tools/snapshot.ts poker setup [cols] [rows] [out.ppm]
//     setup: the new-match settings panel over the idle table, previewing the
//            default seats (chair ring + creator wisps) + the start/cancel buttons.
//   pnpm exec tsx src/tools/snapshot.ts poker cine [cols] [rows] [players=N] [out.ppm]
//     cine: the flop's bird's-eye deal cinematic (fixed top-down over the board, HUD
//           hidden to the top-right pills, with the top banner + "click to continue").
//   pnpm exec tsx src/tools/snapshot.ts poker showdown hud result [players=N] [out.ppm]
//     result: the end-of-hand winner banner + "click to continue" over the final table.
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

  // `setup`: the new-match settings panel over the idle table, previewing the default
  // choices (chair ring follows the player count; creator wisps float over AI seats),
  // with the bottom-left "start match" button — exactly what "new match" opens in-app.
  // `spectate` / `players=N` drive the real pickers, so variants render true to app.
  if (args.includes('setup')) {
    if (args.includes('spectate')) pokerModeDropdown.pick(1);
    if (players >= 2 && players <= 6 && args.some((a) => a.startsWith('players='))) pokerPlayersDropdown.pick(players - 2);
    const idleScene = new PokerGameScene();
    idleScene.setPreview(pokerPreviewSeats(), pokerStartingStack());
    const buf = new RenderTarget(cols * SS, rows * 2 * SS);
    let ti = 0;
    for (let i = 0; i < 45; i++) {
      idleScene.renderScene(buf, ti);
      ti += 1 / 30;
    }
    const region = { x: 0, y: 0, w: cols, h: rows };
    const screen = new Screen(cols, rows);
    mountPokerSetup(screen);
    mountPokerGameHud(screen);
    screen.setRoot(
      buildPokerGameRoot(region, buildBar('poker', 'ascii', barActions), {
        hero: { toAct: false, toCall: 0, minRaiseTo: 0, maxRaiseTo: 0, stack: 0, pot: 0, currentBet: 0, bigBlind: 20, canRaise: false },
        blinds: '10/20',
        commentary: null,
        t: 0,
        status: '',
        table: null,
        active: false,
        chatOpen: false,
        onToggleChat: noop,
        onOpenMenu: noop,
        onOpenNotes: noop,
        setup: buildPokerSetupPanel(args.includes('checking') ? { lines: ['checking model health ...'], failed: false } : args.includes('health-failed') ? { lines: ['claude-haiku-4.5, gpt-5.4-nano failed health check.'], failed: true } : undefined),
        matchControls: { setup: true, onPrimary: args.includes('checking') || args.includes('health-failed') ? undefined : noop, onCancel: noop },
        pauseControl: null,
        hideHud: false,
        cineLabel: null,
        resultLabel: null,
        awaitingContinue: false,
      }),
      region,
    );
    const surf2 = screen.snapshot((s) => shapeGlyphToSurface(s, buf, cols, rows, { color: true, hybrid: true }));
    surfaceToPpm(surf2, cols, rows, args.find((a) => a.endsWith('.ppm')) ?? '.snapshots/poker-setup.ppm');
    return;
  }

  // `spectate` → every seat is an AI (all hole cards visible, no hero controls); otherwise
  // seat 1 is the human hero (only their own cards show).
  const spectate = args.includes('spectate');
  const scene = new PokerGameScene();
  // Route game events into the chat thread (grey lines) so the `hud` snapshot shows them.
  clearPokerChat();
  scene.setEventSink((text) => pushPokerChat({ text, model: '', event: true }));
  const creatorSlugs = creators().map((c) => c.slug);
  const longNames = ['grok-4.1-fast-non-reasoning', 'claude-haiku-4.5', 'step-3.7-flash', 'gemini-2.5-flash'];
  const seatViews: PokerSeatView[] = [];
  for (let s = 0; s < players; s++) {
    if (s === 0 && !spectate) seatViews.push({ kind: 'human', label: 'You' });
    else {
      const label = args.includes('longnames') ? longNames[s % longNames.length] : `AI ${s + 1}`;
      seatViews.push({ kind: 'ai', label, creator: creatorSlugs[s % creatorSlugs.length] });
    }
  }
  scene.beginSession(seatViews);

  // `stack=N` sets each seat's starting chips (default 1000) — to eyeball big-stack piles
  // now that the starting stack is configurable in setup, e.g. checking chips clear the cards.
  const stackArg = args.find((a) => /^stack=\d+$/.test(a));
  const startStack = stackArg ? Number(stackArg.split('=')[1]) : 1000;
  const state = new HoldemState({ stacks: new Array(players).fill(startStack), button: 0, smallBlind: 10, bigBlind: 20, rng: mulberry32(0x90ce7) });
  scene.beginHand(state);

  // `cine`: catch the community-deal cinematic mid-flight — the camera has cut to the
  // fixed bird's-eye over the board and the HUD is hidden down to the top-right pills.
  // Finish the opening deal, close the preflop round (turning the flop → starting the
  // cinematic), then step into its bird's-eye hold before compositing.
  if (args.includes('cine')) {
    const chatOpen = args.includes('chat');
    const sceneViewport = insetSceneViewport(cols, rows, { right: chatOpen ? CHAT_WIDTH : 0 });
    const buf = new RenderTarget(sceneViewport.w * SS, sceneViewport.h * 2 * SS);
    let tc = 0.05;
    const stepc = (): void => {
      scene.renderScene(buf, tc);
      tc += 1 / 30;
    };
    for (let i = 0; i < 100; i++) stepc(); // opening hole-card deal lands
    // Play (check/call) up to the requested street so its cinematic frames the right count:
    // flop (default) → 3 cards, `river` → all 5. The turning move starts the cinematic.
    const cineTarget = street === 'river' || street === 'showdown' ? 3 : 1;
    let g = 0;
    while (state.street() < cineTarget && !state.isTerminal() && g++ < 120) {
      const toCall = state.toCall(state.toActSeat());
      void scene.playMove(toCall > 0 ? { type: 'call' } : { type: 'check' });
    }
    for (let i = 0; i < 160; i++) stepc(); // pre beat → cut → cards deal (slow) → sit in 'wait'
    const region = { x: 0, y: 0, w: cols, h: rows };
    const screen = new Screen(cols, rows);
    mountPokerGameHud(screen);
    screen.setRoot(
      buildPokerGameRoot(region, buildBar('poker', 'ascii', barActions, { label: 'pause', active: true }), {
        hero: { toAct: false, toCall: 0, minRaiseTo: 0, maxRaiseTo: 0, stack: 0, pot: 0, currentBet: 0, bigBlind: 20, canRaise: false },
        blinds: '10/20',
        commentary: null,
        t: 0,
        status: '',
        table: scene.tableView(),
        active: true,
        chatOpen,
        onToggleChat: noop,
        onOpenMenu: noop,
        onOpenNotes: noop,
        setup: null,
        matchControls: null,
        pauseControl: { paused: false, onToggle: noop },
        hideHud: scene.cineHidesHud(),
        cineLabel: scene.cineLabel(),
        resultLabel: scene.resultLabel(),
        awaitingContinue: scene.awaitingContinue(),
        continueIn: scene.continueCountdown(),
      }),
      region,
    );
    const surf2 = screen.snapshot((s) =>
      shapeGlyphToSurface(
        s,
        buf,
        sceneViewport.w,
        sceneViewport.h,
        { color: true, hybrid: true },
        sceneViewport.x,
        sceneViewport.y,
      ),
    );
    surfaceToPpm(surf2, cols, rows, args.find((a) => a.endsWith('.ppm')) ?? '.snapshots/poker-cine.ppm');
    return;
  }

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
  // `muck` (needs players≥3): fold seats down to two, so the burn pile has several
  // rotated cards to show. Folds go through playMove so each mucks its cards.
  if (args.includes('muck')) {
    const live = (): number => {
      let c = 0;
      for (let i = 0; i < players; i++) if (!state.isFolded(i)) c++;
      return c;
    };
    let guard = 0;
    while (live() > 2 && !state.isTerminal() && guard++ < 50) void scene.playMove({ type: 'fold' });
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
  // `gather` / `shuffle`: kick off the between-hands interlude and step partway in —
  // `gather` stops mid-sweep (cards flying into the deck), `shuffle` steps deeper so the
  // deck is mid riffle/bridge. Same frame source, different depth.
  if (args.includes('gather') || args.includes('shuffle')) {
    void scene.runInterlude();
    const frames = args.includes('shuffle') ? 60 : 8;
    for (let i = 0; i < frames; i++) step();
  }
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
  // `menu` composites the in-game ☰ menu popup over the table.
  if (args.includes('menu')) {
    const screen = new Screen(cols, rows);
    screen.setRoot(
      buildGameMenu({
        groups: [
          [
            { id: 'poker-menu-home', label: 'home', onClick: noop },
            { id: 'poker-menu-new', label: 'new game', onClick: noop },
          ],
          [
            { id: 'poker-menu-reset', label: 'reset camera', onClick: noop },
            { id: 'poker-menu-mode', label: 'display', value: 'ascii', onClick: noop },
            { id: 'poker-menu-color', label: 'color', value: 'truecolor', onClick: noop },
          ],
          [{ id: 'poker-menu-quit', label: 'quit', onClick: noop }],
        ],
        valueColW: 9,
        onClose: noop,
      }),
      region,
    );
    const surf2 = screen.snapshot((s) => shapeGlyphToSurface(s, target, cols, rows, { color: true, hybrid: true }));
    surfaceToPpm(surf2, cols, rows, out);
    return;
  }
  // `notes` composites the opponent-notes modal over the table, with sample reads so the
  // observer dropdown + per-player bullets render. `longnames` picks a long observer to
  // check the dropdown ellipsis + the card's fixed width.
  if (args.includes('notes')) {
    const screen = new Screen(cols, rows);
    mountPokerGameHud(screen); // mounts the notes ScrollBox + observer dropdown so their Slots resolve
    const observers = args.includes('longnames')
      ? [
          { label: 'grok-4.1-fast-non-reasoning', creator: 'xai' },
          { label: 'claude-opus-4.8', creator: 'anthropic' },
          { label: 'gpt-5.4-nano', creator: 'openai' },
        ]
      : [
          { label: 'claude-opus-4.8', creator: 'anthropic' },
          { label: 'gpt-5.4', creator: 'openai' },
          { label: 'gemini-3-pro', creator: 'google' },
        ];
    screen.setRoot(
      buildPokerNotesModal({
        observers,
        activeIndex: 0,
        entries: [
          {
            label: 'the human',
            notes: [
              'Bets big when weak and checks the nuts, so treat a large bet on a scary board as a bluff more often than not.',
              'Folds to any turn raise.',
              'Overvalues top pair and will stack off with it on wet boards.',
            ],
          },
          {
            label: 'gpt-5.4',
            notes: ['Shoves almost every hand — call lighter.', 'Never slow-plays; a check means genuine weakness.'],
          },
          {
            label: 'gemini-3-pro',
            notes: ['Tight preflop, but barrels turn and river relentlessly once committed.'],
          },
          { label: 'claude-haiku-4.5', notes: [] },
        ],
        onClose: noop,
      }),
      region,
    );
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
    const chatOpen = !args.includes('chatclosed');
    const sceneViewport = insetSceneViewport(cols, rows, { right: chatOpen ? CHAT_WIDTH : 0 });
    const hudTarget = chatOpen ? new RenderTarget(sceneViewport.w * SS, sceneViewport.h * 2 * SS) : target;
    // Re-render once at the actual visible aspect so the camera and scene match
    // the left-side viewport instead of continuing underneath the chat rail.
    if (chatOpen) scene.renderScene(hudTarget, t);
    // Seed a few table-talk lines so the right-rail chat renders alongside the game events.
    for (const m of [
      { text: "checking to the raiser - let's see what you've got.", model: 'openai/gpt-5.4' },
      { text: 'feeling good about this one. bumping it up.', model: 'anthropic/claude-opus-4.8' },
      { text: "that's a big number. giving it a think.", model: 'google/gemini-3-pro' },
    ])
      pushPokerChat(m);
    // `result` composites the end-of-hand winner banner and next-hand countdown over
    // the visible final table. Needs a decided hand (showdown).
    if (args.includes('result')) {
      void scene.beginResult('claude-opus-4.8 wins $240');
      scene.renderScene(hudTarget, t + 1 / 30); // arm the six-second next-hand countdown
    }
    const hero = {
      toAct: !spectate && !args.includes('result'),
      toCall: st.toCall(0),
      minRaiseTo: st.minRaiseTo(0),
      maxRaiseTo: st.maxRaiseTo(0),
      stack: st.stackOf(0),
      pot: st.potTotal(),
      currentBet: st.currentBetAmount(),
      bigBlind: st.bigBlind(),
      canRaise: st.maxRaiseTo(0) > st.currentBetAmount(),
    };
    const buildRoot = (): ReturnType<typeof buildPokerGameRoot> =>
      buildPokerGameRoot(region, buildBar('poker', 'ascii', barActions, { label: 'pause', active: true }), {
        hero,
        blinds: '10/20',
        commentary: null,
        t: 0,
        status: '', // matches the app: no "Your move" toast (the lit strip + action bar signal the turn)
        table: scene.tableView(),
        active: true,
        chatOpen,
        onToggleChat: noop,
        onOpenMenu: noop,
        onOpenNotes: noop,
        setup: null,
        matchControls: null,
        pauseControl: { paused: false, onToggle: noop },
        hideHud: false, // the community-deal cinematic has its own `cine` subcommand
        cineLabel: null,
        resultLabel: scene.resultLabel(),
        awaitingContinue: scene.awaitingContinue(),
        continueIn: scene.continueCountdown(),
      });
    screen.setRoot(buildRoot(), region); // first build arms the amount field to the min-raise
    // `bet=N` presets the raise amount (to check fixed button widths at any digit count / all-in).
    // The re-arm only fires on the first build, so setting the field then rebuilding sticks.
    const betArg = args.find((a) => /^bet=\d+$/.test(a));
    if (betArg) {
      pokerBetInput.value = betArg.split('=')[1];
      screen.setRoot(buildRoot(), region);
    }
    const surf2 = screen.snapshot((s) => {
      shapeGlyphToSurface(
        s,
        hudTarget,
        sceneViewport.w,
        sceneViewport.h,
        { color: true, hybrid: true },
        sceneViewport.x,
        sceneViewport.y,
      );
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

// The realtime audio scene: the active model's creator wisp in 3D (speaking, so
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
  // title chrome on top (mirrors drawCoverChrome in main.ts).
  const surf = new Surface(cols, rows);
  shapeGlyphToSurface(surf, target, cols, rows, { color: true });
  const item = MENU_ITEMS[coverFlowIndex(sel, MENU_ITEMS.length)];
  if (item) {
    const suffix = item.enabled ? '' : '   coming soon';
    const x = Math.max(0, Math.floor((cols - item.title.length - suffix.length) / 2));
    surf.drawTextOver(x, rows - 4, item.title, [240, 244, 255], STYLE_BOLD);
    if (suffix) surf.drawTextOver(x + item.title.length, rows - 4, suffix, [150, 156, 174], STYLE_DIM);
  }
  surfaceToPpm(surf, cols, rows, out);
  console.log(`wrote ${out} (${cols}x${rows})`);
}

// The home menu button over Cover Flow; `open` shows its menu and `account`
// shows the nested Vercel account modal. Mirrors the live menu chrome.
//   pnpm exec tsx src/tools/snapshot.ts settings [cols] [rows] [open|account [dropdown]] [out.ppm]
function settingsSnapshot(): void {
  const args = process.argv.slice(3);
  const cols = Number(args[0]) || 150;
  const rows = Number(args[1]) || 46;
  const open = args.includes('open');
  const account = args.includes('account');
  const out = args.find((a) => a.endsWith('.ppm')) ?? '.snapshots/settings.ppm';
  const SS = 3;
  const sel = 0;

  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new CoverFlowScene().renderScene(target, 0, -1);

  const screen = new Screen(cols, rows);
  mountTeamSwitch(screen);
  const region = { x: 0, y: 0, w: cols, h: rows };
  if (account) {
    // A long list exercises the dropdown's sticky search row, wrapped options,
    // and overflow-owned scrollbar. The closed field shows the current team.
    const teams = [
      { id: 't1', slug: 'acme', name: args.includes('long') ? 'Acme Corporation With An Unusually Long Team Name' : 'Acme Corp' },
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
    setTeamSwitchTeams(teams, teams[1]);
    if (args.includes('switched')) markSwitchSucceeded(teams[3]);
    const view = args.includes('loading')
      ? { kind: 'loading' as const }
      : args.includes('error')
        ? { kind: 'error' as const, message: 'Could not create AI Gateway key (HTTP 403): Your team does not have permission to create AI Gateway keys.', canReturn: true }
        : { kind: 'loaded' as const };
    screen.setRoot(buildTeamSwitch(view, { onClose: noop, onSignIn: noop, onBack: noop, onLogout: noop }), region);
    if (view.kind === 'loaded' && args.includes('dropdown')) {
      screen.setFocus('team-switch-dropdown');
      (screen.component('team-switch-dropdown') as Dropdown | undefined)?.onKey({
        name: 'enter',
        raw: '\r',
        sequence: '\r',
        ctrl: false,
        shift: false,
        meta: false,
        eventType: 'press',
      });
      // Re-expand after changing component state so the snapshot includes its overlays.
      screen.setRoot(buildTeamSwitch(view, { onClose: noop, onSignIn: noop, onBack: noop, onLogout: noop }), region);
    }
  } else if (open) {
    screen.setRoot(
      buildGameMenu({
        groups: [
          [
            { id: 'home-menu-display', label: 'display', value: 'ascii', onClick: noop },
            { id: 'home-menu-color', label: 'color', value: 'truecolor', onClick: noop },
          ],
          [
            { id: 'home-menu-shortcuts', label: 'controls', onClick: noop },
            { id: 'home-menu-account', label: 'account', onClick: noop },
            { id: 'home-menu-quit', label: 'quit', onClick: noop },
          ],
        ],
        valueColW: 9,
        onClose: noop,
      }),
      region,
    );
  } else {
    const overlay = Box({ width: cols, height: rows }, [Box({ position: 'absolute', top: 1, right: 2 }, [Button({ id: 'menu-button', label: '☰ menu', style: UI_CHROME_PILL })])]);
    screen.setRoot(overlay, region);
  }
  const surf = screen.snapshot((s) => {
    shapeGlyphToSurface(s, target, cols, rows, { color: true });
    const item = MENU_ITEMS[sel];
    if (item) {
      const suffix = item.enabled ? '' : '   coming soon';
      const x = Math.max(0, Math.floor((cols - item.title.length - suffix.length) / 2));
      s.drawTextOver(x, rows - 4, item.title, [240, 244, 255], STYLE_BOLD);
      if (suffix) s.drawTextOver(x + item.title.length, rows - 4, suffix, [150, 156, 174], STYLE_DIM);
    }
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

function prismMenuInkSnapshot(): void {
  const cols = Number(process.argv[3]) || 140;
  const rows = Number(process.argv[4]) || 44;
  const progress = Math.max(0, Math.min(1, Number(process.argv[5]) || 0));
  const out = process.argv.find((arg) => arg.endsWith('.ppm')) ?? '.snapshots/prism-menu-ink.ppm';
  const SS = 3;
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new PrismScene().renderScene(target, 0.9 + progress * 0.2);
  const source = new Surface(cols, rows);
  shapeGlyphToSurface(source, target, cols, rows, { color: true });
  const prompt = 'press any key to start';
  source.drawTextOver(Math.max(0, Math.floor((cols - prompt.length) / 2)), rows - 2, prompt, [205, 210, 230]);

  const coverflow = new CoverFlowScene();
  coverflow.renderScene(target, 0, null);
  const destination = new Surface(cols, rows);
  shapeGlyphToSurface(destination, target, cols, rows, { color: true });
  const item = MENU_ITEMS[0];
  destination.drawTextOver(Math.max(0, Math.floor((cols - item.title.length) / 2)), rows - 4, item.title, [240, 244, 255], STYLE_BOLD);

  const transition = new TimedInkTransition({ duration: 1, cut: { from: { x: 0.62, y: 0.43 }, to: { x: 0.5, y: 0.5 }, direction: { x: -0.82, y: 0.57 } } });
  transition.start();
  transition.step(progress);
  surfaceToPpm(transition.compose(source, destination), cols, rows, out);
  console.log(`wrote ${out} (${cols}x${rows}, progress=${progress})`);
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
  const queryArg = args.find((a) => a.startsWith('query='));
  const out = args.find((a) => a.endsWith('.ppm')) ?? '.snapshots/showcase.ppm';
  const SS = 3;

  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new ChessGameScene().renderScene(target);

  const screen = new Screen(cols, rows);
  mountShowcase(screen);
  if (focusArg) screen.setFocus(focusArg.split('=')[1]);
  const region = { x: 0, y: 0, w: cols, h: rows };
  screen.setRoot(buildShowcase(region, buildBar('ui', 'ascii', barActions)), region);
  if (queryArg) {
    const targetId = focusArg?.split('=')[1] ?? 'sc-model-dropdown';
    screen.setFocus(targetId);
    // Rebuild once so the component receives focus before the synthetic text
    // events, then again so the filtered overlay has current geometry.
    screen.setRoot(buildShowcase(region, buildBar('ui', 'ascii', barActions)), region);
    for (const raw of queryArg.slice('query='.length)) {
      screen.handleKey({
        name: raw.toLowerCase(),
        raw,
        sequence: raw,
        ctrl: false,
        shift: raw !== raw.toLowerCase(),
        meta: false,
        eventType: 'press',
      });
    }
    screen.setRoot(buildShowcase(region, buildBar('ui', 'ascii', barActions)), region);
  }
  if (args.includes('blur')) {
    screen.setFocus(null);
    screen.setRoot(buildShowcase(region, buildBar('ui', 'ascii', barActions)), region);
  }
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
  const chatVisible = args.includes('chat');

  const cg = new ChessGameScene();
  cg.beginMatch();
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) {
    const m = cg.state().actionFromString(san);
    if (m) cg.state().applyAction(m);
  }
  const sceneViewport = insetSceneViewport(cols, rows, { right: chatVisible ? CHAT_WIDTH : 0 });
  const target = new RenderTarget(sceneViewport.w * SS, sceneViewport.h * 2 * SS);
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
  if (chatVisible && !process.argv.includes('empty')) {
    clearChat();
    // Mirror the live thread: each ply's pre-move rationale (colored, named) followed by
    // the settled move as a grey event line with the mover's glyph — and, under the
    // illegal toggle, a red "(illegal)" move line.
    const seed: [string, string, string][] = [
      ['e4', 'openai/gpt-5.4', 'e4 - grabbing the center. Classic and principled.'],
      ['c5', 'anthropic/claude-opus-4.8', 'c5, the Sicilian. I refuse to play symmetrically against you today.'],
      ['Nf3', 'openai/gpt-5.4', "Nf3, developing and eyeing d4. Let's open this up."],
      ['Nc6', 'anthropic/claude-opus-4.8', 'Nc6. Fighting for the center squares, holding my ground.'],
      ['Bb5', 'openai/gpt-5.4', 'Bb5 — a Rossolimo. Pinning your knight and slowing the queenside.'],
    ];
    seed.forEach(([san, model, text], i) => {
      pushChatMessage({ text, model });
      pushChatMessage(chessMoveChat(san, i, false));
    });
    if (process.argv.includes('illegal')) {
      pushChatMessage({ text: 'Qh5?! ignoring the pin — sending it anyway.', model: 'anthropic/claude-opus-4.8' });
      pushChatMessage(chessMoveChat('Qh5', 5, true)); // illegal-toggle ply → red "(illegal)"
    }
  }
  const region = { x: 0, y: 0, w: cols, h: rows };
  // 'menu' shows the in-game ☰ menu popup over the board (the shared buildGameMenu).
  if (process.argv.includes('menu')) {
    screen.setRoot(
      buildGameMenu({
        groups: [
          [
            { id: 'chess-menu-home', label: 'home', onClick: noop },
            { id: 'chess-menu-new', label: 'reset board', onClick: noop },
          ],
          [
            { id: 'chess-menu-reset', label: 'reset camera', onClick: noop },
            { id: 'chess-menu-mode', label: 'display', value: 'ascii', onClick: noop },
            { id: 'chess-menu-color', label: 'color', value: 'truecolor', onClick: noop },
            { id: 'chess-menu-eval', label: 'eval bar', value: evalVisible ? 'on' : 'off', onClick: noop },
            { id: 'chess-menu-illegal', label: 'illegal moves', value: 'off', onClick: noop },
          ],
          [
            { id: 'chess-menu-shortcuts', label: 'controls', onClick: noop },
            { id: 'chess-menu-quit', label: 'quit', onClick: noop },
          ],
        ],
        valueColW: 9,
        onClose: noop,
      }),
      region,
    );
    const surf2 = screen.snapshot((s) =>
      shapeGlyphToSurface(
        s,
        target,
        sceneViewport.w,
        sceneViewport.h,
        { color: true, hybrid: true },
        sceneViewport.x,
        sceneViewport.y,
      ),
    );
    surfaceToPpm(surf2, cols, rows, out);
    return;
  }
  screen.setRoot(
    buildChessGameRoot(region, buildBar('chess-game', 'ascii', barActions, { label: 'pause', active: true }), {
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
      onOpenMenu: noop,
      chatActive: false,
      illegalOn: process.argv.includes('illegal'),
      // Sample matchup for the top banner (brand-ish colors); `freeplay` shows the idle state.
      matchup: process.argv.includes('freeplay')
        ? null
        : { white: { text: 'claude-opus-4.8', color: [217, 119, 87] }, black: { text: 'gpt-5.4', color: [22, 163, 127] } },
    }),
    region,
  );
  const surf = screen.snapshot((s) =>
    shapeGlyphToSurface(
      s,
      target,
      sceneViewport.w,
      sceneViewport.h,
      { color: true, hybrid: true },
      sceneViewport.x,
      sceneViewport.y,
    ),
  );
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
// (so the creator/model Slots expand). Commits a model for each side so Start is
// enabled; pass `open` to expand White's creator dropdown, or `thinking` to
// select Thinking Machines and open the list around it.
//   pnpm exec tsx src/tools/snapshot.ts setup [cols] [rows] [out.ppm] [open|thinking]
function setupSnapshot(): void {
  const cols = Number(process.argv[3]) || 120;
  const rows = Number(process.argv[4]) || 40;
  const out = process.argv[5] ?? '.snapshots/setup.ppm';
  const SS = 3;
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  const chess = new ChessGameScene();
  const screen = new Screen(cols, rows);
  mountMatchSetup(screen);
  // The modal's module defaults already pre-commit a model per side (Start enabled).
  // Optionally open a dropdown to show the expanded, scrollable picker floating
  // over the rest of the modal. `open` opens White's creator list; `models`
  // selects Google then opens White's MODEL list (long names wrap onto 2 lines).
  // The default mode (Play as White) makes White the human, so its pickers are hidden.
  // The dropdown-open variants need them visible, so switch to Watch AI vs AI first.
  if (['thinking', 'models', 'open'].some((a) => process.argv.includes(a))) {
    (screen.component('setup-mode') as Dropdown | undefined)?.pick(2);
  }
  if (process.argv.includes('thinking')) {
    const wc = screen.component('setup-white-creator') as Dropdown | undefined;
    const thinking = creators().findIndex((c) => c.slug === 'thinkingmachines');
    if (thinking >= 0) wc?.pick(thinking);
    wc?.onKey?.({ name: 'enter', raw: '', sequence: '', ctrl: false, shift: false, meta: false, eventType: 'press' });
  } else if (process.argv.includes('models')) {
    const wc = screen.component('setup-white-creator') as Dropdown | undefined;
    const g = creators().findIndex((c) => c.slug === 'google');
    if (g >= 0) wc?.pick(g); // switch White to Google (repopulates + clears its model)
    (screen.component('setup-white-model') as Dropdown | undefined)?.onKey?.({ name: 'enter', raw: '', sequence: '', ctrl: false, shift: false, meta: false, eventType: 'press' });
  } else if (process.argv.includes('open')) {
    const enter = { name: 'enter', raw: '', sequence: '', ctrl: false, shift: false, meta: false, eventType: 'press' as const };
    (screen.component('setup-white-creator') as Dropdown | undefined)?.onKey?.(enter);
  }
  // Preview the chosen creators as king wisps behind the panel (what main wires up
  // via setPreview), then render the board so the wisps composite over it.
  chess.setPreview(chessPreviewSides());
  chess.renderScene(target, 0.6);
  const region = { x: 0, y: 0, w: cols, h: rows };
  screen.setRoot(buildMatchSetup(region, { onStart: noop, onCancel: noop, healthStatus: process.argv.includes('checking') ? { lines: ['checking model health ...'], failed: false } : process.argv.includes('health-failed') ? { lines: ['claude-haiku-4.5, gpt-5.4-nano failed health check.'], failed: true } : undefined }), region);
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
  screen.setRoot(buildGameOver({ title: 'black wins', subtitle: 'by checkmate', tint: [184, 126, 74] }, noop, noop), region);
  screen.setFocus('over-newgame'); // mirror the live app, which default-focuses "new game"
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
  const root = buildPromotion(0 as Color, () => {}, () => {}); // WHITE
  layout(root, { x: 0, y: 0, w: cols, h: rows });
  paint(root, surf, { hoverId: 'promo-queen', focusId: 'promo-queen', pressedId: null });
  surfaceToPpm(surf, cols, rows, out);
}

// The shortcuts overlay for a given screen ('poker' | 'chess' | 'menu'), generated from a
// real keymap's activeBindings() so the panel matches what actually resolves at runtime.
function shortcutsSnapshot(): void {
  const arg = process.argv[3];
  const which: 'chess' | 'poker' | 'menu' = arg === 'chess' || arg === 'menu' ? arg : 'poker';
  const cols = Number(process.argv[4]) || 96;
  const rows = Number(process.argv[5]) || 34;
  const out = process.argv.find((a) => a.endsWith('.ppm')) ?? `.snapshots/shortcuts-${which}.ppm`;
  const SS = 3;
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new ChessGameScene().renderScene(target); // backdrop only — the overlay content is the point
  const surf = new Surface(cols, rows);
  shapeGlyphToSurface(surf, target, cols, rows, { color: true, hybrid: true });
  const km = installKeymap(new Proxy({}, { get: () => () => {} }) as never); // stub handlers (never invoked)
  km.setBase(which);
  const mode: Mode = which === 'chess' ? 'chess-game' : which;
  const root = buildShortcuts(km.activeBindings(), () => {}, { mouse: mouseControlsFor(mode) });
  layout(root, { x: 0, y: 0, w: cols, h: rows });
  const hover = process.argv.find((a) => a.startsWith('hover='))?.slice(6) ?? null;
  paint(root, surf, { hoverId: hover, focusId: null, pressedId: null });
  surfaceToPpm(surf, cols, rows, out);
}

// The "return to home screen?" confirm popup (esc in a game), over the chess scene, with
// "return" default-focused — mirrors how syncBar renders it.
function confirmHomeSnapshot(): void {
  const cols = Number(process.argv[3]) || 90;
  const rows = Number(process.argv[4]) || 30;
  const out = process.argv[5] ?? '.snapshots/confirm-home.ppm';
  const SS = 3;
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new ChessGameScene().renderScene(target);
  const surf = new Surface(cols, rows);
  shapeGlyphToSurface(surf, target, cols, rows, { color: true, hybrid: true });
  const root = buildConfirm({ prompt: 'return to home screen?', confirmLabel: 'return', idPrefix: 'confirm-home', onConfirm: () => {}, onCancel: () => {} });
  layout(root, { x: 0, y: 0, w: cols, h: rows });
  paint(root, surf, { hoverId: null, focusId: 'confirm-home-yes', pressedId: null });
  surfaceToPpm(surf, cols, rows, out);
}

// The "quit arcade?" confirm popup (the 'q' key), with "quit" default-focused.
function confirmQuitSnapshot(): void {
  const cols = Number(process.argv[3]) || 90;
  const rows = Number(process.argv[4]) || 30;
  const out = process.argv[5] ?? '.snapshots/confirm-quit.ppm';
  const SS = 3;
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new ChessGameScene().renderScene(target);
  const surf = new Surface(cols, rows);
  shapeGlyphToSurface(surf, target, cols, rows, { color: true, hybrid: true });
  const root = buildConfirm({ prompt: 'quit arcade?', confirmLabel: 'quit', idPrefix: 'confirm-quit', onConfirm: () => {}, onCancel: () => {} });
  layout(root, { x: 0, y: 0, w: cols, h: rows });
  paint(root, surf, { hoverId: null, focusId: 'confirm-quit-yes', pressedId: null });
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
  if (scene === 'chess-game') new ChessGameScene().renderScene(target);
  else if (scene === 'logos') new LogosScene().renderScene(target, 0.6);
  else new PrismScene().renderScene(target, 0.6);

  const surf = new Surface(cols, rows);
  shapeGlyphToSurface(surf, target, cols, rows, { color: true, hybrid: scene !== 'prism' && scene !== 'logos' });
  const root = buildBar(scene, 'ascii', barActions);
  layout(root, { x: 0, y: rows - 2, w: cols, h: 1 });
  paint(root, surf, { hoverId: 'reset', focusId: null, pressedId: null });

  surfaceToPpm(surf, cols, rows, out);
}
