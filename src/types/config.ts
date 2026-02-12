export type MaxNewSetting = number | 'all';

export interface OAuthConfig {
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
  scopes: string[];
}

export interface SyncConfig {
  default_initial_max_new: number;
  default_incremental_max_new: MaxNewSetting;
  quote_resolve_max_depth: number;
  known_boundary_threshold: number;
  incremental_bookmarks_page_size: number | null;
}

export interface CostConfig {
  unit_price_post_read_usd: number;
  unit_price_user_read_usd: number;
}

export interface AppConfig {
  version: number;
  oauth: OAuthConfig;
  sync: SyncConfig;
  cost: CostConfig;
}

export interface ConfigPaths {
  configPath: string;
  dataRoot: string;
  dbPath: string;
  mediaRoot: string;
}

export interface AuthOverride {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
}
