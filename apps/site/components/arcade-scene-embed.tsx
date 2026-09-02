'use client';

import {
  CanvasSurfaceHost,
  TERMINAL_CELL_ASPECT_RATIO,
  createBrowserMiniScene,
  type BrowserDisplayMode,
  type BrowserMiniScene,
  type BrowserMiniSceneId,
  type CanvasLike,
} from '@vercel/arcade/web';
import { useEffect, useRef, useState } from 'react';

export interface ArcadeSceneEmbedProps {
  ariaLabel: string;
  className?: string;
  cols?: number;
  rows?: number;
  scene: BrowserMiniSceneId;
}

/**
 * Website host for a browser-safe Arcade scene. This component owns DOM and
 * canvas lifecycle only; all rendering and cell generation stays in Arcade.
 */
export function ArcadeSceneEmbed({
  ariaLabel,
  className = '',
  cols = 58,
  rows = 34,
  scene,
}: ArcadeSceneEmbedProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<BrowserMiniScene | null>(null);
  const requestDrawRef = useRef<() => void>(() => {});
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<BrowserDisplayMode>('ascii');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const runtime = createBrowserMiniScene(scene);
    const host = new CanvasSurfaceHost(canvas as unknown as CanvasLike, {
      cellAspectRatio: TERMINAL_CELL_ASPECT_RATIO,
      devicePixelRatio: window.devicePixelRatio,
    });
    runtimeRef.current = runtime;
    setMode('ascii');
    let frame = 0;
    let visible = true;
    const animated = scene === 'chess-knight' || scene.startsWith('islanders-');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = motion.matches;

    const draw = (time: number) => {
      frame = 0;
      if (!visible) return;
      const rect = canvas.getBoundingClientRect();
      host.resize(rect.width, rect.height, cols, rows);
      host.draw(runtime.frame(cols, rows, reducedMotion ? 0 : time / 1000).surface);
      if (animated && !reducedMotion) frame = requestAnimationFrame(draw);
    };
    const requestDraw = () => {
      if (!frame && visible) frame = requestAnimationFrame(draw);
    };
    requestDrawRef.current = requestDraw;

    const resize = new ResizeObserver(requestDraw);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) requestDraw();
      else {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      cancelAnimationFrame(frame);
      frame = 0;
      requestDraw();
    };
    const onPointerDown = (event: PointerEvent) => {
      dragRef.current = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      const prior = dragRef.current;
      if (!prior) return;
      runtime.orbit((event.clientX - prior.x) * 0.7, (event.clientY - prior.y) * 0.7);
      dragRef.current = { x: event.clientX, y: event.clientY };
      requestDraw();
    };
    const onPointerUp = () => { dragRef.current = null; };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      runtime.zoom(event.deltaY);
      requestDraw();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'd') {
        setMode(runtime.cycleDisplayMode());
        requestDraw();
      } else if (event.key.toLowerCase() === 'r') {
        runtime.reset();
        requestDraw();
      }
    };

    resize.observe(canvas);
    intersection.observe(canvas);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKeyDown);
    motion.addEventListener('change', onMotionChange);
    requestDraw();
    void runtime.prepare?.().then(requestDraw).catch((error) => {
      console.error('Unable to prepare Arcade scene assets', error);
    });

    return () => {
      visible = false;
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKeyDown);
      motion.removeEventListener('change', onMotionChange);
      runtimeRef.current = null;
      requestDrawRef.current = () => {};
    };
  }, [cols, rows, scene]);

  const cycleDisplay = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    setMode(runtime.cycleDisplayMode());
    requestDrawRef.current();
  };
  const reset = () => {
    runtimeRef.current?.reset();
    requestDrawRef.current();
  };

  return <div className={`arcade-scene-embed ${className}`.trim()}>
    <canvas aria-label={ariaLabel} className="arcade-scene-embed__canvas" ref={canvasRef} tabIndex={0} />
    <div className="arcade-scene-embed__controls">
      <button onClick={cycleDisplay} type="button">display: {mode}</button>
      <button onClick={reset} type="button">reset camera</button>
    </div>
  </div>;
}
