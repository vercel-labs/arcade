import type { Surface } from '../engine/surface.ts';
import type { BrowserDisplayMode } from './browser-chess.ts';

export type BrowserMiniSceneId = 'chess-board' | 'catan-fields';

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
  frame(cols: number, rows: number, timeSeconds?: number): BrowserMiniSceneFrame;
  cycleDisplayMode(): BrowserDisplayMode;
  orbit(dx: number, dy: number): void;
  zoom(delta: number): void;
  reset(): void;
}
