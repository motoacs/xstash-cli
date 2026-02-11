export interface XPublicMetrics {
  like_count?: number;
  retweet_count?: number;
  reply_count?: number;
  quote_count?: number;
}

export interface XPostReference {
  type: 'quoted' | 'replied_to' | 'retweeted';
  id: string;
}

export interface XPostEntity {
  id: string;
  author_id?: string;
  text?: string;
  created_at?: string;
  conversation_id?: string;
  lang?: string;
  possibly_sensitive?: boolean;
  public_metrics?: XPublicMetrics;
  referenced_tweets?: XPostReference[];
  attachments?: {
    media_keys?: string[];
  };
  [key: string]: unknown;
}

export interface XUserEntity {
  id: string;
  name?: string;
  username?: string;
  profile_image_url?: string;
  verified?: boolean;
  verified_type?: string;
  [key: string]: unknown;
}

export interface XMediaVariant {
  content_type?: string;
  bit_rate?: number;
  url?: string;
}

export interface XMediaEntity {
  media_key: string;
  type: string;
  url?: string;
  preview_image_url?: string;
  alt_text?: string;
  width?: number;
  height?: number;
  duration_ms?: number;
  variants?: XMediaVariant[];
  [key: string]: unknown;
}

export interface XIncludes {
  users?: XUserEntity[];
  tweets?: XPostEntity[];
  media?: XMediaEntity[];
}

export interface XBookmarksResponse {
  data?: XPostEntity[];
  includes?: XIncludes;
  meta?: {
    next_token?: string;
    result_count?: number;
  };
}

export interface XTweetsLookupResponse {
  data?: XPostEntity[];
  includes?: XIncludes;
}
