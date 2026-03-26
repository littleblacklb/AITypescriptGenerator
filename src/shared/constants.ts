import type { AppSettings, GenerateOptions, RewriteOptions, RewriteStrength } from './types';

export const APP_NAME = 'Batch Article Generator';
export const TITLE_LIMIT = 120;
export const SOURCE_TEXT_MIN_LENGTH = 80;
export const HISTORY_LIMIT = 20;
export const MIN_CONCURRENT_JOBS = 1;
export const MAX_CONCURRENT_JOBS = 8;
export const DEFAULT_MAX_CONCURRENT_JOBS = 2;

export const STYLE_PRESETS = ['资讯解读', '观点评论', '故事化表达', '实用指南'];
export const TONE_PRESETS = ['专业稳健', '亲切自然', '冷静客观', '有力鲜明'];
export const REWRITE_STRENGTH_OPTIONS: RewriteStrength[] = ['light', 'balanced', 'strong'];

export const DEFAULT_GENERATE_OPTIONS: GenerateOptions = {
  targetLength: 1200,
  stylePreset: STYLE_PRESETS[0],
  tonePreset: TONE_PRESETS[0],
  openingHookEnabled: true,
  avoidTerms: '绝对、震惊、内幕、必看'
};

export const DEFAULT_REWRITE_OPTIONS: RewriteOptions = {
  ...DEFAULT_GENERATE_OPTIONS,
  targetLength: 1000,
  rewriteStrength: 'balanced',
  preserveOriginalMeaning: true
};

export const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  timeoutMs: 60000,
  retryCount: 1,
  maxConcurrentJobs: DEFAULT_MAX_CONCURRENT_JOBS,
  defaultExportDir: '',
  defaultGenerateOptions: DEFAULT_GENERATE_OPTIONS,
  defaultRewriteOptions: DEFAULT_REWRITE_OPTIONS
};

function normalizeConcurrentJobs(value: unknown): number {
  const numericValue = Math.trunc(Number(value));
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_MAX_CONCURRENT_JOBS;
  }

  return Math.min(MAX_CONCURRENT_JOBS, Math.max(MIN_CONCURRENT_JOBS, numericValue));
}

export function mergeGenerateOptions(input?: Partial<GenerateOptions>): GenerateOptions {
  return {
    ...DEFAULT_GENERATE_OPTIONS,
    ...input
  };
}

export function mergeRewriteOptions(input?: Partial<RewriteOptions>): RewriteOptions {
  return {
    ...DEFAULT_REWRITE_OPTIONS,
    ...input
  };
}

export function mergeSettings(input?: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...input,
    maxConcurrentJobs: normalizeConcurrentJobs(input?.maxConcurrentJobs),
    defaultGenerateOptions: mergeGenerateOptions(input?.defaultGenerateOptions),
    defaultRewriteOptions: mergeRewriteOptions(input?.defaultRewriteOptions)
  };
}
