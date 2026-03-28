import { describe, expect, it } from 'vitest';

import { DEFAULT_GENERATE_OPTIONS, DEFAULT_SETTINGS } from '../../../shared/constants';
import type { AppSettings } from '../../../shared/types';
import {
  BRAVE_LLM_CONTEXT_ENDPOINT,
  BraveSearchService,
  buildBraveSearchRequestPayload
} from '../brave-search-service';

const braveApiKey = process.env.BRAVE_API_KEY ?? '';
const testQuery = process.env.BRAVE_TEST_QUERY ?? '2026 年 AI 模型排行榜';

function createSettings(): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    braveApiKey
  };
}

function parseJsonSafely(rawText: string): unknown {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return rawText;
  }
}

function logSection(title: string, payload: unknown): void {
  console.log(`\n===== ${title} =====`);
  console.log(JSON.stringify(payload, null, 2));
}

const describeLive = braveApiKey ? describe : describe.skip;

describeLive('BraveSearchService live API', () => {
  it(
    'calls Brave LLM Context and prints the full request/response log',
    async () => {
      const payload = buildBraveSearchRequestPayload(testQuery);

      logSection('BRAVE REQUEST', {
        endpoint: BRAVE_LLM_CONTEXT_ENDPOINT,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Subscription-Token': '[REDACTED]'
        },
        body: payload
      });

      const response = await fetch(BRAVE_LLM_CONTEXT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Subscription-Token': braveApiKey
        },
        body: JSON.stringify(payload)
      });

      const rawText = await response.text();
      const parsedBody = parseJsonSafely(rawText);

      logSection('BRAVE RESPONSE STATUS', {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText
      });
      logSection('BRAVE RESPONSE HEADERS', Object.fromEntries(response.headers.entries()));
      logSection('BRAVE RESPONSE BODY', parsedBody);

      expect(response.ok).toBe(true);
      expect(parsedBody).toMatchObject({
        grounding: {
          generic: expect.any(Array)
        }
      });

      const service = new BraveSearchService();
      const mappedResult = await service.searchGenerateGrounding(testQuery, createSettings(), DEFAULT_GENERATE_OPTIONS);

      logSection('BRAVE MAPPED RESULT', mappedResult);

      expect(['used', 'skipped']).toContain(mappedResult.status);
      expect(mappedResult.query).toBe(testQuery);
    },
    30000
  );
});

if (!braveApiKey) {
  console.warn('\nSkipping live Brave API test because BRAVE_API_KEY is not set.');
}
