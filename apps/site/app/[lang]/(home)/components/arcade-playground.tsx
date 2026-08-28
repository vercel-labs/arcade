'use client';

import { BrowserArcade, CanvasSurfaceHost, type CanvasLike } from '@vercel/arcade/web';
import { useEffect, useRef, useState } from 'react';

const COLS = 92;
const ROWS = 52;

export function ArcadePlayground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<BrowserArcade | null>(null);
  const hostRef = useRef<CanvasSurfaceHost | null>(null);
  const draggingRef = useRef<{ x: number; y: number } | null>(null);
  const [status, setStatus] = useState('Choose Chess');
  const [displayMode, setDisplayMode] = useState('ascii');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const runtime = new BrowserArcade();
    const host = new CanvasSurfaceHost(canvas as unknown as CanvasLike, {
      devicePixelRatio: window.devicePixelRatio,
    });
    runtimeRef.current = runtime;
    hostRef.current = host;

    let frame = 0;
    const draw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = canvas.getBoundingClientRect();
        host.resize(rect.width, rect.height, COLS, ROWS);
        const next = runtime.frame(COLS, ROWS);
        host.draw(next.surface);
        setStatus(next.status);
        setDisplayMode(next.displayMode);
      });
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'd') runtime.cycleDisplayMode();
      else if (event.key === 'r') runtime.reset();
      else if (event.key === 'Escape') runtime.back();
      else if (event.key === 'Enter') runtime.openChess();
      else return;
      event.preventDefault();
      draw();
    };
    window.addEventListener('keydown', onKey);

    const onPointerDown = (event: PointerEvent) => {
      draggingRef.current = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      const previous = draggingRef.current;
      if (!previous) return;
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        runtime.orbit(dx * 0.008, dy * 0.008);
        draggingRef.current = { x: event.clientX, y: event.clientY };
        draw();
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      const start = draggingRef.current;
      draggingRef.current = null;
      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
      runtime.click(x, y);
      draw();
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      runtime.zoom(event.deltaY);
      draw();
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('keydown', onKey);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  const mutate = (operation: (runtime: BrowserArcade) => void) => {
    const runtime = runtimeRef.current;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!runtime || !host || !canvas) return;
    operation(runtime);
    const rect = canvas.getBoundingClientRect();
    host.resize(rect.width, rect.height, COLS, ROWS);
    const next = runtime.frame(COLS, ROWS);
    host.draw(next.surface);
    setStatus(next.status);
    setDisplayMode(next.displayMode);
  };

  return (
    <div className="arcade-playground" aria-label="Playable Arcade Chess demo">
      <div className="arcade-playground__chrome">
        <span className="arcade-playground__lights" aria-hidden="true">● ● ●</span>
        <span>{status}</span>
        <span>{displayMode}</span>
      </div>
      <canvas
        aria-label="Arcade terminal canvas. Click Chess, then click pieces and highlighted destinations to play."
        className="arcade-playground__canvas"
        ref={canvasRef}
        tabIndex={0}
      />
      <div className="arcade-playground__controls">
        <button onClick={() => mutate((runtime) => runtime.back())} type="button">launcher</button>
        <button onClick={() => mutate((runtime) => runtime.reset())} type="button">reset</button>
        <button onClick={() => mutate((runtime) => runtime.cycleDisplayMode())} type="button">display</button>
      </div>
    </div>
  );
}
