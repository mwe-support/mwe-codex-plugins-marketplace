#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'marketplace/plugins');
const SUBMISSION_DIR = path.join(ROOT, 'marketplace/submissions');
const SNAPSHOT_DIR = path.join(ROOT, 'marketplace/snapshots');
const REGISTRY_FILE = path.join(ROOT, 'registry/plugins.json');
const CODEX_MARKETPLACE_FILE = path.join(ROOT, 'marketplace.json');
const AGENTS_MARKETPLACE_FILE = path.join(ROOT, '.agents/plugins/marketplace.json');
const MARKETPLACE_REPOSITORY_URL = 'https://github.com/mwe-support/mwe-codex-plugins-marketplace';
const MARKETPLACE_NAME = 'codex-community';

const allowedStatuses = new Set(['verified', 'reviewing', 'unverified']);
const allowedSyncStatuses = new Set(['synced', 'pending', 'failed']);
const allowedSubmissionStatuses = new Set(['reviewing', 'approved', 'rejected', 'removed']);

function usage() {
  console.log(`Marketplace registry helper

Commands:
  submit <github-url> [--note text] [--by name]
  approve <submission-id-or-file> [metadata flags]
  auto-review <submission-id-or-file|github-url> [--by name] [--ref ref] [--manual-approve true]
  reject <submission-id-or-file> --reason text
  remove <plugin-name-or-github-url> --by github-login [--reason text] [--issue url] [--admin-approved true]
  remove-submission <submission-id-or-github-url> [--reason text] [--by name] [--issue url]
  sync [--check]
  validate

Approval metadata flags:
  --name id --display-name text --description text --long-description text
  --author text --category text --version semver --release-tag tag
  --tags a,b,c --capabilities a,b,c --avatar-url url --featured true|false
`);
}

function ensureDirs() {
  fs.mkdirSync(PLUGIN_DIR, { recursive: true });
  fs.mkdirSync(SUBMISSION_DIR, { recursive: true });
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
  fs.mkdirSync(path.dirname(AGENTS_MARKETPLACE_FILE), { recursive: true });
}

function runGit(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function walkFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(file, files);
    else files.push(file);
  }
  return files;
}

function readTextIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function copySnapshotDirectory(sourceDir, targetDir) {
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (source) => !path.relative(sourceDir, source).split(path.sep).includes('.git'),
  });
}

function firstParagraph(markdown) {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  const useful = [];
  for (const line of lines) {
    if (!line || line.startsWith('#')) {
      if (useful.length) break;
      continue;
    }
    useful.push(line);
    if (useful.join(' ').length > 220) break;
  }
  return useful.join(' ').slice(0, 320);
}

function authorName(author, fallback) {
  if (!author) return fallback;
  if (typeof author === 'string') return author;
  return author.name || fallback;
}

function normalizePathForJson(value) {
  return value.split(path.sep).join('/');
}

function validateSourcePlugin(plugin, pluginDir) {
  const errors = [];
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(plugin.name || '')) errors.push('manifest name 只能包含字母、数字、点、下划线或短横线');
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(plugin.version || '')) errors.push('manifest version 需要是 SemVer，例如 0.1.0');
  if (!plugin.description && !plugin.interface?.shortDescription) errors.push('manifest 需要 description 或 interface.shortDescription');
  if (!authorName(plugin.author, plugin.interface?.developerName)) errors.push('manifest 需要 author.name 或 interface.developerName');
  if (!plugin.interface?.displayName) errors.push('manifest interface.displayName 缺失');
  if (!plugin.interface?.category) errors.push('manifest interface.category 缺失');
  if (!Array.isArray(plugin.interface?.capabilities) || plugin.interface.capabilities.length === 0) errors.push('manifest interface.capabilities 需要至少一个能力');
  if (plugin.skills && !fs.existsSync(path.resolve(pluginDir, plugin.skills))) errors.push('skills 路径不存在：' + plugin.skills);
  if (plugin.mcpServers && !fs.existsSync(path.resolve(pluginDir, plugin.mcpServers))) errors.push('mcpServers 路径不存在：' + plugin.mcpServers);
  if (!fs.existsSync(path.join(pluginDir, 'README.md'))) errors.push('插件目录需要 README.md');
  return errors;
}

const SECURITY_TEXT_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.sh', '.bash', '.zsh', '.ps1', '.py', '.rb', '.go', '.rs', '.toml', '.md']);

const SECURITY_PATTERNS = [
  { id: 'remote-shell-pipe', severity: 'critical', description: '远程脚本直接管道到 shell 执行', pattern: /\b(curl|wget)\b[^\n|;]*(https?:\/\/)[^\n|;]*\|\s*(bash|sh|zsh|fish|pwsh|powershell)\b/i },
  { id: 'destructive-root-delete', severity: 'critical', description: '包含高危根目录删除命令', pattern: /\brm\s+-rf\s+(\/|~|\$HOME)(\s|$)/i },
  { id: 'disk-destructive-command', severity: 'critical', description: '包含磁盘擦除或格式化类命令', pattern: /\b(mkfs|dd\s+if=|diskpart|format\s+[A-Z]:|sdelete)\b/i },
  { id: 'privilege-shell-install', severity: 'high', description: '安装脚本中包含提权或系统级写入动作', pattern: /\b(sudo|chmod\s+777|chown\s+-R|setenforce\s+0)\b/i },
  { id: 'dynamic-code-execution', severity: 'medium', description: '存在动态代码执行，需要人工复核上下文', pattern: /\b(eval|new Function|child_process\.(exec|execSync)|subprocess\.(Popen|run|call))\s*\(/ },
  { id: 'secret-network-use', severity: 'medium', description: '代码同时读取常见密钥环境变量并进行网络访问', pattern: /(GITHUB_TOKEN|GH_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY|NPM_TOKEN)[\s\S]{0,500}\b(fetch|axios|curl|request|https\.request)\b/i },
];

function isSecurityScannableFile(file) {
  const relative = normalizePathForJson(path.relative(ROOT, file));
  if (relative.includes('/node_modules/') || relative.includes('/.git/')) return false;
  const extension = path.extname(file).toLowerCase();
  return SECURITY_TEXT_EXTENSIONS.has(extension);
}

function scanPluginSecurity(pluginDir) {
  const findings = [];
  for (const file of walkFiles(pluginDir)) {
    if (!isSecurityScannableFile(file)) continue;
    const stat = fs.statSync(file);
    if (stat.size > 1024 * 1024) continue;
    const content = fs.readFileSync(file, 'utf8');
    const relativePath = normalizePathForJson(path.relative(pluginDir, file));
    for (const rule of SECURITY_PATTERNS) {
      if (rule.pattern.test(content)) {
        findings.push({ id: rule.id, severity: rule.severity, path: relativePath, description: rule.description });
      }
    }
  }

  const packageFile = path.join(pluginDir, 'package.json');
  if (fs.existsSync(packageFile)) {
    try {
      const packageJson = readJson(packageFile);
      for (const scriptName of ['preinstall', 'install', 'postinstall', 'prepare']) {
        const script = packageJson.scripts?.[scriptName];
        if (!script) continue;
        const suspicious = SECURITY_PATTERNS.find((rule) => rule.pattern.test(script));
        findings.push({
          id: suspicious ? suspicious.id : 'install-lifecycle-script',
          severity: suspicious?.severity || 'medium',
          path: 'package.json',
          description: suspicious ? '生命周期脚本 ' + scriptName + ': ' + suspicious.description : '包含 npm 生命周期脚本 ' + scriptName + '，需要人工留意安装时行为',
        });
      }
    } catch (error) {
      findings.push({ id: 'package-json-parse', severity: 'medium', path: 'package.json', description: 'package.json 无法解析：' + error.message });
    }
  }

  const blocked = findings.some((finding) => finding.severity === 'critical');
  return {
    status: blocked ? 'blocked' : findings.length ? 'warnings' : 'passed',
    blocked,
    scannedAt: now(),
    findings,
  };
}

function discoverSourcePlugins(repoDir, repo, args = {}) {
  const manifestFiles = walkFiles(repoDir).filter((file) => normalizePathForJson(path.relative(repoDir, file)).endsWith('.codex-plugin/plugin.json'));
  if (!manifestFiles.length) throw new Error('自动审核失败：没有找到 .codex-plugin/plugin.json');
  return manifestFiles.map((manifestFile) => {
    const pluginDir = path.dirname(path.dirname(manifestFile));
    const manifest = readJson(manifestFile);
    const relativePluginDir = normalizePathForJson(path.relative(repoDir, pluginDir)) || '.';
    const manifestPath = normalizePathForJson(path.relative(pluginDir, manifestFile));
    const readme = readTextIfExists(path.join(pluginDir, 'README.md'));
    const errors = validateSourcePlugin(manifest, pluginDir);
    if (errors.length) throw new Error('自动审核失败：' + relativePluginDir + '\n- ' + errors.join('\n- '));
    let securityScan = scanPluginSecurity(pluginDir);
    const manualApprove = args['manual-approve'] === true || args['manual-approve'] === 'true';
    if (securityScan.blocked && !manualApprove) {
      const summary = securityScan.findings.map((finding) => `${finding.severity} ${finding.id} at ${finding.path}: ${finding.description}`).join('\n- ');
      throw new Error('安全扫描未通过：' + relativePluginDir + '\n- ' + summary);
    }
    if (securityScan.blocked && manualApprove) {
      securityScan = {
        ...securityScan,
        status: 'warnings',
        blocked: false,
        manuallyApproved: true,
        approvedAt: now(),
        approvedBy: args.by || 'marketplace-admin',
      };
    }
    const iface = manifest.interface || {};
    const ref = args.ref || runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoDir }) || 'main';
    const timestamp = now();
    const displayName = args['display-name'] || iface.displayName || titleFromRepo(manifest.name);
    const sourceDescription = iface.shortDescription || manifest.description;
    const sourceLongDescription = iface.longDescription || firstParagraph(readme) || sourceDescription;
    const fallbackDescription = displayName + ' 是来自 ' + repo.owner + '/' + repo.repo + ' 的 Codex 插件。';
    const fallbackLongDescription = displayName + ' 来自 ' + repo.repositoryUrl + '，已通过自动结构校验和静态安全检查。';
    return {
      schemaVersion: 1,
      name: args.name || manifest.name,
      displayName,
      description: marketplaceDescription(args.description || sourceDescription, fallbackDescription),
      longDescription: marketplaceLongDescription(args['long-description'] || sourceLongDescription, fallbackLongDescription, sourceLongDescription),
      author: args.author || authorName(manifest.author, iface.developerName || repo.owner),
      avatarUrl: args['avatar-url'] || 'https://github.com/' + repo.owner + '.png?size=96',
      category: args.category || iface.category || 'Community',
      tags: splitList(args.tags).length ? splitList(args.tags) : [iface.category || 'Community', 'Auto Reviewed'].filter(Boolean),
      capabilities: splitList(args.capabilities).length ? splitList(args.capabilities) : iface.capabilities || [],
      version: args.version || manifest.version,
      releaseTag: ref,
      repositoryUrl: repo.repositoryUrl,
      verifiedStatus: 'verified',
      syncStatus: 'synced',
      syncTimestamp: timestamp,
      installPolicy: 'AVAILABLE',
      featured: args.featured === 'true',
      source: {
        type: 'local-snapshot',
        url: repo.repositoryUrl,
        ref,
        path: null,
        upstreamPath: relativePluginDir,
        manifestPath,
      },
      __pluginDir: pluginDir,
      securityScan,
      review: {
        status: 'approved',
        reviewedAt: timestamp,
        reviewer: args.by || 'marketplace-bot',
        method: args['manual-approve'] === true || args['manual-approve'] === 'true' ? 'admin-manual' : 'auto-rules',
        rules: [
          'public GitHub repository cloned',
          '.codex-plugin/plugin.json discovered',
          'manifest identity, version, interface and capability fields valid',
          'README and declared skills/mcp paths present',
          securityScan.manuallyApproved ? 'security scan warnings manually approved by marketplace admin' : securityScan.status === 'passed' ? 'security scan passed' : 'security scan completed with warnings',
        ],
      },
    };
  });
}


function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function now() {
  return new Date().toISOString();
}

function stableId(input) {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 10);
}

function parseGithubRepo(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('请输入完整 GitHub 仓库 URL，例如 https://github.com/owner/repo');
  }
  if (url.hostname !== 'github.com') throw new Error('目前只接受 github.com 仓库链接');
  const [owner, repo] = url.pathname.split('/').filter(Boolean);
  if (!owner || !repo) throw new Error('GitHub URL 需要包含 owner 和 repo');
  const cleanRepo = repo.replace(/\.git$/, '');
  return {
    owner,
    repo: cleanRepo,
    repositoryUrl: `https://github.com/${owner}/${cleanRepo}`,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => path.join(dir, file));
}

function resolveSubmission(ref) {
  const direct = path.isAbsolute(ref) ? ref : path.join(ROOT, ref);
  if (fs.existsSync(direct)) return direct;
  const byId = path.join(SUBMISSION_DIR, `${ref}.json`);
  if (fs.existsSync(byId)) return byId;
  const matches = listJson(SUBMISSION_DIR).filter((file) => {
    const submission = readJson(file);
    return submission.id === ref || submission.slug === ref;
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`提交引用不唯一：${ref}`);
  throw new Error(`找不到提交：${ref}`);
}

function splitList(value) {
  if (!value) return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function titleFromRepo(repo) {
  return repo
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function containsChinese(value) {
  return /[\u3400-\u9fff]/.test(String(value || ''));
}

function validateChineseMarketplaceText(plugin) {
  const errors = [];
  for (const field of ['description', 'longDescription']) {
    if (!containsChinese(plugin[field])) {
      errors.push((plugin.name || '(unknown)') + ' ' + field + ' 必须使用中文描述');
    }
  }
  return errors;
}

function marketplaceDescription(value, fallback) {
  const text = String(value || '').trim();
  return containsChinese(text) ? text : fallback;
}

function marketplaceLongDescription(value, fallback, sourceText) {
  const text = String(value || '').trim();
  if (containsChinese(text)) return text;
  const source = String(sourceText || '').trim();
  return source ? fallback + ' 源仓库说明：' + source : fallback;
}

function normalizePlugin(plugin) {
  const errors = [];
  for (const field of ['name', 'displayName', 'description', 'author', 'category', 'version', 'releaseTag', 'repositoryUrl']) {
    if (!plugin[field]) errors.push(`${plugin.name || '(unknown)'} 缺少字段 ${field}`);
  }
  if (plugin.verifiedStatus && !allowedStatuses.has(plugin.verifiedStatus)) errors.push(`${plugin.name} verifiedStatus 无效`);
  if (plugin.syncStatus && !allowedSyncStatuses.has(plugin.syncStatus)) errors.push(`${plugin.name} syncStatus 无效`);
  parseGithubRepo(plugin.repositoryUrl);
  errors.push(...validateChineseMarketplaceText(plugin));
  if (plugin.source?.path && path.isAbsolute(plugin.source.path)) errors.push(`${plugin.name} source.path 不能是绝对路径`);
  if (plugin.source?.type === 'local-snapshot' && plugin.source.path && !fs.existsSync(path.join(ROOT, plugin.source.path))) errors.push(`${plugin.name} source.path 快照不存在`);
  return errors;
}

function submissionToRegistryPlugin(submission) {
  return {
    name: submission.slug,
    displayName: titleFromRepo(submission.repo),
    description: submission.note || '已提交，等待维护者审核源仓库、Release 和插件 manifest。',
    longDescription: submission.note || `这个插件来自 ${submission.repositoryUrl}，目前处于审核中。维护者会检查 manifest、Release、资产路径和权限说明。`,
    author: submission.owner,
    avatarUrl: `https://github.com/${submission.owner}.png?size=96`,
    category: 'Community Review',
    tags: ['Submitted', 'Reviewing'],
    capabilities: ['Pending Review'],
    version: '0.0.0-review',
    releaseTag: 'pending-review',
    repositoryUrl: submission.repositoryUrl,
    verifiedStatus: 'reviewing',
    syncStatus: 'pending',
    syncTimestamp: submission.updatedAt || submission.submittedAt,
    installPolicy: 'REVIEW_ONLY',
    source: { type: 'pending', path: null },
    featured: false,
    review: submission.review || null,
  };
}

function pluginSourceToRegistry(plugin) {
  return {
    name: plugin.name,
    displayName: plugin.displayName,
    description: plugin.description,
    longDescription: plugin.longDescription || plugin.description,
    author: plugin.author,
    avatarUrl: plugin.avatarUrl || `https://github.com/${parseGithubRepo(plugin.repositoryUrl).owner}.png?size=96`,
    category: plugin.category,
    tags: plugin.tags || [],
    capabilities: plugin.capabilities || [],
    version: plugin.version,
    releaseTag: plugin.releaseTag,
    repositoryUrl: plugin.repositoryUrl,
    verifiedStatus: plugin.verifiedStatus || 'verified',
    syncStatus: plugin.syncStatus || 'synced',
    syncTimestamp: plugin.syncTimestamp || now(),
    installPolicy: plugin.installPolicy || 'AVAILABLE',
    source: plugin.source || { type: 'local-snapshot', url: plugin.repositoryUrl, ref: plugin.releaseTag, path: '.', manifestPath: '.codex-plugin/plugin.json' },
    featured: Boolean(plugin.featured),
    review: plugin.review || null,
    securityScan: plugin.securityScan || plugin.review?.securityScan || null,
  };
}

function submissionToReviewItem(submission) {
  const plugin = listJson(PLUGIN_DIR).map(readJson).find((item) => item.repositoryUrl === submission.repositoryUrl || item.name === submission.slug);
  return {
    id: submission.id,
    slug: submission.slug,
    owner: submission.owner,
    repo: submission.repo,
    displayName: plugin?.displayName || titleFromRepo(submission.repo),
    repositoryUrl: submission.repositoryUrl,
    issueUrl: submission.review?.issueUrl || null,
    status: submission.status,
    submittedAt: submission.submittedAt,
    updatedAt: submission.updatedAt || submission.submittedAt,
    reviewer: submission.review?.reviewer || null,
    decision: submission.review?.decision || null,
    reason: submission.review?.reason || null,
    pluginName: plugin?.name || null,
    verifiedStatus: plugin?.verifiedStatus || (submission.status === 'approved' ? 'verified' : 'reviewing'),
    syncStatus: plugin?.syncStatus || (submission.status === 'approved' ? 'synced' : 'pending'),
    securityScan: plugin?.securityScan || submission.review?.securityScan || null,
  };
}

function buildRegistry(generatedAt = now()) {
  const pluginSources = listJson(PLUGIN_DIR).map(readJson);
  const submissions = listJson(SUBMISSION_DIR).map(readJson);
  const approvedNames = new Set(pluginSources.map((plugin) => plugin.name));
  const registryPlugins = pluginSources.map(pluginSourceToRegistry);
  for (const submission of submissions) {
    if (submission.status !== 'reviewing') continue;
    if (approvedNames.has(submission.slug)) continue;
    registryPlugins.push(submissionToRegistryPlugin(submission));
  }
  registryPlugins.sort((a, b) => Number(b.featured) - Number(a.featured) || a.displayName.localeCompare(b.displayName));
  return {
    marketplace: {
      name: MARKETPLACE_NAME,
      displayName: 'MWE Codex Plugin Marketplace',
      repositoryUrl: MARKETPLACE_REPOSITORY_URL,
      marketplacePath: 'marketplace.json',
      lastUpdated: generatedAt,
    },
    plugins: registryPlugins,
    submissions: submissions.map(submissionToReviewItem).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
  };
}

function buildCodexMarketplace(registry) {
  return {
    schemaVersion: 1,
    name: registry.marketplace.name,
    displayName: registry.marketplace.displayName,
    repositoryUrl: registry.marketplace.repositoryUrl,
    generatedAt: registry.marketplace.lastUpdated,
    plugins: registry.plugins
      .filter((plugin) => plugin.installPolicy !== 'REVIEW_ONLY')
      .map((plugin) => ({
        name: plugin.name,
        displayName: plugin.displayName,
        version: plugin.version,
        releaseTag: plugin.releaseTag,
        repositoryUrl: plugin.repositoryUrl,
        verifiedStatus: plugin.verifiedStatus,
        installPolicy: plugin.installPolicy,
        source: plugin.source,
      })),
  };
}

function buildAgentsMarketplace(registry) {
  return {
    name: registry.marketplace.name,
    interface: {
      displayName: registry.marketplace.displayName,
    },
    plugins: registry.plugins
      .filter((plugin) => plugin.installPolicy !== 'REVIEW_ONLY')
      .map((plugin) => ({
        name: plugin.name,
        source: {
          source: 'local',
          path: './' + (plugin.source?.path || '.'),
        },
        policy: {
          installation: plugin.installPolicy || 'AVAILABLE',
          authentication: plugin.authentication || 'ON_INSTALL',
        },
        category: plugin.category,
      })),
  };
}

function pluginRecordsForRepository(repositoryUrl) {
  const repo = parseGithubRepo(repositoryUrl);
  return listJson(PLUGIN_DIR)
    .map((file) => ({ file, plugin: readJson(file) }))
    .filter((item) => parseGithubRepo(item.plugin.repositoryUrl).repositoryUrl === repo.repositoryUrl);
}

function submissionFilesForRepository(repositoryUrl) {
  const repo = parseGithubRepo(repositoryUrl);
  return listJson(SUBMISSION_DIR).filter((file) => {
    const submission = readJson(file);
    if (submission.type === 'removal') return false;
    return parseGithubRepo(submission.repositoryUrl).repositoryUrl === repo.repositoryUrl;
  });
}

function removeSubmissionFilesForRepository(repositoryUrl) {
  for (const file of submissionFilesForRepository(repositoryUrl)) {
    fs.rmSync(file, { force: true });
  }
}

function removePluginRecordFiles(records) {
  for (const { file, plugin } of records) {
    const snapshotPath = plugin.source?.type === 'local-snapshot' ? plugin.source?.path : null;
    if (snapshotPath && snapshotPath.startsWith('marketplace/snapshots/')) {
      fs.rmSync(path.join(ROOT, snapshotPath), { recursive: true, force: true });
    }
    fs.rmSync(file, { force: true });
  }
}

function manualApproveExistingPlugins(submission, submissionFile, args) {
  const records = pluginRecordsForRepository(submission.repositoryUrl)
    .filter((item) => item.plugin.installPolicy === 'REVIEW_ONLY' || item.plugin.securityScan?.blocked || item.plugin.securityScan?.status === 'blocked');
  if (!records.length) {
    console.log('submission already approved: ' + submission.id);
    return;
  }
  const timestamp = now();
  for (const { file, plugin } of records) {
    const scan = plugin.securityScan || { status: 'pending', findings: [] };
    plugin.verifiedStatus = 'verified';
    plugin.syncStatus = 'synced';
    plugin.syncTimestamp = timestamp;
    plugin.installPolicy = 'AVAILABLE';
    plugin.securityScan = {
      ...scan,
      status: scan.status === 'passed' ? 'passed' : 'warnings',
      blocked: false,
      manuallyApproved: true,
      approvedAt: timestamp,
      approvedBy: args.by || 'marketplace-admin',
    };
    plugin.review = {
      ...(plugin.review || {}),
      status: 'approved',
      decision: 'approved',
      reviewer: args.by || 'marketplace-admin',
      reason: args.reason || 'Marketplace admin manually approved blocked security scan findings.',
      reviewedAt: timestamp,
    };
    writeJson(file, plugin);
  }
  submission.status = 'approved';
  submission.updatedAt = timestamp;
  submission.review = {
    ...(submission.review || {}),
    reviewer: args.by || 'marketplace-admin',
    decision: 'approved',
    reason: 'admin manually approved existing plugin(s): ' + records.map((item) => item.plugin.name).join(', '),
    reviewedAt: timestamp,
  };
  writeJson(submissionFile, submission);
  console.log('admin-approved existing plugin(s): ' + records.map((item) => item.plugin.name).join(', '));
}

function commandSubmit(args) {
  const url = args._[0];
  if (!url) throw new Error('submit 需要 GitHub 仓库 URL');
  const repo = parseGithubRepo(url);
  const slug = `${repo.owner}-${repo.repo}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const id = `${slug}-${stableId(repo.repositoryUrl)}`;
  const file = path.join(SUBMISSION_DIR, `${id}.json`);
  if (fs.existsSync(file)) throw new Error(`提交已存在：${path.relative(ROOT, file)}`);
  const timestamp = now();
  const submission = {
    schemaVersion: 1,
    id,
    slug,
    owner: repo.owner,
    repo: repo.repo,
    repositoryUrl: repo.repositoryUrl,
    note: args.note || '',
    submitter: args.by || 'unknown',
    status: 'reviewing',
    submittedAt: timestamp,
    updatedAt: timestamp,
    review: {
      issueUrl: args.issue || null,
      reviewer: null,
      decision: null,
      reason: null,
    },
  };
  writeJson(file, submission);
  console.log(`created ${path.relative(ROOT, file)}`);
}

function commandApprove(args) {
  const ref = args._[0];
  if (!ref) throw new Error('approve 需要 submission id 或文件路径');
  const submissionFile = resolveSubmission(ref);
  const submission = readJson(submissionFile);
  if (submission.status !== 'reviewing') throw new Error(`只能审核 reviewing 状态，当前为 ${submission.status}`);
  const name = args.name || submission.slug;
  const timestamp = now();
  const plugin = {
    schemaVersion: 1,
    name,
    displayName: args['display-name'] || titleFromRepo(submission.repo),
    description: args.description || submission.note || '社区提交的 Codex 插件。',
    longDescription: args['long-description'] || args.description || submission.note || '社区提交的 Codex 插件，已通过 Marketplace 审核。',
    author: args.author || submission.owner,
    avatarUrl: args['avatar-url'] || `https://github.com/${submission.owner}.png?size=96`,
    category: args.category || 'Community',
    tags: splitList(args.tags),
    capabilities: splitList(args.capabilities),
    version: args.version || '0.1.0',
    releaseTag: args['release-tag'] || args.version || 'v0.1.0',
    repositoryUrl: submission.repositoryUrl,
    verifiedStatus: 'verified',
    syncStatus: 'synced',
    syncTimestamp: timestamp,
    installPolicy: 'AVAILABLE',
    featured: args.featured === 'true',
    source: {
      type: 'github-release',
      manifestPath: '.codex-plugin/plugin.json',
      releaseTag: args['release-tag'] || args.version || 'v0.1.0',
    },
    review: {
      status: 'approved',
      reviewedAt: timestamp,
      reviewer: args.by || 'maintainer',
    },
  };
  const errors = normalizePlugin(plugin);
  if (errors.length) throw new Error(errors.join('\n'));
  writeJson(path.join(PLUGIN_DIR, `${name}.json`), plugin);
  submission.status = 'approved';
  submission.updatedAt = timestamp;
  submission.review = {
    ...submission.review,
    reviewer: args.by || 'maintainer',
    decision: 'approved',
    reason: args.reason || null,
  };
  writeJson(submissionFile, submission);
  console.log(`approved ${submission.id} -> marketplace/plugins/${name}.json`);
}

function commandAutoReview(args) {
  const ref = args._[0];
  if (!ref) throw new Error('auto-review 需要 submission id、文件路径或 GitHub 仓库 URL');
  let submissionFile;
  if (/^https:\/\/github\.com\//.test(ref)) {
    const repo = parseGithubRepo(ref);
    const slug = (repo.owner + '-' + repo.repo).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    try {
      commandSubmit({ ...args, _: [ref] });
    } catch (error) {
      if (!String(error.message).includes('提交已存在')) throw error;
      console.log('submission already exists for ' + repo.repositoryUrl);
    }
    submissionFile = resolveSubmission(slug);
  } else {
    submissionFile = resolveSubmission(ref);
  }
  const submission = readJson(submissionFile);
  if (submission.status === 'approved') {
    if (args['manual-approve'] === true || args['manual-approve'] === 'true') {
      manualApproveExistingPlugins(submission, submissionFile, args);
      return;
    }
    console.log('submission already approved: ' + submission.id);
    return;
  }
  if (submission.status !== 'reviewing') throw new Error('只能自动审核 reviewing 状态，当前为 ' + submission.status);
  const repo = parseGithubRepo(submission.repositoryUrl);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mwe-marketplace-review-'));
  const repoDir = path.join(tmp, 'repo');
  try {
    runGit(['clone', '--depth=1', '--branch', args.ref || 'main', repo.repositoryUrl, repoDir]);
  } catch {
    runGit(['clone', '--depth=1', repo.repositoryUrl, repoDir]);
  }
  const plugins = discoverSourcePlugins(repoDir, repo, args);
  for (const plugin of plugins) {
    const snapshotPath = normalizePathForJson(path.join('marketplace/snapshots', plugin.name));
    const snapshotDir = path.join(ROOT, snapshotPath);
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    copySnapshotDirectory(plugin.__pluginDir, snapshotDir);
    delete plugin.__pluginDir;
    plugin.source.path = snapshotPath;
    const errors = normalizePlugin(plugin);
    if (errors.length) throw new Error(errors.join('\n'));
    writeJson(path.join(PLUGIN_DIR, plugin.name + '.json'), plugin);
    console.log('auto-approved ' + plugin.name + ' from ' + plugin.source.path);
  }
  const timestamp = now();
  submission.status = 'approved';
  submission.updatedAt = timestamp;
  submission.review = {
    ...submission.review,
    securityScan: plugins.some((plugin) => plugin.securityScan?.status === 'warnings')
      ? { status: 'warnings', findings: plugins.flatMap((plugin) => plugin.securityScan?.findings || []) }
      : { status: 'passed', findings: [] },
    reviewer: args.by || 'marketplace-bot',
    decision: 'approved',
    reason: (args['manual-approve'] === true || args['manual-approve'] === 'true' ? 'admin manually approved ' : 'auto-approved ') + plugins.length + ' plugin(s): ' + plugins.map((plugin) => plugin.name).join(', '),
    reviewedAt: timestamp,
  };
  writeJson(submissionFile, submission);
}

function commandReject(args) {
  const ref = args._[0];
  if (!ref) throw new Error('reject 需要 submission id 或文件路径');
  if (!args.reason) throw new Error('reject 需要 --reason');
  const submissionFile = resolveSubmission(ref);
  const submission = readJson(submissionFile);
  submission.status = 'rejected';
  submission.updatedAt = now();
  submission.review = {
    ...submission.review,
    reviewer: args.by || 'maintainer',
    decision: 'rejected',
    reason: args.reason,
  };
  writeJson(submissionFile, submission);
  console.log(`rejected ${submission.id}`);
}
function githubApi(pathname, token) {
  if (!token) throw new Error('删除校验需要 GITHUB_TOKEN，用于查询仓库权限');
  const response = fetch('https://api.github.com' + pathname, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  return response.then(async (result) => {
    const text = await result.text();
    const data = text ? JSON.parse(text) : null;
    if (!result.ok) throw new Error(data?.message || result.statusText);
    return data;
  });
}

async function verifyRemovalRequester(plugin, requester) {
  const login = String(requester || '').replace(/^@/, '').trim();
  if (!login) throw new Error('删除请求必须提供 GitHub 登录名');
  const repo = parseGithubRepo(plugin.repositoryUrl);
  if (login.toLowerCase() === repo.owner.toLowerCase()) return { login, permission: 'owner' };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const permission = await githubApi('/repos/' + repo.owner + '/' + repo.repo + '/collaborators/' + encodeURIComponent(login) + '/permission', token)
    .then((data) => data.permission)
    .catch((error) => {
      throw new Error('无法确认 @' + login + ' 对 ' + repo.owner + '/' + repo.repo + ' 的权限：' + error.message);
    });
  if (!['admin', 'maintain'].includes(permission)) {
    throw new Error('@' + login + ' 不是 ' + repo.owner + '/' + repo.repo + ' 的 owner/maintainer，当前权限为 ' + (permission || 'none'));
  }
  return { login, permission };
}

function resolveSubmissionReference(ref) {
  if (!ref) throw new Error('remove-submission 需要 submission id 或 GitHub 仓库 URL');
  if (/^https:\/\/github\.com\//.test(ref)) {
    const repo = parseGithubRepo(ref);
    const matches = listJson(SUBMISSION_DIR).filter((file) => parseGithubRepo(readJson(file).repositoryUrl).repositoryUrl === repo.repositoryUrl);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error('提交引用不唯一：' + repo.repositoryUrl);
    throw new Error('找不到提交：' + repo.repositoryUrl);
  }
  return resolveSubmission(ref);
}

function resolvePluginReference(ref) {
  if (!ref) throw new Error('remove 需要插件名称或 GitHub 仓库 URL');
  const plugins = listJson(PLUGIN_DIR).map((file) => ({ file, plugin: readJson(file) }));
  if (/^https:\/\/github\.com\//.test(ref)) {
    const repo = parseGithubRepo(ref);
    const match = plugins.find((item) => parseGithubRepo(item.plugin.repositoryUrl).repositoryUrl === repo.repositoryUrl);
    if (!match) throw new Error('找不到这个 GitHub 仓库对应的已收录插件：' + repo.repositoryUrl);
    return match;
  }
  const match = plugins.find((item) => item.plugin.name === ref);
  if (!match) throw new Error('找不到已收录插件：' + ref);
  return match;
}

function upsertRemovalRecord(plugin, args, verified) {
  const repo = parseGithubRepo(plugin.repositoryUrl);
  const id = 'remove-' + plugin.name + '-' + stableId(plugin.repositoryUrl);
  const file = path.join(SUBMISSION_DIR, id + '.json');
  const timestamp = now();
  const existing = fs.existsSync(file) ? readJson(file) : {};
  writeJson(file, {
    schemaVersion: 1,
    type: 'removal',
    id,
    slug: plugin.name,
    owner: repo.owner,
    repo: repo.repo,
    repositoryUrl: plugin.repositoryUrl,
    note: args.reason || '仓库 owner 请求从 Marketplace 删除插件。',
    submitter: verified.login,
    status: 'removed',
    submittedAt: existing.submittedAt || timestamp,
    updatedAt: timestamp,
    review: {
      ...(existing.review || {}),
      issueUrl: args.issue || existing.review?.issueUrl || null,
      reviewer: args.by || verified.login,
      decision: 'removed',
      reason: args.reason || null,
      permission: verified.permission,
      reviewedAt: timestamp,
    },
  });
}

async function commandRemove(args) {
  const ref = args._[0];
  const { file, plugin } = resolvePluginReference(ref);
  const adminApproved = args['admin-approved'] === true || args['admin-approved'] === 'true';
  const verified = adminApproved
    ? { login: args.by || 'marketplace-admin', permission: 'marketplace-admin' }
    : await verifyRemovalRequester(plugin, args.by);
  const snapshotPath = plugin.source?.type === 'local-snapshot' ? plugin.source?.path : null;
  if (snapshotPath && snapshotPath.startsWith('marketplace/snapshots/')) {
    fs.rmSync(path.join(ROOT, snapshotPath), { recursive: true, force: true });
  }
  fs.rmSync(file, { force: true });
  removeSubmissionFilesForRepository(plugin.repositoryUrl);
  upsertRemovalRecord(plugin, args, verified);
  console.log('removed ' + plugin.name + '; requester @' + verified.login + ' permission=' + verified.permission);
}

function commandRemoveSubmission(args) {
  const ref = args._[0];
  let submissionFile = null;
  let submission = null;
  try {
    submissionFile = resolveSubmissionReference(ref);
    submission = readJson(submissionFile);
  } catch (error) {
    if (!/^https:\/\/github\.com\//.test(ref || '')) throw error;
    const repo = parseGithubRepo(ref);
    submission = { id: repo.owner + '-' + repo.repo, repositoryUrl: repo.repositoryUrl };
  }
  const records = pluginRecordsForRepository(submission.repositoryUrl);
  removePluginRecordFiles(records);
  removeSubmissionFilesForRepository(submission.repositoryUrl);
  if (submissionFile) fs.rmSync(submissionFile, { force: true });
  console.log('removed submission ' + submission.id + ' and ' + records.length + ' plugin record(s); requester @' + (args.by || 'marketplace-admin'));
}

function commandValidate() {
  const errors = [];
  for (const file of listJson(PLUGIN_DIR)) {
    try {
      const plugin = readJson(file);
      errors.push(...normalizePlugin(plugin).map((error) => `${path.relative(ROOT, file)}: ${error}`));
    } catch (error) {
      errors.push(`${path.relative(ROOT, file)}: ${error.message}`);
    }
  }
  for (const file of listJson(SUBMISSION_DIR)) {
    try {
      const submission = readJson(file);
      if (!submission.id || !submission.repositoryUrl || !submission.status) errors.push(`${path.relative(ROOT, file)}: submission 缺少必填字段`);
      parseGithubRepo(submission.repositoryUrl);
      if (!allowedSubmissionStatuses.has(submission.status)) errors.push(`${path.relative(ROOT, file)}: submission status 无效`);
    } catch (error) {
      errors.push(`${path.relative(ROOT, file)}: ${error.message}`);
    }
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
    return false;
  }
  console.log('marketplace validation ok');
  return true;
}

function commandSync(args) {
  if (!commandValidate()) return;
  const existingRegistry = fs.existsSync(REGISTRY_FILE) ? readJson(REGISTRY_FILE) : null;
  const generatedAt = args.check && existingRegistry?.marketplace?.lastUpdated ? existingRegistry.marketplace.lastUpdated : now();
  const registry = buildRegistry(generatedAt);
  const codexMarketplace = buildCodexMarketplace(registry);
  if (args.check) {
    const currentRegistry = fs.existsSync(REGISTRY_FILE) ? fs.readFileSync(REGISTRY_FILE, 'utf8') : '';
    const nextRegistry = JSON.stringify(registry, null, 2) + '\n';
    const currentMarketplace = fs.existsSync(CODEX_MARKETPLACE_FILE) ? fs.readFileSync(CODEX_MARKETPLACE_FILE, 'utf8') : '';
    const nextMarketplace = JSON.stringify(codexMarketplace, null, 2) + '\n';
    const currentAgentsMarketplace = fs.existsSync(AGENTS_MARKETPLACE_FILE) ? fs.readFileSync(AGENTS_MARKETPLACE_FILE, 'utf8') : '';
    const nextAgentsMarketplace = JSON.stringify(buildAgentsMarketplace(registry), null, 2) + '\n';
    if (currentRegistry !== nextRegistry || currentMarketplace !== nextMarketplace || currentAgentsMarketplace !== nextAgentsMarketplace) {
      console.error('registry or marketplace.json is out of sync; run node scripts/marketplace.mjs sync');
      process.exitCode = 1;
      return;
    }
    console.log('registry sync check ok');
    return;
  }
  writeJson(REGISTRY_FILE, registry);
  writeJson(CODEX_MARKETPLACE_FILE, codexMarketplace);
  writeJson(AGENTS_MARKETPLACE_FILE, buildAgentsMarketplace(registry));
  console.log(`wrote ${path.relative(ROOT, REGISTRY_FILE)}, ${path.relative(ROOT, CODEX_MARKETPLACE_FILE)} and ${path.relative(ROOT, AGENTS_MARKETPLACE_FILE)}`);
}

ensureDirs();
const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
try {
  if (!command || command === 'help' || command === '--help') usage();
  else if (command === 'submit') commandSubmit(args);
  else if (command === 'approve') commandApprove(args);
  else if (command === 'auto-review') commandAutoReview(args);
  else if (command === 'reject') commandReject(args);
  else if (command === 'remove') await commandRemove(args);
  else if (command === 'remove-submission') commandRemoveSubmission(args);
  else if (command === 'sync') commandSync(args);
  else if (command === 'validate') commandValidate();
  else throw new Error(`未知命令：${command}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
