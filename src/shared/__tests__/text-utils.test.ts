import { describe, expect, it } from 'vitest';

import { buildExportFolderName, parseTitleLines, sanitizeFileName } from '../text-utils';

describe('parseTitleLines', () => {
  it('splits non-empty trimmed titles by line', () => {
    const parsed = parseTitleLines(' 第一条标题 \n\n第二条标题\r\n第三条标题 ');

    expect(parsed.titles).toEqual(['第一条标题', '第二条标题', '第三条标题']);
    expect(parsed.duplicates).toEqual([]);
  });

  it('detects duplicates', () => {
    const parsed = parseTitleLines('同一个标题\n同一个标题\n另一个标题');

    expect(parsed.duplicates).toEqual(['同一个标题']);
  });
});

describe('sanitizeFileName', () => {
  it('removes invalid path characters', () => {
    expect(sanitizeFileName('A/B:C*D?')).toBe('A B C D');
  });

  it('falls back when nothing is left', () => {
    expect(sanitizeFileName('////', 'fallback')).toBe('fallback');
  });
});

describe('buildExportFolderName', () => {
  it('uses predictable prefixes', () => {
    const folder = buildExportFolderName('generate', new Date('2026-03-25T10:11:12Z'));
    expect(folder.startsWith('generate-')).toBe(true);
  });
});
