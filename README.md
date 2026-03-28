# Batch Article Generator

Electron + React + TypeScript desktop app for:

- Batch article generation from pasted titles
- Article rewriting from imported `txt` files
- TXT export, settings persistence, and local history

## Scripts

```bash
npm install
npm run dev
npm run build
npm run build:win
npm run test
```

`npm run build:win` creates a Windows NSIS installer in `dist/`.

If you are on Apple Silicon macOS, `electron-builder` may fail during the Windows packaging step because its Wine helper is x64-only. In that case, use the GitHub Actions workflow in `.github/workflows/build-windows.yml` or run the command on a Windows machine.

## Live Brave API Test

Run the real Brave LLM Context API smoke test with full request/response logs:

```bash
BRAVE_API_KEY=your_key npm run test:brave-api
```

Optional:

```bash
BRAVE_API_KEY=your_key BRAVE_TEST_QUERY="2026 年 AI 模型排行榜" npm run test:brave-api
```

## Features

- Paste one title per line and generate articles concurrently
- Import one or more `txt` files for rewriting
- Save API settings, defaults, and task history locally
- Export each successful article as its own `txt` file

## Concurrency

- Use the `并发任务数` setting to control how many jobs run at the same time
- `1` keeps the original serial behavior, higher values process more titles or rewrites in parallel

## Notes

- The app uses an OpenAI-compatible `POST /chat/completions` API.
- First-time startup requires configuring `API Base URL`, `API Key`, and `Model`.
