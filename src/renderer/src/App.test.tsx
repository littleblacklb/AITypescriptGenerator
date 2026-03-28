// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_GENERATE_OPTIONS, DEFAULT_REWRITE_OPTIONS, DEFAULT_SETTINGS } from '@shared/constants';
import type { ArticleAppApi } from '@shared/ipc';
import type { AppSettings, ArticleJob, BatchTaskWithJobs, SearchMetadata } from '@shared/types';

import App, { BatchWorkspace } from './App';

function createSettings(overrides?: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    apiBaseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'deepseek-key',
    model: 'deepseek-chat',
    ...overrides
  };
}

function createApi(settings: AppSettings): ArticleAppApi {
  return {
    settings: {
      get: vi.fn(async () => settings),
      save: vi.fn(async (value) => value)
    },
    generate: {
      createBatch: vi.fn(),
      retryJob: vi.fn(),
      cancelBatch: vi.fn()
    },
    rewrite: {
      selectSourceFiles: vi.fn(async () => []),
      createBatch: vi.fn(),
      retryJob: vi.fn(),
      cancelBatch: vi.fn()
    },
    batches: {
      getBatch: vi.fn()
    },
    exports: {
      selectDirectory: vi.fn(async () => null),
      exportBatch: vi.fn(),
      openPath: vi.fn()
    },
    history: {
      list: vi.fn(async () => []),
      getBatch: vi.fn(async () => null)
    }
  };
}

function createGenerateJob(searchMetadata: SearchMetadata): ArticleJob {
  return {
    id: 'job-1',
    batchId: 'batch-1',
    type: 'generate',
    title: '2026 年 AI 模型排行榜',
    sourceText: null,
    status: 'succeeded',
    resultText: '文章内容',
    errorMessage: null,
    createdAt: '2026-03-28T12:00:00.000Z',
    finishedAt: '2026-03-28T12:01:00.000Z',
    exportPath: null,
    metadata: {
      search: searchMetadata
    },
    orderIndex: 0,
    sourceFilePath: null
  };
}

function createGenerateBatch(job: ArticleJob): BatchTaskWithJobs {
  return {
    id: 'batch-1',
    type: 'generate',
    status: 'completed',
    totalCount: 1,
    successCount: 1,
    failedCount: 0,
    createdAt: '2026-03-28T12:00:00.000Z',
    finishedAt: '2026-03-28T12:01:00.000Z',
    exportDirectory: null,
    options: DEFAULT_GENERATE_OPTIONS,
    jobs: [job]
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('App settings and generate options', () => {
  it('renders and saves the Brave Search API key', async () => {
    const settings = createSettings();
    const articleApi = createApi(settings);
    window.articleApp = articleApi;

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /设置/ }));

    const braveInput = screen.getByLabelText('Brave Search API Key（可选）');
    fireEvent.change(braveInput, {
      target: {
        value: 'brave-live-key'
      }
    });

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => {
      expect(articleApi.settings.save).toHaveBeenCalledWith(
        expect.objectContaining({
          braveApiKey: 'brave-live-key'
        })
      );
    });
  });

  it('hydrates the fresh-search checkbox from persisted defaults', async () => {
    const settings = createSettings({
      defaultGenerateOptions: {
        ...DEFAULT_GENERATE_OPTIONS,
        freshSearchEnabled: false
      },
      defaultRewriteOptions: DEFAULT_REWRITE_OPTIONS
    });
    window.articleApp = createApi(settings);

    render(<App />);

    await screen.findByText('启用实时搜索（自动判断）');
    const checkboxLabel = screen.getByText('启用实时搜索（自动判断）').closest('label');
    const checkbox = checkboxLabel?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox?.checked).toBe(false);
  });
});

describe('BatchWorkspace search preview', () => {
  it('shows Brave source cards when grounding is used', () => {
    const searchMetadata: SearchMetadata = {
      provider: 'brave',
      status: 'used',
      query: '2026 年 AI 模型排行榜',
      triggerReason: '标题包含明确的时间表达',
      sources: [
        {
          title: '模型榜单',
          url: 'https://example.com/ranking',
          snippets: ['榜单摘要', '第二段摘录'],
          publishedAt: '2026-03-20'
        }
      ],
      errorMessage: null,
      fetchedAt: '2026-03-28T12:00:00.000Z'
    };
    const job = createGenerateJob(searchMetadata);

    render(
      <BatchWorkspace
        batch={createGenerateBatch(job)}
        selectedJobId={job.id}
        selection={job}
        onSelectJob={vi.fn()}
        onRetry={vi.fn(async () => undefined)}
        onCopy={vi.fn(async () => undefined)}
        onExport={vi.fn(async () => undefined)}
        onOpenPath={vi.fn(async () => undefined)}
      />
    );

    expect(screen.queryByText('实时检索')).not.toBeNull();
    expect(screen.queryByText('模型榜单')).not.toBeNull();
    expect(screen.queryByText('https://example.com/ranking')).not.toBeNull();
    expect(screen.queryByText('榜单摘要')).not.toBeNull();
  });

  it('shows a readable failed search state', () => {
    const searchMetadata: SearchMetadata = {
      provider: 'brave',
      status: 'failed',
      query: '最新 AI 模型价格对比',
      triggerReason: '标题包含最新或当前类表述',
      sources: [],
      errorMessage: 'Brave 检索失败（HTTP 500）',
      fetchedAt: '2026-03-28T12:00:00.000Z'
    };
    const job = createGenerateJob(searchMetadata);

    render(
      <BatchWorkspace
        batch={createGenerateBatch(job)}
        selectedJobId={job.id}
        selection={job}
        onSelectJob={vi.fn()}
        onRetry={vi.fn(async () => undefined)}
        onCopy={vi.fn(async () => undefined)}
        onExport={vi.fn(async () => undefined)}
        onOpenPath={vi.fn(async () => undefined)}
      />
    );

    expect(screen.queryByText('状态：检索失败')).not.toBeNull();
    expect(screen.queryByText('Brave 检索失败（HTTP 500）')).not.toBeNull();
  });
});
