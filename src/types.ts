export type RefactorPreset = 'balanced' | 'standard' | 'python-first';
export type NetlifyMode = 'netlify-toml' | 'root-index';

export interface RepoFileMeta {
  name: string;
  path: string;
  size: number;
  type: 'file' | 'dir';
  sha: string;
}

export interface RepoInspection {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
  files: RepoFileMeta[];
  languages: Record<string, number>;
  primaryHtmlFile: string | null;
  rawHtml: string;
  breakdown: {
    totalBytes: number;
    styleBytes: number;
    scriptBytes: number;
    htmlBytes: number;
  } | null;
}

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

export interface GithubVerifyResponse {
  ok: boolean;
  login: string;
  avatarUrl: string;
  defaultBranch: string;
  canPush: boolean;
}

export interface GithubPushResponse {
  ok: boolean;
  commitSha: string;
  commitUrl: string;
  filesCommitted: number;
  removedFile: string | null;
  updatedLanguages: Record<string, number> | null;
}
