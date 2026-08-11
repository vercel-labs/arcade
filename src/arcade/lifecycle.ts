import type { RecordEndReason } from '../telemetry/records.ts';

export type ShutdownReason = Exclude<RecordEndReason, 'natural'>;

export interface ShutdownCoordinator {
  finalize(reason: ShutdownReason, code: number, error?: unknown): void;
  signal(): void;
  crash(error: unknown): void;
  isFinalizing(): boolean;
}

export interface ShutdownDeps {
  cleanup: Array<(reason: ShutdownReason) => void>;
  flush(capMs: number): Promise<void>;
  exit(code: number): void;
  report(error: unknown): void;
  flushCapMs?: number;
}

// Owns the application's one-way transition from running to exited. Cleanup is
// synchronous and best-effort (active games persist their durable records here);
// telemetry then gets a short asynchronous flush window before the process exits.
export function createShutdownCoordinator(deps: ShutdownDeps): ShutdownCoordinator {
  let finalizing = false;
  const flushCapMs = deps.flushCapMs ?? 400;

  const finalize = (reason: ShutdownReason, code: number, error?: unknown): void => {
    if (finalizing) return;
    finalizing = true;

    for (const cleanup of deps.cleanup) {
      try {
        cleanup(reason);
      } catch {
        // One cleanup must not prevent the remaining resources from being restored.
      }
    }
    if (error !== undefined) deps.report(error);

    let flush: Promise<void>;
    try {
      flush = deps.flush(flushCapMs);
    } catch {
      deps.exit(code);
      return;
    }
    void flush.catch(() => {}).finally(() => deps.exit(code));
  };

  return {
    finalize,
    signal: () => finalize('user_stopped', 0),
    crash: (error) => finalize('process_exit_recovered', 1, error),
    isFinalizing: () => finalizing,
  };
}
