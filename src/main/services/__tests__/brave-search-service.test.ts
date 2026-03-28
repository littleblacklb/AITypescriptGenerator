import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_GENERATE_OPTIONS, DEFAULT_SETTINGS } from '../../../shared/constants';
import type { AppSettings } from '../../../shared/types';
import {
  BraveSearchService,
  buildBraveSearchRequestPayload,
  resolveFreshSearchTriggerReason,
  resolveSearchLocale
} from '../brave-search-service';

function createSettings(overrides?: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    braveApiKey: 'brave-key',
    ...overrides
  };
}

function createJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fresh search heuristics', () => {
  it('triggers for date-sensitive titles', () => {
    expect(resolveFreshSearchTriggerReason('2026 年 AI 模型排行榜')).toBe('标题包含明确的时间表达');
  });

  it('triggers for fact-sensitive titles', () => {
    expect(resolveFreshSearchTriggerReason('最新 AI 模型价格对比')).toBeTruthy();
  });

  it('skips evergreen titles', () => {
    expect(resolveFreshSearchTriggerReason('如何提升写作表达能力')).toBeNull();
  });

  it('switches locale for CJK titles only', () => {
    expect(resolveSearchLocale('2026 年 AI 模型排行榜')).toEqual({
      country: 'cn',
      search_lang: 'zh-hans'
    });
    expect(resolveSearchLocale('latest ai model rankings')).toEqual({});
  });

  it('builds the Brave request body with q and the normalized locale', () => {
    expect(buildBraveSearchRequestPayload('2026 年 AI 模型排行榜')).toEqual({
      q: '2026 年 AI 模型排行榜',
      count: 5,
      maximum_number_of_urls: 3,
      maximum_number_of_tokens: 2048,
      maximum_number_of_snippets: 9,
      context_threshold_mode: 'balanced',
      country: 'cn',
      search_lang: 'zh-hans'
    });
  });
});

describe('BraveSearchService', () => {
  it('maps Brave grounding results into stable search metadata', async () => {
    const service = new BraveSearchService();
    const fetchMock = vi.fn(async () =>
      createJsonResponse(200, {
        grounding: {
          generic: [
            {
              url: 'https://example.com/ranking',
              title: '模型榜单',
              snippets: ['摘要一', '摘要二']
            }
          ]
        },
        sources: {
          'https://example.com/ranking': {
            title: '模型榜单',
            age: ['Friday, March 20, 2026', '2026-03-20', '8 days ago']
          }
        }
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    const result = await service.searchGenerateGrounding(
      '2026 年 AI 模型排行榜',
      createSettings(),
      DEFAULT_GENERATE_OPTIONS
    );

    expect(result).toEqual({
      provider: 'brave',
      status: 'used',
      query: '2026 年 AI 模型排行榜',
      triggerReason: '标题包含明确的时间表达',
      sources: [
        {
          title: '模型榜单',
          url: 'https://example.com/ranking',
          snippets: ['摘要一', '摘要二'],
          publishedAt: '2026-03-20'
        }
      ],
      errorMessage: null,
      fetchedAt: expect.any(String)
    });
  });

  it('skips search when Brave returns no usable grounding', async () => {
    const service = new BraveSearchService();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        createJsonResponse(200, {
          grounding: {
            generic: []
          },
          sources: {}
        })
      )
    );

    const result = await service.searchGenerateGrounding(
      '2026 年 AI 模型排行榜',
      createSettings(),
      DEFAULT_GENERATE_OPTIONS
    );

    expect(result.status).toBe('skipped');
    expect(result.errorMessage).toBe('未检索到足够相关的资料');
  });

  it('retries once for retryable HTTP responses', async () => {
    const service = new BraveSearchService();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse(429, { message: 'Too many requests' }))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          grounding: {
            generic: [
              {
                url: 'https://example.com/pricing',
                title: '价格数据',
                snippets: ['最新价格区间']
              }
            ]
          },
          sources: {
            'https://example.com/pricing': {
              age: ['2026-03-18']
            }
          }
        })
      );

    vi.stubGlobal('fetch', fetchMock);

    const result = await service.searchGenerateGrounding('最新 AI 模型价格对比', createSettings(), DEFAULT_GENERATE_OPTIONS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('used');
  });

  it('passes CJK locale hints to Brave requests', async () => {
    const service = new BraveSearchService();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));

      expect(body.q).toBe('2026 年 AI 模型排行榜');
      expect(body.country).toBe('cn');
      expect(body.search_lang).toBe('zh-hans');

      return createJsonResponse(200, {
        grounding: {
          generic: []
        },
        sources: {}
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    await service.searchGenerateGrounding('2026 年 AI 模型排行榜', createSettings(), DEFAULT_GENERATE_OPTIONS);
  });

  it('cancels cleanly when the abort signal fires', async () => {
    const service = new BraveSearchService();
    const controller = new AbortController();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const requestSignal = init?.signal as AbortSignal | undefined;

      return new Promise<Response>((_resolve, reject) => {
        if (requestSignal?.aborted) {
          const abortError = new Error('aborted');
          abortError.name = 'AbortError';
          reject(abortError);
          return;
        }

        requestSignal?.addEventListener(
          'abort',
          () => {
            const abortError = new Error('aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          },
          { once: true }
        );
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const promise = service.searchGenerateGrounding(
      '2026 年 AI 模型排行榜',
      createSettings(),
      DEFAULT_GENERATE_OPTIONS,
      controller.signal
    );

    controller.abort();

    await expect(promise).rejects.toMatchObject({
      name: 'AbortError'
    });
  });

  it('surfaces nested validation errors from Brave responses', async () => {
    const service = new BraveSearchService();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        createJsonResponse(422, {
          error: {
            detail: 'Unable to validate request parameter(s)',
            meta: {
              errors: [
                {
                  loc: ['body', 'q'],
                  msg: 'Field required'
                },
                {
                  loc: ['body', 'search_lang'],
                  msg: "Input should be 'zh-hans' or 'zh-hant'"
                }
              ]
            }
          }
        })
      )
    );

    const result = await service.searchGenerateGrounding(
      '2026 年 AI 模型排行榜',
      createSettings(),
      DEFAULT_GENERATE_OPTIONS
    );

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('body.q: Field required');
    expect(result.errorMessage).toContain("body.search_lang: Input should be 'zh-hans' or 'zh-hant'");
  });
});
