import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  MatchLabEvent,
  MatchLabManifest,
  MatchLabResult,
  MatchLabSummary,
} from './types.ts';

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const jsonLine = (value: unknown): string => `${JSON.stringify(value)}\n`;

export class MatchLabArtifacts {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    readonly directory: string,
    readonly runId: string,
  ) {}

  async initialize(manifest: MatchLabManifest): Promise<void> {
    await mkdir(join(this.directory, 'matches'), { recursive: true });
    await writeFile(join(this.directory, 'manifest.json'), json(manifest), 'utf8');
  }

  emit(matchId: string | undefined, event: Omit<MatchLabEvent, 'runId' | 'matchId' | 'at'>): void {
    const record: MatchLabEvent = {
      runId: this.runId,
      ...(matchId ? { matchId } : {}),
      at: new Date().toISOString(),
      ...event,
    };
    const line = jsonLine(record);
    this.writeQueue = this.writeQueue.then(async () => {
      await appendFile(join(this.directory, 'events.jsonl'), line, 'utf8');
      if (matchId) {
        const matchDirectory = join(this.directory, 'matches', matchId);
        await mkdir(matchDirectory, { recursive: true });
        await appendFile(join(matchDirectory, 'trace.jsonl'), line, 'utf8');
      }
    });
  }

  async writeResult(result: MatchLabResult): Promise<void> {
    await this.flush();
    const matchDirectory = join(this.directory, 'matches', result.id);
    await mkdir(matchDirectory, { recursive: true });
    await writeFile(join(matchDirectory, 'result.json'), json(result), 'utf8');
    if (result.canonical !== undefined) {
      await writeFile(join(matchDirectory, 'canonical.json'), json(result.canonical), 'utf8');
    }
    if (result.error) await appendFile(join(this.directory, 'errors.jsonl'), jsonLine({ matchId: result.id, ...result.error }), 'utf8');
  }

  async writeSummary(summary: MatchLabSummary): Promise<void> {
    await this.flush();
    await writeFile(join(this.directory, 'summary.json'), json(summary), 'utf8');
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }
}

export async function runWorkerPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const count = Math.max(1, Math.min(Math.floor(concurrency), items.length || 1));
  await Promise.all(Array.from({ length: count }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

export function summarizeRun(
  manifest: MatchLabManifest,
  startedAt: string,
  results: readonly MatchLabResult[],
): MatchLabSummary {
  const resultsByModel: MatchLabSummary['resultsByModel'] = {};
  for (const result of results) {
    for (let seat = 0; seat < result.models.length; seat++) {
      const model = result.models[seat];
      const modelResult = resultsByModel[model] ?? { games: 0, wins: 0 };
      modelResult.games++;
      if (result.winnerSeats.includes(seat)) modelResult.wins++;
      resultsByModel[model] = modelResult;
    }
  }
  const endedAt = new Date().toISOString();
  return {
    runId: manifest.runId,
    game: manifest.game,
    startedAt,
    endedAt,
    durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
    requested: results.length,
    completed: results.filter((result) => result.status === 'completed').length,
    bounded: results.filter((result) => result.status === 'bounded').length,
    failed: results.filter((result) => result.status === 'failed').length,
    totalActions: results.reduce((sum, result) => sum + result.actionCount, 0),
    resultsByModel,
    matches: results.map(({ canonical: _canonical, finalState: _finalState, error, ...result }) => ({
      ...result,
      ...(error ? { error: `${error.name}: ${error.message}` } : {}),
    })),
  };
}
