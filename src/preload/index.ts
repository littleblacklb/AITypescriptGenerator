import { contextBridge, ipcRenderer } from 'electron';

import type { ArticleAppApi } from '@shared/ipc';

const api: ArticleAppApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings)
  },
  generate: {
    createBatch: (input) => ipcRenderer.invoke('generate:createBatch', input),
    retryJob: (jobId) => ipcRenderer.invoke('generate:retryJob', jobId),
    cancelBatch: (batchId) => ipcRenderer.invoke('generate:cancelBatch', batchId)
  },
  rewrite: {
    selectSourceFiles: () => ipcRenderer.invoke('rewrite:selectSourceFiles'),
    createBatch: (input) => ipcRenderer.invoke('rewrite:createBatch', input),
    retryJob: (jobId) => ipcRenderer.invoke('rewrite:retryJob', jobId),
    cancelBatch: (batchId) => ipcRenderer.invoke('rewrite:cancelBatch', batchId)
  },
  batches: {
    getBatch: (batchId) => ipcRenderer.invoke('batches:getBatch', batchId)
  },
  exports: {
    selectDirectory: () => ipcRenderer.invoke('exports:selectDirectory'),
    exportBatch: (batchId) => ipcRenderer.invoke('exports:exportBatch', batchId),
    openPath: (targetPath) => ipcRenderer.invoke('exports:openPath', targetPath)
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    getBatch: (batchId) => ipcRenderer.invoke('history:getBatch', batchId)
  }
};

contextBridge.exposeInMainWorld('articleApp', api);
