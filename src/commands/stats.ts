import { ensureDatabaseParent, openDatabase } from '../db/connection.ts';
import { migrateSchema } from '../db/schema.ts';
import { resolveConfigPaths } from '../utils/paths.ts';

export async function runStatsCommand(): Promise<void> {
  const paths = resolveConfigPaths();
  await ensureDatabaseParent(paths.dbPath);
  const db = openDatabase(paths.dbPath);
  migrateSchema(db);

  try {
    const totals = db.prepare(`
      SELECT
        COUNT(*) AS bookmarks_count,
        MIN(discovered_at) AS first_discovered_at,
        MAX(discovered_at) AS last_discovered_at
      FROM bookmarks
    `).get() as {
      bookmarks_count: number;
      first_discovered_at: string | null;
      last_discovered_at: string | null;
    };

    const topAuthors = db.prepare(`
      SELECT
        COALESCE(u.username, '(unknown)') AS username,
        COUNT(*) AS count
      FROM bookmarks b
      JOIN posts p ON p.id = b.post_id
      LEFT JOIN users u ON u.id = p.author_id
      GROUP BY COALESCE(u.username, '(unknown)')
      ORDER BY count DESC, username ASC
      LIMIT 10
    `).all() as Array<{ username: string; count: number }>;

    const mediaBreakdown = db.prepare(`
      SELECT m.type, COUNT(*) AS count
      FROM post_media pm
      JOIN media m ON m.media_key = pm.media_key
      JOIN bookmarks b ON b.post_id = pm.post_id
      GROUP BY m.type
      ORDER BY count DESC, m.type ASC
    `).all() as Array<{ type: string; count: number }>;

    const cost = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN resource_type='post' THEN unit_price_usd END), 0.0) AS post_cost,
        COALESCE(SUM(CASE WHEN resource_type='user' THEN unit_price_usd END), 0.0) AS user_cost
      FROM api_billable_reads
    `).get() as { post_cost: number; user_cost: number };

    const rawReads = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN resource_type='post' THEN 1 ELSE 0 END), 0) AS post_reads,
        COALESCE(SUM(CASE WHEN resource_type='user' THEN 1 ELSE 0 END), 0) AS user_reads
      FROM api_requests
    `).get() as { post_reads: number; user_reads: number };

    console.log(`Bookmarks: ${totals.bookmarks_count}`);
    console.log(
      `Range: ${totals.first_discovered_at ?? 'n/a'} .. ${totals.last_discovered_at ?? 'n/a'}`,
    );
    console.log('Top authors:');
    for (const author of topAuthors) {
      console.log(`- @${author.username}: ${author.count}`);
    }

    console.log('Media breakdown:');
    for (const item of mediaBreakdown) {
      console.log(`- ${item.type}: ${item.count}`);
    }

    console.log('API usage (raw reads):');
    console.log(`- post: ${rawReads.post_reads}`);
    console.log(`- user: ${rawReads.user_reads}`);
    console.log('Estimated cost (billable dedupe):');
    console.log(`- post: ${cost.post_cost.toFixed(4)} USD`);
    console.log(`- user: ${cost.user_cost.toFixed(4)} USD`);
    console.log(`- total: ${(cost.post_cost + cost.user_cost).toFixed(4)} USD`);
  } finally {
    db.close();
  }
}
