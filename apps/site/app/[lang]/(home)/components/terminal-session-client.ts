'use client';

interface InteractiveStart {
  command: string;
  args: string[];
  env: string[];
  cwd: string;
  cols: number;
  rows: number;
}

export interface TerminalSession {
  url: string;
  token: string;
  start: InteractiveStart;
  expiresInMs: number;
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const ENDPOINT = '/api/terminal/session';
const PREPARED_COLS = 100;
const PREPARED_ROWS = 48;

export function createTerminalSessionPreparer(fetcher: Fetcher = fetch) {
  let prepared: Promise<TerminalSession | null> | null = null;

  const requestSession = async (cols: number, rows: number, signal?: AbortSignal): Promise<TerminalSession> => {
    const response = await fetcher(ENDPOINT, {
      method: 'POST',
      body: JSON.stringify({ cols, rows }),
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal,
    });
    if (!response.ok) throw new Error('session unavailable');
    return response.json() as Promise<TerminalSession>;
  };

  return {
    async warmBase(): Promise<void> {
      try {
        await fetcher(ENDPOINT, {
          method: 'POST',
          body: JSON.stringify({ warmOnly: true }),
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
        });
      } catch {
        // Best-effort page-idle work must never affect the site or the later retry.
      }
    },
    prepareSession(): void {
      if (prepared) return;
      const pending = requestSession(PREPARED_COLS, PREPARED_ROWS).catch(() => null);
      prepared = pending;
      void pending.then((session) => {
        if (!session && prepared === pending) prepared = null;
      });
    },
    async acquireSession(cols: number, rows: number, signal?: AbortSignal): Promise<TerminalSession> {
      const pending = prepared;
      prepared = null;
      const session = await pending;
      if (session) return session;
      return requestSession(cols, rows, signal);
    },
  };
}

const terminalSessionPreparer = createTerminalSessionPreparer();

export const warmArcadeTerminalBase = (): Promise<void> => terminalSessionPreparer.warmBase();
export const prepareArcadeTerminalSession = (): void => terminalSessionPreparer.prepareSession();
export const acquireArcadeTerminalSession = (cols: number, rows: number, signal?: AbortSignal): Promise<TerminalSession> =>
  terminalSessionPreparer.acquireSession(cols, rows, signal);
