import { anchoredInkMatchCut, type InkMatchCut } from '../../cinematic/transitions/ink-match-cut.ts';
import { CHESS_LOOP_SECONDS, POKER_LOOP_SECONDS } from '../../cinematic/scripted-games.ts';
import { ISLANDERS_GAMEPLAY_START } from '../../cinematic/islanders-choreography.ts';
import { RenderTarget } from '../../engine/framebuffer.ts';
import { shapeGlyphToSurface, ShapeGlyphSurfaceCache } from '../../engine/present-cells.ts';
import { Surface } from '../../engine/surface.ts';
import type { Texture } from '../../engine/texture-data.ts';
import { PrismScene } from '../../prism/prism.ts';
import { ARCADE_CATALOGUE } from '../../cinematic/catalogue.ts';
import { CoverFlowRenderer, type CoverFlowItem } from '../../cinematic/scenes/cover-flow.ts';
import { BrowserIslandersCinematic, BrowserPokerCinematic } from '../../web/browser-game-cinematics.ts';
import { BrowserChessBoardShowcase } from '../../web/browser-mini-scenes.ts';
import type { BrowserMiniSceneOptions } from '../../web/mini-scene.ts';
import type { CinematicOrbitCamera } from '../../cinematic/camera.ts';
import { islandersCinematicCamera } from '../../cinematic/camera.ts';
import { GLYPH_SUPERSAMPLE } from '../render-quality.ts';
import { islandersWaterMesh as productionIslandersWaterMesh } from '../games/islanders/water.ts';

export const SOCIAL_TRAILER_SECONDS = 30;
export const SOCIAL_TRAILER_INK_SECONDS = 1.5;
export const SOCIAL_TRAILER_RENDER_STYLE = {
  rasterScale: GLYPH_SUPERSAMPLE,
  productionLighting: true,
  shadowGlyphs: true,
} as const;

export type SocialTrailerBeat =
  | 'hook-islanders'
  | 'hook-poker'
  | 'hook-chess'
  | 'islanders'
  | 'islanders-to-poker'
  | 'poker'
  | 'poker-to-chess'
  | 'chess'
  | 'chess-to-covers'
  | 'covers'
  | 'covers-to-prism'
  | 'prism';

export interface SocialTrailerSample {
  beat: SocialTrailerBeat;
  localSeconds: number;
  durationSeconds: number;
}

export interface SocialTrailerOptions {
  chess?: BrowserMiniSceneOptions;
  poker?: ConstructorParameters<typeof BrowserPokerCinematic>[0];
  covers?: Partial<Record<CoverFlowItem['id'], Texture>>;
}

interface TrailerBeatDefinition {
  beat: SocialTrailerBeat;
  durationSeconds: number;
}

// Promise, proof, signature: reveal all three games with equal compact hooks,
// revisit each at legible native speed, then close on the catalogue and prism.
export const SOCIAL_TRAILER_BEATS: readonly TrailerBeatDefinition[] = [
  { beat: 'hook-islanders', durationSeconds: 1.75 },
  { beat: 'hook-poker', durationSeconds: 1.75 },
  { beat: 'hook-chess', durationSeconds: 1.75 },
  { beat: 'islanders', durationSeconds: 5 },
  { beat: 'islanders-to-poker', durationSeconds: SOCIAL_TRAILER_INK_SECONDS },
  { beat: 'poker', durationSeconds: 5 },
  { beat: 'poker-to-chess', durationSeconds: SOCIAL_TRAILER_INK_SECONDS },
  { beat: 'chess', durationSeconds: 4.5 },
  { beat: 'chess-to-covers', durationSeconds: SOCIAL_TRAILER_INK_SECONDS },
  { beat: 'covers', durationSeconds: 1.75 },
  { beat: 'covers-to-prism', durationSeconds: SOCIAL_TRAILER_INK_SECONDS },
  { beat: 'prism', durationSeconds: 2.5 },
] as const;

const CUTS: Record<'islanders-to-poker' | 'poker-to-chess' | 'chess-to-covers' | 'covers-to-prism', InkMatchCut> = {
  'islanders-to-poker': { from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.52 }, direction: { x: -0.72, y: 0.69 } },
  'poker-to-chess': { from: { x: 0.5, y: 0.52 }, to: { x: 0.5, y: 0.48 }, direction: { x: 0.76, y: 0.65 } },
  'chess-to-covers': { from: { x: 0.5, y: 0.48 }, to: { x: 0.5, y: 0.5 }, direction: { x: -0.82, y: 0.57 } },
  'covers-to-prism': { from: { x: 0.5, y: 0.5 }, to: { x: 0.62, y: 0.43 }, direction: { x: 0.84, y: 0.54 } },
};

// The hook already owns the close shuffle insert. Start the proof shot after it
// so the longer beat can carry the real deal, staggered peeks, bets, and flop.
const POKER_EXCERPT_START = 4.2;
// Skip the opening deck cut in the hook. At the cinematic's 1.5x shuffle
// clock, 0.6s enters the riffle and 1.75s later completes the bridge/cascade.
const POKER_HOOK_START = 0.6;
const CHESS_EXCERPT_START = 7.8;
const CHESS_CASTLE_START = 5.15;
const ISLANDERS_PROOF_SECONDS = 5;
const POKER_PROOF_SECONDS = 5;
const CHESS_PROOF_SECONDS = 4.5;
const COVER_PROOF_SECONDS = 1.75;
// Enter with roughly the final six hexes still in flight, so the extended shot
// reads immediately as an active board build rather than an almost-complete hold.
const ISLANDERS_SETUP_HEAD_START = 1.5;
// Finish the inertial swipe just before the clean Cover Flow beat ends. It gets
// one readable Chess landing without spending the ending on a static cover.
const COVER_SETTLE_SECONDS = SOCIAL_TRAILER_INK_SECONDS + COVER_PROOF_SECONDS - 0.1;
const BLACK: [number, number, number] = [0, 0, 0];
const TRAILER_RASTER_SCALE = SOCIAL_TRAILER_RENDER_STYLE.rasterScale;
const MAX_TRANSITION_PLATES = 8;

interface MovingTransitionPlates {
  from: Surface;
  to: Surface;
  refreshSource: boolean;
}

export function socialTrailerSample(elapsedSeconds: number): SocialTrailerSample {
  const elapsed = clamp(elapsedSeconds, 0, SOCIAL_TRAILER_SECONDS);
  let start = 0;
  for (const definition of SOCIAL_TRAILER_BEATS) {
    const end = start + definition.durationSeconds;
    if (elapsed < end || end === SOCIAL_TRAILER_SECONDS) {
      return {
        beat: definition.beat,
        localSeconds: Math.min(definition.durationSeconds, elapsed - start),
        durationSeconds: definition.durationSeconds,
      };
    }
    start = end;
  }
  return { beat: 'prism', localSeconds: 2.5, durationSeconds: 2.5 };
}

/** CLI-only, self-editing social film. Shared renderers stay at native speed. */
export class SocialTrailerDirector {
  private readonly hookIslanders: BrowserIslandersCinematic;
  private readonly islanders: BrowserIslandersCinematic;
  private readonly poker: BrowserPokerCinematic;
  private readonly chess: BrowserChessBoardShowcase;
  private readonly covers: SocialTrailerCoverFlow;
  private readonly prism = new PrismScene();
  private readonly prismTarget = new RenderTarget(1, 1);
  private readonly prismGlyphCache = new ShapeGlyphSurfaceCache();
  private readonly transitionPlates = new Map<string, MovingTransitionPlates>();
  private elapsed = 0;
  private preparation: Promise<void> | null = null;
  private readonly wispRenderers: NonNullable<BrowserMiniSceneOptions['wispRenderer']>[];

  constructor(options: SocialTrailerOptions = {}) {
    this.wispRenderers = [...new Set([options.chess?.wispRenderer, options.poker?.wispRenderer].filter((renderer): renderer is NonNullable<typeof renderer> => renderer !== undefined))];
    const water = {
      full: productionIslandersWaterMesh(),
      settled: productionIslandersWaterMesh({ omitSettledLand: true }),
    };
    this.hookIslanders = new BrowserIslandersCinematic(socialTrailerIslandersHookCamera, TRAILER_RASTER_SCALE, {
      productionLighting: SOCIAL_TRAILER_RENDER_STYLE.productionLighting,
    }, water);
    this.islanders = new BrowserIslandersCinematic(socialTrailerIslandersCamera, TRAILER_RASTER_SCALE, {
      productionLighting: SOCIAL_TRAILER_RENDER_STYLE.productionLighting,
    }, water);
    this.poker = new BrowserPokerCinematic({
      ...options.poker,
      rasterScale: TRAILER_RASTER_SCALE,
      productionLighting: SOCIAL_TRAILER_RENDER_STYLE.productionLighting,
      shadowGlyphs: SOCIAL_TRAILER_RENDER_STYLE.shadowGlyphs,
    });
    this.chess = new BrowserChessBoardShowcase({
      ...options.chess,
      rasterScale: TRAILER_RASTER_SCALE,
      productionLighting: SOCIAL_TRAILER_RENDER_STYLE.productionLighting,
      shadowGlyphs: SOCIAL_TRAILER_RENDER_STYLE.shadowGlyphs,
    }, true);
    this.chess.setChromeVisible(false);
    this.covers = new SocialTrailerCoverFlow(options.covers);
  }

  prepare(): Promise<void> {
    this.preparation ??= Promise.all([this.poker.prepare(), this.chess.prepare()]).then(() => undefined);
    return this.preparation;
  }

  reset(): void { this.resetVisualState(); this.elapsed = 0; }
  seek(seconds: number): void {
    const elapsed = clamp(seconds, 0, SOCIAL_TRAILER_SECONDS);
    if (elapsed < this.elapsed) this.resetVisualState();
    this.elapsed = elapsed;
  }
  step(seconds: number): void { this.elapsed = Math.min(SOCIAL_TRAILER_SECONDS, this.elapsed + Math.max(0, seconds)); }
  done(): boolean { return this.elapsed >= SOCIAL_TRAILER_SECONDS; }
  progress(): number { return this.elapsed / SOCIAL_TRAILER_SECONDS; }
  sample(): SocialTrailerSample { return socialTrailerSample(this.elapsed); }

  private resetVisualState(): void {
    this.transitionPlates.clear();
    for (const renderer of this.wispRenderers) renderer.reset?.();
  }

  frame(cols: number, rows: number): Surface {
    const sample = this.sample();
    const local = sample.localSeconds;
    const unit = local / sample.durationSeconds;
    switch (sample.beat) {
      case 'hook-islanders': return this.hookIslanders.frame(cols, rows, 0.54 + unit * 0.08, ISLANDERS_GAMEPLAY_START + 10.8 + local, ISLANDERS_GAMEPLAY_START + 10.8 + local);
      case 'hook-poker': return this.pokerFrame(cols, rows, 0.02 + unit * 0.08, POKER_HOOK_START + local);
      case 'hook-chess': return this.chessFrame(cols, rows, 0.4 + unit * 0.1, CHESS_CASTLE_START + local);
      case 'islanders': return this.islandersProofFrame(cols, rows, local);
      case 'islanders-to-poker': return this.transition(cols, rows, sample.beat, unit);
      case 'poker': return this.pokerProofFrame(cols, rows, SOCIAL_TRAILER_INK_SECONDS + local);
      case 'poker-to-chess': return this.transition(cols, rows, sample.beat, unit);
      case 'chess': return this.chessProofFrame(cols, rows, SOCIAL_TRAILER_INK_SECONDS + local);
      case 'chess-to-covers': return this.transition(cols, rows, sample.beat, unit);
      case 'covers': return this.coverProofFrame(cols, rows, SOCIAL_TRAILER_INK_SECONDS + local);
      case 'covers-to-prism': return this.transition(cols, rows, sample.beat, unit);
      case 'prism': return this.prismFrame(cols, rows, SOCIAL_TRAILER_INK_SECONDS + local);
    }
  }


  private transition(cols: number, rows: number, beat: keyof typeof CUTS, progress: number): Surface {
    const plates = this.movingTransitionPlates(cols, rows, beat, progress * SOCIAL_TRAILER_INK_SECONDS);
    return anchoredInkMatchCut(plates.from, plates.to, cols, rows, smoothstep(progress), CUTS[beat]);
  }

  private movingTransitionPlates(cols: number, rows: number, beat: keyof typeof CUTS, local: number): MovingTransitionPlates {
    const key = `${beat}:${cols}:${rows}`;
    let plates = this.transitionPlates.get(key);
    if (!plates) {
      const initial = this.transitionFrames(cols, rows, beat, local);
      if (!initial.from || !initial.to) throw new Error(`Incomplete trailer transition: ${beat}`);
      plates = { from: initial.from, to: initial.to, refreshSource: true };
      this.transitionPlates.set(key, plates);
      while (this.transitionPlates.size > MAX_TRANSITION_PLATES) this.transitionPlates.delete(this.transitionPlates.keys().next().value!);
      return plates;
    }
    // One live 3D plate per terminal frame keeps both sides moving at half the
    // terminal refresh rate without doubling sustained rasterization cost.
    const frames = this.transitionFrames(cols, rows, beat, local, plates.refreshSource ? 'from' : 'to');
    if (frames.from) plates.from = frames.from;
    if (frames.to) plates.to = frames.to;
    plates.refreshSource = !plates.refreshSource;
    return plates;
  }

  private transitionFrames(cols: number, rows: number, beat: keyof typeof CUTS, local: number, only?: 'from' | 'to'): Partial<{ from: Surface; to: Surface }> & { from?: Surface; to?: Surface } {
    const renderFrom = only !== 'to';
    const renderTo = only !== 'from';
    if (beat === 'islanders-to-poker') return {
      from: renderFrom ? this.islandersProofFrame(cols, rows, ISLANDERS_PROOF_SECONDS + local) : undefined,
      to: renderTo ? this.pokerProofFrame(cols, rows, local) : undefined,
    };
    if (beat === 'poker-to-chess') return {
      from: renderFrom ? this.pokerProofFrame(cols, rows, SOCIAL_TRAILER_INK_SECONDS + POKER_PROOF_SECONDS + local) : undefined,
      to: renderTo ? this.chessProofFrame(cols, rows, local) : undefined,
    };
    if (beat === 'chess-to-covers') return {
      from: renderFrom ? this.chessProofFrame(cols, rows, SOCIAL_TRAILER_INK_SECONDS + CHESS_PROOF_SECONDS + local) : undefined,
      to: renderTo ? this.coverProofFrame(cols, rows, local) : undefined,
    };
    return {
      from: renderFrom ? this.coverProofFrame(cols, rows, SOCIAL_TRAILER_INK_SECONDS + COVER_PROOF_SECONDS + local) : undefined,
      to: renderTo ? this.prismFrame(cols, rows, local) : undefined,
    };
  }

  private islandersProofFrame(cols: number, rows: number, clock: number): Surface {
    const elapsed = socialTrailerIslandersElapsed(clock);
    const cameraProgress = clamp(clock / (ISLANDERS_PROOF_SECONDS + SOCIAL_TRAILER_INK_SECONDS), 0, 1);
    return this.islandersFrame(cols, rows, cameraProgress, elapsed);
  }

  private pokerProofFrame(cols: number, rows: number, clock: number): Surface {
    const total = SOCIAL_TRAILER_INK_SECONDS + POKER_PROOF_SECONDS + SOCIAL_TRAILER_INK_SECONDS;
    const cameraProgress = lerp(0.22, 0.64, clamp(clock / total, 0, 1));
    return this.pokerFrame(cols, rows, cameraProgress, POKER_EXCERPT_START + clock);
  }

  private chessProofFrame(cols: number, rows: number, clock: number): Surface {
    const total = SOCIAL_TRAILER_INK_SECONDS + CHESS_PROOF_SECONDS + SOCIAL_TRAILER_INK_SECONDS;
    // This angle establishes both kings and their wisps before the close lobe.
    const cameraProgress = lerp(0.18, 0.68, clamp(clock / total, 0, 1));
    return this.chessFrame(cols, rows, cameraProgress, CHESS_EXCERPT_START + clock);
  }

  private coverProofFrame(cols: number, rows: number, clock: number): Surface {
    return this.covers.frame(cols, rows, socialTrailerCoverPosition(clock));
  }

  private islandersFrame(cols: number, rows: number, cameraProgress: number, gameplaySeconds: number): Surface {
    return this.islanders.frame(cols, rows, cameraProgress, gameplaySeconds, gameplaySeconds);
  }

  private pokerFrame(cols: number, rows: number, cameraProgress: number, gameplaySeconds: number): Surface {
    return this.poker.frame(cols, rows, cameraProgress, gameplaySeconds, gameplaySeconds / POKER_LOOP_SECONDS, 0);
  }

  private chessFrame(cols: number, rows: number, cameraProgress: number, gameplaySeconds: number): Surface {
    this.chess.setCinematicState(cameraProgress, gameplaySeconds / CHESS_LOOP_SECONDS);
    return this.chess.frame(cols, rows, gameplaySeconds).surface;
  }

  private prismFrame(cols: number, rows: number, elapsed: number): Surface {
    this.prismTarget.resize(cols * TRAILER_RASTER_SCALE, rows * TRAILER_RASTER_SCALE * 2);
    // The final signature shot starts fully formed. The offset chooses a strong
    // beam/rainbow angle while retaining the live prism's native rotation.
    this.prism.renderScene(this.prismTarget, 2.35 + elapsed);
    const surface = new Surface(cols, rows);
    surface.fillRect(0, 0, cols, rows, BLACK);
    shapeGlyphToSurface(surface, this.prismTarget, cols, rows, { color: true, contrast: 2.2, hybrid: false, coloredBackground: false }, 0, 0, this.prismGlyphCache);
    return surface;
  }
}

/** One iPod-like swipe: accelerate through the catalogue, brake, land on Chess. */
export function socialTrailerCoverPosition(clock: number): number {
  return ARCADE_CATALOGUE.length * smootherstep(clamp(clock / COVER_SETTLE_SECONDS, 0, 1));
}

export function socialTrailerIslandersElapsed(clock: number): number {
  return ISLANDERS_SETUP_HEAD_START + Math.max(0, clock) * 1.15;
}

/** Preserve the original close terrain-study framing for the one-second dice hook. */
export function socialTrailerIslandersHookCamera(progress: number, aspect: number, harbor: { x: number; z: number }): CinematicOrbitCamera {
  return islandersCinematicCamera(progress, aspect, harbor);
}

/** Trailer-only camera: overview during tile setup, then a readable coast push. */
export function socialTrailerIslandersCamera(progress: number, aspect: number, harbor: { x: number; z: number }): CinematicOrbitCamera {
  const p = clamp(progress, 0, 1);
  // One camera move, not an overview followed by a separate coast move. Every
  // authored parameter shares this same eased clock from the first frame.
  const travel = smootherstep(p);
  const fit = aspect >= 1 ? 1 : lerp(2.5, 1, clamp((aspect - 0.55) / 0.45, 0, 1));
  const harborAngle = Math.atan2(harbor.x, harbor.z);
  const coast = { x: Math.sin(harborAngle) * 2.45, y: 0.03, z: Math.cos(harborAngle) * 2.45 };
  const target = { x: lerp(0, coast.x, travel), y: lerp(-0.08, coast.y, travel), z: lerp(0, coast.z, travel) };
  const azimuth = lerp(-0.72, -0.72 + Math.PI * 0.72, travel);
  const elevation = lerp(0.98, 0.66, travel);
  const distance = lerp(14.6, 5.75, travel) * fit;
  const ce = Math.cos(elevation);
  return {
    eye: { x: target.x + ce * Math.sin(azimuth) * distance, y: target.y + Math.sin(elevation) * distance, z: target.z + ce * Math.cos(azimuth) * distance },
    target, up: { x: 0, y: 1, z: 0 }, fovy: 48 * Math.PI / 180, near: 0.05, far: 100, azimuth,
    ndcOffsetX: lerp(0, -0.25, travel),
    ndcOffsetY: lerp(0, -0.08, travel),
  };
}

class SocialTrailerCoverFlow {
  private readonly target = new RenderTarget(1, 1);
  private readonly textures: Map<string, Texture>;
  private readonly renderer: CoverFlowRenderer;

  constructor(textures: Partial<Record<CoverFlowItem['id'], Texture>> = {}) {
    this.textures = new Map(Object.entries(textures).filter((entry): entry is [string, Texture] => entry[1] !== undefined));
    this.renderer = new CoverFlowRenderer(ARCADE_CATALOGUE, (id) => this.textures.get(id) ?? null);
  }


  frame(cols: number, rows: number, position: number): Surface {
    this.target.resize(cols * TRAILER_RASTER_SCALE, rows * TRAILER_RASTER_SCALE * 2);
    this.renderer.renderScene(this.target, position, null);
    const surface = new Surface(cols, rows);
    surface.fillRect(0, 0, cols, rows, BLACK);
    shapeGlyphToSurface(surface, this.target, cols, rows, { color: true, contrast: 2, hybrid: false, coloredBackground: false });
    return surface;
  }
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function smoothstep(value: number): number { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); }
function smootherstep(value: number): number { const t = clamp(value, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); }
