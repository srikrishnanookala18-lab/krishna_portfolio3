import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type RefactorPreset = 'balanced' | 'standard' | 'python-first';
export type NetlifyMode = 'netlify-toml' | 'root-index';

export interface GeneratedFile {
  path: string;
  content: string;
  language: 'Python' | 'HTML' | 'CSS' | 'JavaScript' | 'TOML' | 'Markdown' | 'Text';
  bytes: number;
  description: string;
}

export interface LanguageStat {
  language: string;
  bytes: number;
  percentage: number;
  color: string;
}

export interface VerificationResult {
  buildSuccess: boolean;
  testsSuccess: boolean;
  buildOutput: string;
  testOutput: string;
  renderedHtmlBytes: number;
}

export interface RefactorOutput {
  owner: string;
  repo: string;
  originalFilename: string;
  originalBytes: number;
  originalBreakdown: {
    htmlBytes: number;
    styleBytes: number;
    scriptBytes: number;
  };
  preset: RefactorPreset;
  netlifyMode: NetlifyMode;
  files: GeneratedFile[];
  languages: LanguageStat[];
  pythonPercentage: number;
  totalCodeBytes: number;
  verification: VerificationResult;
  renderedPreviewHtml: string;
}

const LANGUAGE_COLORS: Record<string, string> = {
  Python: '#3572A5',
  HTML: '#e34c26',
  CSS: '#563d7c',
  JavaScript: '#f1e05a',
};

function detectLanguage(filePath: string): GeneratedFile['language'] {
  if (filePath.endsWith('.py')) return 'Python';
  if (filePath.endsWith('.html')) return 'HTML';
  if (filePath.endsWith('.css')) return 'CSS';
  if (filePath.endsWith('.js')) return 'JavaScript';
  if (filePath.endsWith('.toml')) return 'TOML';
  if (filePath.endsWith('.md')) return 'Markdown';
  return 'Text';
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function extractJsConstSpan(
  js: string,
  varName: string
): { start: number; end: number; literal: string } | null {
  const marker = `const ${varName} =`;
  const idx = js.indexOf(marker);
  if (idx === -1) return null;

  let i = idx + marker.length;
  while (i < js.length && /\s/.test(js[i])) i++;
  const openChar = js[i];
  if (openChar !== '[' && openChar !== '{') return null;

  const closeChar = openChar === '[' ? ']' : '}';
  let depth = 0;
  let inString: string | null = null;
  let escaped = false;
  const literalStart = i;

  for (; i < js.length; i++) {
    const ch = js[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escaped = true;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === openChar) depth++;
    if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        const literalEnd = i + 1;
        let end = literalEnd;
        while (end < js.length && (js[end] === ';' || js[end] === ' ')) {
          if (js[end] === ';') {
            end++;
            break;
          }
          end++;
        }
        return {
          start: idx,
          end,
          literal: js.slice(literalStart, literalEnd),
        };
      }
    }
  }
  return null;
}

function parseJsLiteral(literal: string): unknown {
  try {
    return JSON.parse(literal);
  } catch {
    try {
      // eslint-disable-next-line no-new-func
      return new Function(`"use strict"; return (${literal});`)();
    } catch {
      return null;
    }
  }
}

function toPythonLiteral(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent);
  const nextPad = ' '.repeat(indent + 4);

  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => `${nextPad}${toPythonLiteral(item, indent + 4)}`);
    return `[\n${items.join(',\n')},\n${pad}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const lines = entries.map(
      ([k, v]) => `${nextPad}${JSON.stringify(k)}: ${toPythonLiteral(v, indent + 4)}`
    );
    return `{\n${lines.join(',\n')},\n${pad}}`;
  }

  return JSON.stringify(String(value));
}

function extractTitleAndMeta(html: string): { title: string; ownerName: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : 'Interactive Portfolio';
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const ownerName = h1Match
    ? h1Match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    : 'Portfolio Owner';
  return { title, ownerName };
}

export function analyzeHtmlBytes(html: string): {
  totalBytes: number;
  styleBytes: number;
  scriptBytes: number;
  htmlBytes: number;
} {
  let styleBytes = 0;
  let scriptBytes = 0;

  for (const m of html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)) {
    styleBytes += byteLength(m[0]);
  }
  for (const m of html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)) {
    scriptBytes += byteLength(m[0]);
  }

  const totalBytes = byteLength(html);
  return {
    totalBytes,
    styleBytes,
    scriptBytes,
    htmlBytes: Math.max(0, totalBytes - styleBytes - scriptBytes),
  };
}

export async function refactorPortfolioHtml(params: {
  owner: string;
  repo: string;
  originalFilename: string;
  rawHtml: string;
  preset: RefactorPreset;
  netlifyMode: NetlifyMode;
}): Promise<RefactorOutput> {
  const { owner, repo, originalFilename, rawHtml, preset, netlifyMode } = params;
  const originalBreakdown = analyzeHtmlBytes(rawHtml);
  const { title, ownerName } = extractTitleAndMeta(rawHtml);

  // 1. Extract CSS blocks
  const styleBlocks: string[] = [];
  let strippedHtml = rawHtml.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_m, inner: string) => {
    styleBlocks.push(inner.trim());
    return '  <link rel="stylesheet" href="static/css/styles.css" />';
  });

  // 2. Extract inline script blocks
  const scriptBlocks: string[] = [];
  let replacedFirstScript = false;
  strippedHtml = strippedHtml.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (fullMatch, attrs: string, inner: string) => {
      if (/\bsrc\s*=/i.test(attrs)) {
        return fullMatch;
      }
      if (inner.trim().length > 0) {
        scriptBlocks.push(inner);
      }
      if (!replacedFirstScript) {
        replacedFirstScript = true;
        return [
          '  <script id="portfolio-data" type="application/json">{{PORTFOLIO_JSON}}</script>',
          '  <script src="static/js/main.js"></script>',
        ].join('\n');
      }
      return '';
    }
  );

  const dedent = (block: string) =>
    block
      .split('\n')
      .map((line) => line.replace(/^ {2,6}/, ''))
      .join('\n')
      .trim();

  const templateHtml = strippedHtml.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  const combinedCss = dedent(styleBlocks.join('\n\n')) + '\n';
  let combinedJs = dedent(scriptBlocks.join('\n\n'));

  // 3. Extract structured datasets from JS into Python portfolio_data.py
  const extractedDatasets: Record<string, unknown> = {};
  const varNames = ['semesters', 'skillsData', 'weatherSample', 'campusRooms'];

  for (const varName of varNames) {
    const span = extractJsConstSpan(combinedJs, varName);
    if (span) {
      const parsed = parseJsLiteral(span.literal);
      if (parsed !== null) {
        extractedDatasets[varName] = parsed;
        combinedJs =
          combinedJs.slice(0, span.start) +
          `const ${varName} = __PORTFOLIO_BOOTSTRAP__.${varName} ?? [];` +
          combinedJs.slice(span.end);
      }
    }
  }

  if (Object.keys(extractedDatasets).length > 0) {
    const bootstrapHeader = [
      'const __portfolioDataEl = document.getElementById("portfolio-data");',
      'const __PORTFOLIO_BOOTSTRAP__ = __portfolioDataEl ? JSON.parse(__portfolioDataEl.textContent || "{}") : {};',
      '',
    ].join('\n');
    if (combinedJs.includes('(function () {')) {
      combinedJs = combinedJs.replace('(function () {', `(function () {\n${bootstrapHeader}`);
    } else {
      combinedJs = `${bootstrapHeader}\n${combinedJs}`;
    }
  }

  const finalJs = combinedJs.trim() + '\n';

  // 4. Generate modular Python architecture
  const portfolioDataPy = buildPortfolioDataPy({
    owner,
    repo,
    title,
    ownerName,
    extractedDatasets,
  });
  const analyticsPy = buildAnalyticsPy();
  const weatherServicePy = buildWeatherServicePy();
  const campusEnginePy = buildCampusEnginePy();
  const svgChartsPy = buildSvgChartsPy();
  const buildStaticPy = buildStaticGeneratorPy();
  const appPy = buildFlaskAppPy();
  const cliPy = buildCliPy();
  const exporterPy = buildResumeExporterPy();
  const seoValidatorPy = buildSeoValidatorPy();
  const skillGraphPy = buildSkillGraphPy();
  const testsCorePy = buildTestsPy();
  const testsEnginesPy = buildEngineTestsPy();
  const testsExporterSeoPy = buildExporterSeoTestsPy();

  const netlifyToml = [
    '[build]',
    '  command = "python3 build_static.py --out dist"',
    '  publish = "dist"',
    '',
    '[build.environment]',
    '  PYTHON_VERSION = "3.10"',
    '',
    '[[headers]]',
    '  for = "/*"',
    '  [headers.values]',
    '    X-Content-Type-Options = "nosniff"',
    '    X-Frame-Options = "SAMEORIGIN"',
    '',
  ].join('\n');

  const requirementsTxt = [
    'Flask>=3.0.0',
    'Jinja2>=3.1.4',
    'Werkzeug>=3.0.3',
    '',
  ].join('\n');

  const gitignoreTxt = [
    '__pycache__/',
    '*.py[cod]',
    '.pytest_cache/',
    '.venv/',
    'venv/',
    'dist/',
    'build/',
    '*.egg-info/',
    '.DS_Store',
    '',
  ].join('\n');

  const readmeMd = buildReadmeMd({ owner, repo, ownerName, title });

  // Core Python modules included in all presets (~44% Python baseline)
  const coreFiles: Omit<GeneratedFile, 'language' | 'bytes'>[] = [
    {
      path: 'portfolio_data.py',
      content: portfolioDataPy,
      description: 'Typed Python dataclasses and structured portfolio datasets extracted from the original SPA.',
    },
    {
      path: 'app.py',
      content: appPy,
      description: 'Flask WSGI web application and JSON API endpoints serving dynamic portfolio routes.',
    },
    {
      path: 'build_static.py',
      content: buildStaticPy,
      description: 'Zero-dependency Python static site generator compiling templates, SVGs, and assets for Netlify.',
    },
    {
      path: 'analytics.py',
      content: analyticsPy,
      description: 'Academic GPA trajectory, skill distribution, and portfolio telemetry engine.',
    },
    {
      path: 'weather_service.py',
      content: weatherServicePy,
      description: 'Python meteorological engine for Jio Sense comfort index, dew point, and UV risk scoring.',
    },
    {
      path: 'campus_engine.py',
      content: campusEnginePy,
      description: 'Python NLP intent parser and floor-by-floor shortest-path router for JAIN Smart Navigation.',
    },
    {
      path: 'svg_charts.py',
      content: svgChartsPy,
      description: 'Server-side Python SVG generator rendering GPA trajectory and skill distribution graphics.',
    },
    {
      path: 'tests/test_portfolio.py',
      content: testsCorePy,
      description: 'Automated unittest suite verifying data integrity, analytics math, and static builds.',
    },
  ];

  if (preset === 'standard' || preset === 'python-first') {
    coreFiles.push(
      {
        path: 'cli.py',
        content: cliPy,
        description: 'Command-line interface for inspecting GPA stats, building dist/, and testing campus routing.',
      },
      {
        path: 'skill_graph.py',
        content: skillGraphPy,
        description: 'Python skill-to-project adjacency graph and role-readiness scoring model.',
      },
      {
        path: 'tests/test_engines.py',
        content: testsEnginesPy,
        description: 'Extended unittest suite covering weather telemetry, campus pathfinding, and SVG output.',
      }
    );
  }

  if (preset === 'python-first') {
    coreFiles.push(
      {
        path: 'resume_exporter.py',
        content: exporterPy,
        description: 'Exports structured JSON-Resume and Markdown CV artifacts directly from portfolio_data.py.',
      },
      {
        path: 'seo_validator.py',
        content: seoValidatorPy,
        description: 'Python HTML accessibility, heading hierarchy, and metadata validator for build output.',
      },
      {
        path: 'tests/test_exporter_and_seo.py',
        content: testsExporterSeoPy,
        description: 'Unit tests validating JSON-Resume, Markdown CV export, skill graph, and HTML audit checks.',
      }
    );
  }

  const assetAndConfigFiles: Omit<GeneratedFile, 'language' | 'bytes'>[] = [
    {
      path: 'templates/index.html',
      content: templateHtml,
      description: 'Semantic HTML template populated dynamically via Python JSON bootstrap injection.',
    },
    {
      path: 'static/css/styles.css',
      content: combinedCss,
      description: 'Extracted responsive layout, Bento grid, and dark/light theme stylesheet.',
    },
    {
      path: 'static/js/main.js',
      content: finalJs,
      description: 'Client-side interactive demos hydrated from Python-generated portfolio JSON.',
    },
    {
      path: 'netlify.toml',
      content: netlifyToml,
      description: 'Netlify build configuration running python3 build_static.py on deploy.',
    },
    {
      path: 'requirements.txt',
      content: requirementsTxt,
      description: 'Python runtime dependencies for local Flask development server.',
    },
    {
      path: '.gitignore',
      content: gitignoreTxt,
      description: 'Excludes Python bytecode caches, virtual environments, and generated dist output.',
    },
    {
      path: 'README.md',
      content: readmeMd,
      description: 'Repository documentation covering Python architecture, local server, and Netlify deploy.',
    },
  ];

  const files: GeneratedFile[] = [...coreFiles, ...assetAndConfigFiles].map((f) => ({
    ...f,
    language: detectLanguage(f.path),
    bytes: byteLength(f.content),
  }));

  // 5. Execute real Python build + tests in an isolated temp directory
  const verification = await verifyWithPython(files);

  if (netlifyMode === 'root-index' && verification.renderedHtml) {
    const compiledIndex = verification.renderedHtml;
    files.push({
      path: 'index.html',
      content: compiledIndex,
      language: 'HTML',
      bytes: byteLength(compiledIndex),
      description: 'Pre-built static entrypoint for zero-build hosting.',
    });
  }

  // 6. Compute exact GitHub Linguist language breakdown
  const { languages, pythonPercentage, totalCodeBytes } = computeLanguageStats(files);

  const previewHtml = buildSelfContainedPreview(
    verification.renderedHtml || templateHtml,
    combinedCss,
    finalJs
  );

  return {
    owner,
    repo,
    originalFilename,
    originalBytes: originalBreakdown.totalBytes,
    originalBreakdown: {
      htmlBytes: originalBreakdown.htmlBytes,
      styleBytes: originalBreakdown.styleBytes,
      scriptBytes: originalBreakdown.scriptBytes,
    },
    preset,
    netlifyMode,
    files,
    languages,
    pythonPercentage,
    totalCodeBytes,
    verification: {
      buildSuccess: verification.buildSuccess,
      testsSuccess: verification.testsSuccess,
      buildOutput: verification.buildOutput,
      testOutput: verification.testOutput,
      renderedHtmlBytes: byteLength(verification.renderedHtml || ''),
    },
    renderedPreviewHtml: previewHtml,
  };
}

function computeLanguageStats(files: GeneratedFile[]): {
  languages: LanguageStat[];
  pythonPercentage: number;
  totalCodeBytes: number;
} {
  const counts: Record<string, number> = {};
  for (const file of files) {
    if (file.language in LANGUAGE_COLORS) {
      counts[file.language] = (counts[file.language] || 0) + file.bytes;
    }
  }

  const totalCodeBytes = Object.values(counts).reduce((acc, v) => acc + v, 0) || 1;
  const languages: LanguageStat[] = Object.entries(counts)
    .map(([language, bytes]) => ({
      language,
      bytes,
      percentage: Number(((bytes / totalCodeBytes) * 100).toFixed(1)),
      color: LANGUAGE_COLORS[language] || '#64748b',
    }))
    .sort((a, b) => b.bytes - a.bytes);

  const py = languages.find((l) => l.language === 'Python');
  return {
    languages,
    pythonPercentage: py ? py.percentage : 0,
    totalCodeBytes,
  };
}

async function verifyWithPython(
  files: GeneratedFile[]
): Promise<VerificationResult & { renderedHtml: string }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pyrefactor-'));
  try {
    for (const file of files) {
      const fullPath = path.join(tmpDir, file.path);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, file.content, 'utf8');
    }

    let buildSuccess = false;
    let buildOutput = '';
    let renderedHtml = '';

    try {
      const { stdout, stderr } = await execFileAsync('python3', ['build_static.py', '--out', 'dist'], {
        cwd: tmpDir,
        timeout: 10000,
      });
      buildOutput = [stdout, stderr].filter(Boolean).join('\n').trim();
      renderedHtml = await fs.readFile(path.join(tmpDir, 'dist', 'index.html'), 'utf8');
      buildSuccess = renderedHtml.length > 0;
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      buildOutput = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim();
    }

    let testsSuccess = false;
    let testOutput = '';

    try {
      const { stdout, stderr } = await execFileAsync(
        'python3',
        ['-m', 'unittest', 'discover', '-s', 'tests', '-v'],
        {
          cwd: tmpDir,
          timeout: 10000,
        }
      );
      testOutput = [stdout, stderr].filter(Boolean).join('\n').trim();
      testsSuccess = true;
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      testOutput = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim();
    }

    return {
      buildSuccess,
      testsSuccess,
      buildOutput,
      testOutput,
      renderedHtmlBytes: byteLength(renderedHtml),
      renderedHtml,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function buildSelfContainedPreview(compiledHtml: string, css: string, js: string): string {
  let out = compiledHtml;
  out = out.replace(
    /<link\b[^>]*href=["']static\/css\/styles\.css["'][^>]*\/?>/i,
    () => `<style>\n${css}\n</style>`
  );
  out = out.replace(
    /<script\b[^>]*src=["']static\/js\/main\.js["'][^>]*><\/script>/i,
    () => `<script>\n${js}\n</script>`
  );
  return out;
}

export async function createZipArchiveBuffer(files: GeneratedFile[]): Promise<Buffer> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pyrefactor-zip-'));
  try {
    const manifestPath = path.join(tmpDir, '_manifest.json');
    const outZipPath = path.join(tmpDir, 'bundle.zip');

    for (const file of files) {
      const dest = path.join(tmpDir, 'repo', file.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, file.content, 'utf8');
    }

    await fs.writeFile(manifestPath, JSON.stringify(files.map((f) => f.path)), 'utf8');

    const zipScript = [
      'import json, os, zipfile',
      `root = os.path.join(${JSON.stringify(tmpDir)}, "repo")`,
      `with open(${JSON.stringify(manifestPath)}, "r", encoding="utf-8") as mf:`,
      '    paths = json.load(mf)',
      `with zipfile.ZipFile(${JSON.stringify(outZipPath)}, "w", zipfile.ZIP_DEFLATED) as zf:`,
      '    for rel in paths:',
      '        zf.write(os.path.join(root, rel), arcname=rel)',
    ].join('\n');

    await execFileAsync('python3', ['-c', zipScript], { timeout: 10000 });
    return await fs.readFile(outZipPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Python Module Generators
// ---------------------------------------------------------------------------

function buildPortfolioDataPy(opts: {
  owner: string;
  repo: string;
  title: string;
  ownerName: string;
  extractedDatasets: Record<string, unknown>;
}): string {
  const { owner, repo, title, ownerName, extractedDatasets } = opts;

  const semestersPy = toPythonLiteral(
    extractedDatasets.semesters ?? [
      { label: 'Sem 1', gpa: 9.02, note: 'Completed' },
      { label: 'Sem 2', gpa: 8.86, note: 'Completed' },
    ]
  );

  const skillsPy = toPythonLiteral(extractedDatasets.skillsData ?? []);
  const weatherPy = toPythonLiteral(extractedDatasets.weatherSample ?? {});
  const campusPy = toPythonLiteral(extractedDatasets.campusRooms ?? []);

  return `"""Structured portfolio models and datasets.

Serves as the single source of truth for both the Flask runtime API
and the static site generator targeting Netlify deployment.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class Profile:
    """Core candidate identity and academic metadata."""

    full_name: str
    title: str
    role: str
    university: str
    degree: str
    batch: str
    location: str
    email: str
    phone: str
    github_username: str
    github_repo: str
    linkedin_url: str
    summary: str


@dataclass(frozen=True)
class SemesterRecord:
    """Academic performance record for a single university semester."""

    sem: str
    label: str
    gpa: Optional[float]
    note: str


@dataclass(frozen=True)
class ProjectSummary:
    """Summary metadata for featured engineering and team projects."""

    slug: str
    title: str
    subtitle: str
    role: str
    stack: List[str] = field(default_factory=list)
    highlights: List[str] = field(default_factory=list)


PROFILE = Profile(
    full_name=${JSON.stringify(ownerName)},
    title=${JSON.stringify(title)},
    role="Second-Year B.Tech CSE (AI & ML) · Python Developer & AI/ML Engineer Aspirant",
    university="Jain University",
    degree="B.Tech Computer Science and Engineering (AI & ML)",
    batch="2025 - 2029",
    location="Hyderabad, Telangana",
    email="srikrishnanookala18@gmail.com",
    phone="8790761414",
    github_username=${JSON.stringify(owner)},
    github_repo=${JSON.stringify(repo)},
    linkedin_url="https://www.linkedin.com/in/sri-krishna-nookala-19758a44b",
    summary=(
        "Second-year B.Tech Computer Science and Engineering (AI & ML) student at "
        "Jain University, aspiring to work as a Python Developer or AI/ML Engineer. "
        "Brings intermediate Python and Java skills, team project experience, and "
        "exposure to data and machine-learning libraries, API integration, and backend development."
    ),
)

CERTIFICATIONS: List[Dict[str, str]] = [
    {
        "title": "100 Days of Code: The Complete Python Pro Bootcamp",
        "issuer": "Udemy",
        "focus": "Python scripting, OOP, automation, APIs, and data analysis",
    },
    {
        "title": "B.Tech CSE (AI & ML) Core Track",
        "issuer": "Jain University",
        "focus": "Data Structures & Algorithms, OOP, DBMS, and Machine Learning",
    },
]

PROJECTS: List[ProjectSummary] = [
    ProjectSummary(
        slug="jiosense",
        title="Jio Sense Weather Dashboard",
        subtitle="Multi-city meteorological telemetry & forecast dashboard",
        role="Frontend & API Integration Contributor",
        stack=["Python", "HTML", "CSS", "JavaScript", "Weather API"],
        highlights=[
            "Multi-city temperature, humidity, wind, UV, and pressure metrics",
            "Hourly and 7-day forecast curve visualizations",
            "Automated weather advisory alert thresholds",
        ],
    ),
    ProjectSummary(
        slug="jainsmart",
        title="JAIN Smart Navigation",
        subtitle="Natural-language campus room & lab locator",
        role="Database Management & Backend Integration",
        stack=["Python", "MySQL", "Express", "Gemini NLP"],
        highlights=[
            "Natural-language intent routing for classrooms and AI/ML laboratories",
            "Floor-by-floor interactive SVG schematic lookup",
            "Structured relational room availability tracking",
        ],
    ),
]

SEMESTERS_RAW: List[Dict[str, Any]] = ${semestersPy}

SKILLS_DATA: List[Dict[str, Any]] = ${skillsPy}

WEATHER_SAMPLE: Dict[str, Any] = ${weatherPy}

CAMPUS_ROOMS: List[Dict[str, Any]] = ${campusPy}


def get_semester_records() -> List[SemesterRecord]:
    """Return typed SemesterRecord instances from SEMESTERS_RAW."""
    records: List[SemesterRecord] = []
    for item in SEMESTERS_RAW:
        raw_gpa = item.get("gpa")
        parsed_gpa = float(raw_gpa) if raw_gpa is not None else None
        label = str(item.get("label", ""))
        records.append(
            SemesterRecord(
                sem=str(item.get("sem") or label),
                label=label,
                gpa=parsed_gpa,
                note=str(item.get("note", "")),
            )
        )
    return records


def filter_skills(category: Optional[str] = None) -> List[Dict[str, Any]]:
    """Filter skills by category name; returns all skills when category is None or 'All'."""
    if not category or category.strip().lower() == "all":
        return list(SKILLS_DATA)
    target = category.strip().lower()
    return [s for s in SKILLS_DATA if str(s.get("cat", "")).lower() == target]


def export_bootstrap_payload() -> Dict[str, Any]:
    """Serialize all client-side interactive data for static and Flask HTML rendering."""
    return {
        "profile": asdict(PROFILE),
        "semesters": SEMESTERS_RAW,
        "skillsData": SKILLS_DATA,
        "weatherSample": WEATHER_SAMPLE,
        "campusRooms": CAMPUS_ROOMS,
        "projects": [asdict(p) for p in PROJECTS],
        "certifications": CERTIFICATIONS,
    }
`;
}

function buildWeatherServicePy(): string {
  return `"""Meteorological analytics & advisory engine for Jio Sense Weather Dashboard.

Parses temperature, humidity, wind, pressure, and UV values from WEATHER_SAMPLE
to calculate heat index, dew point approximation, comfort classification,
and forecast statistics.
"""

from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional

from portfolio_data import WEATHER_SAMPLE


@dataclass(frozen=True)
class WeatherReading:
    """Normalized meteorological metrics for a single city."""

    city: str
    temperature_c: float
    humidity_pct: float
    wind_kmh: float
    pressure_hpa: float
    uv_index: int
    uv_band: str
    heat_index_c: float
    dew_point_c: float
    comfort_score: int
    advisory_level: str
    advisory_text: str


def _extract_number(raw: Any, default: float = 0.0) -> float:
    """Extract the leading floating-point value from formatted sensor strings."""
    if isinstance(raw, (int, float)):
        return float(raw)
    match = re.search(r"-?\\d+(?:\\.\\d+)?", str(raw))
    return float(match.group(0)) if match else default


def calculate_dew_point(temp_c: float, humidity_pct: float) -> float:
    """Compute Magnus-formula dew point temperature in Celsius."""
    rh = max(1.0, min(100.0, humidity_pct))
    a = 17.625
    b = 243.04
    gamma = math.log(rh / 100.0) + (a * temp_c) / (b + temp_c)
    return round((b * gamma) / (a - gamma), 1)


def calculate_heat_index(temp_c: float, humidity_pct: float) -> float:
    """Compute Steadman apparent heat index when temperature >= 26C."""
    if temp_c < 26.0:
        return round(temp_c, 1)
    t_f = temp_c * 9.0 / 5.0 + 32.0
    rh = max(0.0, min(100.0, humidity_pct))
    hi_f = (
        -42.379
        + 2.04901523 * t_f
        + 10.14333127 * rh
        - 0.22475541 * t_f * rh
        - 0.00683783 * t_f * t_f
        - 0.05481717 * rh * rh
        + 0.00122874 * t_f * t_f * rh
        + 0.00085282 * t_f * rh * rh
        - 0.00000199 * t_f * t_f * rh * rh
    )
    return round((hi_f - 32.0) * 5.0 / 9.0, 1)


def classify_uv_band(uv_index: int) -> str:
    """Map numeric UV index to WHO risk band."""
    if uv_index <= 2:
        return "Low"
    if uv_index <= 5:
        return "Moderate"
    if uv_index <= 7:
        return "High"
    if uv_index <= 10:
        return "Very High"
    return "Extreme"


def compute_comfort_score(temp_c: float, humidity_pct: float, wind_kmh: float) -> int:
    """Return a 0-100 outdoor comfort index peaking around 23C and 50% humidity."""
    temp_penalty = abs(temp_c - 23.0) * 3.2
    humidity_penalty = abs(humidity_pct - 50.0) * 0.45
    breeze_bonus = min(8.0, wind_kmh * 0.3) if temp_c > 25.0 else 0.0
    raw = 100.0 - temp_penalty - humidity_penalty + breeze_bonus
    return max(0, min(100, int(round(raw))))


def analyze_city_weather(city: str) -> Optional[WeatherReading]:
    """Build a normalized WeatherReading with derived meteorological indices."""
    matched_key = next(
        (key for key in WEATHER_SAMPLE.keys() if key.lower() == city.strip().lower()),
        None,
    )
    if not matched_key:
        return None

    data = WEATHER_SAMPLE[matched_key]
    temp_c = _extract_number(data.get("temp"), 25.0)
    humidity = _extract_number(data.get("humidity"), 50.0)
    wind = _extract_number(data.get("wind"), 10.0)
    pressure = _extract_number(data.get("pressure"), 1013.0)
    uv_val = int(round(_extract_number(data.get("uv"), 3)))

    alert = data.get("alert", {})
    return WeatherReading(
        city=matched_key,
        temperature_c=temp_c,
        humidity_pct=humidity,
        wind_kmh=wind,
        pressure_hpa=pressure,
        uv_index=uv_val,
        uv_band=classify_uv_band(uv_val),
        heat_index_c=calculate_heat_index(temp_c, humidity),
        dew_point_c=calculate_dew_point(temp_c, humidity),
        comfort_score=compute_comfort_score(temp_c, humidity, wind),
        advisory_level=str(alert.get("level", "Clear")),
        advisory_text=str(alert.get("text", "")),
    )


def summarize_forecast_series(city: str, mode: str = "hourly") -> Dict[str, Any]:
    """Compute min, max, mean, and peak slot for a city's hourly or daily series."""
    matched_key = next(
        (key for key in WEATHER_SAMPLE.keys() if key.lower() == city.strip().lower()),
        None,
    )
    if not matched_key:
        return {"error": f"Unknown city: {city}", "available": list(WEATHER_SAMPLE.keys())}

    series: List[Dict[str, Any]] = WEATHER_SAMPLE[matched_key].get(mode, [])
    if not series:
        return {"city": matched_key, "mode": mode, "points": 0}

    temps = [float(point["v"]) for point in series]
    peak_point = max(series, key=lambda p: float(p["v"]))
    low_point = min(series, key=lambda p: float(p["v"]))

    return {
        "city": matched_key,
        "mode": mode,
        "points": len(series),
        "min_c": min(temps),
        "max_c": max(temps),
        "mean_c": round(sum(temps) / len(temps), 1),
        "peak_slot": peak_point["t"],
        "coolest_slot": low_point["t"],
    }


def list_all_city_reports() -> List[Dict[str, Any]]:
    """Return normalized telemetry reports for all modeled cities."""
    reports: List[Dict[str, Any]] = []
    for city in WEATHER_SAMPLE.keys():
        reading = analyze_city_weather(city)
        if reading is not None:
            reports.append(asdict(reading))
    return reports
`;
}

function buildCampusEnginePy(): string {
  return `"""Natural-language query parser and floor-routing engine for JAIN Smart Navigation.

Provides intent classification, room availability filtering, and step-by-step
elevator/corridor navigation paths across campus floors.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional

from portfolio_data import CAMPUS_ROOMS


@dataclass(frozen=True)
class NavigationResult:
    """Structured routing output for a natural-language campus query."""

    query: str
    intent: str
    target_floor: int
    matched_rooms: List[Dict[str, Any]]
    directions: List[str]


def parse_campus_intent(query: str) -> str:
    """Classify user query into an actionable navigation intent."""
    text = query.strip().lower()
    if any(word in text for word in ("vacant", "free", "empty")) or (
        "available" in text and "ai" not in text
    ):
        return "find_vacant_rooms"
    if "ai" in text or "ml" in text or "machine learning" in text:
        return "locate_ai_lab"
    if re.search(r"\\b[rR]?\\d{3}\\b", text):
        return "lookup_room_number"
    if "lab" in text or "laboratory" in text:
        return "list_laboratories"
    if "floor" in text:
        return "browse_floor"
    return "keyword_search"


def query_campus_rooms(query: str) -> List[Dict[str, Any]]:
    """Resolve a natural-language campus query against CAMPUS_ROOMS."""
    if not CAMPUS_ROOMS:
        return []

    text = query.strip().lower()
    intent = parse_campus_intent(query)

    if intent == "find_vacant_rooms":
        matches = [r for r in CAMPUS_ROOMS if str(r.get("status", "")).lower() == "available"]
    elif intent == "locate_ai_lab":
        matches = [
            r
            for r in CAMPUS_ROOMS
            if r.get("id") == "R201"
            or "ai" in str(r.get("name", "")).lower()
            or "ml" in str(r.get("name", "")).lower()
        ]
    elif intent == "lookup_room_number":
        num_match = re.search(r"(\\d{3})", text)
        digits = num_match.group(1) if num_match else ""
        matches = [
            r
            for r in CAMPUS_ROOMS
            if digits in str(r.get("id", "")) or digits in str(r.get("name", ""))
        ]
    elif intent == "list_laboratories":
        matches = [r for r in CAMPUS_ROOMS if str(r.get("type", "")).lower() == "laboratory"]
    elif intent == "browse_floor":
        floor_match = re.search(r"floor\\s*(\\d+)", text)
        if floor_match:
            target = int(floor_match.group(1))
            matches = [r for r in CAMPUS_ROOMS if int(r.get("floor", 0)) == target]
        else:
            matches = list(CAMPUS_ROOMS)
    else:
        matches = [
            r
            for r in CAMPUS_ROOMS
            if text in str(r.get("name", "")).lower()
            or text in str(r.get("id", "")).lower()
            or text in str(r.get("type", "")).lower()
        ]

    return matches if matches else [CAMPUS_ROOMS[0]]


def build_directions(room: Dict[str, Any], start_floor: int = 1) -> List[str]:
    """Generate human-readable step-by-step corridor directions to a target room."""
    target_floor = int(room.get("floor", 1))
    room_id = str(room.get("id", "Room"))
    room_name = str(room.get("name", "Destination"))
    x_pos = int(room.get("x", 100))

    steps: List[str] = [f"Start at Main Entrance Lobby (Floor {start_floor})."]
    if target_floor != start_floor:
        direction = "Up" if target_floor > start_floor else "Down"
        steps.append(f"Take Central Elevator {direction} to Floor {target_floor}.")
    else:
        steps.append(f"Proceed along Main Corridor on Floor {target_floor}.")

    wing = "West Wing" if x_pos < 180 else "East Wing"
    steps.append(f"Turn toward the {wing} corridor.")
    steps.append(f"Arrive at {room_name} ({room_id}) — Status: {room.get('status', 'Unknown')}.")
    return steps


def route_campus_query(query: str, start_floor: int = 1) -> Dict[str, Any]:
    """Execute end-to-end NLP intent parsing, lookup, and turn-by-turn routing."""
    intent = parse_campus_intent(query)
    matches = query_campus_rooms(query)
    primary = matches[0] if matches else {}
    target_floor = int(primary.get("floor", 1)) if primary else 1
    directions = build_directions(primary, start_floor=start_floor) if primary else []

    result = NavigationResult(
        query=query,
        intent=intent,
        target_floor=target_floor,
        matched_rooms=matches,
        directions=directions,
    )
    return asdict(result)


def get_floor_occupancy_summary() -> Dict[int, Dict[str, int]]:
    """Aggregate available vs occupied rooms grouped by floor."""
    summary: Dict[int, Dict[str, int]] = {}
    for room in CAMPUS_ROOMS:
        floor = int(room.get("floor", 1))
        bucket = summary.setdefault(floor, {"total": 0, "available": 0, "occupied": 0})
        bucket["total"] += 1
        if str(room.get("status", "")).lower() == "available":
            bucket["available"] += 1
        else:
            bucket["occupied"] += 1
    return summary
`;
}

function buildSvgChartsPy(): string {
  return `"""Server-side SVG chart generator for GPA trajectories and skill distributions."""

from __future__ import annotations

from html import escape
from typing import List

from analytics import compute_skill_distribution
from portfolio_data import get_semester_records


def render_gpa_trajectory_svg(width: int = 560, height: int = 180) -> str:
    """Render an accessible vector SVG line chart of completed semester GPAs."""
    records = [r for r in get_semester_records() if r.gpa is not None]
    if not records:
        return '<svg viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg"><text x="20" y="50">No GPA records</text></svg>'

    pad_l, pad_r, pad_t, pad_b = 42, 24, 26, 30
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b
    min_g, max_g = 7.5, 10.0

    def x_for(idx: int) -> float:
        if len(records) == 1:
            return pad_l + plot_w / 2.0
        return pad_l + (idx / (len(records) - 1)) * plot_w

    def y_for(val: float) -> float:
        clamped = max(min_g, min(max_g, val))
        return pad_t + ((max_g - clamped) / (max_g - min_g)) * plot_h

    points: List[str] = []
    markers: List[str] = []
    for idx, rec in enumerate(records):
        assert rec.gpa is not None
        x = x_for(idx)
        y = y_for(rec.gpa)
        points.append(f"{x:.1f},{y:.1f}")
        markers.append(
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.5" fill="#2557d6" stroke="#ffffff" stroke-width="2" />'
        )
        markers.append(
            f'<text x="{x:.1f}" y="{y - 10:.1f}" text-anchor="middle" font-size="11" '
            f'font-family="monospace" fill="#111318">{rec.gpa:.2f}</text>'
        )
        markers.append(
            f'<text x="{x:.1f}" y="{height - 8}" text-anchor="middle" font-size="11" '
            f'font-family="sans-serif" fill="#555b66">{escape(rec.label)}</text>'
        )

    grid_lines: List[str] = []
    for tick in (8.0, 8.5, 9.0, 9.5, 10.0):
        ty = y_for(tick)
        grid_lines.append(
            f'<line x1="{pad_l}" y1="{ty:.1f}" x2="{width - pad_r}" y2="{ty:.1f}" '
            'stroke="#e4e2dc" stroke-dasharray="3 3" />'
        )
        grid_lines.append(
            f'<text x="{pad_l - 8}" y="{ty + 4:.1f}" text-anchor="end" font-size="10" '
            f'font-family="monospace" fill="#848b98">{tick:.1f}</text>'
        )

    polyline = (
        f'<polyline fill="none" stroke="#2557d6" stroke-width="2.4" '
        f'stroke-linecap="round" stroke-linejoin="round" points="{" ".join(points)}" />'
        if len(points) >= 2
        else ""
    )

    return "\\n".join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="Academic GPA Trajectory">',
            '  <rect width="100%" height="100%" rx="12" fill="#ffffff" stroke="#e4e2dc" />',
            *[f"  {g}" for g in grid_lines],
            f"  {polyline}",
            *[f"  {m}" for m in markers],
            "</svg>",
        ]
    )


def render_skill_breakdown_svg(width: int = 560, height: int = 210) -> str:
    """Render a horizontal SVG bar chart summarizing skills by category."""
    dist = compute_skill_distribution()["by_category"]
    if not dist:
        return '<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg"><text x="20" y="40">No skills</text></svg>'

    items = sorted(dist.items(), key=lambda kv: kv[1], reverse=True)
    max_val = max(v for _, v in items) or 1
    bar_area_x = 200
    bar_max_w = width - bar_area_x - 56
    row_h = 32
    computed_h = max(height, 44 + len(items) * row_h)

    rows: List[str] = []
    for idx, (cat, count) in enumerate(items):
        y = 32 + idx * row_h
        bar_w = max(8.0, (count / max_val) * bar_max_w)
        rows.append(
            f'<text x="16" y="{y + 14}" font-size="12" font-family="sans-serif" fill="#111318">{escape(cat)}</text>'
        )
        rows.append(
            f'<rect x="{bar_area_x}" y="{y}" width="{bar_w:.1f}" height="18" rx="4" fill="#2557d6" />'
        )
        rows.append(
            f'<text x="{bar_area_x + bar_w + 8:.1f}" y="{y + 14}" font-size="12" font-family="monospace" fill="#555b66">{count}</text>'
        )

    return "\\n".join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {computed_h}" role="img" aria-label="Skill Category Distribution">',
            '  <rect width="100%" height="100%" rx="12" fill="#ffffff" stroke="#e4e2dc" />',
            *[f"  {r}" for r in rows],
            "</svg>",
        ]
    )
`;
}

function buildFlaskAppPy(): string {
  return `"""Flask web application and REST API for Nookala Sri Krishna's Portfolio.

Run locally with:
    python3 app.py
"""

from __future__ import annotations

import os
from typing import Any, Dict

from flask import Flask, Response, jsonify, render_template, request

from analytics import build_portfolio_report
from campus_engine import get_floor_occupancy_summary, route_campus_query
from portfolio_data import (
    CERTIFICATIONS,
    PROJECTS,
    export_bootstrap_payload,
    filter_skills,
)
from svg_charts import render_gpa_trajectory_svg, render_skill_breakdown_svg
from weather_service import (
    analyze_city_weather,
    list_all_city_reports,
    summarize_forecast_series,
)

app = Flask(__name__, static_folder="static", template_folder="templates")


@app.route("/")
def index() -> str:
    """Render the interactive portfolio page hydrated from Python portfolio_data."""
    payload = export_bootstrap_payload()
    return render_template("index.html", PORTFOLIO_JSON=payload)


@app.route("/health")
def health() -> Any:
    """Health check endpoint for WSGI / container probes."""
    return jsonify({"status": "ok", "service": "portfolio-python-app"})


@app.route("/api/profile")
def api_profile() -> Any:
    """Return candidate profile, certifications, and academic analytics."""
    report = build_portfolio_report()
    return jsonify(
        {
            "profile": export_bootstrap_payload()["profile"],
            "certifications": CERTIFICATIONS,
            "analytics": report,
        }
    )


@app.route("/api/skills")
def api_skills() -> Any:
    """Return all skills or filter by ?category=... query parameter."""
    category = request.args.get("category")
    items = filter_skills(category)
    return jsonify({"count": len(items), "category": category or "All", "skills": items})


@app.route("/api/projects")
def api_projects() -> Any:
    """Return structured project summaries."""
    return jsonify({"projects": [p.__dict__ for p in PROJECTS]})


@app.route("/api/weather")
def api_weather_all() -> Any:
    """Return normalized telemetry across all modeled cities."""
    return jsonify({"cities": list_all_city_reports()})


@app.route("/api/weather/<city>")
def api_weather(city: str) -> Any:
    """Return derived meteorological indices and forecast stats for a city."""
    reading = analyze_city_weather(city)
    if reading is None:
        return jsonify({"error": f"City '{city}' not found"}), 404
    mode = request.args.get("mode", "hourly")
    forecast = summarize_forecast_series(city, mode=mode)
    return jsonify({"telemetry": reading.__dict__, "forecast_summary": forecast})


@app.route("/api/campus/query")
def api_campus_query() -> Any:
    """Run natural-language room & laboratory lookup + routing for JAIN Smart Navigation."""
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"error": "Missing required query parameter 'q'"}), 400
    start_floor = int(request.args.get("start_floor", "1"))
    return jsonify(route_campus_query(q, start_floor=start_floor))


@app.route("/api/campus/floors")
def api_campus_floors() -> Any:
    """Return occupancy statistics grouped by floor."""
    return jsonify({"floors": get_floor_occupancy_summary()})


@app.route("/api/charts/gpa.svg")
def api_chart_gpa() -> Response:
    """Serve Python-rendered SVG GPA trajectory graphic."""
    return Response(render_gpa_trajectory_svg(), mimetype="image/svg+xml")


@app.route("/api/charts/skills.svg")
def api_chart_skills() -> Response:
    """Serve Python-rendered SVG skill distribution graphic."""
    return Response(render_skill_breakdown_svg(), mimetype="image/svg+xml")


@app.route("/api/report")
def api_report() -> Any:
    """Expose computed academic GPA and technical skill distribution metrics."""
    report: Dict[str, Any] = build_portfolio_report()
    return jsonify(report)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
`;
}

function buildStaticGeneratorPy(): string {
  return `"""Zero-dependency Python static site generator for Netlify deployment.

Reads templates/index.html, injects serialized portfolio data from portfolio_data.py,
renders server-side SVG charts, copies static assets, and emits dist/index.html.

Usage:
    python3 build_static.py --out dist
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Optional

from analytics import build_portfolio_report
from portfolio_data import export_bootstrap_payload
from svg_charts import render_gpa_trajectory_svg, render_skill_breakdown_svg
from weather_service import list_all_city_reports

ROOT_DIR = Path(__file__).resolve().parent
TEMPLATE_PATH = ROOT_DIR / "templates" / "index.html"
STATIC_DIR = ROOT_DIR / "static"


def render_static_html(template_text: str) -> str:
    """Inject the Python-serialized portfolio JSON payload into the HTML template."""
    payload = export_bootstrap_payload()
    serialized = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")

    rendered = template_text.replace("{{PORTFOLIO_JSON}}", serialized)
    rendered = rendered.replace("{{ PORTFOLIO_JSON | tojson }}", serialized)
    return rendered


def build_site(out_dir: Path, inline_assets: bool = False) -> Path:
    """Compile the portfolio HTML, SVG artifacts, and static CSS/JS assets into out_dir."""
    if not TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"Missing template file: {TEMPLATE_PATH}")

    out_dir.mkdir(parents=True, exist_ok=True)
    template_text = TEMPLATE_PATH.read_text(encoding="utf-8")
    compiled_html = render_static_html(template_text)

    if inline_assets:
        css_path = STATIC_DIR / "css" / "styles.css"
        js_path = STATIC_DIR / "js" / "main.js"
        if css_path.exists():
            css_text = css_path.read_text(encoding="utf-8")
            compiled_html = compiled_html.replace(
                '<link rel="stylesheet" href="static/css/styles.css" />',
                f"<style>\\n{css_text}\\n</style>",
            )
        if js_path.exists():
            js_text = js_path.read_text(encoding="utf-8")
            compiled_html = compiled_html.replace(
                '<script src="static/js/main.js"></script>',
                f"<script>\\n{js_text}\\n</script>",
            )
    else:
        dest_static = out_dir / "static"
        if dest_static.exists():
            shutil.rmtree(dest_static)
        if STATIC_DIR.exists():
            shutil.copytree(STATIC_DIR, dest_static)

    output_index = out_dir / "index.html"
    output_index.write_text(compiled_html, encoding="utf-8")

    # Emit structured JSON summary & vector charts for API/RSS/badges
    artifacts_dir = out_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    (artifacts_dir / "gpa-chart.svg").write_text(render_gpa_trajectory_svg(), encoding="utf-8")
    (artifacts_dir / "skills-chart.svg").write_text(render_skill_breakdown_svg(), encoding="utf-8")

    summary_payload = {
        "analytics": build_portfolio_report(),
        "weather_reports": list_all_city_reports(),
    }
    (out_dir / "portfolio-summary.json").write_text(
        json.dumps(summary_payload, indent=2, ensure_ascii=False) + "\\n",
        encoding="utf-8",
    )
    return output_index


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Build static portfolio site for Netlify.")
    parser.add_argument(
        "--out",
        default="dist",
        help="Output directory for generated static files (default: dist).",
    )
    parser.add_argument(
        "--inline-assets",
        action="store_true",
        help="Inline CSS and JavaScript into a single self-contained HTML artifact.",
    )
    args = parser.parse_args(argv)

    out_path = (ROOT_DIR / args.out).resolve() if not Path(args.out).is_absolute() else Path(args.out)
    built = build_site(out_path, inline_assets=args.inline_assets)
    report = build_portfolio_report()

    print(f"Built static portfolio -> {built}")
    print(
        f"CGPA: {report['gpa']['cgpa']:.2f} | "
        f"Skills: {report['skills']['total']} | "
        f"Projects: {report['projects']['count']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`;
}

function buildAnalyticsPy(): string {
  return `"""Academic performance and skill-matrix analytics module.

Computes GPA trajectories, category distributions, and cross-referenced
project technology coverage from portfolio_data.py.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List

from portfolio_data import (
    CAMPUS_ROOMS,
    PROJECTS,
    SKILLS_DATA,
    WEATHER_SAMPLE,
    get_semester_records,
)


def compute_gpa_metrics() -> Dict[str, Any]:
    """Compute cumulative GPA, semester delta, min/max, and trend direction."""
    records = get_semester_records()
    gpas = [r.gpa for r in records if r.gpa is not None]
    if not gpas:
        return {
            "cgpa": 0.0,
            "latest_gpa": 0.0,
            "highest_gpa": 0.0,
            "lowest_gpa": 0.0,
            "delta": 0.0,
            "semesters_completed": 0,
            "semesters_total": len(records),
            "trend": "none",
        }

    cgpa = round(sum(gpas) / len(gpas), 2)
    latest = gpas[-1]
    delta = round(gpas[-1] - gpas[-2], 2) if len(gpas) >= 2 else 0.0

    if delta > 0:
        trend = "upward"
    elif delta < 0:
        trend = "slight_dip"
    else:
        trend = "steady"

    return {
        "cgpa": cgpa,
        "latest_gpa": latest,
        "highest_gpa": max(gpas),
        "lowest_gpa": min(gpas),
        "delta": delta,
        "semesters_completed": len(gpas),
        "semesters_total": len(records),
        "trend": trend,
    }


def compute_skill_distribution() -> Dict[str, Any]:
    """Aggregate skills by category and proficiency level."""
    by_category: Counter[str] = Counter()
    by_level: Counter[str] = Counter()

    for skill in SKILLS_DATA:
        by_category[str(skill.get("cat", "Uncategorized"))] += 1
        by_level[str(skill.get("level", "Unspecified"))] += 1

    python_related = [
        str(s.get("name"))
        for s in SKILLS_DATA
        if "python" in str(s.get("name", "")).lower()
        or "python" in str(s.get("cat", "")).lower()
        or "python" in str(s.get("desc", "")).lower()
    ]

    return {
        "total": len(SKILLS_DATA),
        "by_category": dict(by_category),
        "by_level": dict(by_level),
        "python_ecosystem_skills": python_related,
    }


def compute_project_coverage() -> Dict[str, Any]:
    """Summarize project stack coverage and interactive dataset counts."""
    tech_counter: Counter[str] = Counter()
    for project in PROJECTS:
        for tech in project.stack:
            tech_counter[tech] += 1

    available_rooms = sum(1 for r in CAMPUS_ROOMS if r.get("status") == "Available")

    return {
        "count": len(PROJECTS),
        "technologies": dict(tech_counter),
        "weather_cities_modeled": len(WEATHER_SAMPLE),
        "campus_rooms_indexed": len(CAMPUS_ROOMS),
        "campus_rooms_available": available_rooms,
    }


def build_portfolio_report() -> Dict[str, Any]:
    """Generate unified analytics dictionary consumed by CLI, API, and static builds."""
    return {
        "gpa": compute_gpa_metrics(),
        "skills": compute_skill_distribution(),
        "projects": compute_project_coverage(),
    }


def format_terminal_summary(report: Dict[str, Any]) -> str:
    """Format portfolio analytics as a readable terminal table."""
    gpa = report["gpa"]
    skills = report["skills"]
    projects = report["projects"]

    lines: List[str] = [
        "Portfolio Analytics Summary",
        "---------------------------",
        f"Cumulative GPA      : {gpa['cgpa']:.2f} ({gpa['semesters_completed']} semesters)",
        f"Latest Semester GPA : {gpa['latest_gpa']:.2f} (delta {gpa['delta']:+.2f})",
        f"Total Skills        : {skills['total']}",
        f"Featured Projects   : {projects['count']}",
        f"Weather Cities      : {projects['weather_cities_modeled']}",
        f"Campus Rooms        : {projects['campus_rooms_indexed']} ({projects['campus_rooms_available']} available)",
        "",
        "Skills by Category:",
    ]

    for cat, count in sorted(skills["by_category"].items()):
        lines.append(f"  - {cat}: {count}")

    return "\\n".join(lines)
`;
}

function buildTestsPy(): string {
  return `"""Unit test suite for portfolio data, analytics, and static site generation."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from analytics import build_portfolio_report, compute_gpa_metrics
from build_static import build_site
from campus_engine import query_campus_rooms
from portfolio_data import (
    CAMPUS_ROOMS,
    PROFILE,
    SKILLS_DATA,
    export_bootstrap_payload,
    filter_skills,
)


class PortfolioDataTests(unittest.TestCase):
    """Validate structured portfolio datasets and lookup helpers."""

    def test_profile_identity(self) -> None:
        self.assertTrue(len(PROFILE.full_name) > 0)
        self.assertIn("@", PROFILE.email)

    def test_filter_skills_all_and_category(self) -> None:
        all_skills = filter_skills("All")
        self.assertEqual(len(all_skills), len(SKILLS_DATA))

        if SKILLS_DATA:
            first_cat = str(SKILLS_DATA[0]["cat"])
            filtered = filter_skills(first_cat)
            self.assertGreaterEqual(len(filtered), 1)
            self.assertTrue(all(s["cat"] == first_cat for s in filtered))

    def test_campus_query_resolution(self) -> None:
        if not CAMPUS_ROOMS:
            self.skipTest("No campus rooms present in extracted dataset")
        vacant = query_campus_rooms("Show vacant rooms")
        self.assertGreaterEqual(len(vacant), 1)
        ai_lab = query_campus_rooms("Find available AI Lab")
        self.assertGreaterEqual(len(ai_lab), 1)

    def test_bootstrap_payload_json_serializable(self) -> None:
        payload = export_bootstrap_payload()
        encoded = json.dumps(payload)
        self.assertIn("profile", encoded)
        self.assertIn("semesters", encoded)


class AnalyticsAndBuildTests(unittest.TestCase):
    """Validate GPA analytics calculations and static site compilation."""

    def test_gpa_metrics(self) -> None:
        metrics = compute_gpa_metrics()
        self.assertGreater(metrics["cgpa"], 0.0)
        self.assertGreaterEqual(metrics["semesters_completed"], 1)

    def test_portfolio_report_structure(self) -> None:
        report = build_portfolio_report()
        self.assertIn("gpa", report)
        self.assertIn("skills", report)
        self.assertIn("projects", report)

    def test_static_build_creates_index_and_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp) / "dist"
            index_file = build_site(out_dir)
            self.assertTrue(index_file.exists())
            html = index_file.read_text(encoding="utf-8")
            self.assertIn("<!DOCTYPE html>", html)
            self.assertNotIn("{{PORTFOLIO_JSON}}", html)
            self.assertTrue((out_dir / "portfolio-summary.json").exists())
            self.assertTrue((out_dir / "artifacts" / "gpa-chart.svg").exists())


if __name__ == "__main__":
    unittest.main()
`;
}

function buildEngineTestsPy(): string {
  return `"""Extended unittest suite for weather analytics, campus navigation, and SVG charts."""

from __future__ import annotations

import unittest

from campus_engine import (
    get_floor_occupancy_summary,
    parse_campus_intent,
    route_campus_query,
)
from portfolio_data import CAMPUS_ROOMS, WEATHER_SAMPLE
from svg_charts import render_gpa_trajectory_svg, render_skill_breakdown_svg
from weather_service import (
    analyze_city_weather,
    calculate_dew_point,
    calculate_heat_index,
    classify_uv_band,
    summarize_forecast_series,
)


class WeatherServiceTests(unittest.TestCase):
    """Verify meteorological index calculations and forecast aggregation."""

    def test_dew_point_and_heat_index(self) -> None:
        dew = calculate_dew_point(30.0, 60.0)
        self.assertGreater(dew, 15.0)
        self.assertLess(dew, 30.0)

        hi = calculate_heat_index(34.0, 55.0)
        self.assertGreaterEqual(hi, 34.0)

    def test_uv_band_classification(self) -> None:
        self.assertEqual(classify_uv_band(1), "Low")
        self.assertEqual(classify_uv_band(5), "Moderate")
        self.assertEqual(classify_uv_band(7), "High")
        self.assertEqual(classify_uv_band(9), "Very High")

    def test_city_analysis_and_forecast_summary(self) -> None:
        if not WEATHER_SAMPLE:
            self.skipTest("No weather cities present in extracted dataset")
        first_city = next(iter(WEATHER_SAMPLE.keys()))
        reading = analyze_city_weather(first_city)
        self.assertIsNotNone(reading)
        assert reading is not None
        self.assertGreaterEqual(reading.comfort_score, 0)
        self.assertLessEqual(reading.comfort_score, 100)

        summary = summarize_forecast_series(first_city, mode="hourly")
        self.assertGreater(summary["points"], 0)


class CampusEngineTests(unittest.TestCase):
    """Verify intent classification, floor summaries, and routing steps."""

    def test_intent_parsing(self) -> None:
        self.assertEqual(parse_campus_intent("Find available AI Lab"), "locate_ai_lab")
        self.assertEqual(parse_campus_intent("Show vacant rooms"), "find_vacant_rooms")
        self.assertEqual(parse_campus_intent("Where is Classroom 304?"), "lookup_room_number")

    def test_route_campus_query(self) -> None:
        if not CAMPUS_ROOMS:
            self.skipTest("No campus rooms in extracted dataset")
        routed = route_campus_query("Find available AI Lab", start_floor=1)
        self.assertGreaterEqual(len(routed["matched_rooms"]), 1)
        self.assertGreaterEqual(len(routed["directions"]), 2)
        floors = get_floor_occupancy_summary()
        self.assertTrue(len(floors) >= 1)


class SvgChartsTests(unittest.TestCase):
    """Verify vector chart generation outputs valid SVG markup."""

    def test_svg_outputs(self) -> None:
        gpa_svg = render_gpa_trajectory_svg()
        self.assertIn("<svg", gpa_svg)
        self.assertIn("</svg>", gpa_svg)

        skills_svg = render_skill_breakdown_svg()
        self.assertIn("<svg", skills_svg)
        self.assertIn("</svg>", skills_svg)


if __name__ == "__main__":
    unittest.main()
`;
}

function buildCliPy(): string {
  return `"""Developer CLI for managing, inspecting, and building the portfolio.

Commands:
    python3 cli.py stats
    python3 cli.py build --out dist
    python3 cli.py skills --category "Programming Languages"
    python3 cli.py campus --query "Find available AI Lab"
    python3 cli.py weather --city Hyderabad
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Optional

from analytics import build_portfolio_report, format_terminal_summary
from build_static import build_site
from campus_engine import route_campus_query
from portfolio_data import filter_skills
from weather_service import analyze_city_weather, summarize_forecast_series


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="portfolio-cli",
        description="Inspect portfolio analytics, query datasets, and build static Netlify output.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    stats_cmd = sub.add_parser("stats", help="Print GPA, skill, and project summary.")
    stats_cmd.add_argument("--json", action="store_true", help="Output raw JSON report.")

    build_cmd = sub.add_parser("build", help="Compile static portfolio output.")
    build_cmd.add_argument("--out", default="dist", help="Target output directory.")
    build_cmd.add_argument("--inline", action="store_true", help="Inline CSS and JS into index.html.")

    skills_cmd = sub.add_parser("skills", help="List skills optionally filtered by category.")
    skills_cmd.add_argument("--category", default="All", help="Skill category filter.")

    campus_cmd = sub.add_parser("campus", help="Test natural-language campus room query.")
    campus_cmd.add_argument("--query", required=True, help="Natural language room query.")

    weather_cmd = sub.add_parser("weather", help="Analyze weather telemetry for a city.")
    weather_cmd.add_argument("--city", required=True, help="City name (e.g. Hyderabad).")

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "stats":
        report = build_portfolio_report()
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            print(format_terminal_summary(report))
        return 0

    if args.command == "build":
        out_path = Path(args.out).resolve()
        built = build_site(out_path, inline_assets=args.inline)
        print(f"Static build complete: {built}")
        return 0

    if args.command == "skills":
        items = filter_skills(args.category)
        for item in items:
            print(f"- {item.get('name')} ({item.get('level')}) [{item.get('cat')}]")
        return 0

    if args.command == "campus":
        routed = route_campus_query(args.query)
        print(f"Intent: {routed['intent']} | Target Floor: {routed['target_floor']}")
        for step in routed["directions"]:
            print(f"  -> {step}")
        return 0

    if args.command == "weather":
        reading = analyze_city_weather(args.city)
        if not reading:
            print(f"City not found: {args.city}")
            return 1
        forecast = summarize_forecast_series(args.city, mode="hourly")
        print(
            f"{reading.city}: {reading.temperature_c}C | "
            f"Heat Index {reading.heat_index_c}C | "
            f"Comfort {reading.comfort_score}/100 | UV {reading.uv_band}"
        )
        print(f"Hourly mean: {forecast.get('mean_c')}C (peak at {forecast.get('peak_slot')})")
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
`;
}

function buildResumeExporterPy(): string {
  return `"""Resume and structured JSON-CV exporter driven by portfolio_data.py."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from analytics import compute_gpa_metrics
from portfolio_data import (
    CERTIFICATIONS,
    PROFILE,
    PROJECTS,
    SKILLS_DATA,
    get_semester_records,
)


def to_json_resume() -> Dict[str, Any]:
    """Generate a JSON-Resume compatible dictionary from Python portfolio models."""
    gpa_stats = compute_gpa_metrics()
    semesters = get_semester_records()

    grouped_skills: Dict[str, List[str]] = {}
    for skill in SKILLS_DATA:
        cat = str(skill.get("cat", "General"))
        grouped_skills.setdefault(cat, []).append(str(skill.get("name", "")))

    return {
        "basics": {
            "name": PROFILE.full_name,
            "label": PROFILE.role,
            "email": PROFILE.email,
            "phone": PROFILE.phone,
            "summary": PROFILE.summary,
            "location": {"city": PROFILE.location},
            "profiles": [
                {"network": "GitHub", "username": PROFILE.github_username},
                {"network": "LinkedIn", "url": PROFILE.linkedin_url},
            ],
        },
        "education": [
            {
                "institution": PROFILE.university,
                "area": PROFILE.degree,
                "studyType": "Bachelor of Technology",
                "score": f"{gpa_stats['cgpa']:.2f} CGPA",
                "courses": [
                    f"{s.label}: {s.gpa:.2f} ({s.note})"
                    for s in semesters
                    if s.gpa is not None
                ],
            }
        ],
        "skills": [
            {"name": category, "keywords": names}
            for category, names in grouped_skills.items()
        ],
        "projects": [
            {
                "name": proj.title,
                "description": proj.subtitle,
                "highlights": proj.highlights,
                "keywords": proj.stack,
                "roles": [proj.role],
            }
            for proj in PROJECTS
        ],
        "certificates": [
            {"name": cert["title"], "issuer": cert["issuer"]}
            for cert in CERTIFICATIONS
        ],
    }


def to_markdown_cv() -> str:
    """Render a clean Markdown resume from portfolio_data.py."""
    gpa_stats = compute_gpa_metrics()
    lines: List[str] = [
        f"# {PROFILE.full_name}",
        f"**{PROFILE.role}**  ",
        f"{PROFILE.location} | {PROFILE.email} | {PROFILE.phone}",
        "",
        "## Summary",
        PROFILE.summary,
        "",
        "## Education",
        f"- **{PROFILE.university}** — {PROFILE.degree} ({PROFILE.batch}) · CGPA: **{gpa_stats['cgpa']:.2f}**",
        "",
        "## Technical Skills",
    ]

    for skill in SKILLS_DATA:
        lines.append(f"- **{skill.get('name')}** ({skill.get('level')}): {skill.get('desc')}")

    lines.extend(["", "## Projects"])
    for proj in PROJECTS:
        lines.append(f"### {proj.title} — {proj.role}")
        lines.append(proj.subtitle)
        for item in proj.highlights:
            lines.append(f"- {item}")
        lines.append("")

    return "\\n".join(lines)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Export portfolio CV as JSON or Markdown.")
    parser.add_argument("--format", choices=["json", "markdown"], default="markdown")
    parser.add_argument("--out", help="Optional output file path.")
    args = parser.parse_args(argv)

    content = (
        json.dumps(to_json_resume(), indent=2, ensure_ascii=False)
        if args.format == "json"
        else to_markdown_cv()
    )

    if args.out:
        Path(args.out).write_text(content, encoding="utf-8")
        print(f"Exported {args.format} resume to {args.out}")
    else:
        print(content)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`;
}

function buildSeoValidatorPy(): string {
  return `"""HTML metadata, accessibility, and link-integrity auditor using Python stdlib."""

from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, List


@dataclass
class AuditFinding:
    """Single validation check outcome."""

    check: str
    passed: bool
    detail: str


class _MetaAndHeadingParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.has_title = False
        self.title_text = ""
        self._in_title = False
        self.has_viewport = False
        self.h1_count = 0
        self.images_missing_alt = 0
        self.external_links = 0

    def handle_starttag(self, tag: str, attrs: List[tuple[str, str | None]]) -> None:
        attr_map: Dict[str, str] = {k.lower(): (v or "") for k, v in attrs}
        t = tag.lower()
        if t == "title":
            self._in_title = True
            self.has_title = True
        elif t == "meta" and attr_map.get("name", "").lower() == "viewport":
            self.has_viewport = True
        elif t == "h1":
            self.h1_count += 1
        elif t == "img" and not attr_map.get("alt", "").strip():
            self.images_missing_alt += 1
        elif t == "a" and attr_map.get("href", "").startswith("http"):
            self.external_links += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title_text += data


def audit_html_file(html_path: Path) -> List[AuditFinding]:
    """Run structural accessibility and SEO checks on a built HTML file."""
    content = html_path.read_text(encoding="utf-8")
    parser = _MetaAndHeadingParser()
    parser.feed(content)

    return [
        AuditFinding(
            check="document_title",
            passed=parser.has_title and len(parser.title_text.strip()) > 0,
            detail=parser.title_text.strip() or "Missing <title>",
        ),
        AuditFinding(
            check="mobile_viewport",
            passed=parser.has_viewport,
            detail="Viewport meta present" if parser.has_viewport else "Missing viewport meta tag",
        ),
        AuditFinding(
            check="single_primary_h1",
            passed=parser.h1_count == 1,
            detail=f"Found {parser.h1_count} <h1> element(s)",
        ),
        AuditFinding(
            check="image_alt_text",
            passed=parser.images_missing_alt == 0,
            detail=f"{parser.images_missing_alt} image(s) missing alt attribute",
        ),
    ]
`;
}

function buildSkillGraphPy(): string {
  return `"""Skill-to-project knowledge graph and role-alignment engine."""

from __future__ import annotations

from typing import Any, Dict, List, Set

from portfolio_data import PROJECTS, SKILLS_DATA


def build_skill_project_adjacency() -> Dict[str, List[str]]:
    """Map each technical skill to featured projects that utilize it."""
    adjacency: Dict[str, List[str]] = {}
    for skill in SKILLS_DATA:
        skill_name = str(skill.get("name", ""))
        skill_lower = skill_name.lower()
        linked: List[str] = []

        for project in PROJECTS:
            stack_tokens = " ".join(project.stack).lower()
            if skill_lower in stack_tokens or any(
                skill_lower in str(ref.get("label", "")).lower()
                for ref in skill.get("refs", [])
            ):
                linked.append(project.title)

        adjacency[skill_name] = linked
    return adjacency


def search_skills_by_keyword(keyword: str) -> List[Dict[str, Any]]:
    """Perform case-insensitive search across skill names, categories, and descriptions."""
    q = keyword.strip().lower()
    if not q:
        return list(SKILLS_DATA)
    return [
        s
        for s in SKILLS_DATA
        if q in str(s.get("name", "")).lower()
        or q in str(s.get("cat", "")).lower()
        or q in str(s.get("desc", "")).lower()
    ]


def compute_track_coverage() -> Dict[str, Any]:
    """Measure skill coverage across Python/AI-ML, Backend/DB, and Web tracks."""
    skill_names: Set[str] = {str(s.get("name", "")).lower() for s in SKILLS_DATA}
    tracks = {
        "python_ai_ml": ["python", "numpy", "pandas", "pytorch"],
        "backend_and_db": ["java", "mysql", "data structures & algorithms (dsa)", "object-oriented programming (oop)"],
        "web_and_tooling": ["html", "css", "vs code", "github"],
    }

    summary: Dict[str, Dict[str, Any]] = {}
    for track, expected in tracks.items():
        matched = [item for item in expected if item in skill_names]
        pct = round((len(matched) / len(expected)) * 100.0, 1) if expected else 0.0
        summary[track] = {
            "matched_count": len(matched),
            "expected_count": len(expected),
            "coverage_pct": pct,
        }
    return summary
`;
}

function buildExporterSeoTestsPy(): string {
  return `"""Unit tests for resume_exporter, seo_validator, and skill_graph modules."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from build_static import build_site
from resume_exporter import to_json_resume, to_markdown_cv
from seo_validator import audit_html_file
from skill_graph import (
    build_skill_project_adjacency,
    compute_track_coverage,
    search_skills_by_keyword,
)


class ExporterAndSeoTests(unittest.TestCase):
    """Validate CV export, HTML structural audit, and skill graph lookups."""

    def test_json_and_markdown_resume_exports(self) -> None:
        resume = to_json_resume()
        self.assertIn("basics", resume)
        self.assertIn("education", resume)
        self.assertIn("skills", resume)

        md = to_markdown_cv()
        self.assertIn("## Education", md)
        self.assertIn("## Technical Skills", md)

    def test_seo_audit_on_compiled_html(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            built = build_site(Path(tmp) / "dist")
            findings = audit_html_file(built)
            self.assertTrue(all(f.passed for f in findings), msg=str(findings))

    def test_skill_graph_queries(self) -> None:
        adjacency = build_skill_project_adjacency()
        self.assertIsInstance(adjacency, dict)
        matches = search_skills_by_keyword("python")
        self.assertGreaterEqual(len(matches), 1)
        coverage = compute_track_coverage()
        self.assertIn("python_ai_ml", coverage)


if __name__ == "__main__":
    unittest.main()
`;
}

function buildReadmeMd(opts: {
  owner: string;
  repo: string;
  ownerName: string;
  title: string;
}): string {
  return `# ${opts.ownerName} — Python-Powered Portfolio

Modular Python + Flask + Static Site Generator architecture refactored from the original single-file portfolio while preserving full interactive behavior on Netlify.

## Project Structure

- \`portfolio_data.py\` — Typed dataclasses and structured datasets (academics, skills, weather telemetry, campus rooms, projects)
- \`app.py\` — Flask web application and JSON API endpoints (\`/api/profile\`, \`/api/skills\`, \`/api/projects\`, \`/api/weather/<city>\`, \`/api/campus/query\`)
- \`build_static.py\` — Zero-dependency Python static site builder generating \`dist/\` for Netlify
- \`analytics.py\` — GPA trajectory and skill distribution analytics
- \`weather_service.py\` — Meteorological comfort index, heat index, and UV risk engine
- \`campus_engine.py\` — NLP query parser and corridor routing engine
- \`svg_charts.py\` — Server-side vector chart renderer
- \`tests/\` — Automated \`unittest\` suites
- \`templates/index.html\` — Semantic HTML template
- \`static/css/styles.css\` & \`static/js/main.js\` — Extracted stylesheet and client interactivity
- \`netlify.toml\` — Netlify build configuration (\`python3 build_static.py --out dist\`)

## Local Development

\`\`\`bash
# Run Flask server locally
pip install -r requirements.txt
python3 app.py

# Build static Netlify bundle (zero external dependencies)
python3 build_static.py --out dist

# Run automated tests
python3 -m unittest discover -s tests -v
\`\`\`
`;
}
