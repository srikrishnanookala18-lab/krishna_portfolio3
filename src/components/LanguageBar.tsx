import type { LanguageStat } from '../types';

interface LanguageBarProps {
  title: string;
  subtitle: string;
  languages: LanguageStat[];
  totalBytes: number;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function LanguageBar({ title, subtitle, languages, totalBytes }: LanguageBarProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        <span className="font-mono text-xs text-slate-500 tabular-nums shrink-0">
          {totalBytes.toLocaleString()} B total
        </span>
      </div>

      {/* GitHub Linguist stacked horizontal bar */}
      <div
        className="w-full h-3 rounded-full overflow-hidden flex bg-slate-100 mb-5"
        role="img"
        aria-label={`Language breakdown for ${title}`}
      >
        {languages.map((lang) => (
          <div
            key={lang.language}
            style={{
              width: `${Math.max(lang.percentage, 0.5)}%`,
              backgroundColor: lang.color,
            }}
            title={`${lang.language}: ${lang.percentage}% (${lang.bytes.toLocaleString()} B)`}
          />
        ))}
      </div>

      <div className="divide-y divide-slate-100">
        {languages.map((lang) => (
          <div
            key={lang.language}
            className="flex items-center justify-between py-2.5 text-sm"
          >
            <div className="flex items-center gap-2.5">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: lang.color }}
                aria-hidden="true"
              />
              <span className="font-medium text-slate-800">{lang.language}</span>
            </div>
            <div className="flex items-center gap-4 font-mono text-xs tabular-nums">
              <span className="text-slate-500">{formatBytes(lang.bytes)}</span>
              <span className="font-semibold text-slate-900 w-12 text-right">
                {lang.percentage.toFixed(1)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
