import { assertEquals, assertThrows } from '@std/assert';
import {
  applyBookmarkObservation,
  collectQuotedEdgesWithinDepth,
  parseMaxNewValue,
  resolveRequestedMaxNew,
} from '../src/commands/sync-logic.ts';
import type { BoundaryState } from '../src/commands/sync-logic.ts';

Deno.test('parseMaxNewValue accepts integer and all', () => {
  assertEquals(parseMaxNewValue('10'), 10);
  assertEquals(parseMaxNewValue('all'), null);
});

Deno.test('parseMaxNewValue rejects invalid values', () => {
  assertThrows(() => parseMaxNewValue('0'));
  assertThrows(() => parseMaxNewValue('-3'));
  assertThrows(() => parseMaxNewValue('abc'));
});

Deno.test('resolveRequestedMaxNew initial defaults to configured initial max', () => {
  const resolved = resolveRequestedMaxNew('initial', undefined, 'all', 200);
  assertEquals(resolved.requestedMaxNew, 200);
});

Deno.test('resolveRequestedMaxNew incremental defaults to all when configured', () => {
  const resolved = resolveRequestedMaxNew('incremental', undefined, 'all', 200);
  assertEquals(resolved.requestedMaxNew, null);
});

Deno.test('resolveRequestedMaxNew explicit max-new overrides defaults', () => {
  const resolved = resolveRequestedMaxNew('incremental', '12', 'all', 200);
  assertEquals(resolved.requestedMaxNew, 12);
});

Deno.test('incremental mode stops after known boundary threshold', () => {
  let state: BoundaryState = {
    mode: 'incremental' as const,
    knownBoundaryThreshold: 3,
    requestedMaxNew: null,
    knownStreak: 0,
    newBookmarksCount: 0,
  };

  for (let i = 0; i < 2; i += 1) {
    const result = applyBookmarkObservation(state, 'existing');
    assertEquals(result.stop, false);
    state = result.state;
  }

  const stop = applyBookmarkObservation(state, 'existing');
  assertEquals(stop.stop, true);
});

Deno.test('initial mode does not stop on known boundary threshold', () => {
  let state: BoundaryState = {
    mode: 'initial' as const,
    knownBoundaryThreshold: 1,
    requestedMaxNew: null,
    knownStreak: 0,
    newBookmarksCount: 0,
  };

  const result = applyBookmarkObservation(state, 'existing');
  assertEquals(result.stop, false);
  state = result.state;
  assertEquals(state.knownStreak, 1);
});

Deno.test('max-new stops both initial and incremental flow', () => {
  const state = {
    mode: 'initial' as const,
    knownBoundaryThreshold: 99,
    requestedMaxNew: 2,
    knownStreak: 0,
    newBookmarksCount: 1,
  };
  const result = applyBookmarkObservation(state, 'new');
  assertEquals(result.stop, true);
  assertEquals(result.state.newBookmarksCount, 2);
});

Deno.test('quote edge traversal is bounded by max depth', () => {
  const posts = new Map<string, {
    id: string;
    referenced_tweets?: Array<{ type: 'quoted'; id: string }>;
  }>([
    ['root', { id: 'root', referenced_tweets: [{ type: 'quoted', id: 'q1' }] }],
    ['q1', { id: 'q1', referenced_tweets: [{ type: 'quoted', id: 'q2' }] }],
    ['q2', { id: 'q2', referenced_tweets: [{ type: 'quoted', id: 'q3' }] }],
  ]);

  const edges = collectQuotedEdgesWithinDepth(
    [posts.get('root')!],
    (id) => posts.get(id),
    2,
  );

  assertEquals(edges.map((edge) => `${edge.fromPostId}->${edge.toPostId}@${edge.depth}`), [
    'root->q1@1',
    'q1->q2@2',
  ]);
});
