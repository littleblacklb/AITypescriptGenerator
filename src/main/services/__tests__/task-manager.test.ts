import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_GENERATE_OPTIONS, DEFAULT_SETTINGS } from '../../../shared/constants';
import type { AppSettings, ArticleJob, BatchSummary, BatchTask, BatchTaskWithJobs } from '../../../shared/types';
import { TaskManager } from '../task-manager';

class FakeDatabaseService {
  private batch: BatchTaskWithJobs | null = null;

  constructor(private readonly settings: AppSettings) {}

  async getSettings(): Promise<AppSettings> {
    return structuredClone(this.settings);
  }

  async insertBatch(batch: BatchTaskWithJobs): Promise<void> {
    this.batch = structuredClone(batch);
  }

  async updateBatch(batch: BatchTask): Promise<void> {
    if (!this.batch) {
      throw new Error('missing batch');
    }

    this.batch = {
      ...structuredClone(batch),
      jobs: this.batch.jobs
    };
  }

  async updateJob(job: ArticleJob): Promise<void> {
    if (!this.batch) {
      throw new Error('missing batch');
    }

    this.batch = {
      ...this.batch,
      jobs: this.batch.jobs.map((item) => (item.id === job.id ? structuredClone(job) : item))
    };
  }

  async updateBatchAndJobs(batch: BatchTask, jobs: ArticleJob[]): Promise<void> {
    this.batch = {
      ...structuredClone(batch),
      jobs: structuredClone(jobs)
    };
  }

  async getBatchById(batchId: string): Promise<BatchTaskWithJobs | null> {
    if (!this.batch || this.batch.id !== batchId) {
      return null;
    }

    return structuredClone(this.batch);
  }

  async listBatches(): Promise<BatchSummary[]> {
    if (!this.batch) {
      return [];
    }

    return [
      {
        id: this.batch.id,
        type: this.batch.type,
        status: this.batch.status,
        totalCount: this.batch.totalCount,
        successCount: this.batch.successCount,
        failedCount: this.batch.failedCount,
        createdAt: this.batch.createdAt,
        finishedAt: this.batch.finishedAt,
        exportDirectory: this.batch.exportDirectory
      }
    ];
  }
}

function createGate(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = () => undefined;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve
  };
}

function waitForSignal(signal: AbortSignal | undefined, gate: Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const handleAbort = () => {
      reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'));
    };

    signal?.addEventListener('abort', handleAbort, { once: true });

    gate
      .then(resolve, reject)
      .finally(() => signal?.removeEventListener('abort', handleAbort));
  });
}

async function waitForCondition(
  assertion: () => void | Promise<void>,
  timeoutMs = 2000,
  intervalMs = 20
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  await assertion();
}

describe('TaskManager concurrency', () => {
  it('runs up to maxConcurrentJobs jobs at the same time', async () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      model: 'test-model',
      maxConcurrentJobs: 2
    };
    const database = new FakeDatabaseService(settings);
    const gates = new Map<string, ReturnType<typeof createGate>>();
    const started: string[] = [];
    let activeCount = 0;
    let peakActiveCount = 0;

    const llmService = {
      generateArticle: vi.fn(async (title: string, _settings: AppSettings, _options: typeof DEFAULT_GENERATE_OPTIONS) => {
        activeCount += 1;
        peakActiveCount = Math.max(peakActiveCount, activeCount);
        started.push(title);

        const gate = createGate();
        gates.set(title, gate);
        await gate.promise;

        activeCount -= 1;
        return {
          content: `${title} result`,
          metadata: {}
        };
      }),
      rewriteArticle: vi.fn()
    };

    const taskManager = new TaskManager(
      database as unknown as ConstructorParameters<typeof TaskManager>[0],
      llmService as unknown as ConstructorParameters<typeof TaskManager>[1],
      {} as ConstructorParameters<typeof TaskManager>[2]
    );

    const batch = await taskManager.createGenerateBatch({
      titles: ['标题 A', '标题 B', '标题 C'],
      options: DEFAULT_GENERATE_OPTIONS
    });

    await waitForCondition(() => {
      expect(started).toEqual(['标题 A', '标题 B']);
    });
    expect(peakActiveCount).toBe(2);

    gates.get('标题 A')?.resolve();

    await waitForCondition(() => {
      expect(started).toContain('标题 C');
    });
    expect(peakActiveCount).toBe(2);

    gates.get('标题 B')?.resolve();
    gates.get('标题 C')?.resolve();

    await waitForCondition(async () => {
      const nextBatch = await taskManager.getBatch(batch.id);
      expect(nextBatch?.status).toBe('completed');
      expect(nextBatch?.successCount).toBe(3);
    });
  });

  it('cancels all in-flight jobs in a concurrent batch', async () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      model: 'test-model',
      maxConcurrentJobs: 2
    };
    const database = new FakeDatabaseService(settings);
    const started: string[] = [];

    const llmService = {
      generateArticle: vi.fn(async (title: string, _settings: AppSettings, _options: typeof DEFAULT_GENERATE_OPTIONS, signal?: AbortSignal) => {
        started.push(title);
        await waitForSignal(signal, new Promise<void>(() => undefined));
        return {
          content: `${title} result`,
          metadata: {}
        };
      }),
      rewriteArticle: vi.fn()
    };

    const taskManager = new TaskManager(
      database as unknown as ConstructorParameters<typeof TaskManager>[0],
      llmService as unknown as ConstructorParameters<typeof TaskManager>[1],
      {} as ConstructorParameters<typeof TaskManager>[2]
    );

    const batch = await taskManager.createGenerateBatch({
      titles: ['标题 A', '标题 B', '标题 C'],
      options: DEFAULT_GENERATE_OPTIONS
    });

    await waitForCondition(() => {
      expect(started).toHaveLength(2);
    });

    await taskManager.cancelBatch(batch.id);

    await waitForCondition(async () => {
      const nextBatch = await taskManager.getBatch(batch.id);
      expect(nextBatch?.status).toBe('cancelled');
      expect(nextBatch?.jobs.every((job) => job.status === 'cancelled')).toBe(true);
    });
  });
});
