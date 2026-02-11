import { assertEquals, assertNotEquals } from '@std/assert';
import { estimateRunCost, insertApiRequests } from '../src/db/api-requests.ts';
import { bookmarkExists, observeBookmark } from '../src/db/bookmarks.ts';
import { attachPostMedia, upsertMedia } from '../src/db/media.ts';
import { postExists, upsertPosts } from '../src/db/posts.ts';
import { upsertReferences } from '../src/db/references.ts';
import { createSyncRun, failSyncRun } from '../src/db/sync-runs.ts';
import { upsertUsers } from '../src/db/users.ts';
import { createInMemoryDb } from './helpers.ts';

Deno.test('post upsert is idempotent', () => {
  const db = createInMemoryDb();
  try {
    upsertUsers(db, [{ id: 'u1', username: 'alice', name: 'Alice' }], '2026-02-10T00:00:00Z');
    const post = {
      id: 'p1',
      author_id: 'u1',
      text: 'hello',
      created_at: '2026-02-10T00:00:00Z',
    };
    assertEquals(upsertPosts(db, [post], '2026-02-10T00:00:00Z'), 1);
    assertEquals(upsertPosts(db, [post], '2026-02-10T00:01:00Z'), 0);
  } finally {
    db.close();
  }
});

Deno.test('post upsert tolerates missing author user and restores link later', () => {
  const db = createInMemoryDb();
  try {
    const post = {
      id: 'p-missing-author',
      author_id: 'u-missing',
      text: 'hello',
      created_at: '2026-02-10T00:00:00Z',
    };

    assertEquals(upsertPosts(db, [post], '2026-02-10T00:00:00Z'), 1);

    const beforeUser = db.prepare('SELECT author_id FROM posts WHERE id=?').get(
      'p-missing-author',
    ) as {
      author_id: string | null;
    };
    assertEquals(beforeUser.author_id, null);

    upsertUsers(db, [{ id: 'u-missing', username: 'ghost' }], '2026-02-10T00:01:00Z');
    assertEquals(upsertPosts(db, [post], '2026-02-10T00:01:00Z'), 0);

    const afterUser = db.prepare('SELECT author_id FROM posts WHERE id=?').get(
      'p-missing-author',
    ) as {
      author_id: string | null;
    };
    assertEquals(afterUser.author_id, 'u-missing');
  } finally {
    db.close();
  }
});

Deno.test('bookmark discovered_at is stable and last_synced_at updates', () => {
  const db = createInMemoryDb();
  try {
    upsertPosts(
      db,
      [{ id: 'p1', text: 'x', created_at: '2026-02-10T00:00:00Z' }],
      '2026-02-10T00:00:00Z',
    );

    const first = observeBookmark(db, 'p1', '2026-02-10T00:00:00Z');
    assertEquals(first, 'new');
    const second = observeBookmark(db, 'p1', '2026-02-10T00:05:00Z');
    assertEquals(second, 'existing');

    const row = db.prepare('SELECT discovered_at, last_synced_at FROM bookmarks WHERE post_id=?')
      .get('p1') as {
        discovered_at: string;
        last_synced_at: string;
      };
    assertEquals(row.discovered_at, '2026-02-10T00:00:00Z');
    assertEquals(row.last_synced_at, '2026-02-10T00:05:00Z');
  } finally {
    db.close();
  }
});

Deno.test('boundary check is bookmark-based, not posts-based', () => {
  const db = createInMemoryDb();
  try {
    upsertPosts(
      db,
      [{ id: 'p-existing-post-only', text: 'seen in quotes', created_at: '2026-02-10T00:00:00Z' }],
      '2026-02-10T00:00:00Z',
    );

    const result = observeBookmark(db, 'p-existing-post-only', '2026-02-10T01:00:00Z');
    assertEquals(result, 'new');
    assertEquals(bookmarkExists(db, 'p-existing-post-only'), true);
  } finally {
    db.close();
  }
});

Deno.test('failed sync run can still leave bookmark updates committed', () => {
  const db = createInMemoryDb();
  try {
    upsertPosts(
      db,
      [{ id: 'p1', text: 'x', created_at: '2026-02-10T00:00:00Z' }],
      '2026-02-10T00:00:00Z',
    );
    const runId = createSyncRun(db, {
      startedAt: '2026-02-10T00:00:00Z',
      mode: 'incremental',
      requestedMaxNew: null,
    });

    observeBookmark(db, 'p1', '2026-02-10T00:01:00Z');
    failSyncRun(db, runId, '2026-02-10T00:02:00Z', 'simulated failure', 0);

    const run = db.prepare('SELECT status FROM sync_runs WHERE id=?').get(runId) as {
      status: string;
    };
    const bookmark = db.prepare('SELECT last_synced_at FROM bookmarks WHERE post_id=?').get(
      'p1',
    ) as {
      last_synced_at: string;
    };
    assertEquals(run.status, 'failed');
    assertEquals(bookmark.last_synced_at, '2026-02-10T00:01:00Z');
  } finally {
    db.close();
  }
});

Deno.test('relations integrity for post_references and post_media', () => {
  const db = createInMemoryDb();
  try {
    upsertPosts(
      db,
      [
        { id: 'p1', text: 'root', created_at: '2026-02-10T00:00:00Z' },
        { id: 'p2', text: 'quote', created_at: '2026-02-10T00:00:10Z' },
      ],
      '2026-02-10T00:00:00Z',
    );

    upsertReferences(db, [
      { postId: 'p1', referencedPostId: 'p2', referenceType: 'quoted', depth: 1 },
    ]);

    upsertMedia(
      db,
      [
        {
          media_key: '3_abc',
          type: 'photo',
          url: 'https://example.com/a.jpg',
        },
      ],
      '2026-02-10T00:00:00Z',
      '/tmp/media',
    );
    attachPostMedia(db, [{ id: 'p1', attachments: { media_keys: ['3_abc'] } }]);

    const ref = db.prepare('SELECT COUNT(*) AS c FROM post_references').get() as { c: number };
    const pm = db.prepare('SELECT COUNT(*) AS c FROM post_media').get() as { c: number };
    assertEquals(ref.c, 1);
    assertEquals(pm.c, 1);
  } finally {
    db.close();
  }
});

Deno.test('attachPostMedia skips unknown media keys to avoid FK failures', () => {
  const db = createInMemoryDb();
  try {
    upsertPosts(
      db,
      [{ id: 'p1', text: 'root', created_at: '2026-02-10T00:00:00Z' }],
      '2026-02-10T00:00:00Z',
    );

    upsertMedia(
      db,
      [
        {
          media_key: '3_known',
          type: 'photo',
          url: 'https://example.com/a.jpg',
        },
      ],
      '2026-02-10T00:00:00Z',
      '/tmp/media',
    );

    attachPostMedia(db, [{ id: 'p1', attachments: { media_keys: ['3_known', '3_missing'] } }]);

    const rows = db.prepare('SELECT media_key FROM post_media WHERE post_id=? ORDER BY media_key')
      .all('p1') as Array<{ media_key: string }>;
    assertEquals(rows, [{ media_key: '3_known' }]);
  } finally {
    db.close();
  }
});

Deno.test('media upsert keeps non-bin local_path when new inference falls back to bin', () => {
  const db = createInMemoryDb();
  try {
    upsertMedia(
      db,
      [
        {
          media_key: '3_keep',
          type: 'photo',
          url: 'https://example.com/media/no-extension',
        },
      ],
      '2026-02-10T00:00:00Z',
      '/tmp/media',
    );

    db.prepare('UPDATE media SET local_path=? WHERE media_key=?')
      .run('/tmp/media/3_/3_keep.jpg', '3_keep');

    upsertMedia(
      db,
      [
        {
          media_key: '3_keep',
          type: 'photo',
          url: 'https://example.com/media/no-extension',
        },
      ],
      '2026-02-10T00:01:00Z',
      '/tmp/media',
    );

    const row = db.prepare('SELECT local_path FROM media WHERE media_key=?').get('3_keep') as {
      local_path: string;
    };
    assertEquals(row.local_path, '/tmp/media/3_/3_keep.jpg');
  } finally {
    db.close();
  }
});

Deno.test('api request accounting keeps raw rows and deduped run estimate', () => {
  const db = createInMemoryDb();
  try {
    const runId = createSyncRun(db, {
      startedAt: '2026-02-10T00:00:00Z',
      mode: 'initial',
      requestedMaxNew: 10,
    });

    insertApiRequests(db, [
      {
        syncRunId: runId,
        requestedAt: '2026-02-10T00:00:00Z',
        billedDayUtc: '2026-02-10',
        resourceType: 'post',
        resourceId: 'p1',
        endpoint: '/2/users/:id/bookmarks',
        unitPriceUsd: 0.005,
      },
      {
        syncRunId: runId,
        requestedAt: '2026-02-10T00:01:00Z',
        billedDayUtc: '2026-02-10',
        resourceType: 'post',
        resourceId: 'p1',
        endpoint: '/2/tweets',
        unitPriceUsd: 0.005,
      },
      {
        syncRunId: runId,
        requestedAt: '2026-02-10T00:01:00Z',
        billedDayUtc: '2026-02-10',
        resourceType: 'user',
        resourceId: 'u1',
        endpoint: '/2/tweets',
        unitPriceUsd: 0.01,
      },
    ]);

    const raw = db.prepare('SELECT COUNT(*) AS c FROM api_requests WHERE sync_run_id=?').get(
      runId,
    ) as {
      c: number;
    };
    assertEquals(raw.c, 3);

    const dedupedCost = estimateRunCost(db, runId);
    assertNotEquals(dedupedCost, 0);
    assertEquals(dedupedCost, 0.015);
  } finally {
    db.close();
  }
});

Deno.test('bookmarks relation survives when post exists', () => {
  const db = createInMemoryDb();
  try {
    upsertPosts(
      db,
      [{ id: 'p1', text: 'a', created_at: '2026-02-10T00:00:00Z' }],
      '2026-02-10T00:00:00Z',
    );
    observeBookmark(db, 'p1', '2026-02-10T00:00:00Z');
    assertEquals(postExists(db, 'p1'), true);
    const row = db.prepare('SELECT post_id FROM bookmarks WHERE post_id=?').get('p1') as {
      post_id: string;
    };
    assertEquals(row.post_id, 'p1');
  } finally {
    db.close();
  }
});
