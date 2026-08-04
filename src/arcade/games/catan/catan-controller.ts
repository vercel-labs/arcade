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

  constructor(deps: CatanDeps) {
    this.ui = deps.ui;
    this.requestRender = deps.requestRender;
    this.requestFrame = deps.requestFrame;
    this.shell = deps.shell;
    // Wire the HUD dropdowns/buttons to the scene once (the HUD components are module-level).
    setCatanTileHandlers({
      onTerrain: (t) => this.change(() => this.scene.setTerrain(t)),
      onReroll: () => this.change(() => this.scene.reroll()),
      onToggleRobber: (on) => this.change(() => this.scene.setRobber(on)),
      onMode: (m) => this.change(() => this.scene.setMode(m)),
      onRollDice: () => this.change(() => this.scene.rollDice()),
      onColor: (c) => this.change(() => this.scene.setActiveColor(c)),
      onPort: (k) => this.change(() => this.scene.setPortKind(k)),
    });
  }

  private change(mutate: () => void): void {
    mutate();
    this.requestFrame();
  }

  // ── enter / leave ──────────────────────────────────────────────────────────
  // Entry: mount the HUD and default to the animated full board.
  enter(): void {
    mountCatanTileHud(this.ui);
    this.scene.setTerrain(catanTileTerrain()); // match the scene to the HUD's committed tile
    this.scene.setMode('board'); // default to the full board
    setCatanTileMode('board'); // sync the Mode dropdown to match
    this.scene.reroll(); // play the tile-placement + number reveal on entry
    this.startEnvironmentAnimation();
  }

  // Leaving the Catan screen: drop the menu + piece-edit modal state.
  reset(): void {
    this.menuOpen = false;
    this.pieceEdit = null;
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
    const hit = this.scene.clickBoard(ndcX, ndcY);
    if (hit) this.pieceEdit = hit; // clicked a placed piece → open its edit modal
    this.requestFrame();
  }

  // ── render / dirty ───────────────────────────────────────────────────────────
  needsRender(): boolean {
    return this.scene.needsRender();
  }
  renderScene(target: RenderTarget, t: number): void {
    this.scene.renderScene(target, t);
  }

  // ── UI roots ─────────────────────────────────────────────────────────────────
  // The normal Catan control panel + ☰ menu button over the scene.
  buildRoot(cols: number, rows: number): Node {
    mountCatanTileHud(this.ui); // a prior modal root may have dropped the Slots
    const singlePort = this.scene.portSailLabel(cols, rows);
    const sailLabels = singlePort ? [singlePort] : this.scene.boardPortLabels(cols, rows);
    return buildCatanTileRoot(this.region(cols, rows), () => this.openMenu(), this.scene.boardTokens(cols, rows), this.scene.currentMode(), sailLabels);
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
