import { useEffect, useState } from 'react';

import {
  DEFAULT_GENERATE_OPTIONS,
  MAX_CONCURRENT_JOBS,
  MIN_CONCURRENT_JOBS,
  DEFAULT_REWRITE_OPTIONS,
  DEFAULT_SETTINGS,
  REWRITE_STRENGTH_OPTIONS,
  STYLE_PRESETS,
  TITLE_LIMIT,
  TONE_PRESETS
} from '@shared/constants';
import { formatDateTime, parseTitleLines, statusText } from '@shared/text-utils';
import type {
  AppSettings,
  ArticleJob,
  BatchSummary,
  BatchTaskWithJobs,
  GenerateOptions,
  RewriteOptions,
  RewriteSource
} from '@shared/types';

type ViewKey = 'generate' | 'rewrite' | 'history' | 'settings';

const NAV_ITEMS: Array<{ key: ViewKey; title: string; description: string }> = [
  { key: 'generate', title: '批量生成', description: '每行一个标题，支持并发出稿' },
  { key: 'rewrite', title: '文章改写', description: '导入 TXT，保留标题改写正文' },
  { key: 'history', title: '历史记录', description: '查看批次结果与导出目录' },
  { key: 'settings', title: '设置', description: '配置 API、模型与默认参数' }
];

function App(): JSX.Element {
  const [view, setView] = useState<ViewKey>('generate');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [generateOptions, setGenerateOptions] = useState<GenerateOptions>(DEFAULT_GENERATE_OPTIONS);
  const [rewriteOptions, setRewriteOptions] = useState<RewriteOptions>(DEFAULT_REWRITE_OPTIONS);
  const [titleInput, setTitleInput] = useState('');
  const [rewriteSources, setRewriteSources] = useState<RewriteSource[]>([]);
  const [generateBatch, setGenerateBatch] = useState<BatchTaskWithJobs | null>(null);
  const [rewriteBatch, setRewriteBatch] = useState<BatchTaskWithJobs | null>(null);
  const [history, setHistory] = useState<BatchSummary[]>([]);
  const [selectedGenerateJobId, setSelectedGenerateJobId] = useState<string | null>(null);
  const [selectedRewriteJobId, setSelectedRewriteJobId] = useState<string | null>(null);
  const [selectedHistoryBatchId, setSelectedHistoryBatchId] = useState<string | null>(null);
  const [selectedHistoryBatch, setSelectedHistoryBatch] = useState<BatchTaskWithJobs | null>(null);
  const [selectedHistoryJobId, setSelectedHistoryJobId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [busyKey, setBusyKey] = useState<string>('');

  const parsedTitles = parseTitleLines(titleInput);
  const validRewriteSources = rewriteSources.filter((source) => !source.errorMessage);
  const generateSelection = generateBatch?.jobs.find((job) => job.id === selectedGenerateJobId) ?? generateBatch?.jobs[0] ?? null;
  const rewriteSelection = rewriteBatch?.jobs.find((job) => job.id === selectedRewriteJobId) ?? rewriteBatch?.jobs[0] ?? null;
  const historySelection = selectedHistoryBatch?.jobs.find((job) => job.id === selectedHistoryJobId) ?? selectedHistoryBatch?.jobs[0] ?? null;
  const hasApiConfig = Boolean(settings.apiBaseUrl.trim() && settings.apiKey.trim() && settings.model.trim());
  const hasTooLongTitles = parsedTitles.titles.some((title) => title.length > TITLE_LIMIT);

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(() => {
    if (!selectedGenerateJobId && generateBatch?.jobs.length) {
      setSelectedGenerateJobId(generateBatch.jobs[0].id);
    }
  }, [generateBatch, selectedGenerateJobId]);

  useEffect(() => {
    if (!selectedRewriteJobId && rewriteBatch?.jobs.length) {
      setSelectedRewriteJobId(rewriteBatch.jobs[0].id);
    }
  }, [rewriteBatch, selectedRewriteJobId]);

  useEffect(() => {
    if (!selectedHistoryJobId && selectedHistoryBatch?.jobs.length) {
      setSelectedHistoryJobId(selectedHistoryBatch.jobs[0].id);
    }
  }, [selectedHistoryBatch, selectedHistoryJobId]);

  useEffect(() => {
    const activeIds = [generateBatch, rewriteBatch]
      .filter((batch): batch is BatchTaskWithJobs => Boolean(batch))
      .filter((batch) => batch.status === 'queued' || batch.status === 'running')
      .map((batch) => batch.id);

    if (activeIds.length === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      for (const batchId of activeIds) {
        void refreshBatch(batchId);
      }
    }, 1200);

    return () => {
      window.clearInterval(timer);
    };
  }, [generateBatch, rewriteBatch]);

  async function initialize(): Promise<void> {
    setBusyKey('bootstrap');
    clearMessages();
    try {
      const nextSettings = await window.articleApp.settings.get();
      setSettings(nextSettings);
      setSettingsDraft(nextSettings);
      setGenerateOptions(nextSettings.defaultGenerateOptions);
      setRewriteOptions(nextSettings.defaultRewriteOptions);

      const batches = await window.articleApp.history.list();
      setHistory(batches);
      if (batches[0]) {
        setSelectedHistoryBatchId(batches[0].id);
        const fullBatch = await window.articleApp.history.getBatch(batches[0].id);
        setSelectedHistoryBatch(fullBatch);
      }
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setBusyKey('');
    }
  }

  async function loadHistory(): Promise<void> {
    const batches = await window.articleApp.history.list();
    setHistory(batches);
    if (!selectedHistoryBatchId && batches[0]) {
      setSelectedHistoryBatchId(batches[0].id);
    }
  }

  async function refreshBatch(batchId: string): Promise<void> {
    try {
      const batch = await window.articleApp.batches.getBatch(batchId);
      if (!batch) {
        return;
      }

      if (generateBatch?.id === batch.id) {
        setGenerateBatch(batch);
      }

      if (rewriteBatch?.id === batch.id) {
        setRewriteBatch(batch);
      }

      if (selectedHistoryBatchId === batch.id) {
        setSelectedHistoryBatch(batch);
      }

      if (batch.status !== 'queued' && batch.status !== 'running') {
        await loadHistory();
      }
    } catch (error) {
      setErrorMessage(toMessage(error));
    }
  }

  async function handleStartGenerate(): Promise<void> {
    clearMessages();
    setBusyKey('generate-start');

    try {
      const batch = await window.articleApp.generate.createBatch({
        titles: parsedTitles.titles,
        options: generateOptions
      });

      setGenerateBatch(batch);
      setSelectedGenerateJobId(batch.jobs[0]?.id ?? null);
      setView('generate');
      await loadHistory();
      setNotice(`已创建生成批次，共 ${batch.totalCount} 篇。`);
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setBusyKey('');
    }
  }

  async function handleImportRewriteFiles(): Promise<void> {
    clearMessages();
    setBusyKey('rewrite-import');

    try {
      const files = await window.articleApp.rewrite.selectSourceFiles();
      setRewriteSources(files);
      if (files.length > 0) {
        setNotice(`已导入 ${files.length} 个文件。`);
      }
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setBusyKey('');
    }
  }

  async function handleStartRewrite(): Promise<void> {
    clearMessages();
    setBusyKey('rewrite-start');

    try {
      const batch = await window.articleApp.rewrite.createBatch({
        sources: rewriteSources,
        options: rewriteOptions
      });

      setRewriteBatch(batch);
      setSelectedRewriteJobId(batch.jobs[0]?.id ?? null);
      setView('rewrite');
      await loadHistory();
      setNotice(`已创建改写批次，共 ${batch.totalCount} 篇。`);
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setBusyKey('');
    }
  }

  async function handleRetry(job: ArticleJob): Promise<void> {
    clearMessages();
    setBusyKey(`retry-${job.id}`);

    try {
      const nextBatch =
        job.type === 'generate'
          ? await window.articleApp.generate.retryJob(job.id)
          : await window.articleApp.rewrite.retryJob(job.id);

      if (nextBatch) {
        if (job.type === 'generate') {
          setGenerateBatch(nextBatch);
          setSelectedGenerateJobId(job.id);
        } else {
          setRewriteBatch(nextBatch);
          setSelectedRewriteJobId(job.id);
        }
      }

      await loadHistory();
      setNotice('已加入重试队列。');
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setBusyKey('');
    }
  }

  async function handleCancel(batch: BatchTaskWithJobs | null): Promise<void> {
    if (!batch) {
      return;
    }

    clearMessages();
    setBusyKey(`cancel-${batch.id}`);

    try {
      const nextBatch =
        batch.type === 'generate'
          ? await window.articleApp.generate.cancelBatch(batch.id)
          : await window.articleApp.rewrite.cancelBatch(batch.id);

      if (nextBatch) {
        if (batch.type === 'generate') {
          setGenerateBatch(nextBatch);
        } else {
          setRewriteBatch(nextBatch);
        }
      }

      await loadHistory();
      setNotice('批次已取消。');
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setBusyKey('');
    }
  }

  async function handleExport(batch: BatchTaskWithJobs | null): Promise<void> {
    if (!batch) {
      return;
    }

    clearMessages();
    setBusyKey(`export-${batch.id}`);

    try {
      const result = await window.articleApp.exports.exportBatch(batch.id);
      await refreshBatch(batch.id);
      await loadHistory();
      setNotice(`已导出 ${result.exportedCount} 篇文章到 ${result.directoryPath}`);
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setBusyKey('');
    }
  }

  async function handleOpenPath(targetPath: string): Promise<void> {
    clearMessages();
    setBusyKey(`open-${targetPath}`);

    try {
      await window.articleApp.exports.openPath(targetPath);
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setBusyKey('');
    }
  }

  async function handleSaveSettings(): Promise<void> {
    clearMessages();
    setBusyKey('settings-save');

    try {
      const saved = await window.articleApp.settings.save(settingsDraft);
      setSettings(saved);
      setSettingsDraft(saved);
      setGenerateOptions(saved.defaultGenerateOptions);
      setRewriteOptions(saved.defaultRewriteOptions);
      setNotice('设置已保存。');
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setBusyKey('');
    }
  }

  async function handlePickExportDirectory(): Promise<void> {
    clearMessages();
    setBusyKey('settings-directory');

    try {
      const selected = await window.articleApp.exports.selectDirectory();
      if (selected) {
        setSettingsDraft({
          ...settingsDraft,
          defaultExportDir: selected
        });
      }
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setBusyKey('');
    }
  }

  async function handleSelectHistory(batchId: string): Promise<void> {
    setSelectedHistoryBatchId(batchId);
    setBusyKey(`history-${batchId}`);

    try {
      const batch = await window.articleApp.history.getBatch(batchId);
      setSelectedHistoryBatch(batch);
      setSelectedHistoryJobId(batch?.jobs[0]?.id ?? null);
    } catch (error) {
      setErrorMessage(toMessage(error));
    } finally {
      setBusyKey('');
    }
  }

  async function handleCopy(text: string | null): Promise<void> {
    if (!text) {
      return;
    }

    clearMessages();

    try {
      await navigator.clipboard.writeText(text);
      setNotice('内容已复制到剪贴板。');
    } catch (error) {
      setErrorMessage(toMessage(error));
    }
  }

  function clearMessages(): void {
    setNotice('');
    setErrorMessage('');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Desktop MVP</p>
          <h1 className="sidebar-title">Batch Article Generator</h1>
          <p className="sidebar-copy">面向今日头条场景的批量文章生成与改写桌面工具。</p>
        </div>

        <nav className="nav-list">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${view === item.key ? 'nav-item--active' : ''}`}
              onClick={() => setView(item.key)}
              type="button"
            >
              <span>{item.title}</span>
              <small>{item.description}</small>
            </button>
          ))}
        </nav>

        <div className="status-card">
          <span className={`signal ${hasApiConfig ? 'signal--ok' : 'signal--warn'}`} />
          <div>
            <strong>{hasApiConfig ? '模型配置已就绪' : '请先完善 API 配置'}</strong>
            <p>{hasApiConfig ? `当前模型：${settings.model}` : '先到设置页填写 Base URL、API Key 和模型名。'}</p>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Current View</p>
            <h2>{NAV_ITEMS.find((item) => item.key === view)?.title}</h2>
          </div>
          <div className="header-pills">
            <span className="pill">生成批次 {generateBatch ? 1 : 0}</span>
            <span className="pill">改写批次 {rewriteBatch ? 1 : 0}</span>
            <span className="pill">历史 {history.length}</span>
          </div>
        </header>

        {notice ? <div className="banner banner--ok">{notice}</div> : null}
        {errorMessage ? <div className="banner banner--error">{errorMessage}</div> : null}

        {view === 'generate' ? (
          <div className="content-grid">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h3>标题输入</h3>
                  <p>每行一个标题，当前会按 {settings.maxConcurrentJobs} 路并发生成。</p>
                </div>
              </div>

              <label className="field">
                <span>标题文本块</span>
                <textarea
                  className="multiline"
                  placeholder={'示例：\n2026 年就业市场有哪些新变化\n年轻人为什么重新关注储蓄\n人工智能会如何改变内容行业'}
                  value={titleInput}
                  onChange={(event) => setTitleInput(event.target.value)}
                />
              </label>

              <div className="inline-notes">
                <span>解析后标题数：{parsedTitles.titles.length}</span>
                <span>重复标题：{parsedTitles.duplicates.length}</span>
                <span>超长标题：{parsedTitles.titles.filter((title) => title.length > TITLE_LIMIT).length}</span>
              </div>

              {parsedTitles.duplicates.length ? (
                <div className="hint-card">检测到重复标题：{parsedTitles.duplicates.join('、')}</div>
              ) : null}
              {hasTooLongTitles ? <div className="hint-card hint-card--warn">存在超过 {TITLE_LIMIT} 个字符的标题，建议缩短后再生成。</div> : null}

              <OptionsPanel
                generateOptions={generateOptions}
                rewriteOptions={rewriteOptions}
                mode="generate"
                onGenerateChange={setGenerateOptions}
                onRewriteChange={setRewriteOptions}
              />

              <div className="action-row">
                <button
                  className="button button--primary"
                  disabled={!hasApiConfig || parsedTitles.titles.length === 0 || hasTooLongTitles || busyKey === 'generate-start'}
                  onClick={() => void handleStartGenerate()}
                  type="button"
                >
                  {busyKey === 'generate-start' ? '创建中...' : '开始批量生成'}
                </button>
                <button
                  className="button"
                  disabled={!generateBatch || generateBatch.status !== 'running'}
                  onClick={() => void handleCancel(generateBatch)}
                  type="button"
                >
                  取消当前批次
                </button>
                <button
                  className="button"
                  disabled={!generateBatch}
                  onClick={() => void handleExport(generateBatch)}
                  type="button"
                >
                  导出 TXT
                </button>
              </div>
            </section>

            <section className="panel">
              <BatchWorkspace
                batch={generateBatch}
                selectedJobId={selectedGenerateJobId}
                onSelectJob={setSelectedGenerateJobId}
                selection={generateSelection}
                onRetry={handleRetry}
                onCopy={handleCopy}
                onExport={handleExport}
                onOpenPath={handleOpenPath}
              />
            </section>
          </div>
        ) : null}

        {view === 'rewrite' ? (
          <div className="content-grid">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h3>TXT 导入</h3>
                  <p>文件名自动作为标题，文件正文作为改写原文，当前按 {settings.maxConcurrentJobs} 路并发处理。</p>
                </div>
              </div>

              <div className="action-row">
                <button
                  className="button button--primary"
                  disabled={busyKey === 'rewrite-import'}
                  onClick={() => void handleImportRewriteFiles()}
                  type="button"
                >
                  {busyKey === 'rewrite-import' ? '读取中...' : '选择 TXT 文件'}
                </button>
                <button
                  className="button"
                  disabled={!hasApiConfig || rewriteSources.length === 0 || busyKey === 'rewrite-start'}
                  onClick={() => void handleStartRewrite()}
                  type="button"
                >
                  {busyKey === 'rewrite-start' ? '创建中...' : '开始批量改写'}
                </button>
              </div>

              <div className="inline-notes">
                <span>导入文件：{rewriteSources.length}</span>
                <span>有效文件：{validRewriteSources.length}</span>
                <span>异常文件：{rewriteSources.length - validRewriteSources.length}</span>
              </div>

              <div className="file-list">
                {rewriteSources.length === 0 ? <div className="empty-state">还没有导入文件。</div> : null}
                {rewriteSources.map((source) => (
                  <div
                    key={source.filePath}
                    className={`file-card ${source.errorMessage ? 'file-card--error' : ''}`}
                  >
                    <div>
                      <strong>{source.title}</strong>
                      <p>{source.fileName}</p>
                    </div>
                    <small>{source.errorMessage ?? `${source.sourceText.length} 字`}</small>
                  </div>
                ))}
              </div>

              <OptionsPanel
                generateOptions={generateOptions}
                rewriteOptions={rewriteOptions}
                mode="rewrite"
                onGenerateChange={setGenerateOptions}
                onRewriteChange={setRewriteOptions}
              />
            </section>

            <section className="panel">
              <BatchWorkspace
                batch={rewriteBatch}
                selectedJobId={selectedRewriteJobId}
                onSelectJob={setSelectedRewriteJobId}
                selection={rewriteSelection}
                onRetry={handleRetry}
                onCopy={handleCopy}
                onExport={handleExport}
                onOpenPath={handleOpenPath}
                showSourceComparison
              />
            </section>
          </div>
        ) : null}

        {view === 'history' ? (
          <div className="content-grid">
            <section className="panel history-panel">
              <div className="panel-header">
                <div>
                  <h3>最近批次</h3>
                  <p>查看执行结果、导出目录和详细内容。</p>
                </div>
              </div>

              <div className="history-list">
                {history.length === 0 ? <div className="empty-state">还没有历史批次。</div> : null}
                {history.map((item) => (
                  <button
                    key={item.id}
                    className={`history-item ${selectedHistoryBatchId === item.id ? 'history-item--active' : ''}`}
                    onClick={() => void handleSelectHistory(item.id)}
                    type="button"
                  >
                    <div>
                      <strong>{item.type === 'generate' ? '批量生成' : '文章改写'}</strong>
                      <p>{formatDateTime(item.createdAt)}</p>
                    </div>
                    <div className="history-meta">
                      <span>{statusText(item.status)}</span>
                      <small>
                        成功 {item.successCount}/{item.totalCount}
                      </small>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel">
              <BatchWorkspace
                batch={selectedHistoryBatch}
                selectedJobId={selectedHistoryJobId}
                onSelectJob={setSelectedHistoryJobId}
                selection={historySelection}
                onRetry={handleRetry}
                onCopy={handleCopy}
                onExport={handleExport}
                onOpenPath={handleOpenPath}
                showSourceComparison={selectedHistoryBatch?.type === 'rewrite'}
              />
            </section>
          </div>
        ) : null}

        {view === 'settings' ? (
          <div className="settings-grid">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h3>模型配置</h3>
                  <p>使用兼容 OpenAI `chat/completions` 的服务即可。</p>
                </div>
              </div>

              <div className="form-grid">
                <label className="field">
                  <span>API Base URL</span>
                  <input
                    type="text"
                    value={settingsDraft.apiBaseUrl}
                    onChange={(event) => setSettingsDraft({ ...settingsDraft, apiBaseUrl: event.target.value })}
                  />
                </label>

                <label className="field">
                  <span>API Key</span>
                  <input
                    type="password"
                    value={settingsDraft.apiKey}
                    onChange={(event) => setSettingsDraft({ ...settingsDraft, apiKey: event.target.value })}
                  />
                </label>

                <label className="field">
                  <span>模型名称</span>
                  <input
                    type="text"
                    placeholder="例如 gpt-4o-mini"
                    value={settingsDraft.model}
                    onChange={(event) => setSettingsDraft({ ...settingsDraft, model: event.target.value })}
                  />
                </label>

                <label className="field">
                  <span>请求超时（毫秒）</span>
                  <input
                    type="number"
                    min={1000}
                    step={1000}
                    value={settingsDraft.timeoutMs}
                    onChange={(event) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        timeoutMs: Number(event.target.value) || DEFAULT_SETTINGS.timeoutMs
                      })
                    }
                  />
                </label>

                <label className="field">
                  <span>失败后重试次数</span>
                  <input
                    type="number"
                    min={0}
                    max={3}
                    value={settingsDraft.retryCount}
                    onChange={(event) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        retryCount: Math.max(0, Number(event.target.value) || 0)
                      })
                    }
                  />
                </label>

                <label className="field">
                  <span>并发任务数</span>
                  <input
                    type="number"
                    min={MIN_CONCURRENT_JOBS}
                    max={MAX_CONCURRENT_JOBS}
                    value={settingsDraft.maxConcurrentJobs}
                    onChange={(event) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        maxConcurrentJobs: Math.min(
                          MAX_CONCURRENT_JOBS,
                          Math.max(MIN_CONCURRENT_JOBS, Number(event.target.value) || DEFAULT_SETTINGS.maxConcurrentJobs)
                        )
                      })
                    }
                  />
                </label>

                <label className="field field--wide">
                  <span>默认导出目录</span>
                  <div className="inline-input">
                    <input
                      type="text"
                      value={settingsDraft.defaultExportDir}
                      onChange={(event) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          defaultExportDir: event.target.value
                        })
                      }
                    />
                    <button
                      className="button"
                      onClick={() => void handlePickExportDirectory()}
                      type="button"
                    >
                      选择
                    </button>
                  </div>
                </label>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h3>默认写作参数</h3>
                  <p>保存后会同步更新生成页和改写页的初始参数。</p>
                </div>
              </div>

              <div className="options-grid">
                <label className="field">
                  <span>默认生成字数</span>
                  <input
                    type="number"
                    min={300}
                    step={100}
                    value={settingsDraft.defaultGenerateOptions.targetLength}
                    onChange={(event) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        defaultGenerateOptions: {
                          ...settingsDraft.defaultGenerateOptions,
                          targetLength: Number(event.target.value) || DEFAULT_GENERATE_OPTIONS.targetLength
                        }
                      })
                    }
                  />
                </label>

                <label className="field">
                  <span>默认改写字数</span>
                  <input
                    type="number"
                    min={300}
                    step={100}
                    value={settingsDraft.defaultRewriteOptions.targetLength}
                    onChange={(event) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        defaultRewriteOptions: {
                          ...settingsDraft.defaultRewriteOptions,
                          targetLength: Number(event.target.value) || DEFAULT_REWRITE_OPTIONS.targetLength
                        }
                      })
                    }
                  />
                </label>

                <label className="field field--wide">
                  <span>默认禁用词</span>
                  <input
                    type="text"
                    value={settingsDraft.defaultGenerateOptions.avoidTerms}
                    onChange={(event) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        defaultGenerateOptions: {
                          ...settingsDraft.defaultGenerateOptions,
                          avoidTerms: event.target.value
                        },
                        defaultRewriteOptions: {
                          ...settingsDraft.defaultRewriteOptions,
                          avoidTerms: event.target.value
                        }
                      })
                    }
                  />
                </label>
              </div>

              <div className="action-row">
                <button
                  className="button button--primary"
                  disabled={busyKey === 'settings-save'}
                  onClick={() => void handleSaveSettings()}
                  type="button"
                >
                  {busyKey === 'settings-save' ? '保存中...' : '保存设置'}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}

interface OptionsPanelProps {
  mode: 'generate' | 'rewrite';
  generateOptions: GenerateOptions;
  rewriteOptions: RewriteOptions;
  onGenerateChange: (options: GenerateOptions) => void;
  onRewriteChange: (options: RewriteOptions) => void;
}

function OptionsPanel(props: OptionsPanelProps): JSX.Element {
  if (props.mode === 'generate') {
    const options = props.generateOptions;

    return (
      <div className="options-grid">
        <label className="field">
          <span>目标字数</span>
          <input
            type="number"
            min={300}
            step={100}
            value={options.targetLength}
            onChange={(event) =>
              props.onGenerateChange({
                ...options,
                targetLength: Number(event.target.value) || DEFAULT_GENERATE_OPTIONS.targetLength
              })
            }
          />
        </label>

        <label className="field">
          <span>风格预设</span>
          <select
            value={options.stylePreset}
            onChange={(event) =>
              props.onGenerateChange({
                ...options,
                stylePreset: event.target.value
              })
            }
          >
            {STYLE_PRESETS.map((preset) => (
              <option
                key={preset}
                value={preset}
              >
                {preset}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>语气预设</span>
          <select
            value={options.tonePreset}
            onChange={(event) =>
              props.onGenerateChange({
                ...options,
                tonePreset: event.target.value
              })
            }
          >
            {TONE_PRESETS.map((preset) => (
              <option
                key={preset}
                value={preset}
              >
                {preset}
              </option>
            ))}
          </select>
        </label>

        <label className="field field--toggle">
          <input
            checked={options.openingHookEnabled}
            type="checkbox"
            onChange={(event) =>
              props.onGenerateChange({
                ...options,
                openingHookEnabled: event.target.checked
              })
            }
          />
          <span>开头增强吸引力</span>
        </label>

        <label className="field field--wide">
          <span>禁用词</span>
          <input
            type="text"
            value={options.avoidTerms}
            onChange={(event) =>
              props.onGenerateChange({
                ...options,
                avoidTerms: event.target.value
              })
            }
          />
        </label>
      </div>
    );
  }

  const options = props.rewriteOptions;
  return (
    <div className="options-grid">
      <label className="field">
        <span>目标字数</span>
        <input
          type="number"
          min={300}
          step={100}
          value={options.targetLength}
          onChange={(event) =>
            props.onRewriteChange({
              ...options,
              targetLength: Number(event.target.value) || DEFAULT_REWRITE_OPTIONS.targetLength
            })
          }
        />
      </label>

      <label className="field">
        <span>风格预设</span>
        <select
          value={options.stylePreset}
          onChange={(event) =>
            props.onRewriteChange({
              ...options,
              stylePreset: event.target.value
            })
          }
        >
          {STYLE_PRESETS.map((preset) => (
            <option
              key={preset}
              value={preset}
            >
              {preset}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>语气预设</span>
        <select
          value={options.tonePreset}
          onChange={(event) =>
            props.onRewriteChange({
              ...options,
              tonePreset: event.target.value
            })
          }
        >
          {TONE_PRESETS.map((preset) => (
            <option
              key={preset}
              value={preset}
            >
              {preset}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>改写强度</span>
        <select
          value={options.rewriteStrength}
          onChange={(event) =>
            props.onRewriteChange({
              ...options,
              rewriteStrength: event.target.value as RewriteOptions['rewriteStrength']
            })
          }
        >
          {REWRITE_STRENGTH_OPTIONS.map((preset) => (
            <option
              key={preset}
              value={preset}
            >
              {preset}
            </option>
          ))}
        </select>
      </label>

      <label className="field field--toggle">
        <input
          checked={options.preserveOriginalMeaning}
          type="checkbox"
          onChange={(event) =>
            props.onRewriteChange({
              ...options,
              preserveOriginalMeaning: event.target.checked
            })
          }
        />
        <span>优先保留原意</span>
      </label>

      <label className="field field--wide">
        <span>禁用词</span>
        <input
          type="text"
          value={options.avoidTerms}
          onChange={(event) =>
            props.onRewriteChange({
              ...options,
              avoidTerms: event.target.value
            })
          }
        />
      </label>
    </div>
  );
}

interface BatchWorkspaceProps {
  batch: BatchTaskWithJobs | null;
  selectedJobId: string | null;
  selection: ArticleJob | null;
  showSourceComparison?: boolean;
  onSelectJob: (jobId: string | null) => void;
  onRetry: (job: ArticleJob) => Promise<void>;
  onCopy: (text: string | null) => Promise<void>;
  onExport: (batch: BatchTaskWithJobs | null) => Promise<void>;
  onOpenPath: (path: string) => Promise<void>;
}

function BatchWorkspace(props: BatchWorkspaceProps): JSX.Element {
  if (!props.batch) {
    return <div className="empty-state empty-state--large">这里会显示当前批次的任务队列和文章预览。</div>;
  }

  return (
    <div className="batch-workspace">
      <div className="batch-summary">
        <div>
          <h3>{props.batch.type === 'generate' ? '批量生成结果' : '改写结果'}</h3>
          <p>
            状态：{statusText(props.batch.status)} · 进行中 {props.batch.jobs.filter((job) => job.status === 'running').length} · 成功{' '}
            {props.batch.successCount}/{props.batch.totalCount} · 失败 {props.batch.failedCount}
          </p>
        </div>
        <div className="action-row">
          <button
            className="button"
            onClick={() => void props.onExport(props.batch)}
            type="button"
          >
            导出 TXT
          </button>
          {props.batch.exportDirectory ? (
            <button
              className="button"
              onClick={() => void props.onOpenPath(props.batch.exportDirectory!)}
              type="button"
            >
              打开导出目录
            </button>
          ) : null}
        </div>
      </div>

      <div className="workspace-split">
        <div className="job-list">
          {props.batch.jobs.map((job) => (
            <button
              key={job.id}
              className={`job-item ${props.selectedJobId === job.id ? 'job-item--active' : ''}`}
              onClick={() => props.onSelectJob(job.id)}
              type="button"
            >
              <div>
                <strong>{job.title}</strong>
                <p>{statusText(job.status)}</p>
              </div>
              <small>
                {job.finishedAt ? formatDateTime(job.finishedAt) : job.status === 'queued' ? '排队中' : '进行中'}
              </small>
            </button>
          ))}
        </div>

        <div className="preview-column">
          {props.selection ? (
            <>
              <div className="preview-header">
                <div>
                  <h4>{props.selection.title}</h4>
                  <p>
                    当前状态：{statusText(props.selection.status)}
                    {props.selection.errorMessage ? ` · ${props.selection.errorMessage}` : ''}
                  </p>
                </div>
                <div className="action-row">
                  <button
                    className="button"
                    disabled={!props.selection.resultText}
                    onClick={() => void props.onCopy(props.selection.resultText)}
                    type="button"
                  >
                    复制正文
                  </button>
                  <button
                    className="button"
                    disabled={props.selection.status === 'running'}
                    onClick={() => void props.onRetry(props.selection!)}
                    type="button"
                  >
                    重试此条
                  </button>
                </div>
              </div>

              {props.showSourceComparison ? (
                <div className="comparison-grid">
                  <article className="article-card">
                    <h5>原文</h5>
                    <pre>{props.selection.sourceText || '暂无原文'}</pre>
                  </article>
                  <article className="article-card">
                    <h5>改写结果</h5>
                    <pre>{props.selection.resultText || props.selection.errorMessage || '等待生成中...'}</pre>
                  </article>
                </div>
              ) : (
                <article className="article-card article-card--full">
                  <h5>文章预览</h5>
                  <pre>{props.selection.resultText || props.selection.errorMessage || '等待生成中...'}</pre>
                </article>
              )}
            </>
          ) : (
            <div className="empty-state empty-state--large">选择左侧任务后，这里会展示文章内容。</div>
          )}
        </div>
      </div>
    </div>
  );
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误';
}

export default App;
