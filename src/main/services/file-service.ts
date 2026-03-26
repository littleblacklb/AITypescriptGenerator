import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { dialog, shell } from 'electron';

import { SOURCE_TEXT_MIN_LENGTH } from '@shared/constants';
import { buildExportFolderName, sanitizeFileName } from '@shared/text-utils';
import type { ArticleJob, BatchType, ExportBatchResult, RewriteSource } from '@shared/types';

interface WriteBatchFilesInput {
  batchId: string;
  batchType: BatchType;
  baseDirectory: string;
  jobs: ArticleJob[];
}

interface JobExportEntry {
  jobId: string;
  filePath: string;
}

interface WriteBatchFilesResult extends ExportBatchResult {
  jobExports: JobExportEntry[];
}

export class FileService {
  constructor(private readonly fallbackExportRoot: string) {}

  async selectSourceFiles(): Promise<RewriteSource[]> {
    const result = await dialog.showOpenDialog({
      title: '选择要改写的 TXT 文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Text Files',
          extensions: ['txt']
        }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    return Promise.all(result.filePaths.map((filePath) => this.readRewriteSource(filePath)));
  }

  async selectDirectory(defaultPath?: string): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: '选择导出目录',
      defaultPath: defaultPath || this.fallbackExportRoot,
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  }

  async writeBatchFiles(input: WriteBatchFilesInput): Promise<WriteBatchFilesResult> {
    const exportDirectory = join(input.baseDirectory, buildExportFolderName(input.batchType));
    await mkdir(exportDirectory, { recursive: true });

    const usedNames = new Set<string>();
    const jobExports: JobExportEntry[] = [];
    let exportedCount = 0;
    let skippedCount = 0;

    for (const job of input.jobs) {
      if (job.status !== 'succeeded' || !job.resultText) {
        skippedCount += 1;
        continue;
      }

      const filePath = await this.resolveOutputPath(exportDirectory, sanitizeFileName(job.title), usedNames);
      await writeFile(filePath, job.resultText, 'utf8');

      exportedCount += 1;
      jobExports.push({
        jobId: job.id,
        filePath
      });
    }

    return {
      batchId: input.batchId,
      directoryPath: exportDirectory,
      exportedCount,
      skippedCount,
      jobExports
    };
  }

  async openPath(targetPath: string): Promise<void> {
    const errorMessage = await shell.openPath(targetPath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
  }

  private async readRewriteSource(filePath: string): Promise<RewriteSource> {
    const fileName = basename(filePath);
    const title = basename(filePath, extname(filePath)).trim();

    try {
      const sourceText = await readFile(filePath, 'utf8');
      if (!sourceText.trim()) {
        return {
          filePath,
          fileName,
          title,
          sourceText: '',
          errorMessage: '文件内容为空'
        };
      }

      if (sourceText.trim().length < SOURCE_TEXT_MIN_LENGTH) {
        return {
          filePath,
          fileName,
          title,
          sourceText,
          errorMessage: `文件内容过短，至少需要 ${SOURCE_TEXT_MIN_LENGTH} 个字符`
        };
      }

      return {
        filePath,
        fileName,
        title,
        sourceText,
        errorMessage: null
      };
    } catch (error) {
      return {
        filePath,
        fileName,
        title,
        sourceText: '',
        errorMessage: error instanceof Error ? error.message : '文件读取失败'
      };
    }
  }

  private async resolveOutputPath(
    directory: string,
    baseName: string,
    usedNames: Set<string>
  ): Promise<string> {
    let counter = 1;
    let fileName = `${baseName}.txt`;

    while (usedNames.has(fileName) || (await this.fileExists(join(directory, fileName)))) {
      counter += 1;
      fileName = `${baseName}-${counter}.txt`;
    }

    usedNames.add(fileName);
    return join(directory, fileName);
  }

  private async fileExists(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}
