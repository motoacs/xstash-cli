import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { exportAsJson } from '../src/export/json.ts';
import { exportAsMarkdown } from '../src/export/markdown.ts';
import { upsertPosts } from '../src/db/posts.ts';
import { observeBookmark } from '../src/db/bookmarks.ts';
import { upsertUsers } from '../src/db/users.ts';
import { upsertReferences } from '../src/db/references.ts';
import { attachPostMedia, upsertMedia } from '../src/db/media.ts';
import { createInMemoryDb } from './helpers.ts';

function seedBaseData(db: ReturnType<typeof createInMemoryDb>) {
  upsertUsers(
    db,
    [
      { id: 'u1', username: 'alice', name: 'Alice', verified: false },
      { id: 'u2', username: 'bob', name: 'Bob', verified: false },
    ],
    '2026-02-10T00:00:00Z',
  );

  upsertPosts(
    db,
    [
      {
        id: 'b1',
        author_id: 'u1',
        text: 'bookmark root',
        created_at: '2026-02-10T00:00:00Z',
        referenced_tweets: [{ type: 'quoted', id: 'q1' }],
        attachments: { media_keys: ['3_abc'] },
      },
      {
        id: 'q1',
        author_id: 'u2',
        text: 'quoted post',
        created_at: '2026-02-09T00:00:00Z',
        referenced_tweets: [{ type: 'quoted', id: 'q2' }],
      },
      {
        id: 'q2',
        author_id: 'u1',
        text: 'nested quoted',
        created_at: '2026-02-08T00:00:00Z',
      },
    ],
    '2026-02-10T00:00:00Z',
  );

  observeBookmark(db, 'b1', '2026-02-10T00:10:00Z');
  upsertReferences(db, [
    { postId: 'b1', referencedPostId: 'q1', referenceType: 'quoted', depth: 1 },
    { postId: 'q1', referencedPostId: 'q2', referenceType: 'quoted', depth: 2 },
  ]);
  upsertMedia(
    db,
    [
      {
        media_key: '3_abc',
        type: 'photo',
        url: 'https://example.com/a.jpg',
        alt_text: 'sample',
      },
    ],
    '2026-02-10T00:00:00Z',
    '/tmp/xstash-media',
  );
  attachPostMedia(db, [{ id: 'b1', attachments: { media_keys: ['3_abc'] } }]);
}

Deno.test('json export uses schema_version 1.1.0 and stable bookmark fields', () => {
  const db = createInMemoryDb();
  try {
    seedBaseData(db);
    const text = exportAsJson(db, { includeReferenced: false });
    const payload = JSON.parse(text);

    assertEquals(payload.schema_version, '1.1.0');
    assertEquals(payload.counts.bookmarks, 1);
    assertEquals(payload.items[0].bookmark.bookmarked_at, null);
    assertEquals(payload.items[0].bookmark.bookmarked_at_source, 'not_provided_by_x_api');
  } finally {
    db.close();
  }
});

Deno.test('json export filters by date and include_referenced flag', () => {
  const db = createInMemoryDb();
  try {
    seedBaseData(db);

    const withoutRef = JSON.parse(
      exportAsJson(db, {
        includeReferenced: false,
        since: '2026-02-10',
      }),
    );
    assertEquals(withoutRef.counts.posts, 1);
    assertEquals(withoutRef.counts.referenced_posts, 0);

    const withRef = JSON.parse(
      exportAsJson(db, {
        includeReferenced: true,
        since: '2026-02-10',
      }),
    );
    assertEquals(withRef.counts.bookmarks, 1);
    assertEquals(withRef.counts.referenced_posts, 2);
    assertEquals(withRef.counts.posts, 3);
  } finally {
    db.close();
  }
});

Deno.test('markdown export format includes heading, quote nesting, and media reference', async () => {
  const db = createInMemoryDb();
  try {
    seedBaseData(db);
    const markdown = await exportAsMarkdown(db, { includeReferenced: true });

    assertStringIncludes(markdown, '## @alice | 2026-02-10T00:00:00Z | b1');
    assertStringIncludes(markdown, '> @bob: quoted post');
    assertStringIncludes(markdown, '> > @alice: nested quoted');
    assert(markdown.includes('!['));
  } finally {
    db.close();
  }
});
