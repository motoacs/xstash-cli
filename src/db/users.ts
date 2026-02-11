import { DatabaseSync } from 'node:sqlite';
import type { XUserEntity } from '../types/x.ts';

export function upsertUsers(db: DatabaseSync, users: XUserEntity[], fetchedAt: string): number {
  if (!users.length) {
    return 0;
  }

  const existsStmt = db.prepare('SELECT 1 FROM users WHERE id=?');
  const stmt = db.prepare(`
    INSERT INTO users (id, name, username, profile_image_url, verified, verified_type, raw_json, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=COALESCE(excluded.name, users.name),
      username=COALESCE(excluded.username, users.username),
      profile_image_url=COALESCE(excluded.profile_image_url, users.profile_image_url),
      verified=COALESCE(excluded.verified, users.verified),
      verified_type=COALESCE(excluded.verified_type, users.verified_type),
      raw_json=excluded.raw_json,
      fetched_at=excluded.fetched_at
  `);

  let inserted = 0;
  for (const user of users) {
    const existed = Boolean(existsStmt.get(user.id));
    if (!existed) {
      inserted += 1;
    }
    stmt.run(
      user.id,
      user.name ?? null,
      user.username ?? null,
      user.profile_image_url ?? null,
      user.verified != null ? (user.verified ? 1 : 0) : null,
      user.verified_type ?? null,
      JSON.stringify(user),
      fetchedAt,
    );
  }

  return inserted;
}
