import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import initSqlJs, { type Database } from 'sql.js';

import { HISTORY_LIMIT, mergeSettings } from '@shared/constants';
import type { AppSettings, ArticleJob, BatchSummary, BatchTask, BatchTaskWithJobs } from '@shared/types';

interface BatchRow {
  id: string;
  type: string;
  status: string;
  total_count: number;
  success_count: number;
  failed_count: number;
  created_at: string;
  finished_at: string | null;
  export_directory: string | null;
  options_json: string;
}

interface JobRow {
  id: string;
  batch_id: string;
  type: string;
  title: string;
  source_text: string | null;
  status: string;
  result_text: string | null;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
  export_path: string | null;
  metadata_json: string | null;
  order_index: number;
  source_file_path: string | null;
}

const require = createRequire(import.meta.url);
const sqlWasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');

export class DatabaseService {
  private readonly dbPath: string;
  private db: Database | null = null;
  private persistQueue = Promise.resolve();

  constructor(userDataPath: string) {
    this.dbPath = join(userDataPath, 'data', 'article-generator.sqlite');
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.dbPath), { recursive: true });

    const SQL = await initSqlJs({
      locateFile: () => sqlWasmPath
    });

    let database: Database;
    try {
      await access(this.dbPath);
      const file = await readFile(this.dbPath);
      database = new SQL.Database(file);
    } catch {
      database = new SQL.Database();
    }

    this.db = database;
    this.migrate();
    await this.markInterruptedBatches();
  }

  async getSettings(): Promise<AppSettings> {
    const row = this.queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['app_settings']);
    if (!row) {
      const defaults = mergeSettings();
      await this.saveSettings(defaults);
      return defaults;
    }

    return mergeSettings(this.safeJsonParse(row.value));
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const merged = mergeSettings(settings);
    this.run(
      `
        INSERT INTO settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
      ['app_settings', JSON.stringify(merged)]
    );
    await this.persist();
    return merged;
  }

  async insertBatch(batch: BatchTaskWithJobs): Promise<void> {
    this.run('BEGIN TRANSACTION');
    try {
      this.upsertBatchRow(batch);
      for (const job of batch.jobs) {
        this.upsertJobRow(job);
      }
      this.run('COMMIT');
    } catch (error) {
      this.run('ROLLBACK');
      throw error;
    }
    await this.persist();
  }

  async updateBatch(batch: BatchTask): Promise<void> {
    this.upsertBatchRow(batch);
    await this.persist();
  }

  async updateJob(job: ArticleJob): Promise<void> {
    this.upsertJobRow(job);
    await this.persist();
  }

  async updateBatchAndJobs(batch: BatchTask, jobs: ArticleJob[]): Promise<void> {
    this.run('BEGIN TRANSACTION');
    try {
      this.upsertBatchRow(batch);
      for (const job of jobs) {
        this.upsertJobRow(job);
      }
      this.run('COMMIT');
    } catch (error) {
      this.run('ROLLBACK');
      throw error;
    }
    await this.persist();
  }

  async getBatchById(batchId: string): Promise<BatchTaskWithJobs | null> {
    const batchRow = this.queryOne<BatchRow>('SELECT * FROM batch_tasks WHERE id = ?', [batchId]);
    if (!batchRow) {
      return null;
    }

    const jobs = this.queryAll<JobRow>(
      'SELECT * FROM article_jobs WHERE batch_id = ? ORDER BY order_index ASC',
      [batchId]
    ).map((row) => this.mapJob(row));

    return {
      ...this.mapBatch(batchRow),
      jobs
    };
  }

  async listBatches(limit = HISTORY_LIMIT): Promise<BatchSummary[]> {
    return this.queryAll<BatchRow>(
      `
        SELECT *
        FROM batch_tasks
        ORDER BY datetime(created_at) DESC
        LIMIT ?
      `,
      [limit]
    ).map((row) => {
      const batch = this.mapBatch(row);
      return {
        id: batch.id,
        type: batch.type,
        status: batch.status,
        totalCount: batch.totalCount,
        successCount: batch.successCount,
        failedCount: batch.failedCount,
        createdAt: batch.createdAt,
        finishedAt: batch.finishedAt,
        exportDirectory: batch.exportDirectory
      };
    });
  }

  private migrate(): void {
    this.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    this.run(`
      CREATE TABLE IF NOT EXISTS batch_tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        total_count INTEGER NOT NULL,
        success_count INTEGER NOT NULL,
        failed_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        export_directory TEXT,
        options_json TEXT NOT NULL
      )
    `);

    this.run(`
      CREATE TABLE IF NOT EXISTS article_jobs (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        source_text TEXT,
        status TEXT NOT NULL,
        result_text TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        export_path TEXT,
        metadata_json TEXT,
        order_index INTEGER NOT NULL,
        source_file_path TEXT,
        FOREIGN KEY(batch_id) REFERENCES batch_tasks(id)
      )
    `);

    this.run('CREATE INDEX IF NOT EXISTS idx_article_jobs_batch_id ON article_jobs(batch_id)');
  }

  private async markInterruptedBatches(): Promise<void> {
    const interrupted = this.queryAll<BatchRow>(
      "SELECT * FROM batch_tasks WHERE status IN ('queued', 'running')"
    );

    if (!interrupted.length) {
      return;
    }

    const now = new Date().toISOString();

    this.run('BEGIN TRANSACTION');
    try {
      for (const batch of interrupted) {
        this.run(
          `
            UPDATE batch_tasks
            SET status = ?, finished_at = ?
            WHERE id = ?
          `,
          ['completed_with_errors', now, batch.id]
        );
        this.run(
          `
            UPDATE article_jobs
            SET status = ?, finished_at = ?, error_message = COALESCE(error_message, ?)
            WHERE batch_id = ? AND status IN ('queued', 'running')
          `,
          ['failed', now, '应用关闭导致任务中断，请重试该条任务。', batch.id]
        );
      }
      this.run('COMMIT');
    } catch (error) {
      this.run('ROLLBACK');
      throw error;
    }

    await this.persist();
  }

  private upsertBatchRow(batch: BatchTask): void {
    this.run(
      `
        INSERT INTO batch_tasks (
          id, type, status, total_count, success_count, failed_count,
          created_at, finished_at, export_directory, options_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          status = excluded.status,
          total_count = excluded.total_count,
          success_count = excluded.success_count,
          failed_count = excluded.failed_count,
          created_at = excluded.created_at,
          finished_at = excluded.finished_at,
          export_directory = excluded.export_directory,
          options_json = excluded.options_json
      `,
      [
        batch.id,
        batch.type,
        batch.status,
        batch.totalCount,
        batch.successCount,
        batch.failedCount,
        batch.createdAt,
        batch.finishedAt,
        batch.exportDirectory,
        JSON.stringify(batch.options)
      ]
    );
  }

  private upsertJobRow(job: ArticleJob): void {
    this.run(
      `
        INSERT INTO article_jobs (
          id, batch_id, type, title, source_text, status, result_text,
          error_message, created_at, finished_at, export_path, metadata_json,
          order_index, source_file_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          batch_id = excluded.batch_id,
          type = excluded.type,
          title = excluded.title,
          source_text = excluded.source_text,
          status = excluded.status,
          result_text = excluded.result_text,
          error_message = excluded.error_message,
          created_at = excluded.created_at,
          finished_at = excluded.finished_at,
          export_path = excluded.export_path,
          metadata_json = excluded.metadata_json,
          order_index = excluded.order_index,
          source_file_path = excluded.source_file_path
      `,
      [
        job.id,
        job.batchId,
        job.type,
        job.title,
        job.sourceText,
        job.status,
        job.resultText,
        job.errorMessage,
        job.createdAt,
        job.finishedAt,
        job.exportPath,
        job.metadata ? JSON.stringify(job.metadata) : null,
        job.orderIndex,
        job.sourceFilePath
      ]
    );
  }

  private mapBatch(row: BatchRow): BatchTask {
    return {
      id: row.id,
      type: row.type as BatchTask['type'],
      status: row.status as BatchTask['status'],
      totalCount: Number(row.total_count),
      successCount: Number(row.success_count),
      failedCount: Number(row.failed_count),
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      exportDirectory: row.export_directory,
      options: this.safeJsonParse(row.options_json)
    };
  }

  private mapJob(row: JobRow): ArticleJob {
    return {
      id: row.id,
      batchId: row.batch_id,
      type: row.type as ArticleJob['type'],
      title: row.title,
      sourceText: row.source_text,
      status: row.status as ArticleJob['status'],
      resultText: row.result_text,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      exportPath: row.export_path,
      metadata: row.metadata_json ? this.safeJsonParse(row.metadata_json) : null,
      orderIndex: Number(row.order_index),
      sourceFilePath: row.source_file_path
    };
  }

  private safeJsonParse<T>(value: string): T {
    try {
      return JSON.parse(value) as T;
    } catch {
      return {} as T;
    }
  }

  private run(sql: string, params: unknown[] = []): void {
    this.ensureDb().run(sql, params);
  }

  private queryOne<T>(sql: string, params: unknown[] = []): T | null {
    return this.queryAll<T>(sql, params)[0] ?? null;
  }

  private queryAll<T>(sql: string, params: unknown[] = []): T[] {
    const statement = this.ensureDb().prepare(sql, params);
    const rows: T[] = [];

    while (statement.step()) {
      rows.push(statement.getAsObject() as T);
    }

    statement.free();
    return rows;
  }

  private ensureDb(): Database {
    if (!this.db) {
      throw new Error('数据库尚未初始化');
    }

    return this.db;
  }

  private async persist(): Promise<void> {
    const bytes = this.ensureDb().export();
    this.persistQueue = this.persistQueue
      .catch(() => undefined)
      .then(() => writeFile(this.dbPath, Buffer.from(bytes)));
    await this.persistQueue;
  }
}
