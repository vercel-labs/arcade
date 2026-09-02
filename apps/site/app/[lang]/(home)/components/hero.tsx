'use client';

import { CanvasSurfaceHost, LIVING_TITLE_MORPH_STARTS, LivingTitleScene, PointerField, SPLASH_END, TERMINAL_CELL_ASPECT_RATIO, advanceAutoTourProgress, interruptsAutoTourKey, livingTitleTimeline, responsiveTerminalGrid, type CanvasLike } from '@vercel/arcade/web';
import { QuickTerminalButton } from '@/components/quick-terminal';
import { useEffect, useRef, useState } from 'react';
import { visibleViewportHeight } from './hero-viewport';
import { InstallCommand } from './install-command';
const CHAPTERS = [
  { title: 'The 3D game engine for agents.', body: 'ASCII in your terminal. No GPU.\nHumans can play too.' },
  { title: 'Powered by Vercel’s AI Gateway.', body: 'Watch hundreds of models face off, or challenge them yourself.' },
  { title: 'Different minds. Endless possibilities.', body: 'Everything you see is open source. Your move.' },
  { title: 'Every player has a tell.', body: 'Discover the hidden tendencies of your favorite models.' },
  { title: 'Settle in, have some fun!', body: 'Play a few rounds while coding agents do your work.' },
] as const;
const AUTO_START_DELAY_MS = SPLASH_END * 1_000;

export const Hero = () => {
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tourRef = useRef<HTMLButtonElement>(null);
  const progressRef = useRef(0);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const [chapter, setChapter] = useState(0);
  const [tourState, setTourState] = useState<'idle' | 'playing' | 'interrupted' | 'complete'>('idle');
  const tourStateRef = useRef(tourState);

  const updateTourState = (state: typeof tourState) => {
    tourStateRef.current = state;
    setTourState(state);
  };
  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const tour = tourRef.current;
    if (!root || !canvas || !tour) return;
    const resolvedMono = getComputedStyle(document.documentElement).getPropertyValue('--font-geist-mono').trim();
    const scene = new LivingTitleScene();
    void scene.prepare().catch((error) => console.error('Unable to prepare cinematic assets', error));
    const host = new CanvasSurfaceHost(canvas as unknown as CanvasLike, {
      cellAspectRatio: TERMINAL_CELL_ASPECT_RATIO,
      devicePixelRatio: window.devicePixelRatio,
      fontFamily: resolvedMono || 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontScale: 0.96,
    });
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const precisePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const pointerField = new PointerField({ response: 52, velocityResponse: 18, trailLifetime: 1.05, trailSpacing: 0.0045, maxTrail: 52, idleDelay: 0.18, fadeRate: 7 });
    let reducedMotion = motion.matches;
    let pointerEffects = precisePointer.matches && !reducedMotion;
    let activePointerId: number | null = null;
    let pressX = 0;
    let pressY = 0;
    let dragged = false;
    let frame = 0;
    let displayedProgress = progressRef.current;
    let displayedChapterRef = -1;
    let primedGrid = '';
    const primedTransitions = new Set<string>();
    const idleHandles = new Set<number>();
    let tourFrame = 0;
    let tourLastTime = 0;
    let previousFrameTime = 0;
    let autoStartHandle = 0;
    const diagnostics = typeof window !== 'undefined' && (
      new URLSearchParams(window.location.search).has('arcadeDebug') ||
      window.location.hash === '#arcadeDebug'
    )
      ? { frames: [] as Array<{ time: number; progress: number; sceneMs: number; drawMs: number; totalMs: number }>, intervals: [] as number[], lastFrameTime: 0, element: document.createElement('output') }
      : null;
    if (diagnostics) {
      diagnostics.element.hidden = true;
      diagnostics.element.dataset.arcadePerformance = 'pending';
      root.appendChild(diagnostics.element);
    }

    const viewportHeight = () => visibleViewportHeight(window.visualViewport?.height, window.innerHeight);
    let fittedViewportHeight = 0;
    const fitVisibleViewport = () => {
      const nextHeight = viewportHeight();
      if (Math.abs(nextHeight - fittedViewportHeight) >= 0.5) {
        fittedViewportHeight = nextHeight;
        root.style.setProperty('--arcade-visual-height', `${nextHeight}px`);
        canvas.style.height = `${nextHeight}px`;
        primedGrid = '';
        primedTransitions.clear();
      }
      measureProgress();
    };

    const measureProgress = () => {
      const rect = root.getBoundingClientRect();
      const distance = Math.max(1, root.offsetHeight - viewportHeight());
      progressRef.current = Math.max(0, Math.min(1, -rect.top / distance));
      tour.style.setProperty('--tour-progress', `${progressRef.current * 100}%`);
    };
    const stopTour = () => {
      if (tourStateRef.current !== 'playing') return;
      cancelAnimationFrame(tourFrame);
      tourFrame = 0;
      tourLastTime = 0;
      updateTourState('interrupted');
    };
    const onTourRequest = () => {
      if (autoStartHandle) window.clearTimeout(autoStartHandle);
      autoStartHandle = 0;
      if (tourStateRef.current === 'playing') {
        stopTour();
        return;
      }
      if (reducedMotion) return;
      if (progressRef.current >= 0.999) window.scrollTo({ top: root.offsetTop, behavior: 'instant' });
      measureProgress();
      updateTourState('playing');
      tourLastTime = 0;
      const advance = (time: number) => {
        if (tourStateRef.current !== 'playing') return;
        const elapsed = tourLastTime ? Math.min(0.1, (time - tourLastTime) / 1000) : 0;
        tourLastTime = time;
        const progress = advanceAutoTourProgress(progressRef.current, elapsed);
        const distance = Math.max(1, root.offsetHeight - viewportHeight());
        window.scrollTo({ top: root.offsetTop + progress * distance, behavior: 'instant' });
        measureProgress();
        if (progress >= 1) {
          updateTourState('complete');
          tourFrame = 0;
          return;
        }
        tourFrame = requestAnimationFrame(advance);
      };
      tourFrame = requestAnimationFrame(advance);
    };
    const interruptTour = () => {
      if (autoStartHandle) window.clearTimeout(autoStartHandle);
      autoStartHandle = 0;
      stopTour();
    };
    const onTourInterruptKey = (event: KeyboardEvent) => {
      if (interruptsAutoTourKey(event.key)) interruptTour();
    };
    const onPointerInterrupt = (event: PointerEvent) => {
      // The tour button owns its click. Stopping on its pointerdown and then
      // toggling again on click made Pause immediately restart on pointerup.
      if ((event.target as Element | null)?.closest('.living-title__tour')) return;
      interruptTour();
    };
    const onTouchInterrupt = (event: TouchEvent) => {
      if ((event.target as Element | null)?.closest('.living-title__tour')) return;
      interruptTour();
    };
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      if (document.hidden) return;
      // Scroll distance is the film clock. No wall-clock checkpoints or
      // catch-up queue: the scrollbar, narration, and canvas always agree.
      displayedProgress = progressRef.current;
      const { act: displayedChapter, local: displayedLocal } = livingTitleTimeline(displayedProgress);
      if (displayedChapter !== displayedChapterRef) {
        displayedChapterRef = displayedChapter;
        setChapter(displayedChapter);
      }
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      // Match terminal resize behavior: font/cell size is stable; resizing adds
      // columns and rows, so wider windows reveal more of the rendered frame.
      const { cols, rows } = responsiveTerminalGrid(rect.width, rect.height);
      const gridKey = `${cols}:${rows}`;
      if (gridKey !== primedGrid) {
        primedGrid = gridKey;
        primedTransitions.clear();
      }
      const transitionKey = `${displayedChapter}:${gridKey}`;
      if (displayedChapter < 4 && !primedTransitions.has(transitionKey)) {
        primedTransitions.add(transitionKey);
        // Prime only this chapter's upcoming cut. Rendering every chapter after
        // a resize creates a burst of main-thread work and stale-looking scroll.
        // The outgoing source must be the exact last live frame; only prepare
        // the next scene off the critical scroll path.
        const parts = ['destination'] as const;
        parts.forEach((part, index) => {
          const handle = window.setTimeout(() => {
            scene.prepareTransitionPart(displayedChapter, cols, rows, part, time / 1000);
            idleHandles.delete(handle);
          }, 120 + index * 90);
          idleHandles.add(handle);
        });
      }
      host.resize(rect.width, rect.height, cols, rows);
      const renderStarted = performance.now();
      if (diagnostics?.lastFrameTime) diagnostics.intervals.push(time - diagnostics.lastFrameTime);
      if (diagnostics) diagnostics.lastFrameTime = time;
      const dt = previousFrameTime ? (time - previousFrameTime) / 1000 : 0;
      previousFrameTime = time;
      const field = pointerEffects ? pointerField.step(dt) : null;
      const surface = scene.frame({ cols, rows, timeSeconds: time / 1000, progress: displayedProgress, pointer: pointerRef.current, pointerField: field, pointerMode: 'trail', reducedMotion });
      const sceneFinished = performance.now();
      // Dense animated terrain and ink fibers touch many neighboring glyphs.
      // A complete repaint is still cheap relative to their 3D render and is
      // the only pixel-exact canvas presentation path under fractional cells.
      const activePointerVisual = !!field && (field.strength >= 0.01 || field.trail.length > 0 || field.bursts.length > 0);
      const forceFullCanvas = activePointerVisual || displayedChapter === 4 || (
        displayedChapter < 4 && displayedLocal >= LIVING_TITLE_MORPH_STARTS[displayedChapter]
      );
      host.draw(surface, { forceFull: forceFullCanvas });
      if (diagnostics) {
        const drawFinished = performance.now();
        diagnostics.frames.push({
          time,
          progress: displayedProgress,
          sceneMs: sceneFinished - renderStarted,
          drawMs: drawFinished - sceneFinished,
          totalMs: drawFinished - renderStarted,
        });
        if (diagnostics.frames.length > 600) diagnostics.frames.splice(0, diagnostics.frames.length - 600);
        if (diagnostics.frames.length % 30 === 0) {
          const samples = diagnostics.frames.map(({ totalMs }) => totalMs).sort((a, b) => a - b);
          const p50 = samples[Math.floor(samples.length * 0.5)] ?? 0;
          const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
          const intervals = diagnostics.intervals.slice(-600).sort((a, b) => a - b);
          const cadenceP50 = intervals[Math.floor(intervals.length * 0.5)] ?? 0;
          const cadenceP95 = intervals[Math.floor(intervals.length * 0.95)] ?? 0;
          diagnostics.element.dataset.arcadePerformance = JSON.stringify({ frames: samples.length, workP50: p50, workP95: p95, worstWork: samples.at(-1) ?? 0, cadenceP50, cadenceP95, presentedFps: 1000 / Math.max(0.001, cadenceP50) });
        }
      }
    };
    const pointerPosition = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (event.clientX - rect.left) / Math.max(1, rect.width), y: (event.clientY - rect.top) / Math.max(1, rect.height) };
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!pointerEffects || event.button !== 0) return;
      activePointerId = event.pointerId;
      pressX = event.clientX;
      pressY = event.clientY;
      dragged = false;
      pointerRef.current = pointerPosition(event);
      pointerField.beginStroke(pointerRef.current);
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointerEffects || event.pointerId !== activePointerId) return;
      pointerRef.current = pointerPosition(event);
      if (Math.hypot(event.clientX - pressX, event.clientY - pressY) >= 4) dragged = true;
      pointerField.setInput(pointerRef.current);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== activePointerId) return;
      const release = pointerPosition(event);
      if (pointerEffects && !dragged) pointerField.burst(release.x, release.y);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      activePointerId = null;
      pointerRef.current = null;
      pointerField.release();
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== activePointerId) return;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      clearPointer();
    };
    const clearPointer = () => { activePointerId = null; pointerRef.current = null; pointerField.release(); };
    const onMotion = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      pointerEffects = precisePointer.matches && !reducedMotion;
      if (!pointerEffects) clearPointer();
      if (reducedMotion) interruptTour();
    };
    const onPointerCapability = () => { pointerEffects = precisePointer.matches && !reducedMotion; if (!pointerEffects) clearPointer(); };

    fitVisibleViewport();
    window.addEventListener('scroll', measureProgress, { passive: true });
    window.addEventListener('resize', fitVisibleViewport);
    window.visualViewport?.addEventListener('resize', fitVisibleViewport);
    window.visualViewport?.addEventListener('scroll', fitVisibleViewport);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    root.addEventListener('arcade-tour-request', onTourRequest);
    window.addEventListener('wheel', interruptTour, { passive: true });
    window.addEventListener('touchstart', onTouchInterrupt, { passive: true });
    window.addEventListener('pointerdown', onPointerInterrupt, { passive: true });
    window.addEventListener('keydown', onTourInterruptKey);
    motion.addEventListener('change', onMotion);
    precisePointer.addEventListener('change', onPointerCapability);
    frame = requestAnimationFrame(draw);
    if (!reducedMotion && progressRef.current <= 0.001) {
      autoStartHandle = window.setTimeout(() => {
        autoStartHandle = 0;
        measureProgress();
        if (progressRef.current <= 0.001 && tourStateRef.current === 'idle') onTourRequest();
      }, AUTO_START_DELAY_MS);
    }
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', measureProgress);
      window.removeEventListener('resize', fitVisibleViewport);
      window.visualViewport?.removeEventListener('resize', fitVisibleViewport);
      window.visualViewport?.removeEventListener('scroll', fitVisibleViewport);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      root.removeEventListener('arcade-tour-request', onTourRequest);
      window.removeEventListener('wheel', interruptTour);
      window.removeEventListener('touchstart', onTouchInterrupt);
      window.removeEventListener('pointerdown', onPointerInterrupt);
      window.removeEventListener('keydown', onTourInterruptKey);
      motion.removeEventListener('change', onMotion);
      precisePointer.removeEventListener('change', onPointerCapability);
      if (tourFrame) cancelAnimationFrame(tourFrame);
      if (autoStartHandle) window.clearTimeout(autoStartHandle);
      for (const handle of idleHandles) window.clearTimeout(handle);
      diagnostics?.element.remove();
      root.style.removeProperty('--arcade-visual-height');
      canvas.style.removeProperty('height');
    };
  }, []);

  return (
    <section className="living-title" ref={rootRef}>
      <span aria-hidden="true" className="living-title__legacy-anchor" id="system" style={{ top: '0' }} />
      <span aria-hidden="true" className="living-title__legacy-anchor" id="chess" style={{ top: 'calc((100% - var(--arcade-visual-height, 100dvh)) * .25 + 1px)' }} />
      <span aria-hidden="true" className="living-title__legacy-anchor" id="poker" style={{ top: 'calc((100% - var(--arcade-visual-height, 100dvh)) * .52 + 1px)' }} />
      <span aria-hidden="true" className="living-title__legacy-anchor" id="islanders" style={{ top: 'calc((100% - var(--arcade-visual-height, 100dvh)) * .76 + 1px)' }} />
      <div className="living-title__stage">
        <canvas aria-label="Arcade scenes transforming from a glass prism into games" className="living-title__canvas" ref={canvasRef} />
        <div aria-hidden="true" className="living-title__vignette" />
        <div className="living-title__copy" aria-live="polite">
          <div className="living-title__chapter" key={CHAPTERS[chapter].title}>
            <h1>{CHAPTERS[chapter].title}</h1>
            <p>{CHAPTERS[chapter].body}</p>
          </div>
          <button
            aria-label={tourState === 'playing' ? 'Pause auto-scroll' : 'Start auto-scroll'}
            className={`living-title__tour ${tourState === 'playing' ? 'is-playing' : ''}`}
            onClick={() => rootRef.current?.dispatchEvent(new Event('arcade-tour-request'))}
            ref={tourRef}
            type="button"
          >
            <span aria-hidden="true">{tourState === 'playing' ? 'Ⅱ' : '▶'}</span>
            {tourState === 'playing' ? 'Pause' : 'Auto-scroll'}
          </button>
        </div>
        <div className="living-title__actions">
          <QuickTerminalButton className="living-title__primary"><span aria-hidden="true">›_</span>Play</QuickTerminalButton>
          <InstallCommand />
        </div>
      </div>
    </section>
  );
};
