import { Check, Copy, FileCode2, Terminal } from 'lucide-react';
import { useState } from 'react';
import type { GeneratedFile, VerificationResult } from '../types';
import { formatBytes } from './LanguageBar';

interface CodeExplorerProps {
  files: GeneratedFile[];
  verification: VerificationResult;
}

const LANG_SHORT: Record<GeneratedFile['language'], string> = {
  Python: 'PY',
  HTML: 'HTML',
  CSS: 'CSS',
  JavaScript: 'JS',
  TOML: 'TOML',
  Markdown: 'MD',
  Text: 'TXT',
};

export function CodeExplorer({ files, verification }: CodeExplorerProps) {
  const [selectedPath, setSelectedPath] = useState<string>(files[0]?.path || '');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [filterLang, setFilterLang] = useState<string>('ALL');

  const visibleFiles =
    filterLang === 'ALL' ? files : files.filter((f) => f.language === filterLang);

  const activeFile =
    files.find((f) => f.path === selectedPath) || visibleFiles[0] || files[0];

  const handleCopy = async (file: GeneratedFile) => {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopiedPath(file.path);
      setTimeout(() => setCopiedPath(null), 1800);
    } catch {
      // Clipboard blocked in some iframe contexts
    }
  };

  return (
    <div className="space-y-6">
      {/* File explorer + code viewer */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-[300px_1fr]">
        {/* Sidebar file list */}
        <aside className="border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50/70 flex flex-col">
          <div className="p-4 border-b border-slate-200">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-sm font-semibold text-slate-900">Repository Files</span>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {visibleFiles.length} files
              </span>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
              {(['ALL', 'Python', 'HTML', 'CSS', 'JavaScript'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setFilterLang(lang)}
                  className={`flex-1 px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    filterLang === lang
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {lang === 'JavaScript' ? 'JS' : lang === 'ALL' ? 'All' : lang}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-200/70 overflow-y-auto max-h-[560px]">
            {visibleFiles.map((file) => {
              const isSelected = activeFile?.path === file.path;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedPath(file.path)}
                  className={`w-full text-left px-4 py-3 flex items-center justify-between gap-3 transition-colors ${
                    isSelected
                      ? 'bg-blue-50/80 text-blue-950'
                      : 'hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-semibold text-slate-500 w-8 shrink-0">
                        {LANG_SHORT[file.language]}
                      </span>
                      <span className="font-mono text-xs truncate">{file.path}</span>
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                    {formatBytes(file.bytes)}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Code content pane */}
        <div className="min-w-0 flex flex-col">
          {activeFile ? (
            <>
              <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 bg-white">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileCode2 className="w-4 h-4 text-slate-500 shrink-0" />
                    <span className="font-mono text-sm font-semibold text-slate-900 truncate">
                      {activeFile.path}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="text-xs text-slate-500 whitespace-nowrap">
                      {activeFile.language}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {activeFile.bytes.toLocaleString()} bytes
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{activeFile.description}</p>
                </div>

                <button
                  type="button"
                  onClick={() => handleCopy(activeFile)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                >
                  {copiedPath === activeFile.path ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                      <span>Copy File</span>
                    </>
                  )}
                </button>
              </div>

              <div className="bg-slate-950 text-slate-100 overflow-auto max-h-[540px] p-4">
                <pre className="font-mono text-xs leading-6 whitespace-pre">
                  <code>{activeFile.content}</code>
                </pre>
              </div>
            </>
          ) : (
            <div className="p-8 text-sm text-slate-500">No files match the selected filter.</div>
          )}
        </div>
      </div>

      {/* Real Python build & unittest execution results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-slate-600" />
              <h3 className="text-sm font-semibold text-slate-900">
                Static Build Execution (python3 build_static.py)
              </h3>
            </div>
            <span
              className={`text-xs font-semibold ${
                verification.buildSuccess ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              {verification.buildSuccess ? 'Passed' : 'Failed'}
            </span>
          </div>
          <pre className="bg-slate-950 text-slate-200 font-mono text-xs p-3.5 rounded-lg overflow-x-auto leading-5">
            {verification.buildOutput || 'No output'}
          </pre>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-slate-600" />
              <h3 className="text-sm font-semibold text-slate-900">
                Python Unit Tests (python3 -m unittest)
              </h3>
            </div>
            <span
              className={`text-xs font-semibold ${
                verification.testsSuccess ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              {verification.testsSuccess ? 'All Tests Passed' : 'Failed'}
            </span>
          </div>
          <pre className="bg-slate-950 text-slate-200 font-mono text-xs p-3.5 rounded-lg overflow-x-auto max-h-48 leading-5">
            {verification.testOutput || 'No output'}
          </pre>
        </div>
      </div>
    </div>
  );
}
