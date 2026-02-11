import { assertEquals } from '@std/assert';
import { fetchWithRetry, runWithRetry } from '../src/utils/retry.ts';

Deno.test('runWithRetry retries transient errors then succeeds', async () => {
  let attempts = 0;
  const result = await runWithRetry(
    () => {
      attempts += 1;
      if (attempts < 3) {
        throw new TypeError('temporary network');
      }
      return Promise.resolve('ok');
    },
    (error) => error instanceof TypeError,
    {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 2,
      jitterMs: 0,
    },
  );

  assertEquals(result, 'ok');
  assertEquals(attempts, 3);
});

Deno.test('fetchWithRetry retries 5xx responses', async () => {
  let attempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    attempts += 1;
    if (attempts < 3) {
      return Promise.resolve(new Response('server error', { status: 500 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;

  try {
    const response = await fetchWithRetry(
      'https://example.com',
      { method: 'GET' },
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitterMs: 0 },
    );
    assertEquals(response.status, 200);
    assertEquals(attempts, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
