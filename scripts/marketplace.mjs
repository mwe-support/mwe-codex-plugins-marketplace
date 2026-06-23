#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'marketplace/plugins');
const SUBMISSION_DIR = path.join(ROOT, 'marketplace/submissions');
const REGISTRY_FILE = path.join(ROOT, 'registry/plugins.json');
const CODEX_MARKETPLACE_FILE = path.join(ROOT, 'marketplace.json');
const MARKETPLACE_REPOSITORY_URL = 'https://github.com/mwe-support/mwe-codex-plugins-marketplace';
const MARKETPLACE_NAME = 'codex-community';

const allowedStatuses = new Set(['verified', 'reviewing', 'unverified']);
const allowedSyncStatuses = new Set(['synced', 'pending', 'failed']);

function usage() {
  console.log(`Marketplace registry helper

Commands:
  submit <github-url> [--note text] [--by name]
  approve <submission-id-or-file> [metadata flags]
  reject <submission-id-or-file> --reason text
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
  fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
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

function normalizePlugin(plugin) {
  const errors = [];
  for (const field of ['name', 'displayName', 'description', 'author', 'category', 'version', 'releaseTag', 'repositoryUrl']) {
    if (!plugin[field]) errors.push(`${plugin.name || '(unknown)'} 缺少字段 ${field}`);
  }
  if (plugin.verifiedStatus && !allowedStatuses.has(plugin.verifiedStatus)) errors.push(`${plugin.name} verifiedStatus 无效`);
  if (plugin.syncStatus && !allowedSyncStatuses.has(plugin.syncStatus)) errors.push(`${plugin.name} syncStatus 无效`);
  parseGithubRepo(plugin.repositoryUrl);
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
    featured: false,
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
    featured: Boolean(plugin.featured),
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
      })),
  };
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
      if (!['reviewing', 'approved', 'rejected'].includes(submission.status)) errors.push(`${path.relative(ROOT, file)}: submission status 无效`);
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
    if (currentRegistry !== nextRegistry || currentMarketplace !== nextMarketplace) {
      console.error('registry or marketplace.json is out of sync; run node scripts/marketplace.mjs sync');
      process.exitCode = 1;
      return;
    }
    console.log('registry sync check ok');
    return;
  }
  writeJson(REGISTRY_FILE, registry);
  writeJson(CODEX_MARKETPLACE_FILE, codexMarketplace);
  console.log(`wrote ${path.relative(ROOT, REGISTRY_FILE)} and ${path.relative(ROOT, CODEX_MARKETPLACE_FILE)}`);
}

ensureDirs();
const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
try {
  if (!command || command === 'help' || command === '--help') usage();
  else if (command === 'submit') commandSubmit(args);
  else if (command === 'approve') commandApprove(args);
  else if (command === 'reject') commandReject(args);
  else if (command === 'sync') commandSync(args);
  else if (command === 'validate') commandValidate();
  else throw new Error(`未知命令：${command}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
