import { assertEquals } from '@std/assert';
import { fetchBookmarkPages } from '../src/api/bookmarks.ts';

Deno.test('fetchBookmarkPages paginates until next_token exhausted', async () => {
  const pages = [
    { data: [{ id: '1' }], meta: { next_token: 'n1' } },
    { data: [{ id: '2' }], meta: { next_token: 'n2' } },
    { data: [{ id: '3' }], meta: {} },
  ];

  const calls: string[] = [];
  const client = {
    getBookmarksPage(_userId: string, token?: string, maxResults?: number) {
      calls.push(`${token ?? ''}:${maxResults ?? ''}`);
      return Promise.resolve(pages[calls.length - 1]);
    },
  };

  const seen: string[] = [];
  await fetchBookmarkPages(
    client,
    'u1',
    (page) => {
      seen.push(...(page.data ?? []).map((p) => p.id));
      return Promise.resolve(true);
    },
  );

  assertEquals(seen, ['1', '2', '3']);
  assertEquals(calls, [':', 'n1:', 'n2:']);
});

Deno.test('fetchBookmarkPages stops when callback returns false', async () => {
  const pages = [
    { data: [{ id: '1' }], meta: { next_token: 'n1' } },
    { data: [{ id: '2' }], meta: { next_token: 'n2' } },
  ];

  let index = 0;
  const client = {
    getBookmarksPage() {
      const page = pages[index];
      index += 1;
      return Promise.resolve(page);
    },
  };

  const seen: string[] = [];
  await fetchBookmarkPages(
    client,
    'u1',
    (page) => {
      seen.push(...(page.data ?? []).map((p) => p.id));
      return Promise.resolve(false);
    },
  );

  assertEquals(seen, ['1']);
});

Deno.test('fetchBookmarkPages forwards maxResults to client calls', async () => {
  const pages = [
    { data: [{ id: '1' }], meta: { next_token: 'n1' } },
    { data: [{ id: '2' }], meta: {} },
  ];
  let index = 0;
  const maxResultsSeen: Array<number | undefined> = [];
  const client = {
    getBookmarksPage(_userId: string, _token?: string, maxResults?: number) {
      maxResultsSeen.push(maxResults);
      const page = pages[index];
      index += 1;
      return Promise.resolve(page);
    },
  };

  await fetchBookmarkPages(
    client,
    'u1',
    () => Promise.resolve(true),
    { maxResults: 7 },
  );

  assertEquals(maxResultsSeen, [7, 7]);
});
