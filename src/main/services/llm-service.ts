import { buildGeneratePromptsWithGrounding, buildRewritePrompts } from './prompt-service';

import type { AppSettings, GenerateOptions, RewriteOptions, SearchMetadata } from '@shared/types';

interface CompletionResult {
  content: string;
  metadata: Record<string, unknown>;
}

export class LlmService {
  async generateArticle(
    title: string,
    settings: AppSettings,
    options: GenerateOptions,
    searchMetadata: SearchMetadata | null,
    signal?: AbortSignal
  ): Promise<CompletionResult> {
    const prompts = buildGeneratePromptsWithGrounding(title, options, searchMetadata);
    return this.requestCompletion(settings, prompts.systemPrompt, prompts.userPrompt, 0.8, signal);
  }

  async rewriteArticle(
    title: string,
    sourceText: string,
    settings: AppSettings,
    options: RewriteOptions,
    signal?: AbortSignal
  ): Promise<CompletionResult> {
    const prompts = buildRewritePrompts(title, sourceText, options);
    return this.requestCompletion(settings, prompts.systemPrompt, prompts.userPrompt, 0.7, signal);
  }

  private async requestCompletion(
    settings: AppSettings,
    systemPrompt: string,
    userPrompt: string,
    temperature: number,
    signal?: AbortSignal
  ): Promise<CompletionResult> {
    const endpoint = this.buildEndpoint(settings.apiBaseUrl);
    const payload = {
      model: settings.model,
      temperature,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompt
        }
      ]
    };

    const { combinedSignal, cleanup } = this.createTimedSignal(signal, settings.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify(payload),
        signal: combinedSignal
      });

      const rawText = await response.text();
      const responseBody = this.tryParseJson(rawText);

      if (!response.ok) {
        throw new Error(this.extractErrorMessage(responseBody) || `请求失败（HTTP ${response.status}）`);
      }

      const content = this.extractAssistantText(responseBody);
      if (!content) {
        throw new Error('模型返回了空内容');
      }

      return {
        content,
        metadata: {
          endpoint,
          request: payload,
          response: responseBody
        }
      };
    } catch (error) {
      if (combinedSignal.aborted) {
        const reason = signal?.aborted ? '任务已取消' : '请求超时，请检查网络或增大超时时间';
        throw new Error(reason);
      }

      throw error instanceof Error ? error : new Error('请求失败');
    } finally {
      cleanup();
    }
  }

  private buildEndpoint(baseUrl: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  }

  private createTimedSignal(signal: AbortSignal | undefined, timeoutMs: number): {
    combinedSignal: AbortSignal;
    cleanup: () => void;
  } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

    const handleAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', handleAbort, { once: true });

    return {
      combinedSignal: controller.signal,
      cleanup: () => {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', handleAbort);
      }
    };
  }

  private tryParseJson(value: string): unknown {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  private extractAssistantText(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
      return '';
    }

    const choices = (payload as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return '';
    }

    const firstChoice = choices[0] as {
      text?: unknown;
      message?: {
        content?: unknown;
      };
    };

    if (typeof firstChoice.text === 'string') {
      return firstChoice.text.trim();
    }

    const content = firstChoice.message?.content;
    if (typeof content === 'string') {
      return content.trim();
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') {
            return part;
          }

          if (
            part &&
            typeof part === 'object' &&
            'text' in part &&
            typeof (part as { text: unknown }).text === 'string'
          ) {
            return (part as { text: string }).text;
          }

          return '';
        })
        .join('\n')
        .trim();
    }

    return '';
  }

  private extractErrorMessage(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return typeof payload === 'string' ? payload : null;
    }

    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === 'string') {
      return error.message;
    }

    const message = (payload as { message?: unknown }).message;
    return typeof message === 'string' ? message : null;
  }
}
