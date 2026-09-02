// Islanders's application-orchestration facade. Owns everything specific to running the Islanders
// test-bed screen — the 3D scene, the in-game menu + piece-edit modal state, HUD handler
// wiring, enter/leave/reset, UI-root construction, pointer hover/click, and render/dirty —
// so main.ts stays thin wiring. The shared bits it can't own (the app mode, the render/
// compositing loop, the shell menu callbacks) are injected via `IslandersDeps`.
//
// This is deliberately a self-contained facade rather than an implementation of a generic
// per-mode controller interface: that shared interface isn't introduced on this branch yet.

import { type RenderTarget } from '../../../engine/index.ts';
import { type LayoutBox, type Node, type Screen } from '../../../tui/index.ts';
import { buildGameMenu, type MenuItem } from '../../shell/bars.ts';
import { type DevCardType, type Resource } from '../../../rules/islanders/types.ts';
import {
  bankIslandersResource,
  beginIslandersWorkbenchDiscard,
  beginIslandersWorkbenchDevelopmentPlay,
  beginIslandersWorkbenchDevPurchase,
  beginStagedIslandersWorkbenchBankTrade,
  beginStagedIslandersWorkbenchPortTrade,
  ISLANDERS_LOCAL_COLOR,
  islandersBankDepartureCell,
  islandersDevDeckDepartureCell,
  islandersDevHandLandingCell,
  islandersHandLandingCell,
  islandersRailVisible,
  islandersWorkbenchDiscardOpen,
  islandersWorkbenchDevelopmentPlay,
  islandersWorkbenchView,
  chooseIslandersWorkbenchDevelopmentResource,
  completeIslandersWorkbenchDevelopmentStep,
  departIslandersWorkbenchBankResource,
  departIslandersWorkbenchHandResource,
  departIslandersWorkbenchDevCard,
  landIslandersWorkbenchBankResource,
  landIslandersWorkbenchDevCard,
  logIslandersReceived,
  logIslandersRobberMove,
  logIslandersRoll,
  logIslandersWorkbenchDevPurchase,
  logIslandersWorkbenchMaritimeTrade,
  finishIslandersWorkbenchDevelopmentPlay,
  resetIslandersWorkbenchCards,
  submitIslandersWorkbenchDiscard,
} from './card-hud.ts';
import { type IslandersWorkbenchMaritimeTrade, type IslandersWorkbenchMaritimeTradeVia } from './card-workbench.ts';
import { ResourceFlights } from './scene/resource-flight.ts';
import { buildIslandersPieceModal, buildIslandersTileRoot, islandersTileTerrain, mountIslandersTileHud, setIslandersTileHandlers, setIslandersTileMode } from './tile-hud.ts';
import { TileScene } from './tile-scene.ts';

const ANIMATION_FRAME_MS = 90; // ~11 fps: enough for water, blades, and livestock without repainting at 60 fps
const TRADE_ARC_MAX = 7; // a shallow lift from the low bank row before the card drops into the hand
const DEV_ARC_MAX = 7;

// The Islanders in-game menu is the standard shell menu; its items dispatch shared app actions,
// which main.ts supplies here (evaluated lazily so ordering/late-bound values are fine).
export interface IslandersShell {
  renderMode: () => string; // current display mode, shown on the menu row
  colorMode: () => string; // current color mode, shown on the menu row
  onHome: () => void;
  onCycleDisplay: () => void;
  onCycleColor: () => void;
  onControls: () => void;
  onQuit: () => void;
  menuValueColW: number;
}
export interface IslandersDeps {
  ui: Screen;
  requestRender: () => void; // schedule a render (on-demand loop)
  requestFrame: () => void; // force a full recomposite + render
  shell: IslandersShell;
}

export class IslandersController {
  readonly scene = new TileScene();
  private ui: Screen;
  private requestRender: () => void;
  private requestFrame: () => void;
  private shell: IslandersShell;
  private menuOpen = false;
  private pieceEdit: { kind: 'building' | 'road'; id: number } | null = null;
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  private readonly flights = new ResourceFlights();
  private readonly tradeFlights = new ResourceFlights();
  private readonly tradeOfferFlights = new ResourceFlights();
  private readonly developmentFlights = new ResourceFlights<DevCardType>();
  private pendingMaritimeTrade: { trade: IslandersWorkbenchMaritimeTrade; via: IslandersWorkbenchMaritimeTradeVia } | null = null;
  private readonly pendingDevelopmentCards: DevCardType[] = [];
  // Cards banked since the current roll's first arrival, held so the log can report the whole
  // haul in one entry once the last one is down.
  private arrived: Resource[] = [];
  // The last geometry the HUD was built at. A roll lands inside renderScene, which knows the
  // scene target but not the terminal, and the launch/landing cells need both.
  private lastCols = 0;
  private lastRows = 0;
  private lastSceneCols = 0;

  constructor(deps: IslandersDeps) {
    this.ui = deps.ui;
    this.requestRender = deps.requestRender;
    this.requestFrame = deps.requestFrame;
    this.shell = deps.shell;
    // Wire the HUD dropdowns/buttons to the scene once (the HUD components are module-level).
    setIslandersTileHandlers({
      onTerrain: (t) => this.change(() => this.scene.setTerrain(t)),
      onReroll: () => this.change(() => this.regenerateWorkbench()),
      onToggleRobber: (on) => this.change(() => this.scene.setRobber(on)),
      onMode: (m) => this.change(() => this.scene.setMode(m)),
      onToggleSidebar: () => this.change(() => {}), // card-hud owns the flag; just repaint
      onRollDice: () => this.change(() => {
        if (!islandersWorkbenchDiscardOpen()) this.scene.rollDice();
      }),
      onColor: (c) => this.change(() => this.scene.setActiveColor(c)),
      onPort: (k) => this.change(() => this.scene.setPortKind(k)),
      onMaritimeTrade: (via) => this.beginMaritimeTrade(via),
      onBuyDevelopmentCard: () => this.beginDevelopmentPurchase(),
      onPlayDevelopmentCard: (type) => this.beginDevelopmentPlay(type),
      onChooseDevelopmentResource: (resource) => this.chooseDevelopmentResource(resource),
      onDiscard: () => this.finishWorkbenchDiscard(),
    });
    // Production. The scene reports the sum once the dice rest; what that pays out depends on
    // whose pieces sit on the matching hexes, so the seat is applied here rather than in the
    // scene. Building is still free — this only ever adds to the hand.
    //
    // Nothing is banked yet: each card is thrown from its hex and credited when it lands, so the
    // counts tick up as the cards arrive. The launch cells come from the camera as it stands
    // right now, which is why they are read here rather than at spawn-time in the flight.
    this.scene.onRollLanded = (sum) => {
      logIslandersRoll(sum);
      if (sum === 7) {
        if (!beginIslandersWorkbenchDiscard()) this.scene.beginRobberMove();
        this.requestFrame();
        return;
      }
      let thrown = 0;
      for (const source of this.scene.rollSources(ISLANDERS_LOCAL_COLOR, sum, this.lastSceneCols, this.lastRows)) {
        const target = islandersHandLandingCell(this.region(this.lastCols, this.lastRows), source.resource);
        this.flights.spawn(source.resource, source.count, source, target, thrown);
        thrown += source.count;
      }
      this.requestFrame();
    };
  }

  private finishWorkbenchDiscard(): boolean {
    if (!submitIslandersWorkbenchDiscard()) return false;
    this.scene.beginRobberMove();
    this.requestFrame();
    return true;
  }

  private change(mutate: () => void): void {
    mutate();
    this.requestFrame();
  }

  private beginMaritimeTrade(via: IslandersWorkbenchMaritimeTradeVia): boolean {
    if (this.tradeFlights.busy() || this.tradeOfferFlights.busy()) return false;
    const trade = via === 'bank'
      ? beginStagedIslandersWorkbenchBankTrade()
      : beginStagedIslandersWorkbenchPortTrade(this.scene.maritimePortTradeRates(ISLANDERS_LOCAL_COLOR));
    if (!trade) return false;

    this.pendingMaritimeTrade = { trade, via };
    const region = this.region(this.lastCols, this.lastRows);
    const railVisible = islandersRailVisible(this.lastCols, this.lastRows);
    const playerCount = islandersWorkbenchView().opponents.length + 1;
    this.tradeOfferFlights.spawn(
      trade.give,
      trade.rate * trade.gets.length,
      islandersHandLandingCell(region, trade.give),
      islandersBankDepartureCell(region, trade.give, playerCount, railVisible),
      0,
      TRADE_ARC_MAX,
      false,
    );
    for (let order = 0; order < trade.gets.length; order++) {
      const resource = trade.gets[order];
      this.tradeFlights.spawn(
        resource,
        1,
        islandersBankDepartureCell(region, resource, playerCount, railVisible),
        islandersHandLandingCell(region, resource),
        order,
        TRADE_ARC_MAX,
      );
    }
    return true;
  }

  private finishPendingMaritimeTrade(): void {
    if (!this.pendingMaritimeTrade) return;
    logIslandersWorkbenchMaritimeTrade(this.pendingMaritimeTrade.trade, this.pendingMaritimeTrade.via);
    this.pendingMaritimeTrade = null;
  }

  private beginDevelopmentPurchase(): boolean {
    if (this.tradeFlights.busy() || this.tradeOfferFlights.busy()) return false;
    const card = beginIslandersWorkbenchDevPurchase();
    if (!card) return false;

    this.pendingDevelopmentCards.push(card);
    const region = this.region(this.lastCols, this.lastRows);
    const railVisible = islandersRailVisible(this.lastCols, this.lastRows);
    const view = islandersWorkbenchView(
      this.scene.maritimeTradeRates(ISLANDERS_LOCAL_COLOR),
      this.scene.maritimePortTradeRates(ISLANDERS_LOCAL_COLOR),
    );
    view.developmentPurchaseBusy = true;
    view.pendingDevelopmentCards = [...this.pendingDevelopmentCards];
    this.developmentFlights.spawn(
      card,
      1,
      islandersDevDeckDepartureCell(region, view.opponents.length + 1, railVisible),
      islandersDevHandLandingCell(region, card, railVisible, view),
      this.pendingDevelopmentCards.length - 1,
      DEV_ARC_MAX,
    );
    return true;
  }

  private beginDevelopmentPlay(type: DevCardType): boolean {
    if (this.tradeFlights.busy() || this.tradeOfferFlights.busy() || this.scene.isMovingRobber()) return false;
    if (type === 'roadBuilding' && this.scene.legalRoadEdges(ISLANDERS_LOCAL_COLOR).length === 0) return false;
    if (!beginIslandersWorkbenchDevelopmentPlay(type)) return false;
    if (type === 'knight') {
      this.scene.setPlacementGate({ nodes: [], edges: [] });
      this.scene.beginRobberMove();
    } else if (type === 'roadBuilding') {
      this.scene.setActiveColor(ISLANDERS_LOCAL_COLOR);
      this.refreshRoadBuildingGate();
    }
    this.requestFrame();
    return true;
  }

  private chooseDevelopmentResource(resource: Resource): boolean {
    if (!chooseIslandersWorkbenchDevelopmentResource(resource)) return false;
    this.requestFrame();
    return true;
  }

  private refreshRoadBuildingGate(): void {
    const play = islandersWorkbenchDevelopmentPlay();
    if (play?.type !== 'roadBuilding') {
      this.scene.setPlacementGate(null);
      return;
    }
    const edges = this.scene.legalRoadEdges(ISLANDERS_LOCAL_COLOR);
    if (edges.length === 0) {
      finishIslandersWorkbenchDevelopmentPlay('roadBuilding');
      this.scene.setPlacementGate(null);
      return;
    }
    this.scene.setPlacementGate({ nodes: [], edges });
  }

  private suspendDevelopmentInteraction(): void {
    this.scene.setPlacementGate(null);
    this.scene.cancelRobberMove();
  }

  private restoreDevelopmentInteraction(): void {
    const play = islandersWorkbenchDevelopmentPlay();
    if (play?.type === 'knight') {
      this.scene.setPlacementGate({ nodes: [], edges: [] });
      this.scene.beginRobberMove();
    } else if (play?.type === 'roadBuilding') {
      this.refreshRoadBuildingGate();
    }
  }

  private finishPendingDevelopmentPurchase(card: DevCardType): void {
    const pending = this.pendingDevelopmentCards.indexOf(card);
    if (pending < 0) return;
    this.pendingDevelopmentCards.splice(pending, 1);
    logIslandersWorkbenchDevPurchase();
  }

  private settleTradeFlights(): void {
    for (const flight of this.tradeOfferFlights.drainPending()) {
      if (!flight.departed && !departIslandersWorkbenchHandResource(flight.resource)) {
        throw new Error(`Islanders hand ran out of ${flight.resource} during a reserved maritime trade`);
      }
      landIslandersWorkbenchBankResource(flight.resource);
    }
    for (const flight of this.tradeFlights.drainPending()) {
      if (!flight.departed && !departIslandersWorkbenchBankResource(flight.resource)) {
        throw new Error(`Islanders bank ran out of ${flight.resource} during a reserved maritime trade`);
      }
      bankIslandersResource(flight.resource);
    }
    this.finishPendingMaritimeTrade();
  }

  private settleDevelopmentFlights(): void {
    for (const flight of this.developmentFlights.drainPending()) {
      if (!flight.departed && !departIslandersWorkbenchDevCard(flight.resource)) {
        throw new Error('Islanders development deck changed during a reserved purchase');
      }
      landIslandersWorkbenchDevCard(flight.resource);
      this.finishPendingDevelopmentPurchase(flight.resource);
    }
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
    // intentionally discarded here because resetIslandersWorkbenchCards restores the whole bank.
    this.flights.drain();
    this.tradeFlights.drain();
    this.tradeOfferFlights.drain();
    this.developmentFlights.drain();
    this.pendingMaritimeTrade = null;
    this.pendingDevelopmentCards.length = 0;
    this.arrived = [];
    this.scene.setPlacementGate(null);
    this.scene.cancelRobberMove();
    resetIslandersWorkbenchCards();
    this.scene.reroll();
  }

  // ── enter / leave ──────────────────────────────────────────────────────────
  // Entry: mount the HUD and default to the animated full board with the card UI over it.
  enter(): void {
    mountIslandersTileHud(this.ui);
    this.scene.setTerrain(islandersTileTerrain()); // match the scene to the HUD's committed tile
    this.scene.setPlacementGate(null);
    this.scene.cancelRobberMove();
    this.scene.setMode('boardCards'); // temporary: card-UI workbench is the default while it is being built
    setIslandersTileMode('boardCards'); // sync the Mode dropdown to match
    this.scene.reroll(); // play the tile-placement + number reveal on entry
    this.restoreDevelopmentInteraction();
    this.startEnvironmentAnimation();
  }

  // Leaving the Islanders screen: drop the menu + piece-edit modal state.
  reset(): void {
    this.menuOpen = false;
    this.pieceEdit = null;
    this.suspendDevelopmentInteraction();
    // Settle any roll still in the air. Left in place they would ride a clock that keeps running
    // while the screen is closed, so re-entering banks the whole lot on the first frame and logs
    // a receipt for a roll from minutes ago.
    const owed = this.flights.drain();
    for (const resource of owed) bankIslandersResource(resource);
    this.arrived.push(...owed);
    if (this.arrived.length) {
      logIslandersReceived(this.arrived);
      this.arrived = [];
    }
    this.settleTradeFlights();
    this.settleDevelopmentFlights();
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
  closeMenu(): void {
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
  closePieceModal(): void {
    this.pieceEdit = null;
    this.requestFrame();
  }

  // ── pointer (board hover / click), in NDC ───────────────────────────────────
  hoverAt(ndcX: number, ndcY: number): void {
    this.scene.hoverBoard(ndcX, ndcY);
    if (this.scene.needsRender()) this.requestRender();
  }
  clickAt(ndcX: number, ndcY: number): void {
    const development = islandersWorkbenchDevelopmentPlay();
    if (this.scene.isMovingRobber()) {
      const hex = this.scene.pickRobberHexAt(ndcX, ndcY);
      if (hex !== null && this.scene.moveRobberTo(hex)) {
        const terrain = this.scene.terrainAtHex(hex);
        if (terrain) logIslandersRobberMove(terrain);
        if (development?.type === 'knight') {
          completeIslandersWorkbenchDevelopmentStep('knight');
          this.scene.setPlacementGate(null);
        }
      }
      this.requestFrame();
      return;
    }
    if (development?.type === 'roadBuilding') {
      const target = this.scene.pickBoardAt(ndcX, ndcY);
      if (target?.kind === 'edge') {
        this.scene.placePiece('road', target.id, ISLANDERS_LOCAL_COLOR);
        completeIslandersWorkbenchDevelopmentStep('roadBuilding');
        this.refreshRoadBuildingGate();
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
    return this.scene.needsRender()
      || this.flights.busy()
      || this.tradeFlights.busy()
      || this.tradeOfferFlights.busy()
      || this.developmentFlights.busy();
  }
  renderScene(target: RenderTarget, t: number): void {
    this.scene.renderScene(target, t);
    // Cards in the air ride the scene's clock, so they advance on the same frames it does. Each
    // arrival is banked on the spot; the log waits for the last one so one roll reads as one
    // entry rather than a line per card.
    const landed = this.flights.advance(t);
    this.advanceTradeFlights(t);
    this.advanceDevelopmentFlights(t);
    if (!landed.length) return;
    for (const resource of landed) bankIslandersResource(resource);
    this.arrived.push(...landed);
    if (!this.flights.busy()) {
      logIslandersReceived(this.arrived);
      this.arrived = [];
    }
    this.requestFrame(); // the hand count changed, so the HUD has to be rebuilt
  }

  private advanceTradeFlights(t: number): void {
    const incoming = this.tradeFlights.advanceWithDepartures(t);
    const offered = this.tradeOfferFlights.advanceWithDepartures(t);
    for (const resource of incoming.departed) {
      if (!departIslandersWorkbenchBankResource(resource)) {
        throw new Error(`Islanders bank ran out of ${resource} during a reserved maritime trade`);
      }
    }
    for (const resource of incoming.landed) bankIslandersResource(resource);
    for (const resource of offered.departed) {
      if (!departIslandersWorkbenchHandResource(resource)) {
        throw new Error(`Islanders hand ran out of ${resource} during a reserved maritime trade`);
      }
    }
    for (const resource of offered.landed) landIslandersWorkbenchBankResource(resource);
    if (this.pendingMaritimeTrade && !this.tradeFlights.busy() && !this.tradeOfferFlights.busy()) {
      this.finishPendingMaritimeTrade();
    }
    if (incoming.departed.length || incoming.landed.length || offered.departed.length || offered.landed.length) {
      this.requestFrame();
    }
  }

  private advanceDevelopmentFlights(t: number): void {
    const { departed, landed } = this.developmentFlights.advanceWithDepartures(t);
    for (const card of departed) {
      if (!departIslandersWorkbenchDevCard(card)) {
        throw new Error('Islanders development deck changed during a reserved purchase');
      }
    }
    for (const card of landed) {
      landIslandersWorkbenchDevCard(card);
      this.finishPendingDevelopmentPurchase(card);
    }
    if (departed.length || landed.length) this.requestFrame();
  }

  // ── UI roots ─────────────────────────────────────────────────────────────────
  // The normal Islanders control panel + ☰ menu button over the scene.
  // `sceneCols` is the width the scene actually renders into — narrower than `cols` while the
  // card sidebar is open. The number chips and port labels are projections of 3D points, so they
  // must use the scene's aspect and cell mapping, not the terminal's, or they stay put while the
  // board shifts. The HUD chrome still spans the full region.
  buildRoot(cols: number, rows: number, sceneCols: number = cols): Node {
    mountIslandersTileHud(this.ui); // a prior modal root may have dropped the Slots
    this.lastCols = cols;
    this.lastRows = rows;
    this.lastSceneCols = sceneCols;
    const singlePort = this.scene.portSailLabel(sceneCols, rows);
    const sailLabels = singlePort ? [singlePort] : this.scene.boardPortLabels(sceneCols, rows);
    const cardsView = this.scene.currentMode() === 'boardCards'
      ? islandersWorkbenchView(
          this.scene.maritimeTradeRates(ISLANDERS_LOCAL_COLOR),
          this.scene.maritimePortTradeRates(ISLANDERS_LOCAL_COLOR),
        )
      : undefined;
    if (cardsView) cardsView.maritimeTradeBusy = this.tradeFlights.busy() || this.tradeOfferFlights.busy();
    if (cardsView) {
      cardsView.developmentPurchaseBusy = this.developmentFlights.busy();
      if (this.pendingDevelopmentCards.length) cardsView.pendingDevelopmentCards = [...this.pendingDevelopmentCards];
    }
    return buildIslandersTileRoot(
      this.region(cols, rows),
      () => this.openMenu(),
      this.scene.boardTokens(sceneCols, rows),
      this.scene.currentMode(),
      sailLabels,
      [
        ...this.flights.active(),
        ...this.tradeOfferFlights.active(),
        ...this.tradeFlights.active(),
        ...this.developmentFlights.active(),
      ],
      this.scene.isMovingRobber(),
      cardsView,
    );
  }

  // The in-game menu popup (home / reset camera / display / color / controls / quit).
  buildMenuRoot(cols: number, rows: number): Node {
    const groups: MenuItem[][] = [
      [{ id: 'islanders-menu-home', label: 'home', onClick: this.shell.onHome }],
      [
        { id: 'islanders-menu-reset', label: 'reset camera', onClick: () => { this.scene.resetView(); this.closeMenu(); } },
        { id: 'islanders-menu-mode', label: 'display', value: this.shell.renderMode(), onClick: this.shell.onCycleDisplay },
        { id: 'islanders-menu-color', label: 'color', value: this.shell.colorMode(), onClick: this.shell.onCycleColor },
      ],
      [
        { id: 'islanders-menu-shortcuts', label: 'controls', onClick: this.shell.onControls },
        { id: 'islanders-menu-quit', label: 'quit', onClick: this.shell.onQuit },
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
      return buildIslandersPieceModal({
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
    return buildIslandersPieceModal({
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
