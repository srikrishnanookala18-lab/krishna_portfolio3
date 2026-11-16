import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, '..', 'python_engine', 'refactor_cli.py');

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

function runPythonCli<T>(mode: 'analyze' | 'refactor' | 'zip', payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [CLI_PATH, '--mode', mode], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', (err) => reject(err));

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Python engine exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch (err) {
        reject(new Error(`Invalid JSON from python_engine: ${err instanceof Error ? err.message : String(err)}`));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
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
    styleBytes += Buffer.byteLength(m[0], 'utf8');
  }
  for (const m of html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)) {
    scriptBytes += Buffer.byteLength(m[0], 'utf8');
  }
  const totalBytes = Buffer.byteLength(html, 'utf8');
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
  return runPythonCli<RefactorOutput>('refactor', params);
}

export async function createZipArchiveBuffer(files: GeneratedFile[]): Promise<Buffer> {
  const { zipBase64 } = await runPythonCli<{ zipBase64: string }>('zip', { files });
  return Buffer.from(zipBase64, 'base64');
}
