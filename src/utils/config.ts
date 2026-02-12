import { dirname } from '@std/path';
import { ensureDir } from '@std/fs/ensure-dir';
import type { AppConfig, AuthOverride, OAuthConfig } from '../types/config.ts';

const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  oauth: {
    scopes: ['bookmark.read', 'tweet.read', 'users.read', 'offline.access'],
  },
  sync: {
    default_initial_max_new: 200,
    default_incremental_max_new: 'all',
    quote_resolve_max_depth: 3,
    known_boundary_threshold: 5,
    incremental_bookmarks_page_size: null,
  },
  cost: {
    unit_price_post_read_usd: 0.005,
    unit_price_user_read_usd: 0.01,
  },
};

export function defaultConfig(): AppConfig {
  return structuredClone(DEFAULT_CONFIG);
}

export async function readConfigFile(path: string): Promise<AppConfig> {
  try {
    const text = await Deno.readTextFile(path);
    const parsed = JSON.parse(text) as Partial<AppConfig>;
    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return defaultConfig();
    }
    throw error;
  }
}

export async function writeConfigFile(path: string, config: AppConfig): Promise<void> {
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, JSON.stringify(config, null, 2) + '\n');
  if (Deno.build.os !== 'windows') {
    await Deno.chmod(path, 0o600);
  }
}

export function maskSecret(value?: string): string {
  if (!value) {
    return '(unset)';
  }
  if (value.length <= 8) {
    return '*'.repeat(value.length);
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function applyAuthOverride(config: AppConfig, override: AuthOverride): AppConfig {
  const next = structuredClone(config);
  next.oauth.client_id = override.clientId ?? next.oauth.client_id;
  next.oauth.client_secret = override.clientSecret ?? next.oauth.client_secret;
  next.oauth.access_token = override.accessToken ?? next.oauth.access_token;
  next.oauth.refresh_token = override.refreshToken ?? next.oauth.refresh_token;
  next.oauth.expires_at = override.expiresAt ?? next.oauth.expires_at;
  return next;
}

export function envAuthOverride(): AuthOverride {
  return {
    clientId: Deno.env.get('XSTASH_CLIENT_ID') ?? undefined,
    clientSecret: Deno.env.get('XSTASH_CLIENT_SECRET') ?? undefined,
    accessToken: Deno.env.get('XSTASH_ACCESS_TOKEN') ?? undefined,
    refreshToken: Deno.env.get('XSTASH_REFRESH_TOKEN') ?? undefined,
    expiresAt: Deno.env.get('XSTASH_TOKEN_EXPIRES_AT') ?? undefined,
  };
}

export function mergeOAuth(
  fileOAuth: OAuthConfig,
  envOverride: AuthOverride,
  cliOverride: AuthOverride,
): OAuthConfig {
  return {
    scopes: fileOAuth.scopes?.length
      ? [...fileOAuth.scopes]
      : ['bookmark.read', 'tweet.read', 'users.read', 'offline.access'],
    client_id: cliOverride.clientId ?? envOverride.clientId ?? fileOAuth.client_id,
    client_secret: cliOverride.clientSecret ?? envOverride.clientSecret ?? fileOAuth.client_secret,
    access_token: cliOverride.accessToken ?? envOverride.accessToken ?? fileOAuth.access_token,
    refresh_token: cliOverride.refreshToken ?? envOverride.refreshToken ?? fileOAuth.refresh_token,
    expires_at: cliOverride.expiresAt ?? envOverride.expiresAt ?? fileOAuth.expires_at,
  };
}

function mergeConfig(base: AppConfig, override?: Partial<AppConfig>): AppConfig {
  if (!override) {
    return structuredClone(base);
  }
  const incrementalBookmarksPageSize = override.sync?.incremental_bookmarks_page_size !==
      undefined
    ? override.sync.incremental_bookmarks_page_size
    : base.sync.incremental_bookmarks_page_size;
  return {
    version: override.version ?? base.version,
    oauth: {
      scopes: override.oauth?.scopes ?? base.oauth.scopes,
      client_id: override.oauth?.client_id ?? base.oauth.client_id,
      client_secret: override.oauth?.client_secret ?? base.oauth.client_secret,
      access_token: override.oauth?.access_token ?? base.oauth.access_token,
      refresh_token: override.oauth?.refresh_token ?? base.oauth.refresh_token,
      expires_at: override.oauth?.expires_at ?? base.oauth.expires_at,
    },
    sync: {
      default_initial_max_new: override.sync?.default_initial_max_new ??
        base.sync.default_initial_max_new,
      default_incremental_max_new: override.sync?.default_incremental_max_new ??
        base.sync.default_incremental_max_new,
      quote_resolve_max_depth: override.sync?.quote_resolve_max_depth ??
        base.sync.quote_resolve_max_depth,
      known_boundary_threshold: override.sync?.known_boundary_threshold ??
        base.sync.known_boundary_threshold,
      incremental_bookmarks_page_size: incrementalBookmarksPageSize,
    },
    cost: {
      unit_price_post_read_usd: override.cost?.unit_price_post_read_usd ??
        base.cost.unit_price_post_read_usd,
      unit_price_user_read_usd: override.cost?.unit_price_user_read_usd ??
        base.cost.unit_price_user_read_usd,
    },
  };
}
