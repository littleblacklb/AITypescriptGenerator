import type { AppSettings, GenerateOptions, SearchMetadata, SearchSource } from '@shared/types';

export const BRAVE_LLM_CONTEXT_ENDPOINT = 'https://api.search.brave.com/res/v1/llm/context';
const MAX_CONCURRENT_REQUESTS = 2;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAY_MS = 500;

const DATE_PATTERNS = [
  /\b(?:19|20)\d{2}\b/,
  /\b(?:q[1-4]|fy)\s?(?:19|20)\d{2}\b/i,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/i,
  /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/,
  /(?:19|20)\d{2}\s*年/,
  /\d{1,2}\s*月\d{1,2}\s*日/,
  /今天|今日|昨日|明天|今年|本月|本周|近期|最近/
];

const RECENCY_PATTERNS = [
  /\b(?:latest|current|recent|newest|today|this year|this month|this week|upcoming)\b/i,
  /最新|当前|当下|实时|今日|本周|本月|今年|近期|最近|刚刚|新规|新版|新款/
];

const FACT_PATTERNS = [
  /\b(?:price|pricing|cost|ranking|rankings|top\s?\d+|data|stats?|policy|regulation|release|released|version|company|model|update|market|stock|funding|gdp|salary|tax|interest rate)\b/i,
  /价格|价位|排行|排名|数据|政策|法规|发布|版本|公司|模型|更新|市场|股价|融资|税率|利率|就业|销量|参数/
];

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '检索失败';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : createAbortError();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);

    const handleAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', handleAbort);
      reject(signal?.reason instanceof Error ? signal.reason : createAbortError());
    };

    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

export function resolveFreshSearchTriggerReason(title: string): string | null {
  if (DATE_PATTERNS.some((pattern) => pattern.test(title))) {
    return '标题包含明确的时间表达';
  }

  if (RECENCY_PATTERNS.some((pattern) => pattern.test(title))) {
    return '标题包含最新或当前类表述';
  }

  if (FACT_PATTERNS.some((pattern) => pattern.test(title))) {
    return '标题包含价格、排行、政策或数据类事实关键词';
  }

  return null;
}

export function resolveSearchLocale(title: string): { country?: string; search_lang?: string } {
  if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(title)) {
    return {
      country: 'cn',
      search_lang: 'zh-hans'
    };
  }

  return {};
}

export function buildBraveSearchRequestPayload(query: string): Record<string, unknown> {
  return {
    q: query,
    count: 5,
    maximum_number_of_urls: 3,
    maximum_number_of_tokens: 2048,
    maximum_number_of_snippets: 9,
    context_threshold_mode: 'balanced',
    ...resolveSearchLocale(query)
  };
}

export class BraveSearchService {
  private activeCount = 0;

  private readonly waiters: Array<() => void> = [];

  async searchGenerateGrounding(
    title: string,
    settings: AppSettings,
    options: GenerateOptions,
    signal?: AbortSignal
  ): Promise<SearchMetadata> {
    if (!options.freshSearchEnabled) {
      return this.buildMetadata({
        status: 'skipped',
        query: null,
        triggerReason: '已关闭实时搜索',
        sources: [],
        errorMessage: null,
        fetchedAt: null
      });
    }

    if (!settings.braveApiKey.trim()) {
      return this.buildMetadata({
        status: 'skipped',
        query: null,
        triggerReason: '未配置 Brave Search API Key',
        sources: [],
        errorMessage: null,
        fetchedAt: null
      });
    }

    const triggerReason = resolveFreshSearchTriggerReason(title);
    if (!triggerReason) {
      return this.buildMetadata({
        status: 'skipped',
        query: title,
        triggerReason: '标题不属于需要实时检索的主题',
        sources: [],
        errorMessage: null,
        fetchedAt: null
      });
    }

    try {
      const sources = await this.requestGrounding(title, settings.braveApiKey, signal);
      if (sources.length === 0) {
        return this.buildMetadata({
          status: 'skipped',
          query: title,
          triggerReason,
          sources: [],
          errorMessage: '未检索到足够相关的资料',
          fetchedAt: new Date().toISOString()
        });
      }

      return this.buildMetadata({
        status: 'used',
        query: title,
        triggerReason,
        sources,
        errorMessage: null,
        fetchedAt: new Date().toISOString()
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      return this.buildMetadata({
        status: 'failed',
        query: title,
        triggerReason,
        sources: [],
        errorMessage: toErrorMessage(error),
        fetchedAt: new Date().toISOString()
      });
    }
  }

  private buildMetadata(input: Omit<SearchMetadata, 'provider'>): SearchMetadata {
    return {
      provider: 'brave',
      ...input
    };
  }

  private async requestGrounding(query: string, apiKey: string, signal?: AbortSignal): Promise<SearchSource[]> {
    const release = await this.acquire(signal);

    try {
      let attempt = 0;

      while (attempt < 2) {
        attempt += 1;

        const response = await fetch(BRAVE_LLM_CONTEXT_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Subscription-Token': apiKey
          },
          body: JSON.stringify(buildBraveSearchRequestPayload(query)),
          signal
        });

        const rawText = await response.text();
        const payload = this.tryParseJson(rawText);

        if (response.ok) {
          return this.mapSources(payload);
        }

        if (attempt < 2 && RETRYABLE_STATUS_CODES.has(response.status)) {
          await delay(RETRY_DELAY_MS, signal);
          continue;
        }

        throw new Error(this.extractErrorMessage(payload) || `Brave 检索失败（HTTP ${response.status}）`);
      }

      return [];
    } finally {
      release();
    }
  }

  private async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : createAbortError();
    }

    if (this.activeCount < MAX_CONCURRENT_REQUESTS) {
      this.activeCount += 1;
      return () => this.release();
    }

    await new Promise<void>((resolve, reject) => {
      const waiter = () => {
        signal?.removeEventListener('abort', handleAbort);
        this.activeCount += 1;
        resolve();
      };

      const handleAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        signal?.removeEventListener('abort', handleAbort);
        reject(signal?.reason instanceof Error ? signal.reason : createAbortError());
      };

      this.waiters.push(waiter);
      signal?.addEventListener('abort', handleAbort, { once: true });
    });

    return () => this.release();
  }

  private release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    const waiter = this.waiters.shift();
    waiter?.();
  }

  private mapSources(payload: unknown): SearchSource[] {
    if (!payload || typeof payload !== 'object') {
      return [];
    }

    const grounding = (payload as { grounding?: { generic?: unknown } }).grounding;
    const generic = Array.isArray(grounding?.generic) ? grounding.generic : [];
    const sourceMap =
      payload && typeof payload === 'object' && 'sources' in payload && payload.sources && typeof payload.sources === 'object'
        ? (payload.sources as Record<string, unknown>)
        : {};

    return generic
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }

        const url = typeof (entry as { url?: unknown }).url === 'string' ? (entry as { url: string }).url : null;
        const title = typeof (entry as { title?: unknown }).title === 'string' ? (entry as { title: string }).title : null;
        const snippets = Array.isArray((entry as { snippets?: unknown }).snippets)
          ? (entry as { snippets: unknown[] }).snippets.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : [];

        if (!url || !title || snippets.length === 0) {
          return null;
        }

        const sourceDetails = sourceMap[url];
        return {
          title,
          url,
          snippets,
          publishedAt: this.extractPublishedAt(sourceDetails)
        } satisfies SearchSource;
      })
      .filter((item): item is SearchSource => Boolean(item));
  }

  private extractPublishedAt(sourceDetails: unknown): string | null {
    if (!sourceDetails || typeof sourceDetails !== 'object') {
      return null;
    }

    const age = (sourceDetails as { age?: unknown }).age;
    const values = Array.isArray(age) ? age : typeof age === 'string' ? [age] : [];
    const isoLikeValue = values.find((value) => /^\d{4}-\d{2}-\d{2}/.test(value));
    if (isoLikeValue) {
      return isoLikeValue;
    }

    const parseableValue = values.find((value) => !Number.isNaN(Date.parse(value)));
    return parseableValue ?? null;
  }

  private tryParseJson(value: string): unknown {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  private extractErrorMessage(payload: unknown): string | null {
    if (typeof payload === 'string') {
      return payload;
    }

    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const typedPayload = payload as {
      error?: {
        detail?: unknown;
        message?: unknown;
        meta?: {
          errors?: Array<{
            loc?: unknown[];
            msg?: unknown;
          }>;
        };
      };
      detail?: unknown;
      message?: unknown;
    };

    const nestedErrors = typedPayload.error?.meta?.errors;
    if (Array.isArray(nestedErrors) && nestedErrors.length > 0) {
      const details = nestedErrors
        .map((entry) => {
          const location = Array.isArray(entry.loc) ? entry.loc.join('.') : 'body';
          const message = typeof entry.msg === 'string' ? entry.msg : '参数无效';
          return `${location}: ${message}`;
        })
        .join('; ');

      if (details) {
        return details;
      }
    }

    const error = typedPayload.error;
    if (error && typeof error.detail === 'string') {
      return error.detail;
    }

    if (error && typeof error.message === 'string') {
      return error.message;
    }

    const detail = typedPayload.detail;
    if (typeof detail === 'string') {
      return detail;
    }

    const message = typedPayload.message;
    return typeof message === 'string' ? message : null;
  }
}
