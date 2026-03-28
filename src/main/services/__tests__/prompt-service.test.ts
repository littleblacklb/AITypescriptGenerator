import { describe, expect, it } from 'vitest';

import { DEFAULT_GENERATE_OPTIONS, DEFAULT_REWRITE_OPTIONS } from '../../../shared/constants';
import type { SearchMetadata } from '../../../shared/types';
import { buildGeneratePromptsWithGrounding, buildRewritePrompts } from '../prompt-service';

const searchMetadata: SearchMetadata = {
  provider: 'brave',
  status: 'used',
  query: '2026 AI 模型排行榜',
  triggerReason: '标题包含明确的时间表达',
  sources: [
    {
      title: '模型榜单',
      url: 'https://example.com/ranking',
      snippets: ['这是最新榜单摘要。'],
      publishedAt: '2026-03-20'
    }
  ],
  errorMessage: null,
  fetchedAt: '2026-03-28T12:00:00.000Z'
};

describe('buildGeneratePromptsWithGrounding', () => {
  it('includes realtime grounding when search metadata is provided', () => {
    const prompts = buildGeneratePromptsWithGrounding('2026 AI 模型排行榜', DEFAULT_GENERATE_OPTIONS, searchMetadata);

    expect(prompts.userPrompt).toContain('实时检索资料');
    expect(prompts.userPrompt).toContain('https://example.com/ranking');
    expect(prompts.userPrompt).toContain('这是最新榜单摘要。');
  });

  it('keeps grounding out of the prompt when no search metadata is provided', () => {
    const prompts = buildGeneratePromptsWithGrounding('常青主题', DEFAULT_GENERATE_OPTIONS, null);

    expect(prompts.userPrompt).not.toContain('实时检索资料');
  });

  it('explicitly forbids visible citations in the generated article body', () => {
    const prompts = buildGeneratePromptsWithGrounding('2026 AI 模型排行榜', DEFAULT_GENERATE_OPTIONS, searchMetadata);

    expect(prompts.systemPrompt).toContain('不要输出引用标记');
    expect(prompts.userPrompt).toContain('不要在正文中输出链接、引用编号或来源清单');
  });
});

describe('buildRewritePrompts', () => {
  it('does not inject realtime search instructions into rewrite prompts', () => {
    const prompts = buildRewritePrompts('原标题', '原文内容', DEFAULT_REWRITE_OPTIONS);

    expect(prompts.userPrompt).not.toContain('实时检索资料');
    expect(prompts.systemPrompt).not.toContain('引用标记');
  });
});
