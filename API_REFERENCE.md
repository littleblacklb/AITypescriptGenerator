# API Reference

This app targets an OpenAI-compatible chat completion endpoint.

## `POST https://api.search.brave.com/res/v1/llm/context`

- **Auth:** `X-Subscription-Token: <braveApiKey>`
- **Request Body Used By This App:**

```json
{
  "q": "string",
  "count": 5,
  "maximum_number_of_urls": 3,
  "maximum_number_of_tokens": 2048,
  "maximum_number_of_snippets": 9,
  "context_threshold_mode": "balanced",
  "country": "cn",
  "search_lang": "zh-hans"
}
```

- **Response Fields Used By This App:**

```json
{
  "grounding": {
    "generic": [
      {
        "url": "https://example.com/page",
        "title": "Page Title",
        "snippets": ["Relevant text chunk"]
      }
    ]
  },
  "sources": {
    "https://example.com/page": {
      "title": "Page Title",
      "age": ["Monday, January 15, 2024", "2024-01-15", "380 days ago"]
    }
  }
}
```

- **Compatibility Notes:**
  - The app reads `grounding.generic[].url`, `grounding.generic[].title`, and `grounding.generic[].snippets`.
  - The app reads `sources[url].age` when available and stores the ISO-like date entry as `publishedAt`.
  - If Brave returns no usable `grounding.generic` entries, the app records the search as skipped and continues with normal generation.

## `POST /chat/completions`

- **Base URL:** Configurable by user, typically `https://api.openai.com/v1`
- **Auth:** `Authorization: Bearer <apiKey>`
- **Request Body:**

```json
{
  "model": "string",
  "temperature": 0.8,
  "messages": [
    { "role": "system", "content": "string" },
    { "role": "user", "content": "string" }
  ]
}
```

- **Response Fields Used By This App:**

```json
{
  "id": "chatcmpl-xxx",
  "model": "gpt-4o-mini",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "article text"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 123,
    "completion_tokens": 456,
    "total_tokens": 579
  }
}
```

- **Compatibility Notes:**
  - Some compatible providers may return `choices[0].text` instead of `choices[0].message.content`.
  - Some providers may return `message.content` as an array of content parts.
  - The app parses all three shapes defensively and stores the raw response in job metadata for debugging.
