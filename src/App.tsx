import {
  ArrowRight,
  Download,
  ExternalLink,
  FolderGit2,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CodeExplorer } from './components/CodeExplorer';
import { GithubPushPanel } from './components/GithubPushPanel';
import { formatBytes, LanguageBar } from './components/LanguageBar';
import { LivePreview } from './components/LivePreview';
import type {
  LanguageStat,
  NetlifyMode,
  RefactorOutput,
  RefactorPreset,
  RepoInspection,
} from './types';

type ActiveTab = 'overview' | 'code' | 'preview' | 'push';

const DEFAULT_OWNER = 'srikrishnanookala18-lab';
const DEFAULT_REPO = 'portfolio2';
const DEFAULT_NETLIFY_URL = 'https://portfolio-srikrishnanookala.netlify.app';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [repoInput, setRepoInput] = useState(`${DEFAULT_OWNER}/${DEFAULT_REPO}`);
  const [netlifyUrl, setNetlifyUrl] = useState(DEFAULT_NETLIFY_URL);
  const [preset, setPreset] = useState<RefactorPreset>('python-first');
  const [netlifyMode] = useState<NetlifyMode>('netlify-toml');

  const [inspection, setInspection] = useState<RepoInspection | null>(null);
  const [refactorResult, setRefactorResult] = useState<RefactorOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const parseRepoInput = (raw: string): { owner: string; repo: string } => {
    const cleaned = raw
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/\/+$/, '');
    const parts = cleaned.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1] };
    }
    return { owner: DEFAULT_OWNER, repo: DEFAULT_REPO };
  };

  const runInspectionAndRefactor = useCallback(
    async (targetRepoStr: string, targetPreset: RefactorPreset) => {
      setLoading(true);
      setError(null);
      const { owner, repo } = parseRepoInput(targetRepoStr);

      try {
        const inspectRes = await fetch(
          `/api/repo/inspect?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`
        );
        const inspectData = await inspectRes.json();
        if (!inspectRes.ok) {
          throw new Error(inspectData.error || 'Failed to inspect GitHub repository.');
        }

        const inspected = inspectData as RepoInspection;
        setInspection(inspected);

        if (!inspected.primaryHtmlFile || !inspected.rawHtml) {
          throw new Error(
            `No standalone HTML file was found in ${owner}/${repo} to refactor.`
          );
        }

        const refactorRes = await fetch('/api/repo/refactor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            owner: inspected.owner,
            repo: inspected.repo,
            originalFilename: inspected.primaryHtmlFile,
            rawHtml: inspected.rawHtml,
            preset: targetPreset,
            netlifyMode,
          }),
        });
        const refactorData = await refactorRes.json();
        if (!refactorRes.ok) {
          throw new Error(refactorData.error || 'Failed to run Python refactoring.');
        }

        setRefactorResult(refactorData as RefactorOutput);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unexpected analysis error.');
      } finally {
        setLoading(false);
      }
    },
    [netlifyMode]
  );

  useEffect(() => {
    runInspectionAndRefactor(`${DEFAULT_OWNER}/${DEFAULT_REPO}`, 'python-first');
  }, [runInspectionAndRefactor]);

  const handlePresetChange = async (nextPreset: RefactorPreset) => {
    setPreset(nextPreset);
    if (!inspection?.rawHtml || !inspection.primaryHtmlFile) {
      await runInspectionAndRefactor(repoInput, nextPreset);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const refactorRes = await fetch('/api/repo/refactor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: inspection.owner,
          repo: inspection.repo,
          originalFilename: inspection.primaryHtmlFile,
          rawHtml: inspection.rawHtml,
          preset: nextPreset,
          netlifyMode,
        }),
      });
      const refactorData = await refactorRes.json();
      if (!refactorRes.ok) {
        throw new Error(refactorData.error || 'Failed to regenerate preset.');
      }
      setRefactorResult(refactorData as RefactorOutput);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preset update failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!refactorResult) return;
    setIsDownloading(true);
    try {
      const res = await fetch('/api/repo/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: refactorResult.files,
          repo: refactorResult.repo,
        }),
      });
      if (!res.ok) throw new Error('ZIP export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${refactorResult.repo}-python-refactored.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to download ZIP archive.');
    } finally {
      setIsDownloading(false);
    }
  };

  const beforeLanguages: LanguageStat[] = inspection?.languages
    ? (() => {
        const total = Object.values(inspection.languages).reduce((a, b) => a + b, 0) || 1;
        return Object.entries(inspection.languages).map(([language, bytes]) => ({
          language,
          bytes,
          percentage: Number(((bytes / total) * 100).toFixed(1)),
          color: language === 'HTML' ? '#e34c26' : '#64748b',
        }));
      })()
    : [];

  const beforeTotalBytes = beforeLanguages.reduce((acc, item) => acc + item.bytes, 0);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-[1280px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('overview');
            }}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            PyRefactor Studio
          </a>

          {/* Zone 2: 4 concise single-line nav links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium" aria-label="Workspace sections">
            {(
              [
                { id: 'overview', label: 'Overview' },
                { id: 'code', label: 'Code Explorer' },
                { id: 'preview', label: 'Live Preview' },
                { id: 'push', label: 'Push to GitHub' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  activeTab === tab.id
                    ? 'text-blue-600 border-blue-600 font-semibold'
                    : 'text-slate-600 border-transparent hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              disabled={!refactorResult || isDownloading}
              onClick={handleDownloadZip}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isDownloading ? 'Packaging...' : 'Download ZIP'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Tab Switcher */}
      <div className="md:hidden bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-2 overflow-x-auto">
        {(
          [
            { id: 'overview', label: 'Overview' },
            { id: 'code', label: 'Code Explorer' },
            { id: 'preview', label: 'Live Preview' },
            { id: 'push', label: 'Push to GitHub' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <main id="top" className="flex-1 max-w-[1280px] w-full mx-auto px-6 py-8 space-y-6">
        {/* Workspace Control Bar */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-end justify-between gap-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runInspectionAndRefactor(repoInput, preset);
            }}
            className="flex-1 grid grid-cols-1 sm:grid-cols-[1.2fr_1fr_auto] gap-3 items-end"
          >
            <div>
              <label htmlFor="repo-input" className="block text-xs font-semibold text-slate-700 mb-1.5">
                GitHub Repository
              </label>
              <div className="relative">
                <FolderGit2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="repo-input"
                  type="text"
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="netlify-input" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Live Netlify URL
              </label>
              <input
                id="netlify-input"
                type="url"
                value={netlifyUrl}
                onChange={(e) => setNetlifyUrl(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-slate-800 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 h-[38px]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Analyze &amp; Refactor</span>
            </button>
          </form>

          {/* Python Ratio Preset Selector */}
          <div className="shrink-0">
            <span className="block text-xs font-semibold text-slate-700 mb-1.5">
              Target Python Architecture
            </span>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'balanced', label: 'Balanced (~42%)' },
                  { id: 'standard', label: 'Standard (~47%)' },
                  { id: 'python-first', label: 'Python-First (50%)' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={loading}
                  onClick={() => handlePresetChange(opt.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    preset === opt.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-center justify-between gap-4">
            <p className="text-sm text-red-900">{error}</p>
            <button
              type="button"
              onClick={() => runInspectionAndRefactor(repoInput, preset)}
              className="px-3.5 py-1.5 text-xs font-semibold text-red-900 bg-white border border-red-200 rounded-lg hover:bg-red-100 whitespace-nowrap shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {loading && !refactorResult ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="bg-white border border-slate-200 rounded-xl p-5 h-24 animate-pulse" />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white border border-slate-200 rounded-xl p-6 h-64 animate-pulse" />
              <div className="bg-white border border-slate-200 rounded-xl p-6 h-64 animate-pulse" />
            </div>
          </div>
        ) : refactorResult ? (
          <>
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* 4-Column Metric Strip */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white border border-slate-200 rounded-xl p-5">
                    <div className="text-xs font-medium text-slate-500">Original Repository</div>
                    <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
                      100.0% HTML
                    </div>
                    <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                      1 monolith file &middot; {formatBytes(refactorResult.originalBytes)}
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-5">
                    <div className="text-xs font-medium text-slate-500">Refactored Python Share</div>
                    <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-blue-600">
                      {refactorResult.pythonPercentage.toFixed(1)}% Python
                    </div>
                    <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                      {refactorResult.files.filter((f) => f.language === 'Python').length} Python modules
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-5">
                    <div className="text-xs font-medium text-slate-500">Static Build Verification</div>
                    <div
                      className={`mt-1.5 text-2xl font-bold ${
                        refactorResult.verification.buildSuccess
                          ? 'text-emerald-700'
                          : 'text-red-700'
                      }`}
                    >
                      {refactorResult.verification.buildSuccess ? 'Compiled' : 'Error'}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                      dist/index.html &middot; {formatBytes(refactorResult.verification.renderedHtmlBytes)}
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-5">
                    <div className="text-xs font-medium text-slate-500">Automated Unit Tests</div>
                    <div
                      className={`mt-1.5 text-2xl font-bold ${
                        refactorResult.verification.testsSuccess
                          ? 'text-emerald-700'
                          : 'text-red-700'
                      }`}
                    >
                      {refactorResult.verification.testsSuccess ? 'Passing' : 'Failing'}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 font-mono">
                      python3 -m unittest
                    </div>
                  </div>
                </div>

                {/* Before vs After Language Breakdown */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <LanguageBar
                    title="Current GitHub Repository"
                    subtitle={`${refactorResult.owner}/${refactorResult.repo} (single HTML monolith)`}
                    languages={beforeLanguages}
                    totalBytes={beforeTotalBytes}
                  />

                  <LanguageBar
                    title="Refactored Repository Breakdown"
                    subtitle="Honest GitHub Linguist byte ratio (no .gitattributes overrides)"
                    languages={refactorResult.languages}
                    totalBytes={refactorResult.totalCodeBytes}
                  />
                </div>

                {/* Module Breakdown Table */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">
                        Extracted Modular Architecture
                      </h3>
                      <p className="text-sm text-slate-500 mt-0.5">
                        Decomposes {formatBytes(refactorResult.originalBytes)} of inline HTML/CSS/JS into typed Python modules, Flask routes, and a zero-dependency Netlify builder.
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <a
                        href={inspection?.htmlUrl || `https://github.com/${DEFAULT_OWNER}/${DEFAULT_REPO}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>GitHub Repo</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <span className="text-slate-300" aria-hidden="true">/</span>
                      <a
                        href={netlifyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>Netlify Live</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                          <th className="py-2.5 px-6">File Path</th>
                          <th className="py-2.5 px-4">Language</th>
                          <th className="py-2.5 px-4">Purpose</th>
                          <th className="py-2.5 px-6 text-right">Size</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {refactorResult.files.map((file) => (
                          <tr
                            key={file.path}
                            onClick={() => setActiveTab('code')}
                            className="hover:bg-slate-50 cursor-pointer transition-colors"
                          >
                            <td className="py-2.5 px-6 font-mono text-xs font-medium text-slate-900 whitespace-nowrap">
                              {file.path}
                            </td>
                            <td className="py-2.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                              {file.language}
                            </td>
                            <td className="py-2.5 px-4 text-xs text-slate-600">
                              {file.description}
                            </td>
                            <td className="py-2.5 px-6 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                              {file.bytes.toLocaleString()} B
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Next Step Action Bar */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">
                      Ready to update {refactorResult.owner}/{refactorResult.repo}
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Inspect the compiled site preview first, or grant scoped GitHub access to push this commit directly to main.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveTab('preview')}
                      className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                    >
                      Verify Live Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('push')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
                    >
                      <span>Push to GitHub</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'code' && (
              <CodeExplorer
                files={refactorResult.files}
                verification={refactorResult.verification}
              />
            )}

            {activeTab === 'preview' && (
              <LivePreview
                renderedHtml={refactorResult.renderedPreviewHtml}
                netlifyUrl={netlifyUrl}
                renderedHtmlBytes={refactorResult.verification.renderedHtmlBytes}
              />
            )}

            {activeTab === 'push' && (
              <GithubPushPanel
                refactorResult={refactorResult}
                defaultBranch={inspection?.defaultBranch || 'main'}
                onDownloadZip={handleDownloadZip}
                isDownloading={isDownloading}
              />
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
