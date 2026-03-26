/// <reference types="vite/client" />

import type { ArticleAppApi } from '@shared/ipc';

declare global {
  interface Window {
    articleApp: ArticleAppApi;
  }
}

export {};
