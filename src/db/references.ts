import { DatabaseSync } from 'node:sqlite';
import type { XPostEntity } from '../types/x.ts';

export interface ReferenceRow {
  postId: string;
  referencedPostId: string;
  referenceType: 'quoted' | 'replied_to' | 'retweeted';
  depth: number;
}

export function extractReferences(post: XPostEntity, depth: number): ReferenceRow[] {
  if (!post.referenced_tweets?.length) {
    return [];
  }
  return post.referenced_tweets.map((ref) => ({
    postId: post.id,
    referencedPostId: ref.id,
    referenceType: ref.type,
    depth,
  }));
}

export function upsertReferences(db: DatabaseSync, references: ReferenceRow[]): void {
  if (!references.length) {
    return;
  }
  const existsStmt = db.prepare('SELECT 1 FROM posts WHERE id=?');
  const stmt = db.prepare(`
    INSERT INTO post_references (post_id, referenced_post_id, reference_type, depth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(post_id, referenced_post_id, reference_type) DO UPDATE SET
      depth=MIN(post_references.depth, excluded.depth)
  `);

  for (const ref of references) {
    if (!existsStmt.get(ref.postId) || !existsStmt.get(ref.referencedPostId)) {
      continue;
    }
    stmt.run(ref.postId, ref.referencedPostId, ref.referenceType, ref.depth);
  }
}

export function getMissingQuotedReferenceIds(db: DatabaseSync, fromPostIds: string[]): string[] {
  if (!fromPostIds.length) {
    return [];
  }

  const placeholders = fromPostIds.map(() => '?').join(',');
  const query = `
    SELECT DISTINCT r.referenced_post_id AS id
    FROM post_references r
    LEFT JOIN posts p ON p.id = r.referenced_post_id
    WHERE r.reference_type='quoted'
      AND r.post_id IN (${placeholders})
      AND p.id IS NULL
  `;

  const rows = db.prepare(query).all(...fromPostIds) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}
