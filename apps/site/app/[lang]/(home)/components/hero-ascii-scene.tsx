'use client';

import {
  BrowserRenderShowcase,
  CanvasSurfaceHost,
  type CanvasLike,
} from '@vercel/arcade/web';
import { useEffect, useRef } from 'react';

const COLS = 72;
const ROWS = 38;
const FRAME_INTERVAL_MS = 1000 / 12;

/** A quiet, real-engine ASCII layer for the homepage—not a CSS illustration. */
export function HeroAsciiScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const runtime = new BrowserRenderShowcase();
    const host = new CanvasSurfaceHost(canvas as unknown as CanvasLike, {
      devicePixelRatio: window.devicePixelRatio,
      fontFamily: 'Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
    });
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = reducedMotionQuery.matches;
    let visible = true;
    let frame = 0;
    let lastDraw = -FRAME_INTERVAL_MS;

    const draw = (time: number) => {
      frame = 0;
      if (!visible) return;
      if (!reducedMotion && time - lastDraw < FRAME_INTERVAL_MS) {
        frame = requestAnimationFrame(draw);
        return;
      }
      lastDraw = time;
      const rect = canvas.getBoundingClientRect();
      host.resize(rect.width, rect.height, COLS, ROWS);
      host.draw(runtime.frame(COLS, ROWS, reducedMotion ? 0 : time / 1000).surface);
      if (!reducedMotion) frame = requestAnimationFrame(draw);
    };

    const requestDraw = () => {
      if (!frame && visible) frame = requestAnimationFrame(draw);
    };
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

    resize.observe(canvas);
    intersection.observe(canvas);
    reducedMotionQuery.addEventListener('change', onMotionChange);
    requestDraw();
    return () => {
      visible = false;
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      reducedMotionQuery.removeEventListener('change', onMotionChange);
    };
  }, []);

  return <canvas aria-label="CPU-rendered ASCII geometry" className="hero-ascii-canvas" ref={canvasRef} />;
}
