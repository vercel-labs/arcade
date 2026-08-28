'use client';

import {
  BrowserRenderShowcase,
  BrowserTuiShowcase,
  CanvasSurfaceHost,
  type CanvasLike,
} from '@vercel/arcade/web';
import { useEffect, useRef, useState } from 'react';

const COLS = 64;
const ROWS = 34;

export function RenderExample() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<BrowserRenderShowcase | null>(null);
  const hostRef = useRef<CanvasSurfaceHost | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const requestDrawRef = useRef<() => void>(() => {});
  const [mode, setMode] = useState('ascii');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const runtime = new BrowserRenderShowcase();
    const host = new CanvasSurfaceHost(canvas as unknown as CanvasLike, { devicePixelRatio: window.devicePixelRatio });
    runtimeRef.current = runtime;
    hostRef.current = host;
    let frame = 0;
    let visible = true;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = motion.matches;
    const draw = (time: number) => {
      frame = 0;
      if (!visible) return;
      const rect = canvas.getBoundingClientRect();
      host.resize(rect.width, rect.height, COLS, ROWS);
      host.draw(runtime.frame(COLS, ROWS, reducedMotion ? 0 : time / 1000).surface);
      if (!reducedMotion) frame = requestAnimationFrame(draw);
    };
    const requestDraw = () => {
      if (!frame && visible) frame = requestAnimationFrame(draw);
    };
    requestDrawRef.current = requestDraw;
    const resize = new ResizeObserver(() => {
      requestDraw();
    });
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) requestDraw();
      if (!visible) {
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
    frame = requestAnimationFrame(draw);

    const onPointerDown = (event: PointerEvent) => {
      dragRef.current = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      const prior = dragRef.current;
      if (!prior) return;
      runtime.orbit((event.clientX - prior.x) * 0.7, (event.clientY - prior.y) * 0.7);
      dragRef.current = { x: event.clientX, y: event.clientY };
      if (reducedMotion) requestDraw();
    };
    const onPointerUp = () => { dragRef.current = null; };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      runtime.zoom(event.deltaY);
      if (reducedMotion) requestDraw();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'd') {
        const next = runtime.cycleDisplayMode();
        setMode(next);
        requestDraw();
      } else if (event.key.toLowerCase() === 'r') {
        runtime.reset();
        requestDraw();
      }
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKeyDown);
    motion.addEventListener('change', onMotionChange);
    return () => {
      visible = false;
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      requestDrawRef.current = () => {};
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKeyDown);
      motion.removeEventListener('change', onMotionChange);
    };
  }, []);

  return <ExampleShell
    controls={<><button onClick={() => {
      const next = runtimeRef.current?.cycleDisplayMode();
      if (next) {
        setMode(next);
        requestDrawRef.current();
      }
    }} type="button">display: {mode}</button><button onClick={() => {
      runtimeRef.current?.reset();
      requestDrawRef.current();
    }} type="button">reset camera</button></>}
    description="A real RenderTarget, camera, meshes, Lambert material, rasterizer, and production ASCII/pixel/hybrid presenters. Drag to orbit, scroll to zoom, or focus the canvas and press D/R."
    imports="@vercel/arcade/engine · @vercel/arcade/web"
    source="src/web/browser-showcase.ts"
    title="Mesh + material"
  ><canvas aria-label="Interactive CPU-rendered Arcade scene" className="live-example__canvas" ref={canvasRef} tabIndex={0} /></ExampleShell>;
}

export function TuiExample() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<BrowserTuiShowcase | null>(null);
  const hostRef = useRef<CanvasSurfaceHost | null>(null);
  const [status, setStatus] = useState('Selected grok-4.1-fast');

  const draw = () => {
    const canvas = canvasRef.current;
    const runtime = runtimeRef.current;
    const host = hostRef.current;
    if (!canvas || !runtime || !host) return;
    const rect = canvas.getBoundingClientRect();
    host.resize(rect.width, rect.height, COLS, ROWS);
    const frame = runtime.frame(COLS, ROWS);
    host.draw(frame.surface);
    setStatus(frame.status);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    runtimeRef.current = new BrowserTuiShowcase();
    hostRef.current = new CanvasSurfaceHost(canvas as unknown as CanvasLike, { devicePixelRatio: window.devicePixelRatio });
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, []);

  return <ExampleShell
    controls={<><span>{status}</span><button onClick={() => { runtimeRef.current?.nextPlayer(); draw(); }} type="button">next player</button><button onClick={() => { runtimeRef.current?.reset(); draw(); }} type="button">reset</button></>}
    description="A real retained Box/Text/Table/Button tree laid out and painted by Arcade's TUI into Surface, then displayed by the browser host."
    imports="@vercel/arcade/tui · @vercel/arcade/web"
    source="src/web/browser-showcase.ts"
    title="Retained HUD"
  ><canvas aria-label="Interactive retained Arcade TUI example" className="live-example__canvas" ref={canvasRef} tabIndex={0} /></ExampleShell>;
}

function ExampleShell({ children, controls, description, imports, source, title }: {
  children: React.ReactNode;
  controls: React.ReactNode;
  description: string;
  imports: string;
  source: string;
  title: string;
}) {
  return <article className="live-example">
    <header><div><span>live example</span><h2>{title}</h2></div><code>{imports}</code></header>
    <div className="live-example__stage">{children}</div>
    <div className="live-example__controls">{controls}</div>
    <p>{description}</p>
    <footer><code>{source}</code><a href="https://github.com/vercel-labs/arcade" rel="noreferrer" target="_blank">view repository ↗</a></footer>
  </article>;
}
