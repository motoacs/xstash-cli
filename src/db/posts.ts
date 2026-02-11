import { DatabaseSync } from 'node:sqlite';
import type { XPostEntity } from '../types/x.ts';

export function postExists(db: DatabaseSync, postId: string): boolean {
  const row = db.prepare('SELECT 1 FROM posts WHERE id=?').get(postId);
  return Boolean(row);
}

export function upsertPosts(db: DatabaseSync, posts: XPostEntity[], fetchedAt: string): number {
  if (!posts.length) {
    return 0;
  }

  const existsStmt = db.prepare('SELECT 1 FROM posts WHERE id=?');
  const stmt = db.prepare(`
    INSERT INTO posts (
      id,
      author_id,
      text,
      full_text,
      created_at,
      conversation_id,
      lang,
      possibly_sensitive,
      like_count,
      retweet_count,
      reply_count,
      quote_count,
      raw_json,
      fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      author_id=COALESCE(excluded.author_id, posts.author_id),
      text=excluded.text,
      full_text=COALESCE(excluded.full_text, posts.full_text),
      created_at=excluded.created_at,
      conversation_id=COALESCE(excluded.conversation_id, posts.conversation_id),
      lang=COALESCE(excluded.lang, posts.lang),
      possibly_sensitive=excluded.possibly_sensitive,
      like_count=excluded.like_count,
      retweet_count=excluded.retweet_count,
      reply_count=excluded.reply_count,
      quote_count=excluded.quote_count,
      raw_json=excluded.raw_json,
      fetched_at=excluded.fetched_at
  `);

  let inserted = 0;

  for (const post of posts) {
    const existed = Boolean(existsStmt.get(post.id));
    if (!existed) {
      inserted += 1;
    }

    const text = post.text ?? '';
    const fullText = typeof post.note_tweet === 'object' && post.note_tweet !== null
      ? (post.note_tweet as { text?: string }).text ?? null
      : null;
    stmt.run(
      post.id,
      post.author_id ?? null,
      text,
      fullText,
      post.created_at ?? new Date(0).toISOString(),
      post.conversation_id ?? null,
      post.lang ?? null,
      post.possibly_sensitive ? 1 : 0,
      post.public_metrics?.like_count ?? 0,
      post.public_metrics?.retweet_count ?? 0,
      post.public_metrics?.reply_count ?? 0,
      post.public_metrics?.quote_count ?? 0,
      JSON.stringify(post),
      fetchedAt,
    );
  }

  return inserted;
}

export function getPostsByIds(db: DatabaseSync, ids: string[]): XPostEntity[] {
  if (!ids.length) {
    return [];
  }
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT raw_json FROM posts WHERE id IN (${placeholders})`).all(
    ...ids,
  ) as Array<{ raw_json: string }>;
  return rows.map((row) => JSON.parse(row.raw_json) as XPostEntity);
}

export function existingPostIds(db: DatabaseSync, ids: string[]): Set<string> {
  if (!ids.length) {
    return new Set();
  }
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id FROM posts WHERE id IN (${placeholders})`).all(
    ...ids,
  ) as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}
