create table if not exists plugins (
  name text primary key,
  display_name text not null,
  description text not null,
  long_description text,
  author text not null,
  avatar_url text,
  category text not null,
  tags jsonb not null default '[]'::jsonb,
  capabilities jsonb not null default '[]'::jsonb,
  version text not null,
  release_tag text not null,
  repository_url text not null,
  normalized_repository_url text not null,
  verified_status text not null default 'reviewing',
  sync_status text not null default 'pending',
  sync_timestamp timestamptz,
  install_policy text not null default 'AVAILABLE',
  featured boolean not null default false,
  source jsonb,
  review jsonb,
  security_scan jsonb,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists submissions (
  id text primary key,
  slug text not null,
  owner text not null,
  repo text not null,
  repository_url text not null,
  normalized_repository_url text not null,
  note text not null default '',
  submitter text not null default 'unknown',
  status text not null default 'reviewing',
  issue_url text,
  plugin_name text,
  review jsonb,
  security_scan jsonb,
  source text not null default 'web',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists admin_actions (
  id bigserial primary key,
  action_type text not null,
  target_type text not null,
  target_id text,
  repository_url text,
  normalized_repository_url text,
  status text not null default 'queued',
  issue_url text,
  message text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sync_events (
  id bigserial primary key,
  event_type text not null,
  source text not null default 'server',
  status text not null default 'ok',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists plugins_normalized_repo_name_idx on plugins (normalized_repository_url, name);
create index if not exists plugins_status_sync_idx on plugins (status, sync_status, updated_at desc);
create index if not exists plugins_category_idx on plugins (category) where status = 'active';
create unique index if not exists submissions_active_repo_unique on submissions (normalized_repository_url) where status in ('reviewing', 'approved', 'manual_approving');
create index if not exists submissions_status_updated_idx on submissions (status, updated_at desc);
create index if not exists admin_actions_target_idx on admin_actions (target_type, target_id, created_at desc);
create index if not exists sync_events_created_idx on sync_events (created_at desc);
