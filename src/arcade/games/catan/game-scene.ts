// The Catan GAME board — the played surface, as distinct from the catan-test editor. It wraps
// the same `TileScene` renderer rather than a copy of it: the island, harbors, tokens, pieces,
// and their animations are all the test bed's, and this adds only the three things a real game
// needs on top.
//
//   1. The rules engine owns the board. `CatanState` generates the arrangement; the scene
//      adopts it instead of generating one from its own seed, so the hexes the models reason
//      about and the hexes you see are the same hexes.
//   2. Legality comes from the state, not from geometry. Every turn the scene is handed the
//      exact legal node/edge set for the current prompt, so a click can only ever be a legal
//      move and no cost or distance rule is re-implemented here.
//   3. A human seam. `requestHumanMove` is the promise `HumanPlayer` awaits; a click on a
//      gated target resolves it.
//
// SCOPE: initial placement only, matching catan-driver. `playMove` handles the two placement
// actions and applies everything else to the state without a board animation, so extending to
// the full game is additive rather than a rewrite.

import { type RenderTarget } from '../../../engine/index.ts';
import { CatanState } from '../../../rules/catan/catan.ts';
import type { CatanAction, PlayerColor } from '../../../rules/catan/types.ts';
import { TileScene } from './tile-scene.ts';

export class CatanGameScene {
  readonly scene = new TileScene();
  private live: CatanState | null = null;
  // The board is up from the moment the screen opens, so the setup panel sits over an island
  // rather than the tile bed's default single hex — poker's idle felt, in Catan's terms. The
  // arrangement is a throwaway: starting a game adopts the rules engine's board over it.
  private colors: PlayerColor[] = [];
  // The in-flight human turn: resolved by a board click, rejected when the match is aborted.
  private pending: {
    resolve: (action: CatanAction) => void;
    reject: (err: Error) => void;
    detach: () => void;
  } | null = null;
  private onChange: () => void = () => {};

  constructor() {
    this.scene.setMode('boardCards');
  }

  // Repaint hook — fired whenever a click or an applied move changes what the HUD reads.
  setOnChange(fn: () => void): void {
    this.onChange = fn;
  }

  // Take over the board for a new session: adopt the engine's arrangement, drop any pieces
  // from a previous game, and remember each seat's color.
  beginSession(state: CatanState, colors: PlayerColor[]): void {
    this.cancelPending('A new game started');
    this.live = state;
    this.colors = colors.slice();
    this.scene.setMode('boardCards');
    this.scene.clearPieces();
    this.scene.adoptBoard(state.boardSetup(), true);
    this.refreshGate();
  }

  // Leaving the screen / ending the session: release the board back to an ungated state so a
  // later editor visit is not left with a stale legal set.
  endSession(): void {
    this.cancelPending('The game ended');
    this.live = null;
    this.colors = [];
    this.scene.setPlacementGate(null);
  }

  state(): CatanState {
    if (!this.live) throw new Error('No Catan game is in progress');
    return this.live;
  }
  hasSession(): boolean {
    return this.live !== null;
  }
  colorOf(seat: number): PlayerColor {
    return this.colors[seat] ?? 'red';
  }

  // ── the match seam ────────────────────────────────────────────────────────────
  // Apply an action and show it. The state is authoritative: it validates and transitions,
  // and only then does the board place the piece, so an illegal action can never leave a
  // piece behind. Resolves once the drop has been queued — the scene animates it from there.
  async playMove(action: CatanAction): Promise<void> {
    const state = this.state();
    const seat = state.currentPlayer();
    state.applyAction(action);
    if (action.type === 'initialSettlement') this.scene.placePiece('building', action.node, this.colorOf(seat));
    else if (action.type === 'initialRoad') this.scene.placePiece('road', action.edge, this.colorOf(seat));
    else if (action.type === 'playRoadBuilding') {
      for (const edge of action.edges) this.scene.placePiece('road', edge, this.colorOf(seat));
    }
    else if (action.type === 'moveRobber' || action.type === 'playKnight') this.scene.syncRobberHex(action.hex);
    this.refreshGate();
    this.onChange();
  }

  // The `HumanPlayer` seam: resolve when the player clicks a legal target. Rejects when the
  // turn is aborted, mirroring ModelPlayer so `runMatch` unwinds cleanly.
  requestHumanMove(signal?: AbortSignal): Promise<CatanAction> {
    this.cancelPending('A new turn started');
    return new Promise<CatanAction>((resolve, reject) => {
      const onAbort = (): void => this.cancelPending('The turn was aborted');
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending = {
        resolve,
        reject,
        detach: () => signal?.removeEventListener('abort', onAbort),
      };
      if (signal?.aborted) this.cancelPending('The turn was aborted');
      else this.refreshGate();
    });
  }

  private cancelPending(reason: string): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    pending.detach();
    pending.reject(new Error(reason));
  }

  // ── legal-target gate ─────────────────────────────────────────────────────────
  // Offer the board exactly the current prompt's legal targets — but only while the human is
  // the one being asked. On a model's turn nothing is clickable, so a stray click can never
  // steal its move.
  private refreshGate(): void {
    this.scene.cancelRobberMove();
    if (!this.live || !this.pending) {
      this.scene.setPlacementGate({ nodes: [], edges: [] });
      return;
    }
    const state = this.live;
    const prompt = state.currentPrompt();
    if (prompt.kind === 'initialSettlement') {
      this.scene.setPlacementGate({ nodes: state.initialSettlementOptions().map((o) => o.action.node) });
    } else if (prompt.kind === 'initialRoad') {
      this.scene.setPlacementGate({ edges: state.initialRoadOptions().map((o) => o.action.edge) });
    } else if (prompt.kind === 'moveRobber') {
      const hexes = state.legalActions()
        .filter((action): action is Extract<CatanAction, { type: 'moveRobber' }> => action.type === 'moveRobber')
        .map((action) => action.hex);
      this.scene.setPlacementGate({ nodes: [], edges: [] });
      this.scene.beginRobberMove(hexes);
    } else {
      // Every other prompt (roll, build, robber…) is unwired in this phase, so nothing on the
      // board is offered rather than something misleading being clickable.
      this.scene.setPlacementGate({ nodes: [], edges: [] });
    }
  }

  // ── pointer ───────────────────────────────────────────────────────────────────
  hoverAt(ndcX: number, ndcY: number): void {
    this.scene.hoverBoard(ndcX, ndcY);
  }

  // A board click during your turn: turn the picked target into the prompt's action and hand
  // it to the awaiting HumanPlayer. Anything else is ignored — the gate has already excluded
  // illegal targets, so there is nothing to validate here.
  clickAt(ndcX: number, ndcY: number): void {
    const pending = this.pending;
    if (!pending || !this.live) return;
    const prompt = this.live.currentPrompt();
    let action: CatanAction | null = null;
    if (prompt.kind === 'moveRobber') {
      const hex = this.scene.pickRobberHexAt(ndcX, ndcY);
      if (hex === null) return;
      // A tile can name more than one steal victim. Tile selection owns the spatial decision;
      // until a victim picker is added, choose the first legal victim in the rules engine's
      // deterministic seating order rather than re-implementing eligibility here.
      action = this.live.legalActions().find((candidate) => candidate.type === 'moveRobber' && candidate.hex === hex) ?? null;
    } else {
      const target = this.scene.pickBoardAt(ndcX, ndcY);
      if (!target) return;
      action =
        prompt.kind === 'initialSettlement' && target.kind === 'node'
          ? { type: 'initialSettlement', node: target.id }
          : prompt.kind === 'initialRoad' && target.kind === 'edge'
            ? { type: 'initialRoad', edge: target.id }
            : null;
    }
    if (!action) return;
    this.pending = null;
    pending.detach();
    // Clear the highlight before the move lands, so the board is not still inviting a click
    // while the action applies.
    this.scene.setPlacementGate({ nodes: [], edges: [] });
    this.scene.cancelRobberMove();
    pending.resolve(action);
    this.onChange();
  }

  // ── render ────────────────────────────────────────────────────────────────────
  needsRender(): boolean {
    return this.scene.needsRender();
  }
  renderScene(target: RenderTarget, t: number): void {
    this.scene.renderScene(target, t);
  }
  requestAnimationFrame(): void {
    this.scene.requestAnimationFrame();
  }
}
