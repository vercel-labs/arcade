import { generateText } from 'ai';
import { classifyModelError } from './model-errors.ts';
import { modelFailureNotice, type ModelFailureNotice } from './model-failure-notice.ts';

export interface ModelHealthFailure {
  model: string;
  notice: ModelFailureNotice;
}

const UNKNOWN_HEALTH_FAILURE: Omit<ModelFailureNotice, 'body'> = {
  code: 'health_check_failed',
  severity: 'warning',
  title: 'model health check failed',
  persistent: false,
};

/**
 * Make one tiny real Gateway request per unique model. Catalog availability cannot
 * detect billing/auth failures, while this exercises the same authenticated route
 * gameplay will use. Checks are bounded to two concurrent requests so a six-seat
 * table cannot create a rate-limit burst before play begins.
 */
export async function checkModelHealth(
  models: readonly string[],
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    generate?: (model: string, signal: AbortSignal) => Promise<void>;
  } = {},
): Promise<ModelHealthFailure[]> {
  const unique = [...new Set(models)];
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const deadline = AbortSignal.timeout(timeoutMs);
  const check = async (model: string): Promise<ModelHealthFailure | null> => {
    if (deadline.aborted) return null;
    const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
    try {
      if (opts.generate) await opts.generate(model, signal);
      else {
        await generateText({
          model,
          prompt: 'Reply with OK.',
          maxOutputTokens: 4,
          temperature: 0,
          maxRetries: 0,
          abortSignal: signal,
        });
      }
      return null;
    } catch (error) {
      if (opts.signal?.aborted) throw error;
      const classified = classifyModelError(error);
      const mapped = modelFailureNotice(classified, model);
      const notice = mapped?.persistent ? mapped : {
        ...UNKNOWN_HEALTH_FAILURE,
        body: `${model} did not respond. try starting the match again.`,
      };
      return mapped?.persistent ? { model, notice } : null;
    }
  };
  const results = new Array<ModelHealthFailure | null>(unique.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(2, unique.length) }, async () => {
    while (cursor < unique.length) {
      const index = cursor++;
      if (deadline.aborted) return;
      results[index] = await check(unique[index]);
    }
  }));
  return results.filter((result): result is ModelHealthFailure => result !== null);
}
