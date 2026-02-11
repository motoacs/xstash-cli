import { DatabaseSync } from 'node:sqlite';
import { buildExportDataset, type ExportQueryOptions } from './dataset.ts';

export function exportAsJson(db: DatabaseSync, options: ExportQueryOptions): string {
  const dataset = buildExportDataset(db, options);
  return JSON.stringify(dataset, null, 2) + '\n';
}
