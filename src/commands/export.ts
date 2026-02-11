import { basename, dirname, extname, join } from '@std/path';
import { ensureDir } from '@std/fs/ensure-dir';
import { ensureDatabaseParent, openDatabase } from '../db/connection.ts';
import { migrateSchema } from '../db/schema.ts';
import { exportAsCsv } from '../export/csv.ts';
import { exportAsJson } from '../export/json.ts';
import { exportAsMarkdown } from '../export/markdown.ts';
import { resolveConfigPaths } from '../utils/paths.ts';

interface ExportCommandOptions {
  format: 'md' | 'csv' | 'json';
  since?: string;
  until?: string;
  includeReferenced: boolean;
  output?: string;
}

async function resolveOutputPath(
  output: string | undefined,
  format: 'md' | 'csv' | 'json',
): Promise<string | null> {
  if (!output) {
    return null;
  }

  try {
    const stat = await Deno.stat(output);
    if (stat.isDirectory) {
      const filename = format === 'md' ? 'bookmarks.md' : `bookmarks.${format}`;
      return join(output, filename);
    }
    return output;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }

    const last = basename(output);
    if (!extname(last)) {
      const filename = format === 'md' ? 'bookmarks.md' : `bookmarks.${format}`;
      return join(output, filename);
    }
    return output;
  }
}

export async function runExportCommand(options: ExportCommandOptions): Promise<void> {
  const paths = resolveConfigPaths();
  await ensureDatabaseParent(paths.dbPath);
  const db = openDatabase(paths.dbPath);
  migrateSchema(db);

  try {
    const payload = options.format === 'json'
      ? exportAsJson(db, {
        since: options.since,
        until: options.until,
        includeReferenced: options.includeReferenced,
      })
      : options.format === 'csv'
      ? exportAsCsv(db, {
        since: options.since,
        until: options.until,
        includeReferenced: options.includeReferenced,
      })
      : await exportAsMarkdown(db, {
        since: options.since,
        until: options.until,
        includeReferenced: options.includeReferenced,
      });

    const outPath = await resolveOutputPath(options.output, options.format);
    if (outPath) {
      await ensureDir(dirname(outPath));
      await Deno.writeTextFile(outPath, payload);
      console.log(outPath);
    } else {
      await Deno.stdout.write(new TextEncoder().encode(payload));
    }
  } finally {
    db.close();
  }
}

export type { ExportCommandOptions };
