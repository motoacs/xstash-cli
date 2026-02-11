import { DatabaseSync } from 'node:sqlite';
import { buildExportDataset, type ExportQueryOptions } from './dataset.ts';

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value);
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportAsCsv(db: DatabaseSync, options: ExportQueryOptions): string {
  const dataset = buildExportDataset(db, options);
  const header = [
    'post_id',
    'author_username',
    'author_name',
    'created_at',
    'text',
    'url',
    'discovered_at',
    'last_synced_at',
    'bookmarked_at',
    'bookmarked_at_source',
    'media_count',
    'media_local_paths',
    'media_urls',
    'reference_count',
  ];

  const lines = [header.join(',')];

  for (const item of dataset.items) {
    const mediaLocalPaths = item.media
      .map((media) => media.local_path)
      .filter((path): path is string => Boolean(path))
      .join('|');
    const mediaUrls = item.media
      .map((media) => media.url)
      .filter((url): url is string => Boolean(url))
      .join('|');

    lines.push([
      escapeCsv(item.post.id),
      escapeCsv(item.author.username),
      escapeCsv(item.author.name),
      escapeCsv(item.post.created_at),
      escapeCsv(item.post.full_text ?? item.post.text),
      escapeCsv(item.post.url),
      escapeCsv(item.bookmark.discovered_at),
      escapeCsv(item.bookmark.last_synced_at),
      escapeCsv(item.bookmark.bookmarked_at),
      escapeCsv(item.bookmark.bookmarked_at_source),
      escapeCsv(item.media.length),
      escapeCsv(mediaLocalPaths),
      escapeCsv(mediaUrls),
      escapeCsv(item.references.length),
    ].join(','));
  }

  return `${lines.join('\n')}\n`;
}
