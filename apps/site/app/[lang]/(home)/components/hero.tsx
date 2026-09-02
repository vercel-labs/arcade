'use client';

import { CanvasSurfaceHost, LIVING_TITLE_MORPH_STARTS, LivingTitleScene, PointerField, SPLASH_END, TERMINAL_CELL_ASPECT_RATIO, advanceAutoTourProgress, interruptsAutoTourKey, livingTitleTimeline, responsiveTerminalGrid, type CanvasLike, type SurfacePointerMode } from '@vercel/arcade/web';
import { QuickTerminalButton } from '@/components/quick-terminal';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { visibleViewportHeight } from './hero-viewport';

const INSTALL_COMMANDS = {
  npm: 'npm i -g @vercel/arcade',
  curl: 'curl -fsSL https://vercel-arcade.vercel.app/install | sh',
} as const;
const CHAPTERS = [
  { title: '3D games in terminal cells.', body: 'Pure TypeScript. No GPU.' },
  { title: 'One engine. Many games.', body: 'The Arcade launcher, rendered in the same canvas.' },
  { title: 'Models make their move.', body: 'Rules, cameras, materials, and model wisps.' },
  { title: 'Shuffle. Deal. Reveal.', body: 'Production cards and table choreography.' },
  { title: 'An island assembles.', body: 'Water, terrain, ports, dice, and pieces.' },
] as const;
const AUTO_START_DELAY_MS = SPLASH_END * 1_000;

export const Hero = () => {
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tourRef = useRef<HTMLButtonElement>(null);
  const progressRef = useRef(0);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const pointerModeRef = useRef<SurfacePointerMode>('trail');
  const [chapter, setChapter] = useState(0);
  const [copied, setCopied] = useState(false);
  const [installMode, setInstallMode] = useState<keyof typeof INSTALL_COMMANDS>('npm');
  const [tourState, setTourState] = useState<'idle' | 'playing' | 'interrupted' | 'complete'>('idle');
  const [pointerMode, setPointerMode] = useState<SurfacePointerMode>('trail');
  const tourStateRef = useRef(tourState);

  const updateTourState = (state: typeof tourState) => {
    tourStateRef.current = state;
    setTourState(state);
  };
  const updatePointerMode = (mode: SurfacePointerMode) => {
    pointerModeRef.current = mode;
    setPointerMode(mode);
    try { window.localStorage.setItem('arcade-pointer-mode', mode); } catch {}
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
    try {
      const saved = window.localStorage.getItem('arcade-pointer-mode');
      if (saved === 'off') updatePointerMode('off');
      else updatePointerMode('trail');
    } catch {}
    let reducedMotion = motion.matches;
    let pointerEffects = precisePointer.matches && !reducedMotion;
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
      if ((event.target as Element | null)?.closest('.living-title__tour, .living-title__pointer-modes')) return;
      interruptTour();
    };
    const onTouchInterrupt = (event: TouchEvent) => {
      if ((event.target as Element | null)?.closest('.living-title__tour, .living-title__pointer-modes')) return;
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
      const surface = scene.frame({ cols, rows, timeSeconds: time / 1000, progress: displayedProgress, pointer: pointerRef.current, pointerField: field, pointerMode: pointerModeRef.current, reducedMotion });
      const sceneFinished = performance.now();
      // Dense animated terrain and ink fibers touch many neighboring glyphs.
      // A complete repaint is still cheap relative to their 3D render and is
      // the only pixel-exact canvas presentation path under fractional cells.
      const activePointerVisual = pointerModeRef.current !== 'off' && !!field && (field.strength >= 0.01 || field.trail.length > 0 || field.bursts.length > 0);
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
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = { x: (event.clientX - rect.left) / Math.max(1, rect.width), y: (event.clientY - rect.top) / Math.max(1, rect.height) };
      if (pointerEffects) {
        pointerField.setInput(pointerRef.current);
      }
    };
    const onCanvasClick = (event: MouseEvent) => {
      if (!pointerEffects || pointerModeRef.current !== 'trail') return;
      const rect = canvas.getBoundingClientRect();
      pointerField.burst((event.clientX - rect.left) / Math.max(1, rect.width), (event.clientY - rect.top) / Math.max(1, rect.height));
    };
    const clearPointer = () => { pointerRef.current = null; pointerField.release(); };
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
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', clearPointer);
    canvas.addEventListener('click', onCanvasClick);
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
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', clearPointer);
      canvas.removeEventListener('click', onCanvasClick);
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

  const copyInstall = async () => {
    await navigator.clipboard.writeText(INSTALL_COMMANDS[installMode]);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <section className="living-title" ref={rootRef}>
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
          <div aria-label="Pointer effect" className="living-title__pointer-modes" role="group">
            {(['trail', 'off'] as const).map((mode) => (
              <button aria-pressed={pointerMode === mode} key={mode} onClick={() => updatePointerMode(mode)} type="button">{mode}</button>
            ))}
          </div>
        </div>
        <div className="living-title__actions">
          <QuickTerminalButton className="living-title__primary"><span aria-hidden="true">›_</span>Play</QuickTerminalButton>
          <div className="living-title__command">
            <div aria-label="Installation method" className="living-title__command-tabs" role="group">
              {(Object.keys(INSTALL_COMMANDS) as Array<keyof typeof INSTALL_COMMANDS>).map((mode) => (
                <button aria-pressed={installMode === mode} key={mode} onClick={() => { setInstallMode(mode); setCopied(false); }} type="button">{mode}</button>
              ))}
            </div>
            <code>{INSTALL_COMMANDS[installMode]}</code>
            <button aria-label={`Copy ${installMode} install command`} className="living-title__command-copy" onClick={copyInstall} type="button">{copied ? 'copied' : 'copy'}</button>
          </div>
          <Link href="/docs">Docs ↗</Link>
        </div>
      </div>
    </section>
  );
};
