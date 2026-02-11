import { DatabaseSync } from 'node:sqlite';

export const CURRENT_SCHEMA_VERSION = 1;

const BASE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT,
  username TEXT,
  profile_image_url TEXT,
  verified INTEGER DEFAULT 0,
  verified_type TEXT,
  raw_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  text TEXT NOT NULL DEFAULT '',
  full_text TEXT,
  created_at TEXT NOT NULL,
  conversation_id TEXT,
  lang TEXT,
  possibly_sensitive INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  retweet_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  quote_count INTEGER DEFAULT 0,
  raw_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
  post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  discovered_at TEXT NOT NULL,
  last_synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS post_references (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  referenced_post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reference_type TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (post_id, referenced_post_id, reference_type)
);

CREATE TABLE IF NOT EXISTS media (
  media_key TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  url TEXT,
  preview_image_url TEXT,
  alt_text TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  variants_json TEXT,
  local_path TEXT,
  raw_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS post_media (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_key TEXT NOT NULL REFERENCES media(media_key) ON DELETE CASCADE,
  PRIMARY KEY (post_id, media_key)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  mode TEXT NOT NULL,
  requested_max_new INTEGER,
  new_bookmarks_count INTEGER NOT NULL DEFAULT 0,
  new_referenced_posts_count INTEGER NOT NULL DEFAULT 0,
  new_media_count INTEGER NOT NULL DEFAULT 0,
  api_posts_read_count INTEGER NOT NULL DEFAULT 0,
  api_users_read_count INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  error_message TEXT,
  CHECK (requested_max_new IS NULL OR requested_max_new > 0)
);

CREATE TABLE IF NOT EXISTS api_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_run_id INTEGER NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  requested_at TEXT NOT NULL,
  billed_day_utc TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  unit_price_usd REAL NOT NULL
);

CREATE VIEW IF NOT EXISTS api_billable_reads AS
SELECT
  billed_day_utc,
  resource_type,
  resource_id,
  MIN(unit_price_usd) AS unit_price_usd,
  COUNT(*) AS request_count
FROM api_requests
GROUP BY billed_day_utc, resource_type, resource_id;

CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_bookmarks_last_synced_at ON bookmarks(last_synced_at);
CREATE INDEX IF NOT EXISTS idx_post_references_ref ON post_references(referenced_post_id);
CREATE INDEX IF NOT EXISTS idx_api_requests_run ON api_requests(sync_run_id);
CREATE INDEX IF NOT EXISTS idx_api_requests_billable_key ON api_requests(
  billed_day_utc,
  resource_type,
  resource_id
);
`;

export function migrateSchema(db: DatabaseSync): void {
  db.exec(BASE_SCHEMA_SQL);

  const current = getSchemaVersion(db);
  if (current === 0) {
    setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
    return;
  }

  if (current > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${current} is newer than app version ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  if (current < CURRENT_SCHEMA_VERSION) {
    for (let version = current + 1; version <= CURRENT_SCHEMA_VERSION; version += 1) {
      applyMigration(db, version);
      setSchemaVersion(db, version);
    }
  }
}

function applyMigration(db: DatabaseSync, version: number): void {
  switch (version) {
    case 1:
      db.exec(BASE_SCHEMA_SQL);
      break;
    default:
      throw new Error(`No migration for schema version ${version}`);
  }
}

function getSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as
    | { value: string }
    | undefined;
  if (!row) {
    return 0;
  }
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function setSchemaVersion(db: DatabaseSync, version: number): void {
  db
    .prepare(`
      INSERT INTO meta (key, value)
      VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `)
    .run(String(version));
}
