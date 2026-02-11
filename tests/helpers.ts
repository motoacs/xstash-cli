import { DatabaseSync } from 'node:sqlite';
import { migrateSchema } from '../src/db/schema.ts';

export function createInMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  migrateSchema(db);
  return db;
}
