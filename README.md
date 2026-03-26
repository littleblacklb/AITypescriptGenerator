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
npm run test
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
