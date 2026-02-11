import { dirname } from '@std/path';
import { ensureDir } from '@std/fs/ensure-dir';
import { extFromContentType as resolveExtFromContentType } from '../db/media.ts';
import type { OAuthConfig } from '../types/config.ts';
import type { XBookmarksResponse, XTweetsLookupResponse } from '../types/x.ts';
import { fetchWithRetry } from '../utils/retry.ts';
import { applyTokenResponse, refreshToken } from './auth.ts';

export interface XApiClientOptions {
  oauth: OAuthConfig;
  onTokenUpdated?: (oauth: OAuthConfig) => Promise<void> | void;
}

function tokenExpired(expiresAt?: string): boolean {
  if (!expiresAt) {
    return false;
  }
  const time = Date.parse(expiresAt);
  if (!Number.isFinite(time)) {
    return false;
  }
  return time <= Date.now() + 30_000;
}

export class XApiClient {
  private oauth: OAuthConfig;
  private onTokenUpdated?: (oauth: OAuthConfig) => Promise<void> | void;

  constructor(options: XApiClientOptions) {
    this.oauth = { ...options.oauth };
    this.onTokenUpdated = options.onTokenUpdated;
  }

  getOAuth(): OAuthConfig {
    return { ...this.oauth };
  }

  async getMe(): Promise<{ data: { id: string; username?: string; name?: string } }> {
    return await this.requestJson('/2/users/me');
  }

  async getBookmarksPage(
    userId: string,
    paginationToken?: string,
    maxResults = 100,
  ): Promise<XBookmarksResponse> {
    const url = new URL(`https://api.x.com/2/users/${userId}/bookmarks`);
    url.searchParams.set('max_results', String(Math.max(5, Math.min(100, maxResults))));
    if (paginationToken) {
      url.searchParams.set('pagination_token', paginationToken);
    }
    url.searchParams.set(
      'tweet.fields',
      [
        'id',
        'author_id',
        'conversation_id',
        'created_at',
        'lang',
        'possibly_sensitive',
        'public_metrics',
        'referenced_tweets',
        'attachments',
        'note_tweet',
      ].join(','),
    );
    url.searchParams.set(
      'user.fields',
      ['id', 'name', 'username', 'profile_image_url', 'verified', 'verified_type'].join(','),
    );
    url.searchParams.set(
      'media.fields',
      [
        'media_key',
        'type',
        'url',
        'preview_image_url',
        'alt_text',
        'width',
        'height',
        'duration_ms',
        'variants',
      ].join(','),
    );
    url.searchParams.set('expansions', 'author_id,attachments.media_keys,referenced_tweets.id');
    return await this.requestJson(url.toString());
  }

  async lookupTweets(ids: string[]): Promise<XTweetsLookupResponse> {
    const unique = [...new Set(ids)].filter(Boolean);
    if (!unique.length) {
      return {};
    }
    const url = new URL('https://api.x.com/2/tweets');
    url.searchParams.set('ids', unique.join(','));
    url.searchParams.set(
      'tweet.fields',
      [
        'id',
        'author_id',
        'conversation_id',
        'created_at',
        'lang',
        'possibly_sensitive',
        'public_metrics',
        'referenced_tweets',
        'attachments',
        'note_tweet',
      ].join(','),
    );
    url.searchParams.set(
      'user.fields',
      ['id', 'name', 'username', 'profile_image_url', 'verified', 'verified_type'].join(','),
    );
    url.searchParams.set(
      'media.fields',
      [
        'media_key',
        'type',
        'url',
        'preview_image_url',
        'alt_text',
        'width',
        'height',
        'duration_ms',
        'variants',
      ].join(','),
    );
    url.searchParams.set('expansions', 'author_id,attachments.media_keys,referenced_tweets.id');
    return await this.requestJson(url.toString());
  }

  async downloadMedia(
    url: string,
    localPath: string,
  ): Promise<{ downloaded: boolean; actualPath: string }> {
    try {
      await Deno.stat(localPath);
      return { downloaded: false, actualPath: localPath };
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }

    await ensureDir(dirname(localPath));
    const headers = new Headers();
    if (this.oauth.access_token) {
      headers.set('authorization', `Bearer ${this.oauth.access_token}`);
    }
    const response = await fetchWithRetry(url, {
      headers,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Media download failed ${response.status}: ${body}`);
    }

    // Prefer Content-Type from the HTTP response for extension detection
    const contentType = response.headers.get('content-type');
    let actualPath = localPath;
    if (contentType) {
      const extFromCt = resolveExtFromContentType(contentType);
      if (extFromCt) {
        const currentExt = localPath.match(/\.([^.]+)$/)?.[1];
        if (currentExt && currentExt !== extFromCt) {
          actualPath = localPath.replace(/\.[^.]+$/, `.${extFromCt}`);
          await ensureDir(dirname(actualPath));
        }
      }
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    await Deno.writeFile(actualPath, bytes);
    return { downloaded: true, actualPath };
  }

  private async ensureTokenValid(): Promise<void> {
    if (!this.oauth.access_token) {
      throw new Error('Missing access_token; run xstash config init or set env vars');
    }
    if (!tokenExpired(this.oauth.expires_at)) {
      return;
    }
    await this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<void> {
    const refreshed = await refreshToken(this.oauth);
    this.oauth = applyTokenResponse(this.oauth, refreshed);
    if (this.onTokenUpdated) {
      await this.onTokenUpdated(this.oauth);
    }
  }

  private async requestJson<T>(pathOrUrl: string): Promise<T> {
    await this.ensureTokenValid();

    const makeRequest = async (): Promise<Response> => {
      const url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://api.x.com${pathOrUrl}`;
      return await fetchWithRetry(url, {
        headers: {
          authorization: `Bearer ${this.oauth.access_token}`,
        },
      });
    };

    let response = await makeRequest();
    if (response.status === 401 && this.oauth.refresh_token) {
      await this.refreshAccessToken();
      response = await makeRequest();
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`X API request failed (${response.status}) ${pathOrUrl}: ${body}`);
    }

    return await response.json() as T;
  }
}
