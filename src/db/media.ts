import { extname, join } from '@std/path';
import { DatabaseSync } from 'node:sqlite';
import type { XMediaEntity, XPostEntity } from '../types/x.ts';

export function extFromContentType(contentType?: string | null): string | null {
  if (!contentType) {
    return null;
  }
  if (contentType.includes('jpeg')) {
    return 'jpg';
  }
  if (contentType.includes('png')) {
    return 'png';
  }
  if (contentType.includes('gif')) {
    return 'gif';
  }
  if (contentType.includes('mp4')) {
    return 'mp4';
  }
  if (contentType.includes('webm')) {
    return 'webm';
  }
  return null;
}

function extFromUrl(url?: string): string | null {
  if (!url) {
    return null;
  }
  const ext = extname(new URL(url).pathname).replace('.', '').toLowerCase();
  return ext || null;
}

function chooseVideoVariant(media: XMediaEntity): { url?: string; contentType?: string } {
  if (!media.variants?.length) {
    return {};
  }

  const sorted = [...media.variants].sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0));
  const top = sorted[0];
  return {
    url: top?.url,
    contentType: top?.content_type,
  };
}

export function buildMediaLocalPath(mediaRoot: string, mediaKey: string, ext: string): string {
  return join(mediaRoot, mediaKey.slice(0, 2), `${mediaKey}.${ext}`);
}

export function resolveMediaStorageTarget(
  mediaRoot: string,
  media: XMediaEntity,
): { url: string | null; localPath: string } {
  const variant = chooseVideoVariant(media);
  const url = variant.url ?? media.url ?? media.preview_image_url ?? null;
  const ext = extFromContentType(variant.contentType) ?? extFromUrl(url ?? undefined) ?? 'bin';
  return {
    url,
    localPath: buildMediaLocalPath(mediaRoot, media.media_key, ext),
  };
}

export function upsertMedia(
  db: DatabaseSync,
  media: XMediaEntity[],
  fetchedAt: string,
  mediaRoot: string,
): number {
  if (!media.length) {
    return 0;
  }

  const existsStmt = db.prepare('SELECT 1 FROM media WHERE media_key=?');
  const stmt = db.prepare(`
    INSERT INTO media (
      media_key,
      type,
      url,
      preview_image_url,
      alt_text,
      width,
      height,
      duration_ms,
      variants_json,
      local_path,
      raw_json,
      fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(media_key) DO UPDATE SET
      type=excluded.type,
      url=COALESCE(excluded.url, media.url),
      preview_image_url=COALESCE(excluded.preview_image_url, media.preview_image_url),
      alt_text=COALESCE(excluded.alt_text, media.alt_text),
      width=COALESCE(excluded.width, media.width),
      height=COALESCE(excluded.height, media.height),
      duration_ms=COALESCE(excluded.duration_ms, media.duration_ms),
      variants_json=COALESCE(excluded.variants_json, media.variants_json),
      local_path=CASE
        WHEN excluded.local_path IS NULL THEN media.local_path
        WHEN media.local_path IS NULL THEN excluded.local_path
        WHEN excluded.local_path LIKE '%.bin' AND media.local_path NOT LIKE '%.bin'
          THEN media.local_path
        ELSE excluded.local_path
      END,
      raw_json=excluded.raw_json,
      fetched_at=excluded.fetched_at
  `);

  let inserted = 0;

  for (const item of media) {
    const existed = Boolean(existsStmt.get(item.media_key));
    if (!existed) {
      inserted += 1;
    }

    const target = resolveMediaStorageTarget(mediaRoot, item);

    stmt.run(
      item.media_key,
      item.type,
      target.url,
      item.preview_image_url ?? null,
      item.alt_text ?? null,
      item.width ?? null,
      item.height ?? null,
      item.duration_ms ?? null,
      item.variants ? JSON.stringify(item.variants) : null,
      target.localPath,
      JSON.stringify(item),
      fetchedAt,
    );
  }

  return inserted;
}

export function attachPostMedia(db: DatabaseSync, posts: XPostEntity[]): void {
  const stmt = db.prepare(`
    INSERT INTO post_media (post_id, media_key)
    VALUES (?, ?)
    ON CONFLICT(post_id, media_key) DO NOTHING
  `);

  for (const post of posts) {
    const keys = post.attachments?.media_keys ?? [];
    for (const mediaKey of keys) {
      stmt.run(post.id, mediaKey);
    }
  }
}
