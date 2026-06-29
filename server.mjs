import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { timingSafeEqual } from 'node:crypto';
import { dbAvailable, deletePluginFromDb, findPluginByRepositoryFromDb, findPluginsByRepositoryFromDb, listSubmissionsFromDb, readRegistryFromDb, upsertPlugin, upsertSubmission } from './db.mjs';

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT || 80);
const ROOT = process.cwd();
const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_MS = Number(process.env.SUBMISSION_RATE_WINDOW_MS || 60_000);
const RATE_LIMIT = Number(process.env.SUBMISSION_RATE_LIMIT || 10);
const CLONE_TIMEOUT_MS = Number(process.env.PLUGIN_CLONE_TIMEOUT_MS || 45_000);
const GITHUB_HEALTH_TIMEOUT_MS = Number(process.env.GITHUB_HEALTH_TIMEOUT_MS || 10_000);
const GITHUB_HEALTH_REPOSITORY = process.env.GITHUB_HEALTH_REPOSITORY || 'https://github.com/upstash/context7';
const GITHUB_PROXY_PREFIX = normalizeGithubProxyPrefix(process.env.GITHUB_PROXY_PREFIX || '');
const MAX_WALK_FILES = Number(process.env.PLUGIN_WALK_FILE_LIMIT || 5000);
const ADMIN_PASSWORD = process.env.MARKETPLACE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';

const allowedFiles = new Set(['index.html', '404.html', 'app.js', 'styles.css']);
const allowedDirs = new Set(['assets']);
const appShellRoutes = new Set(['plugins', 'share', 'reviews', 'submit', 'install', 'about', 'perspective']);
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

const buckets = new Map();
const memory = { plugins: new Map(), checks: new Map() };

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}


function normalizeGithubProxyPrefix(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || /^(0|false|none|off)$/i.test(trimmed)) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function proxiedGithubUrl(normalizedUrl) {
  if (!GITHUB_PROXY_PREFIX) return '';
  return `${GITHUB_PROXY_PREFIX}${normalizedUrl}`;
}

function githubUrlCandidates(normalizedUrl) {
  const proxied = proxiedGithubUrl(normalizedUrl);
  return [proxied || normalizedUrl];
}

function gitSourceLabel(url, normalizedUrl) {
  return url === normalizedUrl ? 'github' : 'github-proxy';
}

function gitFailureSummary(error) {
  const message = String(error?.stderr || error?.stdout || error?.message || '').replace(/\s+/g, ' ').trim();
  if (/timed out|timeout/i.test(message)) return 'timeout';
  if (/could not resolve|name or service not known|dns/i.test(message)) return 'dns';
  if (/connection reset|failed to connect|connection timed out|network is unreachable/i.test(message)) return 'network';
  if (/repository not found|not found|authentication failed|403|401/i.test(message)) return 'unavailable';
  return message.slice(0, 180) || 'unknown';
}

function parseHeadRefOutput(stdout) {
  const text = String(stdout || '');
  const branch = text.match(/^ref:\s+refs\/heads\/(.+?)\s+HEAD$/m)?.[1] || '';
  const headSha = text.match(/^([a-f0-9]{40})\s+HEAD$/m)?.[1] || null;
  return { defaultBranch: branch || 'HEAD', headSha };
}

function repositoryTreeUrl(normalizedUrl, defaultBranch) {
  const branch = String(defaultBranch || '').trim();
  if (!branch || branch === 'HEAD') return normalizedUrl;
  const encodedBranch = branch.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `${normalizedUrl}/tree/${encodedBranch}`;
}

function repositoryRefMetadata(normalizedUrl, defaultBranch, headSha) {
  const branch = String(defaultBranch || '').trim() || 'HEAD';
  return {
    defaultBranch: branch,
    headSha: headSha || null,
    repositoryTreeUrl: repositoryTreeUrl(normalizedUrl, branch),
    installSourceUrl: normalizedUrl,
  };
}

function withRepositoryRef(plugin, ref) {
  const metadata = repositoryRefMetadata(plugin.repositoryUrl, ref.defaultBranch, ref.headSha);
  return {
    ...plugin,
    ...metadata,
    releaseTag: metadata.defaultBranch,
    source: { ...(plugin.source || {}), ...metadata },
  };
}

async function runGitRead(args, { timeout, normalizedUrl, beforeAttempt = null }) {
  const attempts = [];
  for (const candidateUrl of githubUrlCandidates(normalizedUrl)) {
    if (beforeAttempt) await beforeAttempt(candidateUrl);
    const startedAt = Date.now();
    try {
      const result = await execFileAsync('git', args(candidateUrl), {
        timeout,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      return { result, source: gitSourceLabel(candidateUrl, normalizedUrl), latencyMs: Date.now() - startedAt, attempts };
    } catch (error) {
      attempts.push({
        source: gitSourceLabel(candidateUrl, normalizedUrl),
        latencyMs: Date.now() - startedAt,
        error: gitFailureSummary(error),
      });
    }
  }
  const error = httpError(attempts.some((item) => item.error === 'timeout') ? '读取仓库超时，请稍后重试。' : '无法读取这个公开仓库，请确认链接可访问。', 422);
  error.gitAttempts = attempts;
  throw error;
}


function verifyAdminPassword(value) {
  if (!ADMIN_PASSWORD) {
    throw httpError('服务端还没有配置 MARKETPLACE_ADMIN_PASSWORD 或 ADMIN_PASSWORD，暂时无法删除插件。', 503);
  }
  const expected = Buffer.from(ADMIN_PASSWORD);
  const provided = Buffer.from(String(value || ''));
  const matches = provided.length === expected.length && timingSafeEqual(provided, expected);
  if (!matches) throw httpError('管理员密码不正确，请确认后再试。', 401);
}

function responseStatusForError(error) {
  if (error instanceof SyntaxError) return 400;
  if (error.status) return error.status;
  if (/请输入|没有找到|只接受|需要|不合法|格式不正确|未知|不是|无法确认/.test(error.message || '')) return 400;
  return 500;
}

function clientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return request.socket.remoteAddress || 'unknown';
}

function checkRateLimit(request) {
  const now = Date.now();
  const ip = clientIp(request);
  const bucket = (buckets.get(ip) || []).filter((stamp) => now - stamp < RATE_WINDOW_MS);
  if (bucket.length >= RATE_LIMIT) {
    buckets.set(ip, bucket);
    return false;
  }
  bucket.push(now);
  buckets.set(ip, bucket);
  return true;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(httpError('提交内容过大，请缩短后再试。', 413));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function parseGithubRepositoryUrl(value) {
  if (!String(value || '').trim()) throw httpError('请输入 GitHub 仓库 URL。');
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw httpError('URL 格式不正确，请使用 https://github.com/owner/repo。');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    throw httpError('目前只接受 https://github.com 上的公开仓库。');
  }
  const [owner, rawRepo] = url.pathname.split('/').filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/, '');
  if (!owner || !repo) throw httpError('链接需要包含 owner 和 repo。');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw httpError('GitHub owner 或 repo 名称不合法。');
  }
  return { owner, repo, normalizedUrl: `https://github.com/${owner}/${repo}` };
}

function normalizeRepositoryUrl(value) {
  try {
    return parseGithubRepositoryUrl(value).normalizedUrl;
  } catch {
    return String(value || '').trim().replace(/\.git$/, '');
  }
}

function slugify(value) {
  return String(value || 'plugin').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'plugin';
}

function submissionIdFor(normalizedUrl) {
  const { owner, repo } = parseGithubRepositoryUrl(normalizedUrl);
  return `${slugify(owner)}-${slugify(repo)}-${Buffer.from(normalizedUrl).toString('hex').slice(0, 10)}`;
}

function authorName(value, fallback) {
  if (typeof value === 'string') return value || fallback;
  if (value && typeof value === 'object') return value.name || value.login || fallback;
  return fallback;
}

function stringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

async function existsSafe(filePath) {
  try {
    const stat = await fs.lstat(filePath);
    return !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function walkRepository(root) {
  const files = [];
  const skip = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', 'target', 'vendor']);
  async function walk(dir) {
    if (files.length >= MAX_WALK_FILES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_WALK_FILES) return;
      if (skip.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(relative);
    }
  }
  await walk(root);
  return files;
}

function manifestPaths(files) {
  const strict = files.filter((file) => file.endsWith('/.codex-plugin/plugin.json') || file === '.codex-plugin/plugin.json');
  if (strict.length) return strict;
  return files.filter((file) => file.endsWith('plugin.json') && !file.includes('node_modules/')).slice(0, 5);
}

function inferredPluginPaths(files) {
  const skillFiles = files.filter((file) => /(^|\/)skills\/[^/]+\/SKILL\.md$/.test(file));
  const mcpFiles = files.filter((file) => file.endsWith('.mcp.json') || file.endsWith('/mcp/server.mjs'));
  return { skillFiles, mcpFiles };
}

async function readJsonFile(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  if (text.length > 512 * 1024) throw httpError('manifest 文件过大，无法作为 Codex 插件读取。');
  return JSON.parse(text);
}

function securityWarnings(files, manifest, manifestRelativePath) {
  const findings = [];
  const manifestText = JSON.stringify(manifest).toLowerCase();
  if (manifestText.includes('postinstall') || manifestText.includes('preinstall')) {
    findings.push({ severity: 'medium', path: manifestRelativePath, description: 'manifest 中出现安装脚本相关字段，请安装前复核。' });
  }
  const interesting = files.filter((file) => /(^|\/)(package\.json|\.mcp\.json|server\.(mjs|js|ts)|SKILL\.md)$/.test(file)).slice(0, 20);
  for (const file of interesting) {
    if (/\.env($|\.)|secret|credential/i.test(file)) {
      findings.push({ severity: 'medium', path: file, description: '仓库包含疑似敏感配置文件名，请安装前复核。' });
    }
  }
  return findings;
}

async function cloneRepository(normalizedUrl) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mwe-codex-plugin-'));
  const repoPath = path.join(tempRoot, 'repo');
  try {
    const cloned = await runGitRead((candidateUrl) => ['clone', '--depth=1', '--filter=blob:limit=1m', candidateUrl, repoPath], {
      timeout: CLONE_TIMEOUT_MS,
      normalizedUrl,
      beforeAttempt: () => fs.rm(repoPath, { recursive: true, force: true }),
    });
    if (cloned.source !== 'github') console.warn(`[github-clone:proxy] repo=${normalizedUrl} source=${cloned.source} latencyMs=${cloned.latencyMs}`);
    return { tempRoot, repoPath, source: cloned.source };
  } catch (error) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    if (error.gitAttempts) console.warn(`[github-clone:failed] repo=${normalizedUrl} attempts=${JSON.stringify(error.gitAttempts)}`);
    throw error;
  }
}

async function readRemoteRepositoryRef(normalizedUrl) {
  const probe = await runGitRead((candidateUrl) => ['ls-remote', '--symref', candidateUrl, 'HEAD'], {
    timeout: GITHUB_HEALTH_TIMEOUT_MS,
    normalizedUrl,
  });
  const ref = parseHeadRefOutput(probe.result.stdout);
  return repositoryRefMetadata(normalizedUrl, ref.defaultBranch, ref.headSha);
}

async function readClonedRepositoryRef(repoPath, normalizedUrl) {
  let defaultBranch = 'HEAD';
  let headSha = null;
  try {
    const branch = await execFileAsync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { timeout: 5_000 });
    defaultBranch = String(branch.stdout || '').trim() || defaultBranch;
  } catch {}
  try {
    const revision = await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { timeout: 5_000 });
    headSha = String(revision.stdout || '').trim() || null;
  } catch {}
  return repositoryRefMetadata(normalizedUrl, defaultBranch, headSha);
}

async function refreshExistingPlugins(normalizedUrl, plugins) {
  let ref;
  try {
    ref = await readRemoteRepositoryRef(normalizedUrl);
  } catch (error) {
    console.warn(`[github-ref:failed] repo=${normalizedUrl} ${error.message || 'unknown error'}`);
    const fallbackBranch = plugins.find((plugin) => plugin.defaultBranch || plugin.releaseTag)?.defaultBranch || plugins.find((plugin) => plugin.releaseTag)?.releaseTag || 'HEAD';
    ref = repositoryRefMetadata(normalizedUrl, fallbackBranch, plugins.find((plugin) => plugin.headSha)?.headSha || null);
  }
  const refreshed = plugins.map((plugin) => withRepositoryRef(plugin, ref));
  for (const plugin of refreshed) {
    memory.plugins.set(plugin.name, plugin);
    await upsertPlugin(plugin, 'active');
  }
  return refreshed;
}

async function checkGithubRead(repositoryUrl = GITHUB_HEALTH_REPOSITORY) {
  const checkedAt = new Date().toISOString();
  let parsed;
  try {
    parsed = parseGithubRepositoryUrl(repositoryUrl);
  } catch (error) {
    return { ok: false, status: responseStatusForError(error), repositoryUrl: String(repositoryUrl || ''), method: 'git ls-remote', checkedAt, error: error.message || 'GitHub 仓库 URL 不正确。', attempts: [] };
  }
  try {
    const probe = await runGitRead((candidateUrl) => ['ls-remote', candidateUrl, 'HEAD'], {
      timeout: GITHUB_HEALTH_TIMEOUT_MS,
      normalizedUrl: parsed.normalizedUrl,
    });
    const head = String(probe.result.stdout || '').trim().split(/\s+/)[0] || null;
    return { ok: true, repositoryUrl: parsed.normalizedUrl, source: probe.source, method: 'git ls-remote', latencyMs: probe.latencyMs, checkedAt, head, attempts: probe.attempts };
  } catch (error) {
    return { ok: false, status: 503, repositoryUrl: parsed.normalizedUrl, method: 'git ls-remote', checkedAt, error: error.message || 'GitHub 访问检测失败。', attempts: error.gitAttempts || [] };
  }
}

async function detectPlugins(repositoryUrl) {
  const { owner, repo, normalizedUrl } = parseGithubRepositoryUrl(repositoryUrl);
  const existingPlugins = (await findPluginsByRepositoryFromDb(normalizedUrl))?.filter((plugin) => plugin.source?.type === 'shared-repository');
  if (existingPlugins?.length) {
    const plugins = await refreshExistingPlugins(normalizedUrl, existingPlugins);
    return { normalizedUrl, owner, repo, duplicate: true, plugins, warnings: [] };
  }
  const existing = await findPluginByRepositoryFromDb(normalizedUrl);
  if (existing?.source?.type === 'shared-repository') {
    const plugins = await refreshExistingPlugins(normalizedUrl, [existing]);
    return { normalizedUrl, owner, repo, duplicate: true, plugins, warnings: [] };
  }

  const { tempRoot, repoPath } = await cloneRepository(normalizedUrl);
  try {
    const repositoryRef = await readClonedRepositoryRef(repoPath, normalizedUrl);
    const files = await walkRepository(repoPath);
    const manifests = manifestPaths(files);
    const inferred = inferredPluginPaths(files);
    if (!manifests.length && !inferred.skillFiles.length && !inferred.mcpFiles.length) {
      throw httpError('没有找到 Codex 插件入口。请确认仓库包含 .codex-plugin/plugin.json、skills/*/SKILL.md 或 MCP 配置。', 422);
    }

    const plugins = [];
    const now = new Date().toISOString();
    if (manifests.length) {
      for (const manifestRelativePath of manifests.slice(0, 5)) {
        const manifestPath = path.join(repoPath, manifestRelativePath);
        let manifest;
        try {
          manifest = await readJsonFile(manifestPath);
        } catch {
          throw httpError(`${manifestRelativePath} 不是可读取的 JSON manifest。`, 422);
        }
        const manifestDir = path.dirname(manifestPath);
        const pluginRoot = path.basename(manifestDir) === '.codex-plugin' ? path.dirname(manifestDir) : manifestDir;
        const iface = manifest.interface || {};
        const pluginName = slugify(manifest.name || repo);
        const missing = [];
        if (manifest.skills && !(await existsSafe(path.resolve(pluginRoot, manifest.skills)))) missing.push('skills 路径不存在');
        if (manifest.mcpServers && !(await existsSafe(path.resolve(pluginRoot, manifest.mcpServers)))) missing.push('mcpServers 路径不存在');
        const findings = securityWarnings(files, manifest, manifestRelativePath);
        for (const item of missing) findings.push({ severity: 'low', path: manifestRelativePath, description: item });
        const tags = [...new Set([...stringList(manifest.keywords), iface.category, ...(missing.length ? ['需要复核'] : ['结构检测通过'])].filter(Boolean))];
        const capabilities = stringList(iface.capabilities).length ? stringList(iface.capabilities) : stringList(manifest.capabilities).length ? stringList(manifest.capabilities) : inferred.skillFiles.length ? ['Skill'] : inferred.mcpFiles.length ? ['MCP'] : ['Codex Plugin'];
        plugins.push(withRepositoryRef({
          name: pluginName,
          displayName: iface.displayName || manifest.displayName || manifest.name || repo,
          description: iface.shortDescription || manifest.description || `${repo} Codex 插件仓库`,
          longDescription: iface.longDescription || manifest.longDescription || manifest.description || `${repo} Codex 插件仓库`,
          author: authorName(manifest.author, iface.developerName || owner),
          avatarUrl: `https://github.com/${owner}.png?size=96`,
          category: iface.category || manifest.category || (inferred.mcpFiles.length ? 'MCP' : 'Codex Plugin'),
          tags,
          capabilities,
          version: String(manifest.version || '0.1.0'),
          releaseTag: repositoryRef.defaultBranch,
          repositoryUrl: normalizedUrl,
          verifiedStatus: 'verified',
          syncStatus: 'synced',
          syncTimestamp: now,
          installPolicy: 'AVAILABLE',
          featured: false,
          source: { type: 'shared-repository', url: normalizedUrl, manifestPath: manifestRelativePath },
          review: {
            status: 'approved',
            reviewedAt: now,
            reviewer: 'server-detector',
            method: 'relaxed-web-detection',
            rules: ['public GitHub repository cloned', 'Codex plugin entry discovered', 'non-critical issues recorded as warnings'],
          },
          securityScan: { status: findings.length ? 'warnings' : 'passed', blocked: false, findings, scannedAt: now },
        }, repositoryRef));
      }
    } else {
      const findings = [{ severity: 'low', path: inferred.skillFiles[0] || inferred.mcpFiles[0], description: '未发现 .codex-plugin/plugin.json，已根据明显的 skill/MCP 结构推断为 Codex 插件。' }];
      plugins.push(withRepositoryRef({
        name: slugify(repo),
        displayName: repo,
        description: `${repo} 包含 Codex skill 或 MCP 插件结构。`,
        longDescription: `${repo} 包含 Codex skill 或 MCP 插件结构，但没有提供 .codex-plugin/plugin.json。安装前建议查看仓库说明。`,
        author: owner,
        avatarUrl: `https://github.com/${owner}.png?size=96`,
        category: inferred.mcpFiles.length ? 'MCP' : 'Codex Skill',
        tags: ['结构推断', '需要复核'],
        capabilities: inferred.skillFiles.length ? ['Skill'] : ['MCP'],
        version: '0.1.0',
        releaseTag: repositoryRef.defaultBranch,
        repositoryUrl: normalizedUrl,
        verifiedStatus: 'verified',
        syncStatus: 'synced',
        syncTimestamp: now,
        installPolicy: 'AVAILABLE',
        featured: false,
        source: { type: 'shared-repository', url: normalizedUrl, inferredFrom: inferred.skillFiles[0] || inferred.mcpFiles[0] },
        review: { status: 'approved', reviewedAt: now, reviewer: 'server-detector', method: 'relaxed-web-detection' },
        securityScan: { status: 'warnings', blocked: false, findings, scannedAt: now },
      }, repositoryRef));
    }
    return { normalizedUrl, owner, repo, duplicate: false, plugins, warnings: plugins.flatMap((plugin) => plugin.securityScan.findings || []) };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function recordCheck({ normalizedUrl, owner, repo, status, reason = '', pluginName = null, securityScan = null, stage = null }) {
  const now = new Date().toISOString();
  const id = submissionIdFor(normalizedUrl);
  const check = {
    id,
    slug: `${slugify(owner)}-${slugify(repo)}`,
    owner,
    repo,
    repositoryUrl: normalizedUrl,
    status,
    submittedAt: now,
    updatedAt: now,
    reason,
    pluginName,
    verifiedStatus: status === 'approved' ? 'verified' : 'unverified',
    syncStatus: status === 'approved' ? 'synced' : 'failed',
    securityScan,
    stage: stage || (status === 'approved' ? 'completed' : status === 'failed' ? 'validating' : 'received'),
    review: { decision: status, reason, reviewedAt: now, securityScan, stage: stage || (status === 'approved' ? 'completed' : status === 'failed' ? 'validating' : 'received') },
    source: 'web-detector',
  };
  memory.checks.set(id, check);
  await upsertSubmission(check);
  return check;
}

async function handleCheck(request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST' });
    response.end();
    return;
  }
  if (!checkRateLimit(request)) {
    sendJson(response, 429, { error: '提交太频繁了，请稍后再试。' });
    return;
  }

  let parsed;
  try {
    const rawBody = await readRequestBody(request);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    parsed = parseGithubRepositoryUrl(payload.repositoryUrl || payload.repoUrl);
    const detection = await detectPlugins(parsed.normalizedUrl);
    const firstPlugin = detection.plugins[0];
    if (!detection.duplicate) {
      for (const plugin of detection.plugins) {
        memory.plugins.set(plugin.name, plugin);
        await upsertPlugin(plugin, 'active');
      }
    }
    const check = await recordCheck({
      normalizedUrl: parsed.normalizedUrl,
      owner: parsed.owner,
      repo: parsed.repo,
      status: 'approved',
      reason: detection.duplicate ? '这个仓库已经在市场中，已刷新状态。' : detection.warnings.length ? '检测通过，但包含安装前复核提示。' : '检测通过，已加入市场。',
      pluginName: firstPlugin?.name || null,
      securityScan: firstPlugin?.securityScan || null,
      stage: 'completed',
    });
    sendJson(response, detection.duplicate ? 200 : 201, {
      status: 'approved',
      duplicate: detection.duplicate,
      plugins: detection.plugins,
      check,
      message: detection.duplicate ? '这个仓库已经在市场中，已刷新检测状态。' : '检测通过，插件已加入市场。',
      stage: 'completed',
    });
  } catch (error) {
    const normalizedUrl = parsed?.normalizedUrl || normalizeRepositoryUrl(String(parsed?.repositoryUrl || ''));
    if (parsed?.owner && parsed?.repo) {
      await recordCheck({ normalizedUrl: parsed.normalizedUrl, owner: parsed.owner, repo: parsed.repo, status: 'failed', reason: error.message || '检测失败。', stage: 'validating' });
    }
    const status = responseStatusForError(error);
    sendJson(response, status, { status: 'failed', stage: 'validating', error: error.message || '检测失败，请稍后重试。' });
  }
}


async function handlePluginDelete(request, response, pluginName) {
  if (request.method !== 'DELETE') {
    response.writeHead(405, { Allow: 'DELETE' });
    response.end();
    return;
  }
  if (!checkRateLimit(request)) {
    sendJson(response, 429, { error: '请求太频繁了，请稍后再试。' });
    return;
  }
  try {
    const rawBody = await readRequestBody(request);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    verifyAdminPassword(payload.adminPassword);
    const deleted = await deletePluginFromDb({ pluginName, adminReason: String(payload.reason || '').slice(0, 500) });
    if (!deleted) throw httpError('没有找到这个已加入市场的插件，或它已经被删除。', 404);
    memory.plugins.delete(pluginName);
    sendJson(response, 200, { plugin: deleted, message: '插件已从市场删除。' });
  } catch (error) {
    sendJson(response, responseStatusForError(error), { error: error.message || '删除失败，请稍后重试。' });
  }
}

async function currentMarket() {
  const registry = await readRegistryFromDb();
  if (registry) {
    return {
      source: 'postgres',
      serviceStatus: 'live',
      generatedAt: new Date().toISOString(),
      plugins: (registry.plugins || []).filter((plugin) => plugin.source?.type === 'shared-repository'),
      checks: (registry.submissions || []).filter((check) => check.source === 'web-detector'),
    };
  }
  return {
    source: 'memory',
    serviceStatus: 'live',
    generatedAt: new Date().toISOString(),
    plugins: [...memory.plugins.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    checks: [...memory.checks.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
  };
}

async function handleClientLog(request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST' });
    response.end();
    return;
  }
  try {
    const rawBody = await readRequestBody(request);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const type = String(payload.type || 'client').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'client';
    const status = String(payload.status || 'info').replace(/[^a-z0-9_-]/gi, '').slice(0, 20) || 'info';
    const message = String(payload.message || '').replace(/adminPassword|password|token|secret/gi, '[redacted]').slice(0, 300);
    console.log(`[client:${type}:${status}] ${message}`);
    sendJson(response, 204, {});
  } catch (error) {
    sendJson(response, 400, { error: 'client log ignored' });
  }
}

async function handleMarket(_request, response) {
  sendJson(response, 200, await currentMarket());
}

async function handleCompatibilityRegistry(_request, response) {
  const market = await currentMarket();
  sendJson(response, 200, {
    marketplace: { name: 'mwe-codex-plugin-share', displayName: 'MWE Codex插件共享市场', generatedAt: market.generatedAt, stateSource: market.source },
    plugins: market.plugins,
    submissions: market.checks,
  });
}

function isAllowedStaticPath(relativePath) {
  const firstSegment = relativePath.split('/')[0];
  return allowedFiles.has(relativePath) || allowedDirs.has(firstSegment);
}

function isAppShellRoute(pathname) {
  const firstSegment = pathname.split('/').filter(Boolean)[0];
  return appShellRoutes.has(firstSegment);
}

async function sendAppShell(response) {
  const content = await fs.readFile(path.join(ROOT, 'index.html'));
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' });
  response.end(content);
}

async function sendNotFound(response) {
  try {
    const content = await fs.readFile(path.join(ROOT, '404.html'));
    response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  const shouldServeAppShell = isAppShellRoute(pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname.endsWith('/')) pathname += 'index.html';
  if (!path.extname(pathname)) pathname = path.join(pathname, 'index.html');

  const relativePath = pathname.replace(/^\/+/, '');
  if (!isAllowedStaticPath(relativePath)) {
    if (shouldServeAppShell) return sendAppShell(response);
    return sendNotFound(response);
  }

  const absolutePath = path.resolve(ROOT, relativePath);
  if (!absolutePath.startsWith(`${ROOT}${path.sep}`)) return sendNotFound(response);

  try {
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink()) return sendNotFound(response);
    const realPath = await fs.realpath(absolutePath);
    const realRoot = await fs.realpath(ROOT);
    if (realPath !== realRoot && !realPath.startsWith(`${realRoot}${path.sep}`)) return sendNotFound(response);
    const content = await fs.readFile(realPath);
    const extension = path.extname(realPath);
    response.writeHead(200, {
      'Content-Type': mimeTypes.get(extension) || 'application/octet-stream',
      'Cache-Control': ['.html', '.js', '.css'].includes(extension) ? 'no-cache' : 'public, max-age=300',
    });
    response.end(content);
  } catch {
    if (shouldServeAppShell) return sendAppShell(response);
    return sendNotFound(response);
  }
}

const server = http.createServer(async (request, response) => {
  const pathname = request.url?.split('?')[0] || '/';
  if (pathname === '/api/health') {
    dbAvailable()
      .then((database) => sendJson(response, 200, { ok: true, mode: 'web-share-detector', database }))
      .catch(() => sendJson(response, 200, { ok: true, mode: 'web-share-detector', database: false }));
    return;
  }
  if (pathname === '/api/client-log') {
    handleClientLog(request, response).catch((error) => sendJson(response, 400, { error: error.message || 'client log ignored' }));
    return;
  }
  if (request.method === 'GET' && pathname === '/api/github-health') {
    const url = new URL(request.url || '/', 'http://localhost');
    const result = await checkGithubRead(url.searchParams.get('repositoryUrl') || undefined);
    sendJson(response, result.ok ? 200 : result.status || 503, result);
    return;
  }
  if (pathname === '/api/market') {
    handleMarket(request, response).catch((error) => sendJson(response, 500, { error: error.message || '市场状态加载失败。' }));
    return;
  }
  if (pathname.startsWith('/api/plugins/')) {
    const pluginName = decodeURIComponent(pathname.split('/').pop() || '');
    handlePluginDelete(request, response, pluginName);
    return;
  }
  if (pathname === '/api/check') {
    handleCheck(request, response).catch((error) => sendJson(response, responseStatusForError(error), { error: error.message || '检测失败。' }));
    return;
  }
  if (request.method === 'GET' && pathname === '/registry/plugins.json') {
    handleCompatibilityRegistry(request, response).catch((error) => sendJson(response, 500, { error: error.message || 'registry 加载失败。' }));
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD, POST' });
    response.end();
    return;
  }
  serveStatic(request, response).catch((error) => sendJson(response, 500, { error: error.message || '页面加载失败。' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MWE Codex shared marketplace server listening on ${PORT}`);
});
