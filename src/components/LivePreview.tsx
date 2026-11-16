import { ExternalLink, Monitor, Smartphone } from 'lucide-react';
import { useState } from 'react';

interface LivePreviewProps {
  renderedHtml: string;
  netlifyUrl: string;
  renderedHtmlBytes: number;
}

export function LivePreview({ renderedHtml, netlifyUrl, renderedHtmlBytes }: LivePreviewProps) {
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Compiled Portfolio Output Preview
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Built live via <span className="font-mono">python3 build_static.py</span> ({(renderedHtmlBytes / 1024).toFixed(1)} KB output) — verifies interactive charts, filters, and demos remain intact.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setViewport('desktop')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewport === 'desktop'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>Desktop</span>
            </button>
            <button
              type="button"
              onClick={() => setViewport('mobile')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewport === 'mobile'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Mobile</span>
            </button>
          </div>

          <a
            href={netlifyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <span>Open Live Netlify Site</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      <div className="bg-slate-100 p-4 flex justify-center">
        <div
          className={`bg-white border border-slate-300 rounded-lg overflow-hidden transition-all ${
            viewport === 'mobile' ? 'w-[390px]' : 'w-full'
          }`}
        >
          <iframe
            title="Compiled Python Portfolio Preview"
            srcDoc={renderedHtml}
            className="w-full h-[680px] border-0"
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      </div>
    </div>
  );
}
