import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_GENERATE_OPTIONS, DEFAULT_REWRITE_OPTIONS, DEFAULT_SETTINGS } from '../../../shared/constants';
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
      generateArticle: vi.fn(
        async (
          title: string,
          _settings: AppSettings,
          _options: typeof DEFAULT_GENERATE_OPTIONS,
          _searchMetadata: unknown,
          _signal?: AbortSignal
        ) => {
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
      }
      ),
      rewriteArticle: vi.fn()
    };

    const taskManager = new TaskManager(
      database as unknown as ConstructorParameters<typeof TaskManager>[0],
      llmService as unknown as ConstructorParameters<typeof TaskManager>[1],
      {} as ConstructorParameters<typeof TaskManager>[2],
      {
        searchGenerateGrounding: vi.fn(async () => ({
          provider: 'brave',
          status: 'skipped',
          query: null,
          triggerReason: '未配置 Brave Search API Key',
          sources: [],
          errorMessage: null,
          fetchedAt: null
        }))
      } as unknown as ConstructorParameters<typeof TaskManager>[3]
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
      generateArticle: vi.fn(
        async (
          title: string,
          _settings: AppSettings,
          _options: typeof DEFAULT_GENERATE_OPTIONS,
          _searchMetadata: unknown,
          signal?: AbortSignal
        ) => {
          started.push(title);
          await waitForSignal(signal, new Promise<void>(() => undefined));
          return {
            content: `${title} result`,
            metadata: {}
          };
        }
      ),
      rewriteArticle: vi.fn()
    };

    const taskManager = new TaskManager(
      database as unknown as ConstructorParameters<typeof TaskManager>[0],
      llmService as unknown as ConstructorParameters<typeof TaskManager>[1],
      {} as ConstructorParameters<typeof TaskManager>[2],
      {
        searchGenerateGrounding: vi.fn(async () => ({
          provider: 'brave',
          status: 'skipped',
          query: null,
          triggerReason: '未配置 Brave Search API Key',
          sources: [],
          errorMessage: null,
          fetchedAt: null
        }))
      } as unknown as ConstructorParameters<typeof TaskManager>[3]
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

  it('calls Brave search only once per generate job and reuses it across LLM retries', async () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      braveApiKey: 'brave-key',
      model: 'test-model',
      maxConcurrentJobs: 1,
      retryCount: 1
    };
    const database = new FakeDatabaseService(settings);
    const searchService = {
      searchGenerateGrounding: vi.fn(async () => ({
        provider: 'brave' as const,
        status: 'used' as const,
        query: '2026 年 AI 模型排行榜',
        triggerReason: '标题包含明确的时间表达',
        sources: [
          {
            title: '模型榜单',
            url: 'https://example.com/ranking',
            snippets: ['榜单摘要'],
            publishedAt: '2026-03-20'
          }
        ],
        errorMessage: null,
        fetchedAt: '2026-03-28T12:00:00.000Z'
      }))
    };
    const llmService = {
      generateArticle: vi
        .fn()
        .mockRejectedValueOnce(new Error('temporary failure'))
        .mockResolvedValueOnce({
          content: '最终文章',
          metadata: {}
        }),
      rewriteArticle: vi.fn()
    };

    const taskManager = new TaskManager(
      database as unknown as ConstructorParameters<typeof TaskManager>[0],
      llmService as unknown as ConstructorParameters<typeof TaskManager>[1],
      {} as ConstructorParameters<typeof TaskManager>[2],
      searchService as unknown as ConstructorParameters<typeof TaskManager>[3]
    );

    const batch = await taskManager.createGenerateBatch({
      titles: ['2026 年 AI 模型排行榜'],
      options: DEFAULT_GENERATE_OPTIONS
    });

    await waitForCondition(async () => {
      const nextBatch = await taskManager.getBatch(batch.id);
      expect(nextBatch?.status).toBe('completed');
      expect(nextBatch?.jobs[0]?.resultText).toBe('最终文章');
    });

    expect(searchService.searchGenerateGrounding).toHaveBeenCalledTimes(1);
    expect(llmService.generateArticle).toHaveBeenCalledTimes(2);
  });

  it('falls back to normal generation when Brave search fails', async () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      braveApiKey: 'brave-key',
      model: 'test-model',
      maxConcurrentJobs: 1
    };
    const database = new FakeDatabaseService(settings);
    const searchService = {
      searchGenerateGrounding: vi.fn(async () => ({
        provider: 'brave' as const,
        status: 'failed' as const,
        query: '最新 AI 模型价格对比',
        triggerReason: '标题包含最新或当前类表述',
        sources: [],
        errorMessage: 'Brave 检索失败（HTTP 500）',
        fetchedAt: '2026-03-28T12:00:00.000Z'
      }))
    };
    const llmService = {
      generateArticle: vi.fn(async () => ({
        content: '即使检索失败也成功生成',
        metadata: {}
      })),
      rewriteArticle: vi.fn()
    };

    const taskManager = new TaskManager(
      database as unknown as ConstructorParameters<typeof TaskManager>[0],
      llmService as unknown as ConstructorParameters<typeof TaskManager>[1],
      {} as ConstructorParameters<typeof TaskManager>[2],
      searchService as unknown as ConstructorParameters<typeof TaskManager>[3]
    );

    const batch = await taskManager.createGenerateBatch({
      titles: ['最新 AI 模型价格对比'],
      options: DEFAULT_GENERATE_OPTIONS
    });

    await waitForCondition(async () => {
      const nextBatch = await taskManager.getBatch(batch.id);
      expect(nextBatch?.status).toBe('completed');
      expect(nextBatch?.jobs[0]?.metadata?.search?.status).toBe('failed');
    });
  });

  it('does not call Brave search for rewrite jobs', async () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      apiKey: 'test-key',
      braveApiKey: 'brave-key',
      model: 'test-model',
      maxConcurrentJobs: 1
    };
    const database = new FakeDatabaseService(settings);
    const searchService = {
      searchGenerateGrounding: vi.fn()
    };
    const llmService = {
      generateArticle: vi.fn(),
      rewriteArticle: vi.fn(async () => ({
        content: '改写结果',
        metadata: {}
      }))
    };

    const taskManager = new TaskManager(
      database as unknown as ConstructorParameters<typeof TaskManager>[0],
      llmService as unknown as ConstructorParameters<typeof TaskManager>[1],
      {} as ConstructorParameters<typeof TaskManager>[2],
      searchService as unknown as ConstructorParameters<typeof TaskManager>[3]
    );

    const batch = await taskManager.createRewriteBatch({
      sources: [
        {
          filePath: '/tmp/source.txt',
          fileName: 'source.txt',
          title: '原始标题',
          sourceText: '这是一段足够长的原始文本内容，用来验证改写流程不会触发 Brave 检索服务。',
          errorMessage: null
        }
      ],
      options: DEFAULT_REWRITE_OPTIONS
    });

    await waitForCondition(async () => {
      const nextBatch = await taskManager.getBatch(batch.id);
      expect(nextBatch?.status).toBe('completed');
    });

    expect(searchService.searchGenerateGrounding).not.toHaveBeenCalled();
  });
});
