import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

const PORT = Number(process.env.PORT || 80);
const ROOT = process.cwd();
const TARGET_REPOSITORY = process.env.MARKETPLACE_GITHUB_REPOSITORY || 'mwe-support/mwe-codex-plugins-marketplace';
const API_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = Number(process.env.SUBMISSION_RATE_LIMIT || 5);

const allowedFiles = new Set(['index.html', '404.html', 'app.js', 'styles.css', 'marketplace.json']);
const allowedDirs = new Set(['assets', 'registry', 'marketplace', '.agents', 'about', 'install', 'submit', 'perspective', 'reviews']);
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

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function responseStatusForError(error) {
  if (error instanceof SyntaxError) return 400;
  if (error.status && error.status < 500) return error.status;
  if (/请输入|没有找到|只接受|需要|不合法|格式不正确/.test(error.message || '')) return 400;
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

function parseGithubRepositoryUrl(value) {
  if (!String(value || '').trim()) throw new Error('请输入 GitHub 仓库 URL。');
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error('URL 格式不正确，请使用 https://github.com/owner/repo。');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    throw new Error('目前只接受 https://github.com 上的公开仓库。');
  }
  const [owner, rawRepo] = url.pathname.split('/').filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/, '');
  if (!owner || !repo) throw new Error('链接需要包含 owner 和 repo。');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('GitHub owner 或 repo 名称不合法。');
  }
  return {
    owner,
    repo,
    normalizedUrl: `https://github.com/${owner}/${repo}`,
  };
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('提交内容过大，请缩短补充说明。'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

async function githubRequest(apiPath, { method = 'GET', body, allowNotFound = false } = {}) {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${API_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (response.status === 404 && allowNotFound) return null;
  if (!response.ok) {
    const reason = data?.message || response.statusText;
    const error = new Error(`GitHub API 请求失败：${reason}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function ensureLabel(name, color, description) {
  const labelPath = `/repos/${TARGET_REPOSITORY}/labels/${encodeURIComponent(name)}`;
  const existing = await githubRequest(labelPath, { allowNotFound: true });
  if (existing) return;
  await githubRequest(`/repos/${TARGET_REPOSITORY}/labels`, {
    method: 'POST',
    body: { name, color, description },
  });
}

function issueMatchesSubmission(issue, normalizedUrl) {
  if (issue.pull_request) return false;
  return String(issue.title || '').includes(normalizedUrl) || String(issue.body || '').includes(normalizedUrl);
}

async function findExistingIssue(normalizedUrl) {
  const issues = await githubRequest(`/repos/${TARGET_REPOSITORY}/issues?state=all&per_page=100`);
  return Array.isArray(issues) ? issues.find((issue) => issueMatchesSubmission(issue, normalizedUrl)) : null;
}

function truncateNote(value) {
  const note = String(value || '').trim();
  if (!note) return '无';
  return note.length > 4000 ? `${note.slice(0, 4000)}\n\n[说明已截断]` : note;
}

async function readLocalJson(relativePath, fallback) {
  try {
    const content = await fs.readFile(path.join(ROOT, relativePath), 'utf8');
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}
function normalizeRepositoryUrl(value) {
  try {
    return parseGithubRepositoryUrl(value).normalizedUrl;
  } catch {
    return String(value || '').trim().replace(/\.git$/, '');
  }
}

async function findRegistryPluginByRepository(repositoryUrl) {
  const normalizedUrl = normalizeRepositoryUrl(repositoryUrl);
  const registry = await readLocalJson('registry/plugins.json', { plugins: [], submissions: [] });
  return (registry.plugins || []).find((plugin) => normalizeRepositoryUrl(plugin.repositoryUrl) === normalizedUrl) || null;
}

async function findRegistrySubmissionByRepository(repositoryUrl) {
  const normalizedUrl = normalizeRepositoryUrl(repositoryUrl);
  const registry = await readLocalJson('registry/plugins.json', { plugins: [], submissions: [] });
  return (registry.submissions || []).find((item) => normalizeRepositoryUrl(item.repositoryUrl) === normalizedUrl && ['reviewing', 'approved'].includes(item.status)) || null;
}

function issueLabelNames(issue) {
  return (issue.labels || []).map((label) => label?.name).filter(Boolean);
}

function issueHasLabel(issue, labelName) {
  return issueLabelNames(issue).includes(labelName);
}

async function findExistingRemovalIssue(normalizedUrl) {
  const issues = await githubRequest(`/repos/${TARGET_REPOSITORY}/issues?state=all&per_page=100`);
  return Array.isArray(issues) ? issues.find((issue) => !issue.pull_request && issueHasLabel(issue, 'plugin-removal') && issueMatchesSubmission(issue, normalizedUrl)) : null;
}

function extractRepositoryUrlFromIssue(issue) {
  const text = `${issue.title || ''}\n${issue.body || ''}`;
  const match = text.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/);
  return match ? match[0].replace(/\.git$/, '') : '';
}

function reviewStatusFromIssue(issue, comments = []) {
  const commentText = comments.map((comment) => comment.body || '').join('\n');
  if (/自动审核通过/.test(commentText)) return 'approved';
  if (/自动审核未通过|安全扫描未通过/.test(commentText)) return 'failed';
  if (issue.state === 'closed') return 'closed';
  return 'reviewing';
}

function localSubmissionMap(registry) {
  const map = new Map();
  for (const item of registry.submissions || []) {
    if (item.repositoryUrl) map.set(item.repositoryUrl.replace(/\.git$/, ''), item);
  }
  return map;
}

async function listSubmissionProgress() {
  const registry = await readLocalJson('registry/plugins.json', { submissions: [] });
  const localByRepo = localSubmissionMap(registry);
  const items = new Map();

  for (const item of registry.submissions || []) {
    items.set(item.repositoryUrl.replace(/\.git$/, ''), { ...item, source: 'registry' });
  }

  if (API_TOKEN) {
    const issues = await githubRequest(`/repos/${TARGET_REPOSITORY}/issues?state=all&per_page=100`);
    for (const issue of Array.isArray(issues) ? issues : []) {
      if (issue.pull_request) continue;
      const repositoryUrl = extractRepositoryUrlFromIssue(issue);
      const labelNames = issueLabelNames(issue);
      if (!repositoryUrl && !labelNames.includes('plugin-submission')) continue;
      const comments = await githubRequest(`/repos/${TARGET_REPOSITORY}/issues/${issue.number}/comments?per_page=50`);
      const local = repositoryUrl ? localByRepo.get(repositoryUrl) : null;
      const issueStatus = reviewStatusFromIssue(issue, Array.isArray(comments) ? comments : []);
      const status = local?.status === 'approved' ? 'approved' : issueStatus;
      const latestActionComment = [...(comments || [])].reverse().find((comment) => comment.user?.login === 'github-actions');
      const repoParts = repositoryUrl ? repositoryUrl.split('/').slice(-2) : [];
      items.set(repositoryUrl || issue.html_url, {
        id: local?.id || `issue-${issue.number}`,
        slug: local?.slug || repoParts.join('-') || `issue-${issue.number}`,
        owner: local?.owner || repoParts[0] || 'unknown',
        repo: local?.repo || repoParts[1] || issue.title,
        displayName: local?.displayName || repoParts[1] || issue.title,
        repositoryUrl: repositoryUrl || local?.repositoryUrl || '',
        issueUrl: issue.html_url,
        status,
        submittedAt: local?.submittedAt || issue.created_at,
        updatedAt: local?.updatedAt || issue.updated_at,
        decision: local?.decision || (status === 'approved' ? 'approved' : status === 'failed' ? 'failed' : null),
        reason: local?.reason || latestActionComment?.body || '',
        pluginName: local?.pluginName || null,
        verifiedStatus: local?.verifiedStatus || (status === 'approved' ? 'verified' : 'reviewing'),
        syncStatus: local?.syncStatus || (status === 'approved' ? 'synced' : status === 'failed' ? 'failed' : 'pending'),
        securityScan: local?.securityScan || null,
        source: local ? 'registry+github' : 'github',
      });
    }
  }

  return [...items.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

async function createSubmissionIssue({ repositoryUrl, note }) {
  if (!API_TOKEN) {
    throw new Error('服务端还没有配置 GITHUB_TOKEN，暂时无法代创建审核 issue。');
  }

  const { normalizedUrl } = parseGithubRepositoryUrl(repositoryUrl);
  const listedPlugin = await findRegistryPluginByRepository(normalizedUrl);
  if (listedPlugin?.installPolicy !== 'REVIEW_ONLY') {
    return {
      duplicate: true,
      duplicateType: 'listed',
      pluginName: listedPlugin.name,
      issueNumber: '',
      issueUrl: '',
      repositoryUrl: normalizedUrl,
    };
  }
  const pendingSubmission = await findRegistrySubmissionByRepository(normalizedUrl);
  if (pendingSubmission) {
    return {
      duplicate: true,
      duplicateType: 'submission',
      issueNumber: pendingSubmission.issueUrl?.split('/').pop() || '',
      issueUrl: pendingSubmission.issueUrl || '',
      repositoryUrl: normalizedUrl,
    };
  }
  const existing = await findExistingIssue(normalizedUrl);
  if (existing) {
    return {
      duplicate: true,
      duplicateType: 'issue',
      issueNumber: existing.number,
      issueUrl: existing.html_url,
      repositoryUrl: normalizedUrl,
    };
  }

  const labels = ['plugin-submission', 'review-needed'];
  try {
    await ensureLabel('plugin-submission', '2563eb', 'Codex marketplace plugin submission');
    await ensureLabel('review-needed', 'f59e0b', 'Needs automated or maintainer review');
  } catch (error) {
    console.warn(`Label setup skipped: ${error.message}`);
  }

  const body = `### GitHub 仓库\n${normalizedUrl}\n\n### 补充说明\n${truncateNote(note)}\n\n### 提交来源\n网页表单自动提交。用户无需在 GitHub 上重复创建 issue。\n\n### 自动检查\n- [ ] Release/tag 可访问\n- [ ] .codex-plugin/plugin.json 存在\n- [ ] manifest 字段完整\n`;

  let issue;
  try {
    issue = await githubRequest(`/repos/${TARGET_REPOSITORY}/issues`, {
      method: 'POST',
      body: {
        title: `收录插件：${normalizedUrl}`,
        body,
        labels,
      },
    });
  } catch (error) {
    if (error.status !== 422) throw error;
    issue = await githubRequest(`/repos/${TARGET_REPOSITORY}/issues`, {
      method: 'POST',
      body: {
        title: `收录插件：${normalizedUrl}`,
        body,
      },
    });
  }

  return {
    duplicate: false,
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    repositoryUrl: normalizedUrl,
  };
}

function cleanGithubLogin(value) {
  const login = String(value || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) throw new Error('请输入有效的 GitHub 登录名。');
  return login;
}

async function findPluginForRemoval({ pluginName, repositoryUrl }) {
  const registry = await readLocalJson('registry/plugins.json', { plugins: [] });
  const plugins = registry.plugins || [];
  if (repositoryUrl) {
    const normalizedUrl = parseGithubRepositoryUrl(repositoryUrl).normalizedUrl;
    const plugin = plugins.find((item) => normalizeRepositoryUrl(item.repositoryUrl) === normalizedUrl && item.installPolicy !== 'REVIEW_ONLY');
    if (plugin) return plugin;
    throw new Error('没有找到这个 GitHub 仓库对应的已收录插件。');
  }
  const plugin = plugins.find((item) => item.name === pluginName && item.installPolicy !== 'REVIEW_ONLY');
  if (!plugin) throw new Error('没有找到这个已收录插件。');
  return plugin;
}

async function createRemovalIssue({ pluginName, repositoryUrl, requester, reason }) {
  if (!API_TOKEN) {
    throw new Error('服务端还没有配置 GITHUB_TOKEN，暂时无法代创建删除请求。');
  }
  const plugin = await findPluginForRemoval({ pluginName, repositoryUrl });
  const { normalizedUrl, owner, repo } = parseGithubRepositoryUrl(plugin.repositoryUrl);
  const requesterLogin = cleanGithubLogin(requester);
  const existing = await findExistingRemovalIssue(normalizedUrl);
  if (existing) {
    return {
      duplicate: true,
      issueNumber: existing.number,
      issueUrl: existing.html_url,
      repositoryUrl: normalizedUrl,
      pluginName: plugin.name,
    };
  }

  const labels = ['plugin-removal', 'removal-needed'];
  try {
    await ensureLabel('plugin-removal', 'be123c', 'Codex marketplace plugin removal request');
    await ensureLabel('removal-needed', 'f97316', 'Needs repository owner or maintainer verification');
  } catch (error) {
    console.warn(`Label setup skipped: ${error.message}`);
  }

  const body = `### 删除插件\n${plugin.name}\n\n### 插件仓库\n${normalizedUrl}\n\n### 请求者 GitHub 用户名\n@${requesterLogin}\n\n### 删除原因\n${truncateNote(reason)}\n\n### 权限校验\n自动流程只信任 GitHub issue 创建者或评论者的真实账号权限。网页表单会创建追踪请求；仓库 owner 或 maintainer 需要在这个 issue 中评论 \`/marketplace remove ${normalizedUrl}\` 才能自动删除。校验失败时不会从 Marketplace 删除插件。`;
  let issue;
  try {
    issue = await githubRequest(`/repos/${TARGET_REPOSITORY}/issues`, {
      method: 'POST',
      body: {
        title: `删除插件：${plugin.name} (${normalizedUrl})`,
        body,
        labels,
      },
    });
  } catch (error) {
    if (error.status !== 422) throw error;
    issue = await githubRequest(`/repos/${TARGET_REPOSITORY}/issues`, {
      method: 'POST',
      body: { title: `删除插件：${plugin.name} (${normalizedUrl})`, body },
    });
  }

  return {
    duplicate: false,
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    repositoryUrl: normalizedUrl,
    pluginName: plugin.name,
  };
}

async function handleRemoval(request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST' });
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
    const result = await createRemovalIssue({
      pluginName: payload.pluginName,
      repositoryUrl: payload.repositoryUrl,
      requester: payload.requester,
      reason: payload.reason,
    });
    sendJson(response, result.duplicate ? 200 : 201, {
      ...result,
      message: result.duplicate ? '这个插件已经有删除请求在处理中。' : '已提交删除请求。仓库 owner/maintainer 需要在 GitHub issue 中确认后才会自动删除。',
    });
  } catch (error) {
    const status = responseStatusForError(error);
    sendJson(response, status, { error: error.message || '删除请求提交失败，请稍后重试。' });
  }
}
async function handleSubmission(request, response) {
  if (request.method === 'GET') {
    try {
      sendJson(response, 200, { submissions: await listSubmissionProgress() });
    } catch (error) {
      const registry = await readLocalJson('registry/plugins.json', { submissions: [] });
      sendJson(response, 200, { submissions: registry.submissions || [], warning: error.message });
    }
    return;
  }
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'GET, POST' });
    response.end();
    return;
  }
  if (!checkRateLimit(request)) {
    sendJson(response, 429, { error: '提交太频繁了，请稍后再试。' });
    return;
  }

  try {
    const rawBody = await readRequestBody(request);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const result = await createSubmissionIssue({
      repositoryUrl: payload.repoUrl || payload.repositoryUrl,
      note: payload.note,
    });
    sendJson(response, result.duplicate ? 200 : 201, {
      ...result,
      message: result.duplicate
        ? result.duplicateType === 'listed'
          ? '这个仓库已经收录在插件市场中。'
          : '这个仓库已经在审核队列中。'
        : '已提交，自动审核已进入队列。',
    });
  } catch (error) {
    const status = responseStatusForError(error);
    sendJson(response, status, { error: error.message || '提交失败，请稍后重试。' });
  }
}

function isAllowedStaticPath(relativePath) {
  const firstSegment = relativePath.split('/')[0];
  return allowedFiles.has(relativePath) || allowedDirs.has(firstSegment);
}

function isAppShellRoute(pathname) {
  const firstSegment = pathname.split('/').filter(Boolean)[0];
  return firstSegment === 'plugins';
}

async function sendAppShell(response) {
  const content = await fs.readFile(path.join(ROOT, 'index.html'));
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
  });
  response.end(content);
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
    if (shouldServeAppShell) {
      await sendAppShell(response);
      return;
    }
    await sendNotFound(response);
    return;
  }

  const absolutePath = path.resolve(ROOT, relativePath);
  if (!absolutePath.startsWith(`${ROOT}${path.sep}`)) {
    await sendNotFound(response);
    return;
  }

  try {
    const content = await fs.readFile(absolutePath);
    const extension = path.extname(absolutePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes.get(extension) || 'application/octet-stream',
      'Cache-Control': extension === '.json' ? 'no-store' : 'public, max-age=300',
    });
    response.end(content);
  } catch {
    if (shouldServeAppShell) {
      await sendAppShell(response);
      return;
    }
    await sendNotFound(response);
  }
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

const server = http.createServer((request, response) => {
  if (request.url?.startsWith('/api/health')) {
    sendJson(response, 200, { ok: true, repository: TARGET_REPOSITORY });
    return;
  }
  if (request.url?.startsWith('/api/submissions')) {
    handleSubmission(request, response);
    return;
  }
  if (request.url?.startsWith('/api/removals')) {
    handleRemoval(request, response);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD, POST' });
    response.end();
    return;
  }
  serveStatic(request, response);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MWE Codex marketplace server listening on ${PORT}`);
});
