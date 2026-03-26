import { randomUUID } from 'node:crypto';

import { mergeGenerateOptions, mergeRewriteOptions } from '@shared/constants';
import type {
  AppSettings,
  ArticleJob,
  BatchStatus,
  BatchSummary,
  BatchTask,
  BatchTaskWithJobs,
  CreateGenerateBatchInput,
  CreateRewriteBatchInput,
  ExportBatchResult
} from '@shared/types';

import { DatabaseService } from './database';
import { FileService } from './file-service';
import { LlmService } from './llm-service';

interface RuntimeBatchState {
  batch: BatchTask;
  jobs: ArticleJob[];
  settings: AppSettings;
  cancelRequested: boolean;
  running: boolean;
  activeControllers: Map<string, AbortController>;
}

export class TaskManager {
  private readonly batches = new Map<string, RuntimeBatchState>();

  constructor(
    private readonly database: DatabaseService,
    private readonly llmService: LlmService,
    private readonly fileService: FileService
  ) {}

  async createGenerateBatch(input: CreateGenerateBatchInput): Promise<BatchTaskWithJobs> {
    const settings = await this.database.getSettings();
    this.assertReadySettings(settings);

    const titles = input.titles.map((title) => title.trim()).filter(Boolean);
    if (titles.length === 0) {
      throw new Error('请至少输入一个标题');
    }

    const now = new Date().toISOString();
    const batchId = randomUUID();
    const jobs = titles.map((title, index) => this.createJob(batchId, 'generate', title, null, index));
    const batch: BatchTask = {
      id: batchId,
      type: 'generate',
      status: 'queued',
      totalCount: jobs.length,
      successCount: 0,
      failedCount: 0,
      createdAt: now,
      finishedAt: null,
      exportDirectory: null,
      options: mergeGenerateOptions(input.options)
    };

    const state: RuntimeBatchState = {
      batch,
      jobs,
      settings,
      cancelRequested: false,
      running: false,
      activeControllers: new Map()
    };

    this.batches.set(batchId, state);
    await this.database.insertBatch(this.snapshot(state));
    void this.runBatch(batchId);
    return this.snapshot(state);
  }

  async createRewriteBatch(input: CreateRewriteBatchInput): Promise<BatchTaskWithJobs> {
    const settings = await this.database.getSettings();
    this.assertReadySettings(settings);

    if (input.sources.length === 0) {
      throw new Error('请先导入至少一个 TXT 文件');
    }

    const now = new Date().toISOString();
    const batchId = randomUUID();

    const jobs = input.sources.map((source, index) => {
      const job = this.createJob(batchId, 'rewrite', source.title, source.sourceText, index, source.filePath);
      if (source.errorMessage) {
        job.status = 'failed';
        job.errorMessage = source.errorMessage;
        job.finishedAt = now;
      }
      return job;
    });

    const batch: BatchTask = {
      id: batchId,
      type: 'rewrite',
      status: jobs.some((job) => job.status === 'queued') ? 'queued' : 'completed_with_errors',
      totalCount: jobs.length,
      successCount: 0,
      failedCount: jobs.filter((job) => job.status === 'failed').length,
      createdAt: now,
      finishedAt: jobs.some((job) => job.status === 'queued') ? null : now,
      exportDirectory: null,
      options: mergeRewriteOptions(input.options)
    };

    const state: RuntimeBatchState = {
      batch,
      jobs,
      settings,
      cancelRequested: false,
      running: false,
      activeControllers: new Map()
    };

    this.batches.set(batchId, state);
    await this.database.insertBatch(this.snapshot(state));

    if (jobs.some((job) => job.status === 'queued')) {
      void this.runBatch(batchId);
    }

    return this.snapshot(state);
  }

  async retryJob(jobId: string): Promise<BatchTaskWithJobs | null> {
    const state = this.findBatchByJobId(jobId);
    if (!state) {
      return null;
    }

    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) {
      return null;
    }

    if (job.status === 'running') {
      throw new Error('当前任务正在执行，不能重复重试');
    }

    state.cancelRequested = false;
    job.status = 'queued';
    job.resultText = null;
    job.errorMessage = null;
    job.finishedAt = null;
    job.exportPath = null;
    job.metadata = null;

    state.batch.finishedAt = null;
    this.refreshCounts(state);
    state.batch.status = 'running';

    await this.database.updateBatchAndJobs(state.batch, state.jobs);
    void this.runBatch(state.batch.id);
    return this.snapshot(state);
  }

  async cancelBatch(batchId: string): Promise<BatchTaskWithJobs | null> {
    const state = this.batches.get(batchId);
    if (!state) {
      return this.database.getBatchById(batchId);
    }

    state.cancelRequested = true;
    for (const controller of state.activeControllers.values()) {
      controller.abort(new Error('cancelled'));
    }

    if (!state.running) {
      for (const job of state.jobs) {
        if (job.status === 'queued') {
          job.status = 'cancelled';
          job.finishedAt = new Date().toISOString();
          job.errorMessage = '任务已取消';
        }
      }

      state.batch.status = 'cancelled';
      state.batch.finishedAt = new Date().toISOString();
      this.refreshCounts(state);
      await this.database.updateBatchAndJobs(state.batch, state.jobs);
    }

    return this.snapshot(state);
  }

  async getBatch(batchId: string): Promise<BatchTaskWithJobs | null> {
    const state = this.batches.get(batchId);
    if (state) {
      return this.snapshot(state);
    }

    return this.database.getBatchById(batchId);
  }

  async listHistory(): Promise<BatchSummary[]> {
    return this.database.listBatches();
  }

  async exportBatch(batchId: string): Promise<ExportBatchResult> {
    const batch = await this.getBatch(batchId);
    if (!batch) {
      throw new Error('未找到批次');
    }

    const hasSuccessfulJobs = batch.jobs.some((job) => job.status === 'succeeded' && job.resultText);
    if (!hasSuccessfulJobs) {
      throw new Error('当前批次没有可导出的文章');
    }

    const settings = await this.database.getSettings();
    const baseDirectory = settings.defaultExportDir || (await this.fileService.selectDirectory());
    if (!baseDirectory) {
      throw new Error('未选择导出目录');
    }

    const result = await this.fileService.writeBatchFiles({
      batchId: batch.id,
      batchType: batch.type,
      baseDirectory,
      jobs: batch.jobs
    });

    for (const item of result.jobExports) {
      const job = batch.jobs.find((entry) => entry.id === item.jobId);
      if (job) {
        job.exportPath = item.filePath;
      }
    }

    batch.exportDirectory = result.directoryPath;
    await this.database.updateBatchAndJobs(batch, batch.jobs);

    const runtimeState = this.batches.get(batchId);
    if (runtimeState) {
      runtimeState.batch.exportDirectory = result.directoryPath;
      runtimeState.jobs = batch.jobs;
    }

    return result;
  }

  async selectExportDirectory(): Promise<string | null> {
    const settings = await this.database.getSettings();
    return this.fileService.selectDirectory(settings.defaultExportDir);
  }

  async openPath(targetPath: string): Promise<void> {
    await this.fileService.openPath(targetPath);
  }

  private async runBatch(batchId: string): Promise<void> {
    const state = this.batches.get(batchId);
    if (!state || state.running) {
      return;
    }

    state.running = true;
    state.batch.status = 'running';
    state.batch.finishedAt = null;
    await this.database.updateBatch(state.batch);

    try {
      const workerCount = this.getWorkerCount(state);
      await Promise.all(Array.from({ length: workerCount }, () => this.runWorker(state)));

      if (state.cancelRequested) {
        for (const job of state.jobs) {
          if (job.status === 'queued') {
            job.status = 'cancelled';
            job.errorMessage = '任务已取消';
            job.finishedAt = new Date().toISOString();
          }
        }
      }

      if (!state.cancelRequested && state.jobs.some((job) => job.status === 'queued')) {
        this.refreshCounts(state);
        state.batch.status = 'running';
        state.batch.finishedAt = null;
        await this.database.updateBatch(state.batch);
        return;
      }

      this.refreshCounts(state);
      state.batch.finishedAt = new Date().toISOString();
      state.batch.status = this.resolveBatchStatus(state);
      await this.database.updateBatchAndJobs(state.batch, state.jobs);
    } finally {
      state.activeControllers.clear();
      state.running = false;

      if (!state.cancelRequested && state.jobs.some((job) => job.status === 'queued')) {
        void this.runBatch(batchId);
      }
    }
  }

  private async runWorker(state: RuntimeBatchState): Promise<void> {
    while (!state.cancelRequested) {
      const job = state.jobs.find((item) => item.status === 'queued');
      if (!job) {
        return;
      }

      await this.executeJob(state, job);
    }
  }

  private async executeJob(state: RuntimeBatchState, job: ArticleJob): Promise<void> {
    const maxAttempts = Math.max(1, state.settings.retryCount + 1);
    let attempt = 0;
    let lastError: Error | null = null;

    job.status = 'running';
    job.errorMessage = null;
    job.finishedAt = null;
    await this.database.updateJob(job);

    while (attempt < maxAttempts) {
      attempt += 1;
      const controller = new AbortController();
      state.activeControllers.set(job.id, controller);

      try {
        const result =
          job.type === 'generate'
            ? await this.llmService.generateArticle(
                job.title,
                state.settings,
                mergeGenerateOptions(state.batch.options),
                controller.signal
              )
            : await this.llmService.rewriteArticle(
                job.title,
                job.sourceText ?? '',
                state.settings,
                mergeRewriteOptions(state.batch.options),
                controller.signal
              );

        job.status = 'succeeded';
        job.resultText = result.content;
        job.metadata = {
          ...result.metadata,
          attempt
        };
        job.finishedAt = new Date().toISOString();
        await this.persistTerminalJobState(state, job);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('任务执行失败');
        if (controller.signal.aborted || state.cancelRequested) {
          job.status = 'cancelled';
          job.errorMessage = '任务已取消';
          job.finishedAt = new Date().toISOString();
          await this.persistTerminalJobState(state, job);
          return;
        }

        if (attempt >= maxAttempts) {
          job.status = 'failed';
          job.errorMessage = lastError.message;
          job.finishedAt = new Date().toISOString();
          await this.persistTerminalJobState(state, job);
          return;
        }
      } finally {
        state.activeControllers.delete(job.id);
      }
    }

    job.status = 'failed';
    job.errorMessage = lastError?.message ?? '任务执行失败';
    job.finishedAt = new Date().toISOString();
    await this.persistTerminalJobState(state, job);
  }

  private async persistTerminalJobState(state: RuntimeBatchState, job: ArticleJob): Promise<void> {
    await this.database.updateJob(job);
    this.refreshCounts(state);
    await this.database.updateBatch(state.batch);
  }

  private getWorkerCount(state: RuntimeBatchState): number {
    const queuedCount = state.jobs.filter((job) => job.status === 'queued').length;
    return Math.max(1, Math.min(state.settings.maxConcurrentJobs, queuedCount || 1));
  }

  private resolveBatchStatus(state: RuntimeBatchState): BatchStatus {
    if (state.cancelRequested) {
      return 'cancelled';
    }

    const hasFailures = state.jobs.some((job) => job.status === 'failed');
    const hasCancellations = state.jobs.some((job) => job.status === 'cancelled');

    if (hasFailures || hasCancellations) {
      return 'completed_with_errors';
    }

    return 'completed';
  }

  private refreshCounts(state: RuntimeBatchState): void {
    state.batch.successCount = state.jobs.filter((job) => job.status === 'succeeded').length;
    state.batch.failedCount = state.jobs.filter((job) => job.status === 'failed').length;
  }

  private findBatchByJobId(jobId: string): RuntimeBatchState | null {
    for (const state of this.batches.values()) {
      if (state.jobs.some((job) => job.id === jobId)) {
        return state;
      }
    }

    return null;
  }

  private createJob(
    batchId: string,
    type: ArticleJob['type'],
    title: string,
    sourceText: string | null,
    orderIndex: number,
    sourceFilePath: string | null = null
  ): ArticleJob {
    return {
      id: randomUUID(),
      batchId,
      type,
      title,
      sourceText,
      status: 'queued',
      resultText: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      exportPath: null,
      metadata: null,
      orderIndex,
      sourceFilePath
    };
  }

  private snapshot(state: RuntimeBatchState): BatchTaskWithJobs {
    return {
      ...structuredClone(state.batch),
      jobs: structuredClone(state.jobs)
    };
  }

  private assertReadySettings(settings: AppSettings): void {
    if (!settings.apiBaseUrl.trim()) {
      throw new Error('请先在设置页填写 API Base URL');
    }

    if (!settings.apiKey.trim()) {
      throw new Error('请先在设置页填写 API Key');
    }

    if (!settings.model.trim()) {
      throw new Error('请先在设置页填写模型名称');
    }
  }
}
