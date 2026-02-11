import { DatabaseSync } from 'node:sqlite';

export type SyncMode = 'initial' | 'incremental';

export interface SyncRunInit {
  startedAt: string;
  mode: SyncMode;
  requestedMaxNew: number | null;
}

export interface SyncRunCounters {
  newBookmarksCount: number;
  newReferencedPostsCount: number;
  newMediaCount: number;
  apiPostsReadCount: number;
  apiUsersReadCount: number;
}

export function createSyncRun(db: DatabaseSync, init: SyncRunInit): number {
  db
    .prepare(`
      INSERT INTO sync_runs (started_at, mode, requested_max_new)
      VALUES (?, ?, ?)
    `)
    .run(init.startedAt, init.mode, init.requestedMaxNew);

  const row = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
  return row.id;
}

export function updateSyncRunCounters(
  db: DatabaseSync,
  syncRunId: number,
  counters: SyncRunCounters,
): void {
  db
    .prepare(`
      UPDATE sync_runs
      SET new_bookmarks_count = ?,
          new_referenced_posts_count = ?,
          new_media_count = ?,
          api_posts_read_count = ?,
          api_users_read_count = ?
      WHERE id = ?
    `)
    .run(
      counters.newBookmarksCount,
      counters.newReferencedPostsCount,
      counters.newMediaCount,
      counters.apiPostsReadCount,
      counters.apiUsersReadCount,
      syncRunId,
    );
}

export function completeSyncRun(
  db: DatabaseSync,
  syncRunId: number,
  completedAt: string,
  estimatedCostUsd: number,
): void {
  db
    .prepare(`
      UPDATE sync_runs
      SET completed_at = ?,
          status = 'completed',
          estimated_cost_usd = ?
      WHERE id = ?
    `)
    .run(completedAt, estimatedCostUsd, syncRunId);
}

export function failSyncRun(
  db: DatabaseSync,
  syncRunId: number,
  completedAt: string,
  errorMessage: string,
  estimatedCostUsd: number,
): void {
  db
    .prepare(`
      UPDATE sync_runs
      SET completed_at = ?,
          status = 'failed',
          error_message = ?,
          estimated_cost_usd = ?
      WHERE id = ?
    `)
    .run(completedAt, errorMessage, estimatedCostUsd, syncRunId);
}
