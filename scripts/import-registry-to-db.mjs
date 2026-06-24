#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, query, upsertPlugin, upsertSubmission } from '../db.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PLUGIN_DIR = path.join(ROOT, 'marketplace/plugins');
const SUBMISSION_DIR = path.join(ROOT, 'marketplace/submissions');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => path.join(dir, file));
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for db:import');
  await query('select pg_advisory_lock(hashtext($1))', ['mwe-codex-marketplace-import']);
  try {
    let pluginCount = 0;
    let submissionCount = 0;
    for (const file of listJson(PLUGIN_DIR)) {
      const plugin = readJson(file);
      await upsertPlugin(plugin, plugin.status || 'active');
      pluginCount += 1;
    }
    for (const file of listJson(SUBMISSION_DIR)) {
      const submission = readJson(file);
      if (submission.type === 'removal') continue;
      await upsertSubmission(submission);
      submissionCount += 1;
    }
    await query(
      `insert into sync_events (event_type, source, status, payload)
       values ('registry_import', 'local', 'ok', $1::jsonb)`,
      [JSON.stringify({ pluginCount, submissionCount })]
    );
    console.log(`imported ${pluginCount} plugin(s) and ${submissionCount} submission(s)`);
  } finally {
    await query('select pg_advisory_unlock(hashtext($1))', ['mwe-codex-marketplace-import']);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(closeDb);
