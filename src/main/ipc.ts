import { ipcMain } from 'electron';

import type { AppSettings, CreateGenerateBatchInput, CreateRewriteBatchInput } from '@shared/types';

import { DatabaseService } from './services/database';
import { FileService } from './services/file-service';
import { TaskManager } from './services/task-manager';

interface MainServices {
  database: DatabaseService;
  taskManager: TaskManager;
  fileService: FileService;
}

export function registerIpcHandlers(services: MainServices): void {
  ipcMain.handle('settings:get', async () => services.database.getSettings());
  ipcMain.handle('settings:save', async (_event, settings: AppSettings) => services.database.saveSettings(settings));

  ipcMain.handle('generate:createBatch', async (_event, input: CreateGenerateBatchInput) =>
    services.taskManager.createGenerateBatch(input)
  );
  ipcMain.handle('generate:retryJob', async (_event, jobId: string) => services.taskManager.retryJob(jobId));
  ipcMain.handle('generate:cancelBatch', async (_event, batchId: string) => services.taskManager.cancelBatch(batchId));

  ipcMain.handle('rewrite:selectSourceFiles', async () => services.fileService.selectSourceFiles());
  ipcMain.handle('rewrite:createBatch', async (_event, input: CreateRewriteBatchInput) =>
    services.taskManager.createRewriteBatch(input)
  );
  ipcMain.handle('rewrite:retryJob', async (_event, jobId: string) => services.taskManager.retryJob(jobId));
  ipcMain.handle('rewrite:cancelBatch', async (_event, batchId: string) => services.taskManager.cancelBatch(batchId));

  ipcMain.handle('batches:getBatch', async (_event, batchId: string) => services.taskManager.getBatch(batchId));

  ipcMain.handle('exports:selectDirectory', async () => services.taskManager.selectExportDirectory());
  ipcMain.handle('exports:exportBatch', async (_event, batchId: string) => services.taskManager.exportBatch(batchId));
  ipcMain.handle('exports:openPath', async (_event, targetPath: string) => services.taskManager.openPath(targetPath));

  ipcMain.handle('history:list', async () => services.taskManager.listHistory());
  ipcMain.handle('history:getBatch', async (_event, batchId: string) => services.taskManager.getBatch(batchId));
}
