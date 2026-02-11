import { assertEquals, assertStringIncludes } from '@std/assert';
import { waitForAuthCode } from '../src/commands/config.ts';

function getFreeLocalPort(): number {
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const address = listener.addr as Deno.NetAddr;
  listener.close();
  return address.port;
}

Deno.test('waitForAuthCode continues after invalid callback and resolves on first valid callback', async () => {
  const port = getFreeLocalPort();
  const exchangedCodes: string[] = [];

  const waiter = waitForAuthCode({
    port,
    expectedState: 'expected-state',
    timeoutMs: 5_000,
    exchangeCode: (code) => {
      exchangedCodes.push(code);
      return Promise.resolve();
    },
  });

  const invalid = await fetch(
    `http://127.0.0.1:${port}/callback?code=invalid&state=unexpected-state`,
  );
  assertEquals(invalid.status, 400);
  assertStringIncludes(await invalid.text(), 'Authorization failed');

  const valid = await fetch(
    `http://127.0.0.1:${port}/callback?code=valid-code&state=expected-state`,
  );
  assertEquals(valid.status, 200);
  assertStringIncludes(await valid.text(), 'Authorization success');

  await waiter;
  assertEquals(exchangedCodes, ['valid-code']);
});

Deno.test('waitForAuthCode returns failure html and rejects when token exchange fails', async () => {
  const port = getFreeLocalPort();

  const waiter = waitForAuthCode({
    port,
    expectedState: 'expected-state',
    timeoutMs: 5_000,
    exchangeCode: () => Promise.reject(new Error('token exchange failed')),
  });
  const handled = waiter
    .then(() => null)
    .catch((error) => error);

  const response = await fetch(
    `http://127.0.0.1:${port}/callback?code=valid-code&state=expected-state`,
  );
  assertEquals(response.status, 500);
  assertStringIncludes(await response.text(), 'Authorization failed');

  const error = await handled;
  if (!(error instanceof Error)) {
    throw new Error('Expected waitForAuthCode to fail');
  }
  assertStringIncludes(error.message, 'token exchange failed');
});
