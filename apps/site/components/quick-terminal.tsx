'use client';

import dynamic from 'next/dynamic';
import {
  createContext,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { resizeTerminalRect, type ResizeDirection } from './quick-terminal-resize';

const loadArcadeTerminal = () => import('../app/[lang]/(home)/components/arcade-terminal');
const ArcadeTerminal = dynamic(
  () => loadArcadeTerminal().then((module) => module.ArcadeTerminal),
  { ssr: false },
);

interface QuickTerminalContextValue {
  close: () => void;
  open: () => void;
  prepare: () => void;
  isOpen: boolean;
}

const RESIZE_DIRECTIONS: ResizeDirection[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

const QuickTerminalContext = createContext<QuickTerminalContextValue | null>(null);

export function QuickTerminalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const restoreRectRef = useRef<DOMRect | null>(null);
  const hasPositionedRef = useRef(false);
  const dragRef = useRef<{
    pointerX: number;
    pointerY: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const resizeRef = useRef<{
    direction: ResizeDirection;
    pointerX: number;
    pointerY: number;
    width: number;
    height: number;
    left: number;
    top: number;
  } | null>(null);

  useEffect(() => {
    // Page-idle work prepares only the shared deployment base. A per-visitor
    // sandbox is intentionally reserved for an explicit Play interaction.
    const preload = () => {
      void loadArcadeTerminal()
        .then((module) => module.warmArcadeTerminalBase())
        .catch(() => {});
    };
    const idle = window.requestIdleCallback?.(preload, { timeout: 2_000 });
    if (idle === undefined) {
      const timer = window.setTimeout(preload, 800);
      return () => window.clearTimeout(timer);
    }
    return () => window.cancelIdleCallback?.(idle);
  }, []);

  // Hover/focus/pointer-down is strong intent: begin the visitor fork before
  // click and let ArcadeTerminal consume the same in-flight session.
  const prepare = useCallback(() => {
    void loadArcadeTerminal()
      .then((module) => module.prepareArcadeTerminalSession())
      .catch(() => {});
  }, []);

  const open = () => {
    setHasOpened(true);
    hasPositionedRef.current = false;
    setIsMinimized(false);
    setIsFullscreen(false);
    setIsOpen(true);
  };
  const close = useCallback(() => {
    setIsOpen(false);
    setIsMinimized(false);
    setIsFullscreen(false);
    restoreRectRef.current = null;
  }, []);

  const toggleMinimize = () => setIsMinimized((value) => !value);

  const toggleFullscreen = () => {
    const panel = panelRef.current;
    if (!panel) return;
    if (!isFullscreen) {
      restoreRectRef.current = panel.getBoundingClientRect();
      setIsMinimized(false);
      setIsFullscreen(true);
      return;
    }

    const restore = restoreRectRef.current;
    setIsFullscreen(false);
    if (restore) {
      requestAnimationFrame(() => {
        panel.style.left = `${restore.left}px`;
        panel.style.top = `${restore.top}px`;
        panel.style.width = `${restore.width}px`;
        panel.style.height = `${restore.height}px`;
        panel.style.transform = 'none';
      });
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    const positionFrame = requestAnimationFrame(() => {
      if (!panel || hasPositionedRef.current || isFullscreen || window.innerWidth <= 640 || window.matchMedia('(pointer: coarse)').matches) return;
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(8, (window.innerWidth - rect.width) / 2)}px`;
      panel.style.top = `${Math.max(8, Math.min(80, window.innerHeight - rect.height - 8))}px`;
      panel.style.transform = 'none';
      hasPositionedRef.current = true;
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const keepInViewport = () => {
      if (!panel || isFullscreen || window.innerWidth <= 640 || window.matchMedia('(pointer: coarse)').matches) return;
      const rect = panel.getBoundingClientRect();
      const width = Math.min(rect.width, window.innerWidth - 16);
      const height = Math.min(rect.height, window.innerHeight - 16);
      panel.style.width = `${width}px`;
      panel.style.height = `${height}px`;
      panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
      panel.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - height - 8))}px`;
      panel.style.transform = 'none';
    };
    const fitMobileVisualViewport = () => {
      if (!panel || !window.matchMedia('(pointer: coarse)').matches) return;
      const viewport = window.visualViewport;
      panel.style.left = `${(viewport?.offsetLeft ?? 0) + 8}px`;
      panel.style.top = `${(viewport?.offsetTop ?? 0) + 8}px`;
      panel.style.width = `${Math.max(1, (viewport?.width ?? window.innerWidth) - 16)}px`;
      panel.style.height = `${Math.max(1, (viewport?.height ?? window.innerHeight) - 16)}px`;
      panel.style.minWidth = '0';
      panel.style.minHeight = '0';
      panel.style.maxWidth = 'none';
      panel.style.maxHeight = 'none';
      panel.style.transform = 'none';
    };
    fitMobileVisualViewport();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', keepInViewport);
    window.visualViewport?.addEventListener('resize', fitMobileVisualViewport);
    window.visualViewport?.addEventListener('scroll', fitMobileVisualViewport);
    return () => {
      cancelAnimationFrame(positionFrame);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', keepInViewport);
      window.visualViewport?.removeEventListener('resize', fitMobileVisualViewport);
      window.visualViewport?.removeEventListener('scroll', fitMobileVisualViewport);
    };
  }, [close, isFullscreen, isOpen]);

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !panelRef.current || isFullscreen) return;
    const panel = panelRef.current;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.transform = 'none';
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const drag = (event: ReactPointerEvent<HTMLElement>) => {
    const origin = dragRef.current;
    const panel = panelRef.current;
    if (!origin || !panel) return;
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - origin.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - origin.height - margin);
    const left = Math.min(maxLeft, Math.max(margin, origin.left + event.clientX - origin.pointerX));
    const top = Math.min(maxTop, Math.max(margin, origin.top + event.clientY - origin.pointerY));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !panelRef.current || isFullscreen || isMinimized) return;
    const direction = event.currentTarget.dataset.resizeDirection as ResizeDirection | undefined;
    if (!direction) return;
    const rect = panelRef.current.getBoundingClientRect();
    resizeRef.current = {
      direction,
      pointerX: event.clientX,
      pointerY: event.clientY,
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
    };
    panelRef.current.style.left = `${rect.left}px`;
    panelRef.current.style.top = `${rect.top}px`;
    panelRef.current.style.transform = 'none';
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = resizeRef.current;
    const panel = panelRef.current;
    if (!origin || !panel) return;
    const margin = 8;
    const minWidth = Math.min(520, window.innerWidth - margin * 2);
    const minHeight = Math.min(360, window.innerHeight - margin * 2);
    const { left, top, width, height } = resizeTerminalRect(
      origin,
      origin.direction,
      event.clientX - origin.pointerX,
      event.clientY - origin.pointerY,
      window.innerWidth,
      window.innerHeight,
      minWidth,
      minHeight,
      margin,
    );
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
  };

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <QuickTerminalContext.Provider value={{ close, open, prepare, isOpen }}>
      {children}
      {hasOpened ? (
        <div className={`quick-terminal-shell${isOpen ? ' is-open' : ''}`}>
          <section
            aria-label="Arcade terminal"
            className={`quick-terminal-panel${isMinimized ? ' is-minimized' : ''}${isFullscreen ? ' is-fullscreen' : ''}`}
            ref={panelRef}
            role="dialog"
          >
            <header
              className="quick-terminal-header"
              onPointerCancel={endDrag}
              onPointerDown={beginDrag}
              onPointerMove={drag}
              onPointerUp={endDrag}
              onDoubleClick={toggleFullscreen}
            >
              <div className="quick-terminal-controls">
                <button
                  aria-label="Close Arcade terminal"
                  className="quick-terminal-control quick-terminal-control--close"
                  onClick={close}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  <svg aria-hidden="true" className="quick-terminal-control-icon" viewBox="0 0 8 8">
                    <path d="m2 2 4 4M6 2 2 6" />
                  </svg>
                </button>
                <button
                  aria-label={isMinimized ? 'Restore Arcade terminal' : 'Minimize Arcade terminal'}
                  className="quick-terminal-control quick-terminal-control--minimize"
                  onClick={toggleMinimize}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  <svg aria-hidden="true" className="quick-terminal-control-icon" viewBox="0 0 8 8">
                    <path d="M1.5 4h5" />
                  </svg>
                </button>
                <button
                  aria-label={isFullscreen ? 'Restore Arcade terminal window' : 'Maximize Arcade terminal window'}
                  className="quick-terminal-control quick-terminal-control--maximize"
                  onClick={toggleFullscreen}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  <svg aria-hidden="true" className="quick-terminal-control-icon" viewBox="0 0 8 8">
                    <path d="M1.5 3.5v-2h2M6.5 4.5v2h-2M3.5 1.5l-2 2M4.5 6.5l2-2" />
                  </svg>
                </button>
              </div>
              <strong>arcade — terminal</strong>
            </header>
            <div aria-hidden={isMinimized} className="quick-terminal-content">
              <ArcadeTerminal />
            </div>
            {RESIZE_DIRECTIONS.map((direction) => (
              <div
                aria-hidden="true"
                className="quick-terminal-resize-handle"
                data-resize-direction={direction}
                key={direction}
                onPointerCancel={endResize}
                onPointerDown={beginResize}
                onPointerMove={resize}
                onPointerUp={endResize}
              />
            ))}
          </section>
        </div>
      ) : null}
    </QuickTerminalContext.Provider>
  );
}

export function QuickTerminalButton({
  ariaLabel,
  children,
  className,
}: {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  const terminal = useContext(QuickTerminalContext);
  if (!terminal) throw new Error('QuickTerminalButton must be used within QuickTerminalProvider');
  return (
    <button
      aria-label={ariaLabel}
      className={className}
      onClick={terminal.open}
      onFocus={terminal.prepare}
      onPointerDown={terminal.prepare}
      onPointerEnter={terminal.prepare}
      type="button"
    >
      {children}
    </button>
  );
}
