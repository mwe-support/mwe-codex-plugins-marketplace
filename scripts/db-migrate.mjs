#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, query } from '../db.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

async function ensureMigrationsTable() {
  await query(`create table if not exists schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  )`);
}

async function appliedVersions() {
  const result = await query('select version from schema_migrations');
  return new Set(result.rows.map((row) => row.version));
}

async function applyMigration(file) {
  const version = path.basename(file);
  const sql = fs.readFileSync(file, 'utf8');
  await query('begin');
  try {
    await query(sql);
    await query('insert into schema_migrations (version) values ($1) on conflict do nothing', [version]);
    await query('commit');
    console.log('applied ' + version);
  } catch (error) {
    await query('rollback');
    throw error;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for db:migrate');
  await ensureMigrationsTable();
  const applied = await appliedVersions();
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => path.join(MIGRATIONS_DIR, file));
  for (const file of files) {
    const version = path.basename(file);
    if (applied.has(version)) continue;
    await applyMigration(file);
  }
  console.log('database migrations ok');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(closeDb);
