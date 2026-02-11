import { DatabaseSync } from 'node:sqlite';

export interface ExportQueryOptions {
  since?: string;
  until?: string;
  includeReferenced: boolean;
}

export interface ExportMediaItem {
  media_key: string;
  type: string;
  url: string | null;
  local_path: string | null;
  alt_text: string | null;
}

export interface ExportReferenceItem {
  type: 'quoted' | 'replied_to' | 'retweeted';
  depth: number;
  post_id: string;
}

export interface ExportItem {
  post: {
    id: string;
    created_at: string;
    text: string;
    full_text: string | null;
    lang: string | null;
    possibly_sensitive: boolean;
    metrics: {
      like_count: number;
      retweet_count: number;
      reply_count: number;
      quote_count: number;
    };
    url: string;
  };
  author: {
    id: string | null;
    username: string | null;
    name: string | null;
    verified: boolean;
    verified_type: string | null;
    profile_image_url: string | null;
  };
  bookmark: {
    bookmarked_at: null;
    bookmarked_at_source: 'not_provided_by_x_api';
    discovered_at: string | null;
    last_synced_at: string | null;
  };
  media: ExportMediaItem[];
  references: ExportReferenceItem[];
  raw: {
    post: unknown;
    author: unknown;
    media: unknown[];
  };
}

export interface ExportDataset {
  schema_version: '1.1.0';
  exported_at: string;
  filters: {
    since: string | null;
    until: string | null;
    include_referenced: boolean;
  };
  counts: {
    posts: number;
    bookmarks: number;
    referenced_posts: number;
    media: number;
  };
  items: ExportItem[];
}

interface BasePostRow {
  id: string;
  author_id: string | null;
  created_at: string;
  text: string;
  full_text: string | null;
  lang: string | null;
  possibly_sensitive: number;
  like_count: number;
  retweet_count: number;
  reply_count: number;
  quote_count: number;
  raw_json: string;
  discovered_at: string | null;
  last_synced_at: string | null;
  user_name: string | null;
  user_username: string | null;
  profile_image_url: string | null;
  user_verified: number | null;
  user_verified_type: string | null;
  user_raw_json: string | null;
}

function normalizeDateBoundary(value: string, end: boolean): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T${end ? '23:59:59' : '00:00:00'}Z`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date.toISOString();
}

function buildBookmarkFilter(options: ExportQueryOptions): { sql: string; params: string[] } {
  const conditions: string[] = [];
  const params: string[] = [];

  if (options.since) {
    conditions.push('b.discovered_at >= ?');
    params.push(normalizeDateBoundary(options.since, false));
  }

  if (options.until) {
    conditions.push('b.discovered_at <= ?');
    params.push(normalizeDateBoundary(options.until, true));
  }

  if (!conditions.length) {
    return { sql: '', params };
  }

  return { sql: `WHERE ${conditions.join(' AND ')}`, params };
}

function mapRowToItem(db: DatabaseSync, row: BasePostRow): ExportItem {
  const mediaRows = db.prepare(`
    SELECT m.media_key, m.type, m.url, m.local_path, m.alt_text, m.raw_json
    FROM post_media pm
    JOIN media m ON m.media_key = pm.media_key
    WHERE pm.post_id = ?
  `).all(row.id) as Array<{
    media_key: string;
    type: string;
    url: string | null;
    local_path: string | null;
    alt_text: string | null;
    raw_json: string;
  }>;

  const references = db.prepare(`
    SELECT reference_type, depth, referenced_post_id
    FROM post_references
    WHERE post_id = ?
    ORDER BY depth ASC, referenced_post_id ASC
  `).all(row.id) as Array<{
    reference_type: 'quoted' | 'replied_to' | 'retweeted';
    depth: number;
    referenced_post_id: string;
  }>;

  const username = row.user_username ?? 'unknown';
  return {
    post: {
      id: row.id,
      created_at: row.created_at,
      text: row.text,
      full_text: row.full_text,
      lang: row.lang,
      possibly_sensitive: row.possibly_sensitive === 1,
      metrics: {
        like_count: row.like_count,
        retweet_count: row.retweet_count,
        reply_count: row.reply_count,
        quote_count: row.quote_count,
      },
      url: `https://x.com/${username}/status/${row.id}`,
    },
    author: {
      id: row.author_id,
      username: row.user_username,
      name: row.user_name,
      verified: row.user_verified === 1,
      verified_type: row.user_verified_type,
      profile_image_url: row.profile_image_url,
    },
    bookmark: {
      bookmarked_at: null,
      bookmarked_at_source: 'not_provided_by_x_api',
      discovered_at: row.discovered_at,
      last_synced_at: row.last_synced_at,
    },
    media: mediaRows.map((entry) => ({
      media_key: entry.media_key,
      type: entry.type,
      url: entry.url,
      local_path: entry.local_path,
      alt_text: entry.alt_text,
    })),
    references: references.map((entry) => ({
      type: entry.reference_type,
      depth: entry.depth,
      post_id: entry.referenced_post_id,
    })),
    raw: {
      post: JSON.parse(row.raw_json),
      author: row.user_raw_json ? JSON.parse(row.user_raw_json) : null,
      media: mediaRows.map((entry) => JSON.parse(entry.raw_json)),
    },
  };
}

function loadBookmarkedRows(db: DatabaseSync, options: ExportQueryOptions): BasePostRow[] {
  const filter = buildBookmarkFilter(options);
  const query = `
    SELECT
      p.id,
      p.author_id,
      p.created_at,
      p.text,
      p.full_text,
      p.lang,
      p.possibly_sensitive,
      p.like_count,
      p.retweet_count,
      p.reply_count,
      p.quote_count,
      p.raw_json,
      b.discovered_at,
      b.last_synced_at,
      u.name AS user_name,
      u.username AS user_username,
      u.profile_image_url,
      u.verified AS user_verified,
      u.verified_type AS user_verified_type,
      u.raw_json AS user_raw_json
    FROM bookmarks b
    JOIN posts p ON p.id = b.post_id
    LEFT JOIN users u ON u.id = p.author_id
    ${filter.sql}
    ORDER BY b.last_synced_at DESC, p.id DESC
  `;

  return db.prepare(query).all(...filter.params) as unknown as BasePostRow[];
}

function loadReferencedRows(db: DatabaseSync, bookmarkIds: string[]): BasePostRow[] {
  if (!bookmarkIds.length) {
    return [];
  }

  const placeholders = bookmarkIds.map(() => '?').join(',');
  const query = `
    WITH RECURSIVE ref_tree(post_id, referenced_post_id, level) AS (
      SELECT r.post_id, r.referenced_post_id, 1
      FROM post_references r
      WHERE r.post_id IN (${placeholders})
      UNION ALL
      SELECT r.post_id, r.referenced_post_id, ref_tree.level + 1
      FROM post_references r
      JOIN ref_tree ON r.post_id = ref_tree.referenced_post_id
      WHERE ref_tree.level < 3
    )
    SELECT DISTINCT
      p.id,
      p.author_id,
      p.created_at,
      p.text,
      p.full_text,
      p.lang,
      p.possibly_sensitive,
      p.like_count,
      p.retweet_count,
      p.reply_count,
      p.quote_count,
      p.raw_json,
      NULL AS discovered_at,
      NULL AS last_synced_at,
      u.name AS user_name,
      u.username AS user_username,
      u.profile_image_url,
      u.verified AS user_verified,
      u.verified_type AS user_verified_type,
      u.raw_json AS user_raw_json
    FROM ref_tree t
    JOIN posts p ON p.id = t.referenced_post_id
    LEFT JOIN users u ON u.id = p.author_id
    LEFT JOIN bookmarks b ON b.post_id = p.id
    WHERE b.post_id IS NULL
    ORDER BY p.created_at DESC, p.id DESC
  `;

  return db.prepare(query).all(...bookmarkIds) as unknown as BasePostRow[];
}

export function buildExportDataset(db: DatabaseSync, options: ExportQueryOptions): ExportDataset {
  const bookmarkedRows = loadBookmarkedRows(db, options);
  const referencedRows = options.includeReferenced
    ? loadReferencedRows(db, bookmarkedRows.map((row) => row.id))
    : [];
  const allRows = [...bookmarkedRows, ...referencedRows];

  const items = allRows.map((row) => mapRowToItem(db, row));
  const mediaSet = new Set<string>();
  for (const item of items) {
    for (const media of item.media) {
      mediaSet.add(media.media_key);
    }
  }

  return {
    schema_version: '1.1.0',
    exported_at: new Date().toISOString(),
    filters: {
      since: options.since ? normalizeDateBoundary(options.since, false) : null,
      until: options.until ? normalizeDateBoundary(options.until, true) : null,
      include_referenced: options.includeReferenced,
    },
    counts: {
      posts: items.length,
      bookmarks: bookmarkedRows.length,
      referenced_posts: referencedRows.length,
      media: mediaSet.size,
    },
    items,
  };
}
