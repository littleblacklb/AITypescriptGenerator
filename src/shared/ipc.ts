import type {
  AppSettings,
  BatchSummary,
  BatchTaskWithJobs,
  CreateGenerateBatchInput,
  CreateRewriteBatchInput,
  ExportBatchResult,
  RewriteSource
} from './types';

export interface ArticleAppApi {
  settings: {
    get: () => Promise<AppSettings>;
    save: (settings: AppSettings) => Promise<AppSettings>;
  };
  generate: {
    createBatch: (input: CreateGenerateBatchInput) => Promise<BatchTaskWithJobs>;
    retryJob: (jobId: string) => Promise<BatchTaskWithJobs | null>;
    cancelBatch: (batchId: string) => Promise<BatchTaskWithJobs | null>;
  };
  rewrite: {
    selectSourceFiles: () => Promise<RewriteSource[]>;
    createBatch: (input: CreateRewriteBatchInput) => Promise<BatchTaskWithJobs>;
    retryJob: (jobId: string) => Promise<BatchTaskWithJobs | null>;
    cancelBatch: (batchId: string) => Promise<BatchTaskWithJobs | null>;
  };
  batches: {
    getBatch: (batchId: string) => Promise<BatchTaskWithJobs | null>;
  };
  exports: {
    selectDirectory: () => Promise<string | null>;
    exportBatch: (batchId: string) => Promise<ExportBatchResult>;
    openPath: (targetPath: string) => Promise<void>;
  };
  history: {
    list: () => Promise<BatchSummary[]>;
    getBatch: (batchId: string) => Promise<BatchTaskWithJobs | null>;
  };
}
