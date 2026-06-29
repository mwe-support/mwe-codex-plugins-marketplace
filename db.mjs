import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || '';
const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
    })
  : null;

let availability;

export function dbConfigured() {
  return Boolean(pool);
}

export async function dbAvailable() {
  if (!pool) return false;
  if (availability !== undefined) return availability;
  try {
    await pool.query('select 1');
    availability = true;
  } catch (error) {
    availability = false;
    console.warn('PostgreSQL unavailable, falling back to file-backed state:', error.message);
  }
  return availability;
}

export async function query(sql, params = []) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  return pool.query(sql, params);
}

export async function closeDb() {
  if (pool) await pool.end();
}

export function normalizeRepositoryUrl(value) {
  return String(value || '').trim().replace(/\.git$/, '');
}

function rowToPlugin(row) {
  const metadata = row.metadata || {};
  const source = row.source || null;
  return {
    ...metadata,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    longDescription: row.long_description || row.description,
    author: row.author,
    avatarUrl: row.avatar_url,
    category: row.category,
    tags: row.tags || [],
    capabilities: row.capabilities || [],
    version: row.version,
    releaseTag: row.release_tag,
    repositoryUrl: row.repository_url,
    verifiedStatus: row.verified_status,
    syncStatus: row.sync_status,
    syncTimestamp: row.sync_timestamp,
    installPolicy: row.install_policy,
    featured: row.featured,
    source,
    defaultBranch: metadata.defaultBranch || source?.defaultBranch || row.release_tag,
    headSha: metadata.headSha || source?.headSha || null,
    repositoryTreeUrl: metadata.repositoryTreeUrl || source?.repositoryTreeUrl || null,
    review: row.review,
    securityScan: row.security_scan,
    stateStatus: row.status,
  };
}

function rowToSubmission(row) {
  return {
    id: row.id,
    slug: row.slug,
    owner: row.owner,
    repo: row.repo,
    displayName: row.display_name || row.repo,
    repositoryUrl: row.repository_url,
    issueUrl: row.issue_url,
    status: row.status,
    submittedAt: row.created_at,
    updatedAt: row.updated_at,
    reviewer: row.review?.reviewer || null,
    decision: row.review?.decision || null,
    reason: row.review?.reason || null,
    pluginName: row.plugin_name || null,
    verifiedStatus: row.verified_status || (row.status === 'approved' ? 'verified' : 'reviewing'),
    syncStatus: row.sync_status || (row.status === 'approved' ? 'synced' : row.status === 'failed' ? 'failed' : 'pending'),
    securityScan: row.security_scan || row.review?.securityScan || null,
    stage: row.review?.stage || (row.status === 'approved' ? 'completed' : row.status === 'failed' ? 'validating' : 'received'),
    source: row.source || 'postgres',
  };
}

export async function readRegistryFromDb() {
  if (!(await dbAvailable())) return null;
  const plugins = await query(`select * from plugins where status = 'active' order by featured desc, display_name asc`);
  const submissions = await listSubmissionsFromDb({ includeRemoved: false });
  return {
    marketplace: {
      name: 'codex-community',
      displayName: 'MWE Codex插件共享市场',
      generatedAt: new Date().toISOString(),
      stateSource: 'postgres',
    },
    plugins: plugins.rows.map(rowToPlugin),
    submissions,
  };
}

export async function listSubmissionsFromDb({ includeRemoved = false } = {}) {
  if (!(await dbAvailable())) return null;
  const result = await query(
    `select s.*, p.name as plugin_name, p.display_name, p.verified_status, p.sync_status, p.security_scan
     from submissions s
     left join lateral (
       select name, display_name, verified_status, sync_status, security_scan
       from plugins
       where normalized_repository_url = s.normalized_repository_url and status = 'active'
       order by featured desc, display_name asc
       limit 1
     ) p on true
     where ($1::boolean or s.status <> 'removed')
     order by s.updated_at desc`,
    [includeRemoved]
  );
  return result.rows.map(rowToSubmission);
}

export async function findPluginByRepositoryFromDb(repositoryUrl) {
  if (!(await dbAvailable())) return null;
  const normalized = normalizeRepositoryUrl(repositoryUrl);
  const result = await query(
    `select * from plugins
     where normalized_repository_url = $1 and status = 'active'
     order by featured desc, updated_at desc
     limit 1`,
    [normalized]
  );
  return result.rows[0] ? rowToPlugin(result.rows[0]) : null;
}

export async function findSubmissionByRepositoryFromDb(repositoryUrl) {
  if (!(await dbAvailable())) return null;
  const normalized = normalizeRepositoryUrl(repositoryUrl);
  const result = await query(
    `select * from submissions
     where normalized_repository_url = $1 and status in ('reviewing', 'approved', 'manual_approving')
     order by updated_at desc
     limit 1`,
    [normalized]
  );
  return result.rows[0] ? rowToSubmission(result.rows[0]) : null;
}

export async function upsertPlugin(plugin, status = 'active') {
  if (!(await dbAvailable())) return;
  await query(
    `insert into plugins (
      name, display_name, description, long_description, author, avatar_url, category,
      tags, capabilities, version, release_tag, repository_url, normalized_repository_url,
      verified_status, sync_status, sync_timestamp, install_policy, featured, source,
      review, security_scan, metadata, status, updated_at
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21::jsonb,$22::jsonb,$23,now()
    )
    on conflict (name) do update set
      display_name = excluded.display_name,
      description = excluded.description,
      long_description = excluded.long_description,
      author = excluded.author,
      avatar_url = excluded.avatar_url,
      category = excluded.category,
      tags = excluded.tags,
      capabilities = excluded.capabilities,
      version = excluded.version,
      release_tag = excluded.release_tag,
      repository_url = excluded.repository_url,
      normalized_repository_url = excluded.normalized_repository_url,
      verified_status = excluded.verified_status,
      sync_status = excluded.sync_status,
      sync_timestamp = excluded.sync_timestamp,
      install_policy = excluded.install_policy,
      featured = excluded.featured,
      source = excluded.source,
      review = excluded.review,
      security_scan = excluded.security_scan,
      metadata = excluded.metadata,
      status = excluded.status,
      updated_at = now()`,
    [
      plugin.name,
      plugin.displayName,
      plugin.description,
      plugin.longDescription || plugin.description,
      plugin.author,
      plugin.avatarUrl || null,
      plugin.category,
      JSON.stringify(plugin.tags || []),
      JSON.stringify(plugin.capabilities || []),
      plugin.version,
      plugin.releaseTag,
      plugin.repositoryUrl,
      normalizeRepositoryUrl(plugin.repositoryUrl),
      plugin.verifiedStatus || 'verified',
      plugin.syncStatus || 'synced',
      plugin.syncTimestamp || new Date().toISOString(),
      plugin.installPolicy || 'AVAILABLE',
      Boolean(plugin.featured),
      JSON.stringify(plugin.source || null),
      JSON.stringify(plugin.review || null),
      JSON.stringify(plugin.securityScan || null),
      JSON.stringify(plugin),
      status,
    ]
  );
}

export async function upsertSubmission(submission) {
  if (!(await dbAvailable())) return;
  const normalized = normalizeRepositoryUrl(submission.repositoryUrl);
  const values = [
    submission.id,
    submission.slug,
    submission.owner,
    submission.repo,
    submission.repositoryUrl,
    normalized,
    submission.note || '',
    submission.submitter || 'unknown',
    submission.status || 'reviewing',
    submission.review?.issueUrl || submission.issueUrl || null,
    submission.pluginName || null,
    JSON.stringify(submission.review || null),
    JSON.stringify(submission.review?.securityScan || submission.securityScan || null),
    submission.source || 'registry-import',
    submission.updatedAt || submission.submittedAt || null,
  ];

  const updated = await query(
    `update submissions set
      slug = $2,
      owner = $3,
      repo = $4,
      repository_url = $5,
      note = $7,
      submitter = $8,
      status = $9,
      issue_url = $10,
      plugin_name = $11,
      review = $12::jsonb,
      security_scan = $13::jsonb,
      source = $14,
      updated_at = coalesce($15::timestamptz, now())
     where normalized_repository_url = $6
       and status in ('reviewing', 'approved', 'manual_approving')
       and $1::text is not null`,
    values
  );
  if (updated.rowCount > 0) return;

  await query(
    `insert into submissions (
      id, slug, owner, repo, repository_url, normalized_repository_url, note,
      submitter, status, issue_url, plugin_name, review, security_scan, source, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,coalesce($15::timestamptz, now()))
    on conflict (id) do update set
      slug = excluded.slug,
      owner = excluded.owner,
      repo = excluded.repo,
      repository_url = excluded.repository_url,
      normalized_repository_url = excluded.normalized_repository_url,
      note = excluded.note,
      submitter = excluded.submitter,
      status = excluded.status,
      issue_url = excluded.issue_url,
      plugin_name = excluded.plugin_name,
      review = excluded.review,
      security_scan = excluded.security_scan,
      source = excluded.source,
      updated_at = excluded.updated_at`,
    values
  );
}

export async function createSubmissionState({ repositoryUrl, issueUrl, note = '', submitter = 'web' }) {
  if (!(await dbAvailable())) return;
  const normalized = normalizeRepositoryUrl(repositoryUrl);
  const url = new URL(normalized);
  const [owner, repo] = url.pathname.split('/').filter(Boolean);
  const slug = (owner + '-' + repo).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const id = slug + '-' + Buffer.from(normalized).toString('hex').slice(0, 10);
  await upsertSubmission({
    id,
    slug,
    owner,
    repo,
    repositoryUrl: normalized,
    note,
    submitter,
    status: 'reviewing',
    review: { issueUrl: issueUrl || null, reviewer: null, decision: null, reason: null },
    source: 'web',
  });
}

export async function markSubmissionRemoved(repositoryUrl) {
  if (!(await dbAvailable())) return;
  await query(
    `update submissions
     set status = 'removed', updated_at = now(), review = coalesce(review, '{}'::jsonb) || jsonb_build_object('decision','removed','reviewedAt', now())
     where normalized_repository_url = $1`,
    [normalizeRepositoryUrl(repositoryUrl)]
  );
}

export async function markSubmissionManualApproving(repositoryUrl) {
  if (!(await dbAvailable())) return;
  await query(
    `update submissions
     set status = 'manual_approving', updated_at = now(), review = coalesce(review, '{}'::jsonb) || jsonb_build_object('decision','manual_approving','reviewedAt', now())
     where normalized_repository_url = $1`,
    [normalizeRepositoryUrl(repositoryUrl)]
  );
}

async function markRepositorySubmissionRemovedIfNoActivePlugin(normalizedRepositoryUrl) {
  if (!normalizedRepositoryUrl) return;
  await query(
    `update submissions
     set status = 'removed', updated_at = now(), review = coalesce(review, '{}'::jsonb) || jsonb_build_object('decision','removed','reviewedAt', now())
     where normalized_repository_url = $1
       and not exists (
         select 1 from plugins
         where normalized_repository_url = $1 and status = 'active'
       )`,
    [normalizedRepositoryUrl]
  );
}

export async function markPluginRemoving({ pluginName, repositoryUrl }) {
  if (!(await dbAvailable())) return;
  const normalized = repositoryUrl ? normalizeRepositoryUrl(repositoryUrl) : '';
  let normalizedRepositoryUrl = normalized;
  if (pluginName) {
    const result = await query(`update plugins set status = 'removing', updated_at = now() where name = $1 returning normalized_repository_url`, [pluginName]);
    normalizedRepositoryUrl = normalizedRepositoryUrl || result.rows[0]?.normalized_repository_url || '';
  } else {
    await query(`update plugins set status = 'removing', updated_at = now() where normalized_repository_url = $1`, [normalized]);
  }
  await markRepositorySubmissionRemovedIfNoActivePlugin(normalizedRepositoryUrl);
}

export async function recordAdminAction({ actionType, targetType, targetId, repositoryUrl, status = 'queued', issueUrl, message }) {
  if (!(await dbAvailable())) return;
  await query(
    `insert into admin_actions (action_type, target_type, target_id, repository_url, normalized_repository_url, status, issue_url, message)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [actionType, targetType, targetId || null, repositoryUrl || null, repositoryUrl ? normalizeRepositoryUrl(repositoryUrl) : null, status, issueUrl || null, message || null]
  );
}

export async function findPluginsByRepositoryFromDb(repositoryUrl) {
  if (!(await dbAvailable())) return null;
  const normalized = normalizeRepositoryUrl(repositoryUrl);
  const result = await query(
    `select * from plugins
     where normalized_repository_url = $1 and status = 'active'
     order by featured desc, display_name asc`,
    [normalized]
  );
  return result.rows.map(rowToPlugin);
}


export async function deletePluginFromDb({ pluginName, adminReason = '' }) {
  if (!(await dbAvailable())) return null;
  const result = await query(
    `update plugins
     set status = 'removed', updated_at = now(),
         review = coalesce(review, '{}'::jsonb) || jsonb_build_object('decision','removed','reviewedAt', now(), 'reason', $2::text)
     where name = $1 and status = 'active'
     returning *`,
    [pluginName, adminReason || 'admin removed from web marketplace']
  );
  const row = result.rows[0];
  if (!row) return null;
  await markRepositorySubmissionRemovedIfNoActivePlugin(row.normalized_repository_url);
  await recordAdminAction({
    actionType: 'plugin-delete',
    targetType: 'plugin',
    targetId: row.name,
    repositoryUrl: row.repository_url,
    status: 'completed',
    message: adminReason || 'admin removed from web marketplace',
  });
  return rowToPlugin(row);
}
