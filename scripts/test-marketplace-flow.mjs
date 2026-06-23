#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mwe-marketplace-flow-'));
const worktree = path.join(tmp, 'repo');

function copyFilter(src) {
  const relative = path.relative(root, src);
  if (!relative) return true;
  if (relative === '.git' || relative.startsWith(`.git${path.sep}`)) return false;
  if (relative === 'node_modules' || relative.startsWith(`node_modules${path.sep}`)) return false;
  return true;
}

function run(args) {
  execFileSync(process.execPath, ['scripts/marketplace.mjs', ...args], {
    cwd: worktree,
    stdio: 'inherit',
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(worktree, file), 'utf8'));
}

fs.cpSync(root, worktree, { recursive: true, filter: copyFilter });

run(['submit', 'https://github.com/acme/codex-weather-plugin', '--note', '读取天气数据的 Codex 插件。', '--by', '@tester']);
run(['sync']);

const pendingRegistry = readJson('registry/plugins.json');
const pending = pendingRegistry.plugins.find((plugin) => plugin.repositoryUrl === 'https://github.com/acme/codex-weather-plugin');
if (!pending) throw new Error('pending plugin missing from registry');
if (pending.verifiedStatus !== 'reviewing' || pending.syncStatus !== 'pending') {
  throw new Error(`unexpected pending status ${pending.verifiedStatus}/${pending.syncStatus}`);
}

const submissionFile = fs.readdirSync(path.join(worktree, 'marketplace/submissions')).find((file) => file.includes('acme-codex-weather-plugin'));
const submissionId = submissionFile.replace(/\.json$/, '');
run([
  'approve',
  submissionId,
  '--name',
  'codex-weather',
  '--display-name',
  'Codex Weather',
  '--description',
  '查询天气数据并返回 Codex 可用摘要。',
  '--long-description',
  '查询天气数据并返回 Codex 可用摘要，已通过 Marketplace manifest 和 Release 审核。',
  '--author',
  'acme',
  '--category',
  'Data',
  '--version',
  '0.1.0',
  '--release-tag',
  'v0.1.0',
  '--tags',
  'Weather,Data',
  '--capabilities',
  'Skill,Read',
  '--by',
  '@maintainer',
]);
run(['sync']);

const approvedRegistry = readJson('registry/plugins.json');
const approved = approvedRegistry.plugins.find((plugin) => plugin.name === 'codex-weather');
if (!approved) throw new Error('approved plugin missing from registry');
if (approved.verifiedStatus !== 'verified' || approved.syncStatus !== 'synced') {
  throw new Error(`unexpected approved status ${approved.verifiedStatus}/${approved.syncStatus}`);
}
const marketplace = readJson('marketplace.json');
if (!marketplace.plugins.find((plugin) => plugin.name === 'codex-weather')) {
  throw new Error('approved plugin missing from marketplace.json');
}

console.log(`marketplace flow test ok (${tmp})`);
