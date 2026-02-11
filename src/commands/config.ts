import {
  applyTokenResponse,
  buildAuthorizeUrl,
  createPkcePair,
  exchangeCodeForToken,
} from '../api/auth.ts';
import type { AppConfig, AuthOverride } from '../types/config.ts';
import {
  applyAuthOverride,
  envAuthOverride,
  maskSecret,
  mergeOAuth,
  readConfigFile,
  writeConfigFile,
} from '../utils/config.ts';
import { ensureAppDirs, resolveConfigPaths } from '../utils/paths.ts';

interface ConfigInitOptions {
  callbackPort: number;
  noBrowser: boolean;
  authOverride: AuthOverride;
}

async function openBrowser(url: string): Promise<void> {
  const os = Deno.build.os;
  const command = os === 'windows'
    ? new Deno.Command('cmd', { args: ['/c', 'start', '', url] })
    : os === 'darwin'
    ? new Deno.Command('open', { args: [url] })
    : new Deno.Command('xdg-open', { args: [url] });

  try {
    await command.spawn().status;
  } catch {
    // Browser launch is best-effort.
  }
}

function findAvailablePort(start: number): number {
  for (let port = start; port < start + 40; port += 1) {
    try {
      const listener = Deno.listen({ hostname: '127.0.0.1', port });
      listener.close();
      return port;
    } catch {
      // try next
    }
  }
  throw new Error(`No available callback port found near ${start}`);
}

export async function waitForAuthCode(
  params: {
    port: number;
    expectedState: string;
    timeoutMs: number;
    exchangeCode: (code: string) => Promise<void>;
  },
): Promise<void> {
  const controller = new AbortController();
  let settled = false;
  let completionError: Error | null = null;
  let resolveFn: (() => void) | null = null;

  const completion = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });

  const finish = (error?: Error): void => {
    if (settled) {
      return;
    }
    settled = true;
    completionError = error ?? null;
    if (resolveFn) {
      resolveFn();
    }
    // Let the callback response flush before stopping the local server.
    setTimeout(() => controller.abort(), 0);
  };

  const server = Deno.serve(
    { hostname: '127.0.0.1', port: params.port, signal: controller.signal },
    async (req) => {
      const url = new URL(req.url);
      if (url.pathname !== '/callback') {
        return new Response('<h1>Not Found</h1>', {
          status: 404,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || state !== params.expectedState) {
        return new Response('<h1>Authorization failed</h1>', {
          status: 400,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }

      if (settled) {
        return new Response('<h1>Authorization already handled</h1>', {
          status: 409,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }

      try {
        await params.exchangeCode(code);
        finish();
        return new Response('<h1>Authorization success. You can close this window.</h1>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
        return new Response('<h1>Authorization failed</h1>', {
          status: 500,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
    },
  );

  const timeout = setTimeout(() => {
    finish(new Error(`OAuth callback timeout (${params.timeoutMs}ms)`));
  }, params.timeoutMs);

  await completion;
  clearTimeout(timeout);
  await server.finished.catch(() => {});
  if (completionError) {
    throw completionError;
  }
}

function mergeConfigWithAuth(fileConfig: AppConfig, cliOverride: AuthOverride): AppConfig {
  const oauth = mergeOAuth(fileConfig.oauth, envAuthOverride(), cliOverride);
  return { ...fileConfig, oauth };
}

export async function runConfigInitCommand(options: ConfigInitOptions): Promise<void> {
  const paths = resolveConfigPaths();
  await ensureAppDirs(paths);

  let config = mergeConfigWithAuth(await readConfigFile(paths.configPath), options.authOverride);

  if (!config.oauth.client_id) {
    throw new Error('Missing client_id. Set XSTASH_CLIENT_ID or pass --client-id.');
  }

  const callbackPort = findAvailablePort(options.callbackPort);
  const redirectUri = `http://127.0.0.1:${callbackPort}/callback`;
  const { codeVerifier, codeChallenge } = await createPkcePair();
  const state = crypto.randomUUID();

  const authUrl = buildAuthorizeUrl({
    clientId: config.oauth.client_id,
    redirectUri,
    codeChallenge,
    scopes: config.oauth.scopes,
    state,
  });

  let token: Awaited<ReturnType<typeof exchangeCodeForToken>> | null = null;
  const callbackPromise = waitForAuthCode({
    port: callbackPort,
    expectedState: state,
    timeoutMs: 120_000,
    exchangeCode: async (code) => {
      token = await exchangeCodeForToken({
        clientId: config.oauth.client_id!,
        clientSecret: config.oauth.client_secret,
        redirectUri,
        code,
        codeVerifier,
      });
    },
  });

  if (!options.noBrowser) {
    await openBrowser(authUrl);
  } else {
    console.log(authUrl);
  }

  await callbackPromise;
  if (!token) {
    throw new Error('Token exchange did not complete');
  }

  config = applyAuthOverride(config, {
    clientId: config.oauth.client_id,
    clientSecret: config.oauth.client_secret,
  });
  config.oauth = applyTokenResponse(config.oauth, token);

  await writeConfigFile(paths.configPath, config);
  console.log('Config initialized.');

  if (Deno.build.os === 'windows') {
    console.error(
      'Warning: local terminal assumed; Windows ACL hardening is not enforced in initial release.',
    );
  }
}

export async function runConfigShowCommand(authOverride: AuthOverride): Promise<void> {
  const paths = resolveConfigPaths();
  const config = mergeConfigWithAuth(await readConfigFile(paths.configPath), authOverride);

  const masked = {
    ...config,
    oauth: {
      ...config.oauth,
      client_id: maskSecret(config.oauth.client_id),
      client_secret: maskSecret(config.oauth.client_secret),
      access_token: maskSecret(config.oauth.access_token),
      refresh_token: maskSecret(config.oauth.refresh_token),
      expires_at: config.oauth.expires_at ?? '(unset)',
    },
  };

  console.log(JSON.stringify(masked, null, 2));

  if (Deno.build.os === 'windows') {
    console.error(
      'Warning: local terminal assumed; Windows ACL hardening is not enforced in initial release.',
    );
  }
}

export function runConfigPathCommand(): void {
  const paths = resolveConfigPaths();
  console.log(paths.configPath);
}

export type { ConfigInitOptions };
