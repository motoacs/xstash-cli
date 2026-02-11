import { dirname } from '@std/path';
import { ensureDir } from '@std/fs/ensure-dir';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  return db;
}

export async function ensureDatabaseParent(path: string): Promise<void> {
  await ensureDir(dirname(path));
}

export function withTransaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
