import { DatabaseSync } from 'node:sqlite';
import { buildExportDataset, type ExportItem, type ExportQueryOptions } from './dataset.ts';

function linesForQuoted(rootItem: ExportItem, itemById: Map<string, ExportItem>): string[] {
  const lines: string[] = [];
  const visited = new Set<string>();

  const walk = (item: ExportItem, depth: number): void => {
    if (depth > 3) {
      return;
    }
    const quoted = item.references
      .filter((ref) => ref.type === 'quoted')
      .sort((a, b) => a.depth - b.depth || a.post_id.localeCompare(b.post_id));

    for (const ref of quoted) {
      const key = `${item.post.id}:${ref.post_id}:${depth}`;
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);

      const nested = itemById.get(ref.post_id);
      const prefix = Array.from({ length: depth }, () => '>').join(' ');
      if (!nested) {
        lines.push(`${prefix} [quoted: ${ref.post_id}]`);
        continue;
      }
      const author = nested.author.username ?? 'unknown';
      const text = nested.post.full_text ?? nested.post.text;
      lines.push(`${prefix} @${author}: ${text}`);
      walk(nested, depth + 1);
    }
  };

  walk(rootItem, 1);
  return lines;
}

async function markdownForItem(
  item: ExportItem,
  itemById: Map<string, ExportItem>,
): Promise<string> {
  const lines: string[] = [];
  const username = item.author.username ?? 'unknown';
  const body = item.post.full_text ?? item.post.text;

  lines.push(`## @${username} | ${item.post.created_at} | ${item.post.id.slice(0, 8)}`);
  lines.push('');
  lines.push(body);
  lines.push('');
  lines.push(`- URL: ${item.post.url}`);
  lines.push(`- created_at: ${item.post.created_at}`);
  lines.push(`- bookmark.discovered_at: ${item.bookmark.discovered_at ?? 'null'}`);

  const nestedQuoteLines = linesForQuoted(item, itemById);
  if (nestedQuoteLines.length) {
    lines.push('');
    lines.push(...nestedQuoteLines);
  }

  if (item.media.length) {
    lines.push('');
    for (const media of item.media) {
      const alt = media.alt_text ?? media.media_key;
      if (media.local_path) {
        try {
          const info = await Deno.stat(media.local_path);
          if (info.isFile) {
            lines.push(`![${alt}](${media.local_path})`);
            continue;
          }
        } catch {
          // Fall through to remote URL rendering.
        }
      }

      if (media.url) {
        lines.push(`![${alt}](${media.url})`);
      } else {
        lines.push(`[${alt}](missing: ${media.media_key})`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

export async function exportAsMarkdown(
  db: DatabaseSync,
  options: ExportQueryOptions,
): Promise<string> {
  const dataset = buildExportDataset(db, options);
  const itemById = new Map(dataset.items.map((item) => [item.post.id, item]));

  const chunks: string[] = [];
  for (const item of dataset.items) {
    chunks.push(await markdownForItem(item, itemById));
  }

  return chunks.join('\n');
}
