import type { BatchType } from './types';

export interface ParsedTitleLines {
  titles: string[];
  duplicates: string[];
}

export function parseTitleLines(input: string): ParsedTitleLines {
  const titles = input
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const counts = new Map<string, number>();
  for (const title of titles) {
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }

  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([title]) => title);

  return {
    titles,
    duplicates
  };
}

export function sanitizeFileName(input: string, fallback = 'article'): string {
  const normalized = input
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '');

  const safe = normalized.slice(0, 80).trim();
  return safe || fallback;
}

export function buildExportFolderName(type: BatchType, date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('');
  const time = [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('');
  return `${type}-${stamp}-${time}`;
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return '未完成';
  }

  const date = new Date(value);
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

export function statusText(status: string): string {
  switch (status) {
    case 'queued':
      return '等待中';
    case 'running':
      return '执行中';
    case 'succeeded':
      return '成功';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    case 'completed':
      return '已完成';
    case 'completed_with_errors':
      return '部分失败';
    default:
      return status;
  }
}
