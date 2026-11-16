import { CheckCircle2, Download, ExternalLink, GitCommit, KeyRound, ShieldCheck, Terminal } from 'lucide-react';
import { useState } from 'react';
import type {
  GeneratedFile,
  GithubPushResponse,
  GithubVerifyResponse,
  RefactorOutput,
} from '../types';

interface GithubPushPanelProps {
  refactorResult: RefactorOutput;
  defaultBranch: string;
  onDownloadZip: () => Promise<void>;
  isDownloading: boolean;
}

export function GithubPushPanel({
  refactorResult,
  defaultBranch,
  onDownloadZip,
  isDownloading,
}: GithubPushPanelProps) {
  const [token, setToken] = useState('');
  const [branch, setBranch] = useState(defaultBranch || 'main');
  const [commitMessage, setCommitMessage] = useState(
    `Refactor portfolio into modular Python app (${refactorResult.pythonPercentage}% Python) with Netlify SSG`
  );
  const [removeOriginal, setRemoveOriginal] = useState(true);

  const [verifying, setVerifying] = useState(false);
  const [verifyInfo, setVerifyInfo] = useState<GithubVerifyResponse | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<GithubPushResponse | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  const handleVerifyToken = async () => {
    setVerifyError(null);
    setVerifyInfo(null);
    setVerifying(true);
    try {
      const res = await fetch('/api/github/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          owner: refactorResult.owner,
          repo: refactorResult.repo,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyError(data.error || 'Token verification failed.');
      } else {
        setVerifyInfo(data as GithubVerifyResponse);
        if (data.defaultBranch) setBranch(data.defaultBranch);
      }
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Network error verifying token.');
    } finally {
      setVerifying(false);
    }
  };

  const handlePushToGithub = async () => {
    setPushError(null);
    setPushResult(null);
    setPushing(true);
    try {
      const res = await fetch('/api/github/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          owner: refactorResult.owner,
          repo: refactorResult.repo,
          branch,
          commitMessage,
          files: refactorResult.files,
          removeOriginalFile: removeOriginal ? refactorResult.originalFilename : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPushError(data.error || 'Failed to push commit to GitHub.');
      } else {
        setPushResult(data as GithubPushResponse);
      }
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Network error pushing to GitHub.');
    } finally {
      setPushing(false);
    }
  };

  const updatedLanguagesList = pushResult?.updatedLanguages
    ? (() => {
        const total = Object.values(pushResult.updatedLanguages).reduce((a, b) => a + b, 0) || 1;
        return Object.entries(pushResult.updatedLanguages)
          .map(([lang, bytes]) => ({
            lang,
            bytes,
            pct: ((bytes / total) * 100).toFixed(1),
          }))
          .sort((a, b) => b.bytes - a.bytes);
      })()
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6 items-start">
      {/* Direct GitHub Push Form */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Push Refactored Python Repo Directly to GitHub
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Commits all {refactorResult.files.length} files to{' '}
            <span className="font-mono text-slate-800">
              {refactorResult.owner}/{refactorResult.repo}
            </span>{' '}
            via the official GitHub Git Data API. Your token is used only for this request and is never stored.
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-600 space-y-1.5">
          <p className="font-semibold text-slate-800">How to grant scoped write access in 30 seconds:</p>
          <p>1. Open GitHub Settings &rarr; Developer settings &rarr; Personal access tokens &rarr; Fine-grained tokens.</p>
          <p>
            2. Select repository <span className="font-mono text-slate-800">{refactorResult.repo}</span> only, and set{' '}
            <span className="font-semibold text-slate-800">Contents: Read and write</span>.
          </p>
          <p>3. Paste the token below, click Verify Access, and click Commit &amp; Push.</p>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="gh-token" className="block text-xs font-semibold text-slate-700 mb-1.5">
              GitHub Personal Access Token
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="gh-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="github_pat_... or ghp_..."
                  className="w-full pl-9 pr-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <button
                type="button"
                disabled={!token.trim() || verifying}
                onClick={handleVerifyToken}
                className="px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                {verifying ? 'Verifying...' : 'Verify Access'}
              </button>
            </div>
          </div>

          {verifyError && (
            <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg">
              {verifyError}
            </div>
          )}

          {verifyInfo && (
            <div className="p-3 text-xs bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-emerald-900">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Authenticated as <span className="font-mono font-semibold">@{verifyInfo.login}</span>{' '}
                  &middot; Push access: {verifyInfo.canPush ? 'Granted' : 'Read-only'}
                </span>
              </div>
              <span className="font-mono text-emerald-700">branch: {verifyInfo.defaultBranch}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="gh-branch" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Target Branch
              </label>
              <input
                id="gh-branch"
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="gh-msg" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Commit Message
              </label>
              <input
                id="gh-msg"
                type="text"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <label className="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={removeOriginal}
              onChange={(e) => setRemoveOriginal(e.target.checked)}
              className="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>
              Remove legacy monolith <span className="font-mono text-xs text-slate-900">{refactorResult.originalFilename}</span>{' '}
              (required so GitHub Linguist drops HTML from 100% down to ~15% and raises Python to {refactorResult.pythonPercentage}%)
            </span>
          </label>

          {pushError && (
            <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg">
              {pushError}
            </div>
          )}

          {pushResult && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Committed {pushResult.filesCommitted} files to {branch}</span>
                </div>
                <a
                  href={pushResult.commitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:underline whitespace-nowrap"
                >
                  <span className="font-mono">{pushResult.commitSha.slice(0, 7)}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              {updatedLanguagesList && (
                <div className="pt-2 border-t border-emerald-200/80">
                  <p className="text-xs font-medium text-emerald-900 mb-1.5">
                    Live GitHub Languages API Response:
                  </p>
                  <div className="flex flex-wrap gap-4 font-mono text-xs text-emerald-800 tabular-nums">
                    {updatedLanguagesList.map((item) => (
                      <span key={item.lang}>
                        {item.lang}: {item.pct}%
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!token.trim() || pushing}
              onClick={handlePushToGithub}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <GitCommit className="w-4 h-4" />
              <span>{pushing ? 'Pushing Commit...' : 'Commit & Push to GitHub'}</span>
            </button>

            <button
              type="button"
              disabled={isDownloading}
              onClick={onDownloadZip}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>{isDownloading ? 'Packaging ZIP...' : 'Download ZIP Instead'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Commit manifest & Netlify deployment notes */}
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h4 className="text-sm font-semibold text-slate-900 mb-3">
            Commit Change Manifest
          </h4>
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {removeOriginal && (
              <div className="py-2 flex items-center justify-between gap-2 text-xs">
                <span className="font-mono text-red-700 truncate">
                  - {refactorResult.originalFilename}
                </span>
                <span className="text-red-600 font-semibold shrink-0">Delete</span>
              </div>
            )}
            {refactorResult.files.map((f: GeneratedFile) => (
              <div key={f.path} className="py-2 flex items-center justify-between gap-2 text-xs">
                <span className="font-mono text-slate-800 truncate">+ {f.path}</span>
                <span className="font-mono text-slate-500 tabular-nums shrink-0">
                  {f.language}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-slate-600" />
            <h4 className="text-sm font-semibold text-slate-900">
              Netlify Compatibility Guaranteed
            </h4>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            The included <span className="font-mono text-slate-800">netlify.toml</span> runs{' '}
            <span className="font-mono text-slate-800">python3 build_static.py --out dist</span>{' '}
            using Python&apos;s standard library (zero pip install failures) and publishes{' '}
            <span className="font-mono text-slate-800">dist/index.html</span> automatically on every push.
          </p>
        </div>
      </div>
    </div>
  );
}
