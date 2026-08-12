// Catan's application-orchestration facade. Owns everything specific to running the Catan
// test-bed screen — the 3D scene, the in-game menu + piece-edit modal state, HUD handler
// wiring, enter/leave/reset, UI-root construction, pointer hover/click, and render/dirty —
// so main.ts stays thin wiring. The shared bits it can't own (the app mode, the render/
// compositing loop, the shell menu callbacks) are injected via `CatanDeps`.
//
// This is deliberately a self-contained facade rather than an implementation of a generic
// per-mode controller interface: that shared interface isn't introduced on this branch yet.

import { type RenderTarget } from '../../../engine/index.ts';
import { type LayoutBox, type Node, type Screen } from '../../../tui/index.ts';
import { buildGameMenu, type MenuItem } from '../../shell/bars.ts';
import { type Resource } from '../../../rules/catan/types.ts';
import { bankCatanResource, CATAN_LOCAL_COLOR, catanHandLandingCell, logCatanReceived, logCatanRobberMove, logCatanRoll, resetCatanWorkbenchCards } from './card-hud.ts';
import { ResourceFlights } from './scene/resource-flight.ts';
import { buildCatanPieceModal, buildCatanTileRoot, catanTileTerrain, mountCatanTileHud, setCatanTileHandlers, setCatanTileMode } from './tile-hud.ts';
import { TileScene } from './tile-scene.ts';

const ANIMATION_FRAME_MS = 90; // ~11 fps: enough for water, blades, and livestock without repainting at 60 fps

// The Catan in-game menu is the standard shell menu; its items dispatch shared app actions,
// which main.ts supplies here (evaluated lazily so ordering/late-bound values are fine).
export interface CatanShell {
  renderMode: () => string; // current display mode, shown on the menu row
  colorMode: () => string; // current color mode, shown on the menu row
  onHome: () => void;
  onCycleDisplay: () => void;
  onCycleColor: () => void;
  onControls: () => void;
  onQuit: () => void;
  menuValueColW: number;
}
export interface CatanDeps {
  ui: Screen;
  requestRender: () => void; // schedule a render (on-demand loop)
  requestFrame: () => void; // force a full recomposite + render
  shell: CatanShell;
}

export class CatanController {
  readonly scene = new TileScene();
  private ui: Screen;
  private requestRender: () => void;
  private requestFrame: () => void;
  private shell: CatanShell;
  private menuOpen = false;
  private pieceEdit: { kind: 'building' | 'road'; id: number } | null = null;
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  private readonly flights = new ResourceFlights();
  // Cards banked since the current roll's first arrival, held so the log can report the whole
  // haul in one entry once the last one is down.
  private arrived: Resource[] = [];
  // The last geometry the HUD was built at. A roll lands inside renderScene, which knows the
  // scene target but not the terminal, and the launch/landing cells need both.
  private lastCols = 0;
  private lastRows = 0;
  private lastSceneCols = 0;

  constructor(deps: CatanDeps) {
    this.ui = deps.ui;
    this.requestRender = deps.requestRender;
    this.requestFrame = deps.requestFrame;
    this.shell = deps.shell;
    // Wire the HUD dropdowns/buttons to the scene once (the HUD components are module-level).
    setCatanTileHandlers({
      onTerrain: (t) => this.change(() => this.scene.setTerrain(t)),
      onReroll: () => this.change(() => this.regenerateWorkbench()),
      onToggleRobber: (on) => this.change(() => this.scene.setRobber(on)),
      onMode: (m) => this.change(() => this.scene.setMode(m)),
      onToggleSidebar: () => this.change(() => {}), // card-hud owns the flag; just repaint
      onRollDice: () => this.change(() => this.scene.rollDice()),
      onColor: (c) => this.change(() => this.scene.setActiveColor(c)),
      onPort: (k) => this.change(() => this.scene.setPortKind(k)),
    });
    // Production. The scene reports the sum once the dice rest; what that pays out depends on
    // whose pieces sit on the matching hexes, so the seat is applied here rather than in the
    // scene. Building is still free — this only ever adds to the hand.
    //
    // Nothing is banked yet: each card is thrown from its hex and credited when it lands, so the
    // counts tick up as the cards arrive. The launch cells come from the camera as it stands
    // right now, which is why they are read here rather than at spawn-time in the flight.
    this.scene.onRollLanded = (sum) => {
      logCatanRoll(sum);
      if (sum === 7) this.scene.beginRobberMove();
      let thrown = 0;
      for (const source of this.scene.rollSources(CATAN_LOCAL_COLOR, sum, this.lastSceneCols, this.lastRows)) {
        const target = catanHandLandingCell(this.region(this.lastCols, this.lastRows), source.resource);
        this.flights.spawn(source.resource, source.count, source, target, thrown);
        thrown += source.count;
      }
      this.requestFrame();
    };
  }

  private change(mutate: () => void): void {
    mutate();
    this.requestFrame();
  }

  private regenerateWorkbench(): void {
    // Tile showcase modes call this same handler for "vary". Varying one authored tile is not a
    // new board session, so it must leave the card workbench alone.
    const mode = this.scene.currentMode();
    if (mode !== 'board' && mode !== 'boardCards') {
      this.scene.reroll();
      return;
    }
    // Regeneration starts a fresh test-board session, not merely a new terrain arrangement.
    // Forget cards from a previous roll rather than allowing them to land after the reset and
    // repopulate the new hand. `drain` also resets the flight clock; its returned cards are
    // intentionally discarded here because resetCatanWorkbenchCards restores the whole bank.
    this.flights.drain();
    this.arrived = [];
    resetCatanWorkbenchCards();
    this.scene.reroll();
  }

  // ── enter / leave ──────────────────────────────────────────────────────────
  // Entry: mount the HUD and default to the animated full board with the card UI over it.
  enter(): void {
    mountCatanTileHud(this.ui);
    this.scene.setTerrain(catanTileTerrain()); // match the scene to the HUD's committed tile
    this.scene.setMode('boardCards'); // temporary: card-UI workbench is the default while it is being built
    setCatanTileMode('boardCards'); // sync the Mode dropdown to match
    this.scene.reroll(); // play the tile-placement + number reveal on entry
    this.startEnvironmentAnimation();
  }

  // Leaving the Catan screen: drop the menu + piece-edit modal state.
  reset(): void {
    this.menuOpen = false;
    this.pieceEdit = null;
    // Settle any roll still in the air. Left in place they would ride a clock that keeps running
    // while the screen is closed, so re-entering banks the whole lot on the first frame and logs
    // a receipt for a roll from minutes ago.
    const owed = this.flights.drain();
    for (const resource of owed) bankCatanResource(resource);
    this.arrived.push(...owed);
    if (this.arrived.length) {
      logCatanReceived(this.arrived);
      this.arrived = [];
    }
    if (this.animationTimer !== null) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
  }

  private startEnvironmentAnimation(): void {
    if (this.animationTimer !== null) clearInterval(this.animationTimer);
    this.animationTimer = setInterval(() => {
      this.scene.requestAnimationFrame();
      if (this.scene.needsRender()) this.requestRender();
    }, ANIMATION_FRAME_MS);
  }

  // ── in-game menu ───────────────────────────────────────────────────────────
  openMenu(): void {
    this.menuOpen = true;
    this.requestFrame();
  }
  private closeMenu(): void {
    this.menuOpen = false;
    this.requestFrame();
  }
  isMenuOpen(): boolean {
    return this.menuOpen;
  }

  // ── piece-edit modal ───────────────────────────────────────────────────────
  hasPieceEdit(): boolean {
    return this.pieceEdit !== null;
  }
  private closePieceModal(): void {
    this.pieceEdit = null;
    this.requestFrame();
  }

  // ── pointer (board hover / click), in NDC ───────────────────────────────────
  hoverAt(ndcX: number, ndcY: number): void {
    this.scene.hoverBoard(ndcX, ndcY);
    if (this.scene.needsRender()) this.requestRender();
  }
  clickAt(ndcX: number, ndcY: number): void {
    if (this.scene.isMovingRobber()) {
      const hex = this.scene.pickRobberHexAt(ndcX, ndcY);
      if (hex !== null && this.scene.moveRobberTo(hex)) {
        const terrain = this.scene.terrainAtHex(hex);
        if (terrain) logCatanRobberMove(terrain);
      }
      this.requestFrame();
      return;
    }
    const hit = this.scene.clickBoard(ndcX, ndcY);
    if (hit) this.pieceEdit = hit; // clicked a placed piece → open its edit modal
    this.requestFrame();
  }

  // ── render / dirty ───────────────────────────────────────────────────────────
  needsRender(): boolean {
    return this.scene.needsRender() || this.flights.busy();
  }
  renderScene(target: RenderTarget, t: number): void {
    this.scene.renderScene(target, t);
    // Cards in the air ride the scene's clock, so they advance on the same frames it does. Each
    // arrival is banked on the spot; the log waits for the last one so one roll reads as one
    // entry rather than a line per card.
    const landed = this.flights.advance(t);
    if (!landed.length) return;
    for (const resource of landed) bankCatanResource(resource);
    this.arrived.push(...landed);
    if (!this.flights.busy()) {
      logCatanReceived(this.arrived);
      this.arrived = [];
    }
    this.requestFrame(); // the hand count changed, so the HUD has to be rebuilt
  }

  // ── UI roots ─────────────────────────────────────────────────────────────────
  // The normal Catan control panel + ☰ menu button over the scene.
  // `sceneCols` is the width the scene actually renders into — narrower than `cols` while the
  // card sidebar is open. The number chips and port labels are projections of 3D points, so they
  // must use the scene's aspect and cell mapping, not the terminal's, or they stay put while the
  // board shifts. The HUD chrome still spans the full region.
  buildRoot(cols: number, rows: number, sceneCols: number = cols): Node {
    mountCatanTileHud(this.ui); // a prior modal root may have dropped the Slots
    this.lastCols = cols;
    this.lastRows = rows;
    this.lastSceneCols = sceneCols;
    const singlePort = this.scene.portSailLabel(sceneCols, rows);
    const sailLabels = singlePort ? [singlePort] : this.scene.boardPortLabels(sceneCols, rows);
    return buildCatanTileRoot(
      this.region(cols, rows),
      () => this.openMenu(),
      this.scene.boardTokens(sceneCols, rows),
      this.scene.currentMode(),
      sailLabels,
      this.flights.active(),
      this.scene.isMovingRobber(),
    );
  }

  // The in-game menu popup (home / reset camera / display / color / controls / quit).
  buildMenuRoot(cols: number, rows: number): Node {
    const groups: MenuItem[][] = [
      [{ id: 'catan-menu-home', label: 'home', onClick: this.shell.onHome }],
      [
        { id: 'catan-menu-reset', label: 'reset camera', onClick: () => { this.scene.resetView(); this.closeMenu(); } },
        { id: 'catan-menu-mode', label: 'display', value: this.shell.renderMode(), onClick: this.shell.onCycleDisplay },
        { id: 'catan-menu-color', label: 'color', value: this.shell.colorMode(), onClick: this.shell.onCycleColor },
      ],
      [
        { id: 'catan-menu-shortcuts', label: 'controls', onClick: this.shell.onControls },
        { id: 'catan-menu-quit', label: 'quit', onClick: this.shell.onQuit },
      ],
    ];
    return buildGameMenu({ groups, onClose: () => this.closeMenu(), valueColW: this.shell.menuValueColW });
  }

  // The piece-edit modal for the currently-clicked piece, or null if it's gone stale (in which
  // case the edit state is cleared so the next frame falls back to the normal root).
  buildPieceModalRoot(): Node | null {
    const edit = this.pieceEdit;
    if (!edit) return null;
    if (edit.kind === 'road') {
      const color = this.scene.roadInfo(edit.id);
      if (color === undefined) {
        this.pieceEdit = null;
        return null;
      }
      return buildCatanPieceModal({
        road: true,
        city: false,
        color,
        onUpgrade: () => {},
        onRemove: () => { this.scene.removeRoad(edit.id); this.closePieceModal(); },
        onColor: (c) => this.change(() => this.scene.setRoadColor(edit.id, c)),
        onClose: () => this.closePieceModal(),
      });
    }
    const b = this.scene.buildingInfo(edit.id);
    if (b === undefined) {
      this.pieceEdit = null;
      return null;
    }
    return buildCatanPieceModal({
      road: false,
      city: b.city,
      color: b.color,
      onUpgrade: () => { this.scene.upgradeBuilding(edit.id); this.closePieceModal(); },
      onRemove: () => { this.scene.removeBuilding(edit.id); this.closePieceModal(); },
      onColor: (c) => this.change(() => this.scene.setBuildingColor(edit.id, c)),
      onClose: () => this.closePieceModal(),
    });
  }

  private region(cols: number, rows: number): LayoutBox {
    return { x: 0, y: 0, w: cols, h: rows };
  }
}
