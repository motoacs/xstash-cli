import { encodeBase64Url } from '@std/encoding/base64url';
import type { OAuthConfig } from '../types/config.ts';
import { fetchWithRetry } from '../utils/retry.ts';

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

function randomString(size = 64): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return encodeBase64Url(bytes).replace(/=/g, '');
}

export async function createPkcePair(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = randomString(64);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const codeChallenge = encodeBase64Url(new Uint8Array(digest)).replace(/=/g, '');
  return { codeVerifier, codeChallenge };
}

export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  state: string;
}): string {
  const url = new URL('https://x.com/i/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scopes.join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeCodeForToken(params: {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    client_id: params.clientId,
  });

  if (params.clientSecret) {
    body.set('client_secret', params.clientSecret);
  }

  const response = await fetchWithRetry('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  return await response.json() as TokenResponse;
}

export async function refreshToken(oauth: OAuthConfig): Promise<TokenResponse> {
  if (!oauth.client_id || !oauth.refresh_token) {
    throw new Error('Missing client_id or refresh_token for token refresh');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: oauth.refresh_token,
    client_id: oauth.client_id,
  });

  if (oauth.client_secret) {
    body.set('client_secret', oauth.client_secret);
  }

  const response = await fetchWithRetry('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${text}`);
  }

  return await response.json() as TokenResponse;
}

export function applyTokenResponse(oauth: OAuthConfig, token: TokenResponse): OAuthConfig {
  const next: OAuthConfig = {
    ...oauth,
    access_token: token.access_token,
    refresh_token: token.refresh_token ?? oauth.refresh_token,
    scopes: token.scope ? token.scope.split(' ') : oauth.scopes,
  };

  if (token.expires_in) {
    next.expires_at = new Date(Date.now() + token.expires_in * 1000).toISOString();
  }

  return next;
}
