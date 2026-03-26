import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

import { registerIpcHandlers } from './ipc';
import { DatabaseService } from './services/database';
import { FileService } from './services/file-service';
import { LlmService } from './services/llm-service';
import { TaskManager } from './services/task-manager';

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    title: 'Batch Article Generator',
    backgroundColor: '#f3eee1',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  const database = new DatabaseService(app.getPath('userData'));
  await database.init();

  const exportRoot = join(app.getPath('documents'), 'ToutiaoArticleExports');
  const fileService = new FileService(exportRoot);
  const llmService = new LlmService();
  const taskManager = new TaskManager(database, llmService, fileService);

  registerIpcHandlers({
    database,
    taskManager,
    fileService
  });

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
