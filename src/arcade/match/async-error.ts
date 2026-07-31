// Promise chains in the match drivers reject both for expected cancellation
// (pause, stop, navigation) and for actual defects. Keep cancellation quiet, but
// route every unexpected failure into the application's crash/finalization path.
export function reportUnexpectedAsyncError(
  error: unknown,
  cancelled: boolean,
  report: (error: unknown) => void,
): void {
  if (!cancelled) report(error);
}
