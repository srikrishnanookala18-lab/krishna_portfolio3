import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeHtmlBytes,
  createZipArchiveBuffer,
  refactorPortfolioHtml,
  type GeneratedFile,
  type NetlifyMode,
  type RefactorPreset,
} from './server/refactorEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const GITHUB_API = 'https://api.github.com';
const inspectCache = new Map<string, { expiresAt: number; payload: unknown }>();

function githubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'PyRefactor-Studio/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token && token.trim().length > 0) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

interface GithubContentItem {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir';
  download_url: string | null;
}

async function fetchRepoHtmlFiles(owner: string, repo: string, branch: string, token?: string) {
  const res = await fetch(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/?ref=${encodeURIComponent(branch)}`,
    { headers: githubHeaders(token) }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub contents API returned ${res.status}: ${errText}`);
  }
  const items = (await res.json()) as GithubContentItem[];
  return items;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Inspect live GitHub repository and extract primary HTML file
  app.get('/api/repo/inspect', async (req, res) => {
    try {
      const owner = String(req.query.owner || 'srikrishnanookala18-lab').trim();
      const repo = String(req.query.repo || 'portfolio2').trim();
      const token = req.headers['x-github-token'] ? String(req.headers['x-github-token']) : undefined;
      const cacheKey = `${owner}/${repo}`.toLowerCase();

      const cached = !token ? inspectCache.get(cacheKey) : undefined;
      if (cached && cached.expiresAt > Date.now()) {
        return res.json(cached.payload);
      }

      const repoRes = await fetch(
        `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        { headers: githubHeaders(token) }
      );
      if (!repoRes.ok) {
        if (cached) {
          return res.json(cached.payload);
        }
        const msg = await repoRes.text();
        return res.status(repoRes.status).json({ error: `Unable to fetch repository metadata: ${msg}` });
      }
      const repoMeta = (await repoRes.json()) as {
        full_name: string;
        html_url: string;
        default_branch: string;
        private: boolean;
        description: string | null;
        stargazers_count: number;
      };

      const branch = repoMeta.default_branch || 'main';
      const [contents, langRes] = await Promise.all([
        fetchRepoHtmlFiles(owner, repo, branch, token),
        fetch(
          `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`,
          { headers: githubHeaders(token) }
        ),
      ]);

      const languages = langRes.ok ? ((await langRes.json()) as Record<string, number>) : {};
      const htmlCandidates = contents
        .filter((f) => f.type === 'file' && /\.html?$/i.test(f.name))
        .sort((a, b) => b.size - a.size);

      const primaryHtml = htmlCandidates[0] || null;
      let rawHtml = '';
      if (primaryHtml && primaryHtml.download_url) {
        const rawRes = await fetch(primaryHtml.download_url);
        if (rawRes.ok) {
          rawHtml = await rawRes.text();
        }
      }

      const breakdown = rawHtml ? analyzeHtmlBytes(rawHtml) : null;

      const payload = {
        owner,
        repo,
        fullName: repoMeta.full_name,
        htmlUrl: repoMeta.html_url,
        defaultBranch: branch,
        isPrivate: repoMeta.private,
        files: contents.map((c) => ({
          name: c.name,
          path: c.path,
          size: c.size,
          type: c.type,
          sha: c.sha,
        })),
        languages,
        primaryHtmlFile: primaryHtml ? primaryHtml.path : null,
        rawHtml,
        breakdown,
      };

      if (!token && rawHtml) {
        inspectCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60 * 1000, payload });
      }

      return res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Repository inspection failed';
      return res.status(500).json({ error: message });
    }
  });

  // Refactor HTML into Python + templates + static + Netlify config and run Python build/tests
  app.post('/api/repo/refactor', async (req, res) => {
    try {
      const {
        owner = 'srikrishnanookala18-lab',
        repo = 'portfolio2',
        originalFilename = 'nookala-sri-krishna-modern-interactive-portfolio (1).html',
        rawHtml,
        preset = 'standard',
        netlifyMode = 'netlify-toml',
      } = req.body as {
        owner?: string;
        repo?: string;
        originalFilename?: string;
        rawHtml?: string;
        preset?: RefactorPreset;
        netlifyMode?: NetlifyMode;
      };

      let htmlSource = rawHtml;
      if (!htmlSource || !htmlSource.trim()) {
        const encodedFile = encodeURIComponent(originalFilename);
        const fallbackRes = await fetch(
          `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/main/${encodedFile}`
        );
        if (!fallbackRes.ok) {
          return res.status(400).json({ error: 'No HTML source provided and fallback GitHub fetch failed.' });
        }
        htmlSource = await fallbackRes.text();
      }

      const result = await refactorPortfolioHtml({
        owner,
        repo,
        originalFilename,
        rawHtml: htmlSource,
        preset,
        netlifyMode,
      });

      return res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refactor failed';
      return res.status(500).json({ error: message });
    }
  });

  // Generate downloadable ZIP archive of the refactored repository
  app.post('/api/repo/download-zip', async (req, res) => {
    try {
      const { files, repo = 'portfolio2' } = req.body as {
        files: GeneratedFile[];
        repo?: string;
      };
      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'Missing files array' });
      }
      const zipBuf = await createZipArchiveBuffer(files);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${repo}-python-refactored.zip"`);
      return res.send(zipBuf);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ZIP creation failed';
      return res.status(500).json({ error: message });
    }
  });

  // Verify GitHub Personal Access Token permissions against target repo
  app.post('/api/github/verify', async (req, res) => {
    try {
      const { token, owner, repo } = req.body as {
        token: string;
        owner: string;
        repo: string;
      };
      if (!token || !owner || !repo) {
        return res.status(400).json({ error: 'Token, owner, and repo are required.' });
      }

      const [userRes, repoRes] = await Promise.all([
        fetch(`${GITHUB_API}/user`, { headers: githubHeaders(token) }),
        fetch(`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
          headers: githubHeaders(token),
        }),
      ]);

      if (!userRes.ok) {
        return res.status(401).json({ error: 'Invalid or expired GitHub token.' });
      }
      if (!repoRes.ok) {
        return res.status(repoRes.status).json({ error: `Cannot access ${owner}/${repo} with this token.` });
      }

      const userData = (await userRes.json()) as { login: string; avatar_url: string };
      const repoData = (await repoRes.json()) as {
        default_branch: string;
        permissions?: { push?: boolean; admin?: boolean; pull?: boolean };
      };

      const canPush = Boolean(repoData.permissions?.push || repoData.permissions?.admin);

      return res.json({
        ok: true,
        login: userData.login,
        avatarUrl: userData.avatar_url,
        defaultBranch: repoData.default_branch || 'main',
        canPush,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'GitHub verification failed';
      return res.status(500).json({ error: message });
    }
  });

  // Push atomic commit to GitHub repository via Git Data API
  app.post('/api/github/push', async (req, res) => {
    try {
      const {
        token,
        owner,
        repo,
        branch = 'main',
        commitMessage = 'Refactor monolithic HTML portfolio into modular Python app + Netlify SSG',
        files,
        removeOriginalFile,
      } = req.body as {
        token: string;
        owner: string;
        repo: string;
        branch?: string;
        commitMessage?: string;
        files: GeneratedFile[];
        removeOriginalFile?: string | null;
      };

      if (!token || !owner || !repo || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'Missing required push payload.' });
      }

      const headers = githubHeaders(token);
      const repoBase = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

      // 1. Get branch ref
      const refRes = await fetch(`${repoBase}/git/ref/heads/${encodeURIComponent(branch)}`, { headers });
      if (!refRes.ok) {
        const msg = await refRes.text();
        return res.status(refRes.status).json({ error: `Failed to read branch '${branch}': ${msg}` });
      }
      const refData = (await refRes.json()) as { object: { sha: string } };
      const latestCommitSha = refData.object.sha;

      // 2. Get base commit tree SHA
      const commitRes = await fetch(`${repoBase}/git/commits/${latestCommitSha}`, { headers });
      if (!commitRes.ok) {
        return res.status(commitRes.status).json({ error: 'Failed to inspect base commit.' });
      }
      const commitData = (await commitRes.json()) as { tree: { sha: string } };
      const baseTreeSha = commitData.tree.sha;

      // 3. Read existing base tree entries so we can cleanly drop removeOriginalFile if requested
      const baseTreeRes = await fetch(`${repoBase}/git/trees/${baseTreeSha}?recursive=1`, { headers });
      const existingEntries: Array<{ path: string; mode: string; type: string; sha: string }> =
        baseTreeRes.ok
          ? (((await baseTreeRes.json()) as { tree: Array<{ path: string; mode: string; type: string; sha: string }> }).tree || [])
          : [];

      // 4. Create blobs for all new/updated files
      const newFilePaths = new Set(files.map((f) => f.path));
      const treeEntries: Array<{ path: string; mode: string; type: 'blob'; sha: string }> = [];

      // Preserve unrelated existing files (except removed monolith and overwritten paths)
      for (const entry of existingEntries) {
        if (entry.type !== 'blob') continue;
        if (removeOriginalFile && entry.path === removeOriginalFile) continue;
        if (newFilePaths.has(entry.path)) continue;
        treeEntries.push({
          path: entry.path,
          mode: entry.mode,
          type: 'blob',
          sha: entry.sha,
        });
      }

      for (const file of files) {
        const blobRes = await fetch(`${repoBase}/git/blobs`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: file.content,
            encoding: 'utf-8',
          }),
        });
        if (!blobRes.ok) {
          const msg = await blobRes.text();
          return res.status(blobRes.status).json({ error: `Failed to upload ${file.path}: ${msg}` });
        }
        const blobData = (await blobRes.json()) as { sha: string };
        treeEntries.push({
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: blobData.sha,
        });
      }

      // 5. Create new Git Tree (without base_tree so deleted file is truly removed)
      const createTreeRes = await fetch(`${repoBase}/git/trees`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tree: treeEntries }),
      });
      if (!createTreeRes.ok) {
        const msg = await createTreeRes.text();
        return res.status(createTreeRes.status).json({ error: `Failed to create Git tree: ${msg}` });
      }
      const newTree = (await createTreeRes.json()) as { sha: string };

      // 6. Create Commit
      const createCommitRes = await fetch(`${repoBase}/git/commits`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: commitMessage,
          tree: newTree.sha,
          parents: [latestCommitSha],
        }),
      });
      if (!createCommitRes.ok) {
        const msg = await createCommitRes.text();
        return res.status(createCommitRes.status).json({ error: `Failed to create commit: ${msg}` });
      }
      const newCommit = (await createCommitRes.json()) as { sha: string; html_url: string };

      // 7. Update branch ref
      const updateRefRes = await fetch(`${repoBase}/git/refs/heads/${encodeURIComponent(branch)}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha: newCommit.sha, force: false }),
      });
      if (!updateRefRes.ok) {
        const msg = await updateRefRes.text();
        return res.status(updateRefRes.status).json({ error: `Failed to update ref '${branch}': ${msg}` });
      }

      // 8. Fetch updated language stats from GitHub
      const updatedLangRes = await fetch(`${repoBase}/languages`, { headers });
      const updatedLanguages = updatedLangRes.ok
        ? ((await updatedLangRes.json()) as Record<string, number>)
        : null;

      return res.json({
        ok: true,
        commitSha: newCommit.sha,
        commitUrl: newCommit.html_url,
        filesCommitted: files.length,
        removedFile: removeOriginalFile || null,
        updatedLanguages,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'GitHub push failed';
      return res.status(500).json({ error: message });
    }
  });

  // Mount Vite middleware in development or serve built dist/ in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    try {
      await fs.access(distDir);
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    } catch {
      // Fallback if dist not built
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PyRefactor Studio listening on http://0.0.0.0:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
