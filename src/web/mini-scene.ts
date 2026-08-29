import type { Surface } from '../engine/surface.ts';
import type { ChessPieceName } from '../game-visuals/chess/index.ts';
import type { BrowserDisplayMode } from './browser-chess.ts';

export type BrowserMiniSceneId = 'chess-board' | 'catan-fields';

export interface BrowserMiniSceneOptions {
  /** Browser-visible directory containing pawn.obj, knight.obj, and the other production pieces. */
  chessPieceAssetBaseUrl?: string;
  /** Exact per-piece URLs override the package-owned model URLs. */
  chessPieceAssetUrls?: Record<ChessPieceName, string>;
  /** Optional transport override for tests, authenticated assets, or custom hosts. */
  chessPieceFetchText?: (url: string) => Promise<string>;
}

export interface BrowserMiniSceneFrame {
  surface: Surface;
  status: string;
  displayMode: BrowserDisplayMode;
}

/**
 * A small browser-safe Arcade scene. The host owns only the canvas lifecycle;
 * Arcade continues to own geometry, cameras, rendering, and terminal cells.
 */
export interface BrowserMiniScene {
  /** Optional one-time asset preparation. Frames remain valid while it is pending. */
  prepare?(): Promise<void>;
  frame(cols: number, rows: number, timeSeconds?: number): BrowserMiniSceneFrame;
  cycleDisplayMode(): BrowserDisplayMode;
  orbit(dx: number, dy: number): void;
  zoom(delta: number): void;
  reset(): void;
}
