import type { RGB } from '../engine/color.ts';
import { anchoredInkMatchCut } from '../cinematic/transitions/ink-match-cut.ts';
import { LIVING_TITLE_ACTS, LIVING_TITLE_ACT_BOUNDARIES, LIVING_TITLE_MORPH_STARTS, livingTitleTimeline, type LivingTitleAct } from '../cinematic/timeline.ts';
import { ActiveSceneLoopClock } from '../cinematic/scene-loop.ts';
import { CHESS_LOOP_SECONDS, POKER_LOOP_SECONDS } from '../cinematic/scripted-games.ts';
import { RenderTarget } from '../engine/framebuffer.ts';
import { shapeGlyphToSurface, ShapeGlyphSurfaceCache } from '../engine/present-cells.ts';
import { Surface } from '../engine/surface.ts';
import type { PointerFieldSnapshot } from '../engine/pointer-field.ts';
import { PrismScene } from '../prism/prism.ts';
import { SplashScene, SPLASH_END } from '../prism/splash.ts';
import { BrowserIslandersCinematic, BrowserPokerCinematic } from './browser-game-cinematics.ts';
import { ISLANDERS_CINEMATIC_LOOP_SECONDS, ISLANDERS_REDUCED_MOTION_TIME } from '../cinematic/islanders-choreography.ts';
import { BrowserChessBoardShowcase } from './browser-mini-scenes.ts';
import type { BrowserMiniSceneOptions } from './mini-scene.ts';
import type { Texture } from '../engine/texture-data.ts';
import type { CoverFlowItem } from '../cinematic/scenes/cover-flow.ts';
import { BrowserCoverFlow } from './browser-coverflow.ts';
import { applySurfacePointerEffect, type SurfacePointerMode } from './surface-pointer-effects.ts';

const BLACK: RGB = [0, 0, 0];
const ACTS = LIVING_TITLE_ACTS.length;
const MATCH_CUT_SOURCE_PROGRESS = [LIVING_TITLE_MORPH_STARTS[0], 0.9, LIVING_TITLE_MORPH_STARTS[2], LIVING_TITLE_MORPH_STARTS[3]] as const;
const ZOOM_DETAIL_SCALE = 2;
const TRANSITION_MOTION_SAMPLES = 4;
const COVER_FLOW_SETTLED_PROGRESS = 0.9;
const MATCH_CUTS = [
  // Prism beam → selected cover bezel.
  { from: { x: 0.62, y: 0.43 }, to: { x: 0.5, y: 0.5 }, direction: { x: -0.82, y: 0.57 } },
  // Flipped CHESS title → ranks and files.
  { from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.48 }, direction: { x: 0.76, y: 0.65 } },
  // Dark board square → cards and felt.
  { from: { x: 0.56, y: 0.49 }, to: { x: 0.5, y: 0.52 }, direction: { x: -0.72, y: 0.69 } },
  // Poker cards/felt → Islanders's central hex and water.
  { from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.5 }, direction: { x: 0.84, y: 0.54 } },
] as const;

export { anchoredInkMatchCut, LIVING_TITLE_ACT_BOUNDARIES, LIVING_TITLE_MORPH_STARTS, livingTitleTimeline };
export type { LivingTitleAct };
export interface LivingTitleFrameOptions { cols: number; rows: number; timeSeconds: number; progress: number; pointer?: { x: number; y: number } | null; pointerField?: PointerFieldSnapshot | null; pointerMode?: SurfacePointerMode; reducedMotion?: boolean; }
export interface LivingTitleSceneOptions {
  chess?: BrowserMiniSceneOptions;
  poker?: ConstructorParameters<typeof BrowserPokerCinematic>[0];
  covers?: Partial<Record<CoverFlowItem['id'], Texture>>;
  coverLabels?: boolean;
}

/** A restrained phone-portrait pullback for the compact opening scenes. */
export function earlyScenePortraitScale(aspect: number): number {
  return aspect >= 0.8 ? 1 : 0.86 + 0.14 * smoothstep((aspect - 0.45) / 0.35);
}

/** Scroll-scrubbed Arcade launch film: long game acts joined by short cell morphs. */
export class LivingTitleScene {
  private readonly prismTarget = new RenderTarget(1, 1);
  private readonly prismGlyphCache = new ShapeGlyphSurfaceCache();
  private readonly prism = new PrismScene();
  private readonly splash = new SplashScene();
  private readonly chess: BrowserChessBoardShowcase;
  private readonly covers: BrowserCoverFlow;
  private readonly poker: BrowserPokerCinematic;
  private readonly islanders = new BrowserIslandersCinematic();
  private readonly chessLoop = new ActiveSceneLoopClock();
  private readonly pokerLoop = new ActiveSceneLoopClock();
  private readonly islandersLoop = new ActiveSceneLoopClock();
  private readonly transitionPlates = new Map<string, Partial<{ source: Surface; destination: Surface; sourceMotion: Surface[]; destinationMotion: Surface[] }>>();
  private prismStartedAt: number | null = null;
  private chessGameplayPhase = 0;
  private pokerGameplayPhase = 0;
  private pokerGameplayIteration = 0;
  private prepared = false;

  constructor(options: LivingTitleSceneOptions = {}) {
    this.chess = new BrowserChessBoardShowcase(options.chess);
    this.poker = new BrowserPokerCinematic(options.poker);
    this.covers = new BrowserCoverFlow(options.covers, options.coverLabels);
  }

  prepare(): Promise<void> {
    return Promise.all([this.covers.prepare(), this.chess.prepare(), this.poker.prepare()]).then(() => {
      this.transitionPlates.clear();
      this.prepared = true;
    });
  }

  ready(): boolean { return this.prepared; }

  /** Restart host-driven playback without discarding prepared scene assets. */
  reset(): void {
    this.prismStartedAt = null;
    this.chessGameplayPhase = 0;
    this.pokerGameplayPhase = 0;
    this.pokerGameplayIteration = 0;
    this.transitionPlates.clear();
    this.chessLoop.reset();
    this.pokerLoop.reset();
    this.islandersLoop.reset();
  }

  /** Pre-render an expensive 3D handoff once; hosts can call this during idle time. */
  prepareTransition(act: number, cols: number, rows: number, timeSeconds = 0): void {
    if (act < 0 || act >= ACTS - 1) return;
    this.transitionPlate(act, cols, rows, timeSeconds);
  }

  clearTransitionPlates(): void { this.transitionPlates.clear(); }

  /** Prepare one transition plate at a time so the browser can yield between expensive renders. */
  prepareTransitionPart(act: number, cols: number, rows: number, part: 'source' | 'destination', timeSeconds = 0): void {
    if (act < 0 || act >= ACTS - 1) return;
    const key = `${act}:${cols}:${rows}`;
    const plate = this.transitionPlates.get(key) ?? {};
    if (part === 'source' && !plate.source) plate.source = this.scene(act, cols, rows, MATCH_CUT_SOURCE_PROGRESS[act], timeSeconds, false);
    else if (part === 'destination' && !plate.destination) plate.destination = this.scene(act + 1, cols * ZOOM_DETAIL_SCALE, rows * ZOOM_DETAIL_SCALE, 0, timeSeconds, false);
    this.setTransitionPlate(key, plate);
  }

  /** Prepare one motion sample; hosts schedule samples independently to avoid long tasks. */
  prepareTransitionMotionSample(act: number, cols: number, rows: number, side: 'source' | 'destination', index: number, timeSeconds = 0): void {
    if (act < 0 || act >= ACTS - 1 || index < 0 || index >= TRANSITION_MOTION_SAMPLES) return;
    // Source sample zero is always the exact live frame captured at cut entry.
    // Leave that slot empty so the first quarter falls back to plate.source.
    if (side === 'source' && index === 0) return;
    const key = `${act}:${cols}:${rows}`;
    const plate = this.transitionPlates.get(key) ?? {};
    const field = side === 'source' ? 'sourceMotion' : 'destinationMotion';
    const samples = plate[field] ?? [];
    if (samples[index]) return;
    const phase = index / (TRANSITION_MOTION_SAMPLES - 1);
    const sampleAct = side === 'source' ? act : act + 1;
    const sampleCols = side === 'source' ? cols : cols * ZOOM_DETAIL_SCALE;
    const sampleRows = side === 'source' ? rows : rows * ZOOM_DETAIL_SCALE;
    const progress = side === 'source' ? lerp(MATCH_CUT_SOURCE_PROGRESS[act], 1, phase) : 0;
    const sampleTime = timeSeconds + phase * 1.5;
    const previous = [this.chessGameplayPhase, this.pokerGameplayPhase, this.pokerGameplayIteration] as const;
    if (sampleAct === 2) this.chessGameplayPhase = phase * 1.5 / CHESS_LOOP_SECONDS;
    if (sampleAct === 3) { this.pokerGameplayPhase = phase * 1.5 / POKER_LOOP_SECONDS; this.pokerGameplayIteration = 0; }
    samples[index] = this.scene(sampleAct, sampleCols, sampleRows, progress, sampleTime, false, sampleTime);
    [this.chessGameplayPhase, this.pokerGameplayPhase, this.pokerGameplayIteration] = previous;
    plate[field] = samples;
    this.setTransitionPlate(key, plate);
  }

  frame(options: LivingTitleFrameOptions): Surface {
    const { cols, rows, timeSeconds, pointer = null, pointerField = null, pointerMode = 'off', reducedMotion = false } = options;
    const { act, local } = livingTitleTimeline(options.progress);
    const morphStart = LIVING_TITLE_MORPH_STARTS[act];
    const inTransition = act < ACTS - 1 && local >= morphStart && !reducedMotion;
    this.chessGameplayPhase = this.chessLoop.sample(timeSeconds, (act === 2 || inTransition && act === 1) && !reducedMotion, CHESS_LOOP_SECONDS).phase;
    const pokerClock = this.pokerLoop.sample(timeSeconds, (act === 3 || inTransition && act === 2) && !reducedMotion, POKER_LOOP_SECONDS);
    this.pokerGameplayPhase = pokerClock.phase;
    this.pokerGameplayIteration = pokerClock.iteration;
    const islandersClock = this.islandersLoop.sample(timeSeconds, (act === 4 || inTransition && act === 3) && !reducedMotion, ISLANDERS_CINEMATIC_LOOP_SECONDS);
    const islandersGameplay = reducedMotion
      ? ISLANDERS_REDUCED_MOTION_TIME
      : islandersClock.iteration * ISLANDERS_CINEMATIC_LOOP_SECONDS + islandersClock.elapsed;
    if (act === ACTS - 1 || local < morphStart || reducedMotion) {
      const rendered = this.scene(act, cols, rows, local, timeSeconds, reducedMotion, islandersGameplay);
      // The outgoing scene is the sheet of paper being burned. Retain the
      // actual last live frame so entering the ink cut cannot swap to a stale
      // gameplay phase, camera pose, or differently sampled high-res plate.
      if (act < ACTS - 1 && !reducedMotion) {
        const key = `${act}:${cols}:${rows}`;
        const plate = this.transitionPlates.get(key) ?? {};
        plate.source = rendered;
        this.setTransitionPlate(key, plate);
      }
      return reducedMotion ? rendered : applySurfacePointerEffect(rendered, pointerField, pointerMode, { protectedTop: 3 });
    }
    // Render denser transition plates so local ink fibers stay crisp. The shared
    // compositor preserves each plate's authored position and scale.
    const { source: detailedScene, destination: next } = this.motionTransitionPlate(act, cols, rows, local, timeSeconds);
    const transition = anchoredInkMatchCut(
      detailedScene,
      next,
      cols,
      rows,
      smoothstep((local - morphStart) / (1 - morphStart)),
      MATCH_CUTS[act],
      pointer,
      null,
    );
    return reducedMotion ? transition : applySurfacePointerEffect(transition, pointerField, pointerMode, { protectedTop: 3 });
  }

  actAt(progress: number): LivingTitleAct { return LIVING_TITLE_ACTS[livingTitleTimeline(progress).act]; }

  private transitionPlate(act: number, cols: number, rows: number, time: number): { source: Surface; destination: Surface } {
    const key = `${act}:${cols}:${rows}`;
    let plate = this.transitionPlates.get(key);
    if (!plate?.source) this.prepareTransitionPart(act, cols, rows, 'source', time);
    if (!plate?.destination) this.prepareTransitionPart(act, cols, rows, 'destination', time);
    plate = this.transitionPlates.get(key)!;
    return plate as { source: Surface; destination: Surface };
  }

  private motionTransitionPlate(act: number, cols: number, rows: number, local: number, time: number): { source: Surface; destination: Surface } {
    const key = `${act}:${cols}:${rows}`;
    const plate = this.transitionPlate(act, cols, rows, time);
    const stored = this.transitionPlates.get(key);
    const transitionProgress = clamp01((local - LIVING_TITLE_MORPH_STARTS[act]) / (1 - LIVING_TITLE_MORPH_STARTS[act]));
    return {
      source: transitionProgress <= 0 ? plate.source : motionSample(stored?.sourceMotion, transitionProgress) ?? plate.source,
      destination: motionSample(stored?.destinationMotion, transitionProgress) ?? plate.destination,
    };
  }

  private scene(act: number, cols: number, rows: number, progress: number, time: number, reduced: boolean, islandersGameplay = 0): Surface {
    const aspect = cols / Math.max(1, rows * 2);
    const portraitScale = earlyScenePortraitScale(aspect);
    if (act === 0) return this.prismSurface(cols, rows, reduced ? 0.8 : time, progress, portraitScale);
    if (act === 1) {
      // Cover Flow's authored 0..0.9 sequence includes one full carousel loop,
      // Chess selection, the complete flip, and its hold. Fit that sequence into
      // the stable portion of the chapter so the ink cut can never interrupt it.
      const coverProgress = Math.min(COVER_FLOW_SETTLED_PROGRESS, progress / LIVING_TITLE_MORPH_STARTS[1] * COVER_FLOW_SETTLED_PROGRESS);
      return this.covers.frame(cols, rows, coverProgress, 1 / portraitScale);
    }
    if (act === 2) {
      this.chess.setChromeVisible(false);
      this.chess.setCinematicState(progress, this.chessGameplayPhase, 1 / portraitScale);
      return this.chess.frame(cols, rows, reduced ? 0 : time).surface;
    }
    if (act === 3) return this.poker.frame(cols, rows, progress, reduced ? 0 : time, this.pokerGameplayPhase, this.pokerGameplayIteration);
    return this.islanders.frame(cols, rows, progress, reduced ? 0 : time, islandersGameplay);
  }

  private prismSurface(cols: number, rows: number, time: number, progress: number, sceneScale: number): Surface {
    const target = this.prismTarget;
    target.resize(cols * 3, rows * 6);
    this.prismStartedAt ??= time;
    const elapsed = Math.max(0, time - this.prismStartedAt);
    if (elapsed < SPLASH_END) this.splash.renderScene(target, elapsed, sceneScale);
    else this.prism.renderScene(target, elapsed, undefined, sceneScale);
    const surface = new Surface(cols, rows);
    surface.fillRect(0, 0, cols, rows, BLACK);
    shapeGlyphToSurface(surface, target, cols, rows, { color: true, contrast: 2.2, hybrid: false, coloredBackground: false }, 0, 0, this.prismGlyphCache);
    return surface;
  }

  private setTransitionPlate(key: string, plate: Partial<{ source: Surface; destination: Surface }>): void {
    this.transitionPlates.delete(key);
    this.transitionPlates.set(key, plate);
  }
}

function smoothstep(value: number): number { const t = clamp01(value); return t * t * (3 - 2 * t); }
function motionSample(samples: Surface[] | undefined, progress: number): Surface | undefined {
  if (!samples?.length) return undefined;
  return samples[Math.min(samples.length - 1, Math.floor(clamp01(progress) * samples.length))];
}
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
