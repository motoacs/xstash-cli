import { dirname, join } from '@std/path';
import { ensureDir } from '@std/fs/ensure-dir';
import type { ConfigPaths } from '../types/config.ts';

function homeDir(): string {
  const home = Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE');
  if (!home) {
    throw new Error('Unable to resolve home directory');
  }
  return home;
}

export function resolveConfigPaths(): ConfigPaths {
  const os = Deno.build.os;

  if (os === 'windows') {
    const appData = Deno.env.get('APPDATA');
    const localAppData = Deno.env.get('LOCALAPPDATA');
    if (!appData || !localAppData) {
      throw new Error('APPDATA and LOCALAPPDATA are required on Windows');
    }
    const configPath = join(appData, 'xstash', 'config.json');
    const dataRoot = join(localAppData, 'xstash');
    return {
      configPath,
      dataRoot,
      dbPath: join(dataRoot, 'xstash.db'),
      mediaRoot: join(dataRoot, 'media'),
    };
  }

  if (os === 'darwin') {
    const base = join(homeDir(), 'Library', 'Application Support', 'xstash');
    return {
      configPath: join(base, 'config.json'),
      dataRoot: base,
      dbPath: join(base, 'xstash.db'),
      mediaRoot: join(base, 'media'),
    };
  }

  const xdgConfig = Deno.env.get('XDG_CONFIG_HOME') ?? join(homeDir(), '.config');
  const xdgData = Deno.env.get('XDG_DATA_HOME') ?? join(homeDir(), '.local', 'share');
  const configDir = join(xdgConfig, 'xstash');
  const dataRoot = join(xdgData, 'xstash');
  return {
    configPath: join(configDir, 'config.json'),
    dataRoot,
    dbPath: join(dataRoot, 'xstash.db'),
    mediaRoot: join(dataRoot, 'media'),
  };
}

export async function ensureAppDirs(paths: ConfigPaths): Promise<void> {
  await ensureDir(dirname(paths.configPath));
  await ensureDir(paths.dataRoot);
  await ensureDir(paths.mediaRoot);
}
