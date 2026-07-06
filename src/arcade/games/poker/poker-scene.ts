// The playable poker table: a 3D felt table with N seats, dealt hole cards + the
// community board, per-AI-seat provider wisps, and a betting-driven match. The
// analog of ChessGameScene — it implements MatchScene<PokerAction> so the generic
// runMatch loop drives one hand, and exposes a HumanPlayer seam (requestHumanMove)
// for the hero. Session concerns (rotating button, carried stacks, new hands) live
// in the driver (match/poker-driver.ts); this scene renders whatever HoldemState it
// is handed and animates the moves played into it.
//
// Numbers (stacks, pot, bets) are drawn as a projected 2D overlay (drawOverlay) over
// the composited frame — the same approach as the audio scene — rather than baked
// into 3D, so the felt stays clean and the labels stay legible.

import {
  type Camera,
  cameraMatrices,
  lambertMaterial,
  type Mat4,
  mat4Multiply,
  mat4MulVec4,
  mat4RotY,
  mat4Translate,
  normalize3,
  rasterize,
  type RenderTarget,
  STYLE_BOLD,
  STYLE_DIM,
  type Surface,
  type Texture,
  type Vec3,
} from '../../../engine/index.ts';
import { OrbitCamera } from '../../orbit.ts';
import { loadWisp, mulberry32, providerTint, type Wisp, WISP_SIZE } from '../../scenes/wisp.ts';
import type { RGB } from '../../../engine/index.ts';
import type { Card } from '../../../rules/poker/cards.ts';
import type { HoldemState, PokerAction } from '../../../rules/poker/holdem.ts';
import { cardBackTexture } from './card-textures.ts';
import { CARD_W, drawCard, flatDown, flatUp } from './card-render.ts';
import { chairMesh, chairModel, TABLE_MODEL, TABLE_RADIUS, tableMesh } from './table.ts';

const FOVY = (46 * Math.PI) / 180;
const TABLE_LIGHT = normalize3({ x: 0.25, y: 0.9, z: 0.4 });
const TABLE_AMBIENT = 0.74;

const HOLE_R = TABLE_RADIUS * 0.62; // radius at which a seat's hole cards rest
const HOLE_GAP = 0.34 * CARD_W; // tangential half-gap between a seat's two cards
const BOARD_SPACING = CARD_W * 1.12; // gap between community cards
const CARD_LIFT = 0.02; // rest cards a hair above the felt
const WISP_FLOAT = 2.2; // world height a seat's wisp floats above the felt
const WISP_SCALE = 0.5;
const ANIM_BEAT = 8; // frames a played action lingers before the loop continues (~0.27s)

// A seat's session-level identity (persists across hands): whether it's the human
// hero or an AI, its display label, and (AI) its provider for the wisp.
export interface PokerSeatView {
  kind: 'human' | 'ai';
  label: string;
  provider?: string;
}

// Text tints for the overlay.
const FG: RGB = [232, 236, 246];
const MUTED: RGB = [150, 156, 174];
const GOLD: RGB = [240, 214, 130];
const WIN: RGB = [150, 226, 150];
const CHIP_BG: RGB = [12, 16, 20];

export class PokerGameScene {
  private cam: OrbitCamera;
  private back: Texture;
  private dirty = true;
  private lastT = -1;

  private hand: HoldemState | null = null;
  private seats: PokerSeatView[] = [];
  private wisps: (Wisp | null)[] = [];
  private wispRng = mulberry32(0x50fa7);
  private active = false; // a session is running (drives live rendering + wisps)
  private paused = false;

  // A played action lingers for a few frames so it's watchable; `beat` counts down.
  private beat = 0;
  private settleResolve: (() => void) | null = null;
  // The hero's pending move request (the HumanPlayer seam), or null.
  private humanReq: { resolve: (a: PokerAction) => void; reject: (e: Error) => void } | null = null;

  constructor() {
    this.back = cardBackTexture();
    this.cam = this.makeCamera();
  }

  private makeCamera(): OrbitCamera {
    // Over the hero's shoulder (hero seat is at +z, front), tilted down onto the felt.
    // Pulled back + a touch of forward target so the hero's own cards clear the bottom.
    return new OrbitCamera({ azimuth: 0, elevation: 0.7, distance: 13, target: { x: 0, y: 0, z: 0.7 } }, 6, 24);
  }

  // ── Session / hand lifecycle ─────────────────────────────────────────────────
  beginSession(seats: PokerSeatView[]): void {
    this.seats = seats;
    this.wisps = seats.map((s, i) => (s.kind === 'ai' && s.provider ? this.loadSeatWisp(s.provider, i) : null));
    this.active = true;
    this.paused = false;
    this.cam = this.makeCamera();
    this.dirty = true;
  }

  endSession(): void {
    this.active = false;
    this.paused = false;
    this.rejectHuman();
    this.hand = null;
    this.dirty = true;
  }

  // Set the state for the hand about to be played (the driver builds it with the
  // live session stacks + button).
  beginHand(state: HoldemState): void {
    this.hand = state;
    this.beat = 0;
    this.dirty = true;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.dirty = true;
  }

  isActive(): boolean {
    return this.active;
  }

  private loadSeatWisp(provider: string, seat: number): Wisp | null {
    try {
      return loadWisp(`public/assets/logos/${provider}.png`, providerTint(provider), seat * 1.3, this.wispRng);
    } catch {
      return null;
    }
  }

  // Swap a seat's wisp to a new provider (in-session model change).
  setSeatProvider(seat: number, provider: string): void {
    if (seat < 0 || seat >= this.seats.length) return;
    this.seats[seat] = { ...this.seats[seat], provider };
    this.wisps[seat] = this.loadSeatWisp(provider, seat);
    this.dirty = true;
  }

  // ── MatchScene<PokerAction> ────────────────────────────────────────────────────
  state(): HoldemState {
    if (!this.hand) throw new Error('poker: no active hand');
    return this.hand;
  }

  // Animate + apply an AI/committed action, resolving once it has settled (a short
  // watchable beat). Card deals happen inside applyAction (the state deals its own
  // streets), so the new board simply renders next frame.
  playMove(action: PokerAction): Promise<void> {
    if (!this.hand) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.hand!.applyAction(action);
      this.beat = ANIM_BEAT;
      this.dirty = true;
      this.settleResolve = resolve;
    });
  }

  // The hero's move seam (HumanPlayer.awaitMove). Resolves when the hero commits via
  // the HUD (commitHumanAction); rejects if the turn is aborted (pause / stop).
  requestHumanMove(signal?: AbortSignal): Promise<PokerAction> {
    return new Promise<PokerAction>((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('aborted'));
      const onAbort = (): void => {
        this.humanReq = null;
        this.dirty = true;
        reject(new Error('aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.humanReq = {
        resolve: (a) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(a);
        },
        reject: (e) => {
          signal?.removeEventListener('abort', onAbort);
          reject(e);
        },
      };
      this.dirty = true;
    });
  }

  // Is the scene awaiting the hero's action right now? (Drives the HUD's enablement.)
  heroToAct(): boolean {
    return this.humanReq !== null;
  }

  // Commit the hero's chosen action (fold / check / call / bet / raise / allin). The
  // driver animates it via playMove next, so this just hands it to the match loop.
  commitHumanAction(a: PokerAction): void {
    const req = this.humanReq;
    if (!req) return;
    this.humanReq = null;
    req.resolve(a);
  }

  private rejectHuman(): void {
    const req = this.humanReq;
    this.humanReq = null;
    req?.reject(new Error('aborted'));
  }

  // ── Camera passthrough ─────────────────────────────────────────────────────────
  resetView(): void {
    this.cam.reset();
    this.dirty = true;
  }
  orbit(dx: number, dy: number): void {
    this.cam.orbit(dx, dy);
    this.cam.elevation = Math.max(0.16, this.cam.elevation); // don't drop under the table
    this.dirty = true;
  }
  pan(dx: number, dy: number): void {
    this.cam.pan(dx, dy);
    this.dirty = true;
  }
  zoomBy(f: number): void {
    this.cam.zoomBy(f);
    this.dirty = true;
  }

  needsRender(): boolean {
    return this.dirty || (this.active && !this.paused) || this.beat > 0;
  }

  // ── Geometry ───────────────────────────────────────────────────────────────────
  private seatAngle(seat: number): number {
    const n = this.seats.length || 1;
    return (seat / n) * Math.PI * 2; // seat 0 at +z (front / hero)
  }
  private seatPos(seat: number, radius: number): Vec3 {
    const a = this.seatAngle(seat);
    return { x: Math.sin(a) * radius, y: 0, z: Math.cos(a) * radius };
  }

  // ── Rendering ────────────────────────────────────────────────────────────────
  renderScene(target: RenderTarget, t = 0): void {
    const dt = this.lastT < 0 ? 1 / 30 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    target.clear(6, 10, 8);
    const eye = this.cam.eye();
    const camera: Camera = { eye, target: this.cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 200 };
    const { viewProjection: vp } = cameraMatrices(camera, target.width / target.height);

    // Table + a chair per seat.
    rasterize(target, tableMesh(), lambertMaterial, { mvp: mat4Multiply(vp, TABLE_MODEL), model: TABLE_MODEL, lightDir: TABLE_LIGHT, ambient: TABLE_AMBIENT });
    const chair = chairMesh();
    for (let s = 0; s < this.seats.length; s++) {
      const model = chairModel(this.seatAngle(s));
      rasterize(target, chair, lambertMaterial, { mvp: mat4Multiply(vp, model), model, lightDir: TABLE_LIGHT, ambient: TABLE_AMBIENT });
    }

    const hand = this.hand;
    if (hand) {
      this.drawCommunity(target, vp, hand);
      this.drawHoleCards(target, vp, hand);
    }

    // Wisps above each AI seat, pulsing the seat to act (idle when paused/over).
    if (this.active) this.drawWisps(target, vp, t, dt);

    // Tick the played-action beat; when it lapses, wake playMove's awaiter.
    if (this.beat > 0) {
      this.beat--;
      if (this.beat === 0) {
        const done = this.settleResolve;
        this.settleResolve = null;
        done?.();
      }
    }
    this.dirty = false;
  }

  private drawCommunity(target: RenderTarget, vp: Mat4, hand: HoldemState): void {
    const board = hand.boardCards();
    const n = board.length;
    const x0 = -((n - 1) / 2) * BOARD_SPACING;
    for (let i = 0; i < n; i++) {
      const M = mat4Multiply(mat4Translate(x0 + i * BOARD_SPACING, CARD_LIFT, -0.1), flatUp());
      drawCard(target, vp, M, board[i], this.back);
    }
  }

  private drawHoleCards(target: RenderTarget, vp: Mat4, hand: HoldemState): void {
    const reveal = new Set(hand.showdownSeats());
    for (let s = 0; s < this.seats.length; s++) {
      if (hand.isFolded(s)) continue;
      const faceUp = s === 0 || reveal.has(s); // hero always sees its own; showdown reveals the rest
      const a = this.seatAngle(s);
      const c = this.seatPos(s, HOLE_R);
      // Two cards, offset along the seat's tangent (perpendicular to the radial).
      const tx = Math.cos(a);
      const tz = -Math.sin(a);
      const hole = hand.holeOf(s);
      for (let k = 0; k < hole.length; k++) {
        const off = (k === 0 ? -HOLE_GAP : HOLE_GAP);
        const M = mat4Multiply(mat4Translate(c.x + tx * off, CARD_LIFT, c.z + tz * off), mat4Multiply(mat4RotY(a), faceUp ? flatUp() : flatDown()));
        drawCard(target, vp, M, hole[k] as Card, this.back);
      }
    }
  }

  private drawWisps(target: RenderTarget, vp: Mat4, t: number, dt: number): void {
    const hand = this.hand;
    const turn = this.paused || !hand ? -1 : hand.toActSeat();
    const { right, up } = this.cam.basis();
    const W = target.width;
    const H = target.height;
    for (let s = 0; s < this.wisps.length; s++) {
      const wisp = this.wisps[s];
      if (!wisp) continue;
      const c = this.seatPos(s, TABLE_RADIUS + 0.4);
      wisp.setSpeaking(turn === s);
      wisp.renderWorld(target, vp, right, up, { x: c.x, y: WISP_FLOAT, z: c.z }, W, H, t, dt, WISP_SCALE);
    }
  }

  // ── 2D overlay: pot + per-seat stack/bet/status labels (projected) ─────────────
  drawOverlay(surf: Surface, cols: number, rows: number): void {
    const hand = this.hand;
    if (!hand) return;
    const eye = this.cam.eye();
    const camera: Camera = { eye, target: this.cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 200 };
    // A cell is two stacked half-block pixels → aspect halves the row count.
    const { viewProjection: vp } = cameraMatrices(camera, cols / (2 * rows));

    // Pot, centered above the board.
    const potCell = this.project(vp, { x: 0, y: 0.1, z: -1.4 }, cols, rows);
    if (potCell) this.centerLabel(surf, potCell.x, potCell.y, `pot ${hand.potTotal()}`, GOLD, cols);

    const toAct = hand.toActSeat();
    const awardBy = new Map<number, number>();
    if (hand.isTerminal()) for (const a of hand.awards()) awardBy.set(a.seat, (awardBy.get(a.seat) ?? 0) + a.amount);

    for (let s = 0; s < this.seats.length; s++) {
      const seat = this.seats[s];
      // Label sits just behind the seat's cards, toward its chair.
      const p = this.seatPos(s, TABLE_RADIUS + 0.5);
      const cell = this.project(vp, { x: p.x, y: 0.5, z: p.z }, cols, rows);
      if (!cell) continue;
      const name = seat.kind === 'human' ? 'You' : seat.label;
      const status = hand.isFolded(s) ? 'folded' : hand.isAllIn(s) ? 'all-in' : '';
      const bet = hand.committedOf(s);
      const won = awardBy.get(s) ?? 0;
      let line = `${name}  ${hand.stackOf(s)}`;
      if (status) line += `  (${status})`;
      else if (bet > 0) line += `  bet ${bet}`;
      const isTurn = s === toAct && !this.paused;
      const tint = won > 0 ? WIN : hand.isFolded(s) ? MUTED : isTurn ? GOLD : FG;
      this.centerLabel(surf, cell.x, cell.y, `${isTurn ? '▸ ' : ''}${line}${s === hand.button ? '  •BTN' : ''}`, tint, cols);
      if (won > 0) this.centerLabel(surf, cell.x, cell.y + 1, `+${won}`, WIN, cols);
    }
  }

  private centerLabel(surf: Surface, cx: number, cy: number, text: string, fg: RGB, cols: number): void {
    const x = Math.max(0, Math.min(cols - text.length, Math.round(cx - text.length / 2)));
    const y = Math.round(cy);
    surf.drawText(x, y, text, fg, CHIP_BG, fg === MUTED ? STYLE_DIM : STYLE_BOLD);
  }

  private project(vp: Mat4, p: Vec3, cols: number, rows: number): { x: number; y: number } | null {
    const c = mat4MulVec4(vp, { x: p.x, y: p.y, z: p.z, w: 1 });
    if (c.w <= 1e-4) return null;
    return { x: ((c.x / c.w) * 0.5 + 0.5) * cols, y: (1 - ((c.y / c.w) * 0.5 + 0.5)) * rows };
  }

  // ── Wisp picking (click an AI seat's wisp to swap its model) ───────────────────
  wispAt(ndcX: number, ndcY: number, aspect: number): number | null {
    if (!this.active) return null;
    const eye = this.cam.eye();
    const camera: Camera = { eye, target: this.cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 200 };
    const { viewProjection: vp } = cameraMatrices(camera, aspect);
    const { up } = this.cam.basis();
    const size = WISP_SIZE * WISP_SCALE;
    let best: number | null = null;
    let bestD = Infinity;
    for (let s = 0; s < this.wisps.length; s++) {
      if (!this.wisps[s]) continue;
      const c = this.seatPos(s, TABLE_RADIUS + 0.4);
      const P = { x: c.x, y: WISP_FLOAT, z: c.z };
      const center = mat4MulVec4(vp, { x: P.x, y: P.y, z: P.z, w: 1 });
      const cw = center.w || 1e-4;
      const cx = center.x / cw;
      const cy = center.y / cw;
      const e = mat4MulVec4(vp, { x: P.x + up.x * size, y: P.y + up.y * size, z: P.z + up.z * size, w: 1 });
      const ew = e.w || 1e-4;
      const radius = Math.hypot(e.x / ew - cx, e.y / ew - cy);
      const d = Math.hypot(ndcX - cx, ndcY - cy);
      if (d < radius * 1.6 && d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }
}
