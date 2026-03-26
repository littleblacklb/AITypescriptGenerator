export type BatchType = 'generate' | 'rewrite';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type BatchStatus = 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'cancelled';
export type RewriteStrength = 'light' | 'balanced' | 'strong';

export interface GenerateOptions {
  targetLength: number;
  stylePreset: string;
  tonePreset: string;
  openingHookEnabled: boolean;
  avoidTerms: string;
}

export interface RewriteOptions extends GenerateOptions {
  rewriteStrength: RewriteStrength;
  preserveOriginalMeaning: boolean;
}

export interface AppSettings {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  retryCount: number;
  maxConcurrentJobs: number;
  defaultExportDir: string;
  defaultGenerateOptions: GenerateOptions;
  defaultRewriteOptions: RewriteOptions;
}

export interface ArticleJob {
  id: string;
  batchId: string;
  type: BatchType;
  title: string;
  sourceText: string | null;
  status: JobStatus;
  resultText: string | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
  exportPath: string | null;
  metadata: Record<string, unknown> | null;
  orderIndex: number;
  sourceFilePath: string | null;
}

export interface BatchTask {
  id: string;
  type: BatchType;
  status: BatchStatus;
  totalCount: number;
  successCount: number;
  failedCount: number;
  createdAt: string;
  finishedAt: string | null;
  exportDirectory: string | null;
  options: GenerateOptions | RewriteOptions;
}

export interface BatchTaskWithJobs extends BatchTask {
  jobs: ArticleJob[];
}

export interface BatchSummary {
  id: string;
  type: BatchType;
  status: BatchStatus;
  totalCount: number;
  successCount: number;
  failedCount: number;
  createdAt: string;
  finishedAt: string | null;
  exportDirectory: string | null;
}

export interface RewriteSource {
  filePath: string;
  fileName: string;
  title: string;
  sourceText: string;
  errorMessage: string | null;
}

export interface ExportBatchResult {
  batchId: string;
  directoryPath: string;
  exportedCount: number;
  skippedCount: number;
}

export interface CreateGenerateBatchInput {
  titles: string[];
  options: GenerateOptions;
}

export interface CreateRewriteBatchInput {
  sources: RewriteSource[];
  options: RewriteOptions;
}
