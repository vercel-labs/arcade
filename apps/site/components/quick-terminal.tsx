'use client';

import dynamic from 'next/dynamic';
import {
  createContext,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

const ArcadeTerminal = dynamic(
  () => import('../app/[lang]/(home)/components/arcade-terminal').then((module) => module.ArcadeTerminal),
  { ssr: false },
);

interface QuickTerminalContextValue {
  close: () => void;
  open: () => void;
  isOpen: boolean;
}

const QuickTerminalContext = createContext<QuickTerminalContextValue | null>(null);

export function QuickTerminalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{
    pointerX: number;
    pointerY: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const open = () => {
    setHasOpened(true);
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !panelRef.current) return;
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

  return (
    <QuickTerminalContext.Provider value={{ close, open, isOpen }}>
      {children}
      {hasOpened ? (
        <div
          aria-hidden={!isOpen}
          className={`quick-terminal-shell${isOpen ? ' is-open' : ''}`}
        >
          <button
            aria-label="Close Arcade terminal"
            className="quick-terminal-scrim"
            onClick={close}
            tabIndex={isOpen ? 0 : -1}
            type="button"
          />
          <section
            aria-label="Arcade terminal"
            aria-modal="true"
            className="quick-terminal-panel"
            ref={panelRef}
            role="dialog"
          >
            <header
              className="quick-terminal-header"
              onPointerCancel={endDrag}
              onPointerDown={beginDrag}
              onPointerMove={drag}
              onPointerUp={endDrag}
            >
              <div className="quick-terminal-controls">
                <button
                  aria-label="Close Arcade terminal"
                  className="quick-terminal-control quick-terminal-control--close"
                  onClick={close}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                />
                <span className="quick-terminal-control quick-terminal-control--minimize" />
                <span className="quick-terminal-control quick-terminal-control--maximize" />
              </div>
              <strong>arcade — terminal</strong>
            </header>
            <ArcadeTerminal />
          </section>
        </div>
      ) : null}
    </QuickTerminalContext.Provider>
  );
}

export function QuickTerminalButton({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const terminal = useContext(QuickTerminalContext);
  if (!terminal) throw new Error('QuickTerminalButton must be used within QuickTerminalProvider');
  return (
    <button className={className} onClick={terminal.open} type="button">
      {children}
    </button>
  );
}
