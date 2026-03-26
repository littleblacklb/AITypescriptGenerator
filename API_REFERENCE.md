# API Reference

This app targets an OpenAI-compatible chat completion endpoint.

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
