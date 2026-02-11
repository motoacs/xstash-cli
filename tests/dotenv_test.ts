import { assertEquals } from '@std/assert';
import { loadDotEnvFromFile } from '../src/utils/dotenv.ts';

Deno.test('.env loader sets values from file and preserves existing env', async () => {
  const dir = await Deno.makeTempDir();
  const envPath = `${dir}/.env`;
  await Deno.writeTextFile(
    envPath,
    [
      '# comment',
      'XSTASH_CLIENT_ID=from_file',
      'export XSTASH_CLIENT_SECRET="quoted-secret"',
      "XSTASH_ACCESS_TOKEN='single quoted token'",
      'XSTASH_REFRESH_TOKEN=token-with-comment # inline comment',
      'XSTASH_TOKEN_EXPIRES_AT=2026-02-11T10:00:00Z',
      'INVALID LINE',
    ].join('\n'),
  );

  const original = {
    clientId: Deno.env.get('XSTASH_CLIENT_ID'),
    clientSecret: Deno.env.get('XSTASH_CLIENT_SECRET'),
    accessToken: Deno.env.get('XSTASH_ACCESS_TOKEN'),
    refreshToken: Deno.env.get('XSTASH_REFRESH_TOKEN'),
    expiresAt: Deno.env.get('XSTASH_TOKEN_EXPIRES_AT'),
  };

  Deno.env.set('XSTASH_CLIENT_ID', 'already_set');

  try {
    await loadDotEnvFromFile(envPath);

    assertEquals(Deno.env.get('XSTASH_CLIENT_ID'), 'already_set');
    assertEquals(Deno.env.get('XSTASH_CLIENT_SECRET'), 'quoted-secret');
    assertEquals(Deno.env.get('XSTASH_ACCESS_TOKEN'), 'single quoted token');
    assertEquals(Deno.env.get('XSTASH_REFRESH_TOKEN'), 'token-with-comment');
    assertEquals(Deno.env.get('XSTASH_TOKEN_EXPIRES_AT'), '2026-02-11T10:00:00Z');
  } finally {
    if (original.clientId === undefined) Deno.env.delete('XSTASH_CLIENT_ID');
    else Deno.env.set('XSTASH_CLIENT_ID', original.clientId);

    if (original.clientSecret === undefined) Deno.env.delete('XSTASH_CLIENT_SECRET');
    else Deno.env.set('XSTASH_CLIENT_SECRET', original.clientSecret);

    if (original.accessToken === undefined) Deno.env.delete('XSTASH_ACCESS_TOKEN');
    else Deno.env.set('XSTASH_ACCESS_TOKEN', original.accessToken);

    if (original.refreshToken === undefined) Deno.env.delete('XSTASH_REFRESH_TOKEN');
    else Deno.env.set('XSTASH_REFRESH_TOKEN', original.refreshToken);

    if (original.expiresAt === undefined) Deno.env.delete('XSTASH_TOKEN_EXPIRES_AT');
    else Deno.env.set('XSTASH_TOKEN_EXPIRES_AT', original.expiresAt);

    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('.env loader ignores missing file', async () => {
  const original = Deno.env.get('XSTASH_CLIENT_ID');
  try {
    await loadDotEnvFromFile('/tmp/xstash-cli-missing-dotenv-file');
    assertEquals(Deno.env.get('XSTASH_CLIENT_ID'), original);
  } finally {
    if (original === undefined) Deno.env.delete('XSTASH_CLIENT_ID');
    else Deno.env.set('XSTASH_CLIENT_ID', original);
  }
});
