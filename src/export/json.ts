import { DatabaseSync } from 'node:sqlite';
import { buildExportDataset, type ExportQueryOptions } from './dataset.ts';

function hasLocalFile(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

export function exportAsJson(db: DatabaseSync, options: ExportQueryOptions): string {
  const dataset = buildExportDataset(db, options);
  for (const item of dataset.items) {
    for (const media of item.media) {
      if (!media.local_path) {
        continue;
      }
      if (!hasLocalFile(media.local_path)) {
        media.local_path = null;
      }
    }
  }
  return JSON.stringify(dataset, null, 2) + '\n';
}
