import { DatabaseSync } from 'node:sqlite';

export function bookmarkExists(db: DatabaseSync, postId: string): boolean {
  const row = db.prepare('SELECT 1 FROM bookmarks WHERE post_id=?').get(postId);
  return Boolean(row);
}

export function hasAnyBookmarks(db: DatabaseSync): boolean {
  const row = db.prepare('SELECT 1 FROM bookmarks LIMIT 1').get();
  return Boolean(row);
}

export type BookmarkObserveResult = 'existing' | 'new';

export function observeBookmark(
  db: DatabaseSync,
  postId: string,
  observedAt: string,
): BookmarkObserveResult {
  if (bookmarkExists(db, postId)) {
    db.prepare('UPDATE bookmarks SET last_synced_at=? WHERE post_id=?').run(observedAt, postId);
    return 'existing';
  }

  db
    .prepare(
      'INSERT INTO bookmarks (post_id, discovered_at, last_synced_at) VALUES (?, ?, ?)',
    )
    .run(postId, observedAt, observedAt);
  return 'new';
}
