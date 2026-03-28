import type { GenerateOptions, RewriteOptions, SearchMetadata } from '@shared/types';

function formatAvoidTerms(value: string): string {
  const items = value
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length ? items.join('、') : '无';
}

export function buildGeneratePrompts(title: string, options: GenerateOptions): {
  systemPrompt: string;
  userPrompt: string;
} {
  return buildGeneratePromptsWithGrounding(title, options, null);
}

export function buildGeneratePromptsWithGrounding(
  title: string,
  options: GenerateOptions,
  searchMetadata: SearchMetadata | null
): {
  systemPrompt: string;
  userPrompt: string;
} {
  const groundingSection =
    searchMetadata?.status === 'used' && searchMetadata.sources.length > 0
      ? [
          '实时检索资料：',
          ...searchMetadata.sources.map((source, index) =>
            [
              `${index + 1}. 标题：${source.title}`,
              `URL：${source.url}`,
              source.publishedAt ? `日期：${source.publishedAt}` : null,
              ...source.snippets.map((snippet, snippetIndex) => `摘录 ${snippetIndex + 1}：${snippet}`)
            ]
              .filter(Boolean)
              .join('\n')
          )
        ].join('\n')
      : null;

  return {
    systemPrompt:
      [
        '你是一名资深中文内容编辑，擅长为今日头条风格的内容创作原创文章。',
        '输出必须自然、具体、可读，避免明显 AI 套话、空洞总结和过度夸张的标题党表达。',
        '如果提供了实时检索资料，只能将其用于时间敏感的事实信息。',
        '不要编造数字、日期、排行、政策细节或版本信息。',
        '如果资料之间存在冲突，请使用谨慎措辞，不要强行下结论。',
        '正文中不要输出引用标记、URL、来源列表或“根据搜索结果”等提示语。'
      ].join(' '),
    userPrompt: [
      `请围绕以下标题撰写一篇适合今日头条发布的中文文章。`,
      `标题：${title}`,
      `目标字数：约 ${options.targetLength} 字`,
      `文章风格：${options.stylePreset}`,
      `整体语气：${options.tonePreset}`,
      `开头要求：${options.openingHookEnabled ? '需要有吸引力的开场' : '直接进入主题'}`,
      `尽量避免使用的词语：${formatAvoidTerms(options.avoidTerms)}`,
      groundingSection,
      '输出要求：',
      '1. 第一行输出标题。',
      '2. 正文结构完整，段落清晰，适合直接导出为纯文本。',
      '3. 不要使用 Markdown、编号提纲或“总之”“综上所述”式收尾。',
      '4. 内容要具体，不要编造明显无法验证的数据。',
      '5. 保持原创表达，减少模板化套话。',
      '6. 不要在正文中输出链接、引用编号或来源清单。'
    ]
      .filter(Boolean)
      .join('\n')
  };
}

export function buildRewritePrompts(
  title: string,
  sourceText: string,
  options: RewriteOptions
): { systemPrompt: string; userPrompt: string } {
  const strengthText =
    options.rewriteStrength === 'light'
      ? '轻度改写，保留原有结构和表达节奏'
      : options.rewriteStrength === 'strong'
        ? '深度改写，明显更新表达方式和段落组织'
        : '中度改写，保持原意同时显著优化表达';

  return {
    systemPrompt:
      '你是一名中文改写编辑，擅长在保留核心信息的前提下重写文章，使其更自然、更流畅、更适合资讯内容分发平台。不要输出任何说明文字。',
    userPrompt: [
      `请根据下面的标题和原文，对文章进行改写。`,
      `标题：${title}`,
      `目标字数：约 ${options.targetLength} 字`,
      `文章风格：${options.stylePreset}`,
      `整体语气：${options.tonePreset}`,
      `改写强度：${strengthText}`,
      `保留原意：${options.preserveOriginalMeaning ? '是，优先保留核心观点和事实' : '否，可以适度重组观点与表达'}`,
      `尽量避免使用的词语：${formatAvoidTerms(options.avoidTerms)}`,
      '输出要求：',
      '1. 第一行输出标题。',
      '2. 不要照抄原文句子，尽量改写段落和措辞。',
      '3. 不要输出解释、对比说明或“以下是改写后内容”。',
      '4. 保持自然、完整、适合直接导出为纯文本。',
      '原文如下：',
      sourceText
    ].join('\n')
  };
}
