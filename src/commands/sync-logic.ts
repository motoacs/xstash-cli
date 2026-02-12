import type { MaxNewSetting } from '../types/config.ts';

export type SyncModeLite = 'initial' | 'incremental';

export interface ResolvedMaxNew {
  requestedMaxNew: number | null;
  display: string;
}

const MIN_BOOKMARKS_PAGE_SIZE = 5;
const MAX_BOOKMARKS_PAGE_SIZE = 100;
const DEFAULT_INCREMENTAL_BOOKMARKS_PAGE_SIZE = 5;

export interface BoundaryState {
  mode: SyncModeLite;
  knownBoundaryThreshold: number;
  requestedMaxNew: number | null;
  knownStreak: number;
  newBookmarksCount: number;
}

export interface BoundaryResult {
  stop: boolean;
  state: BoundaryState;
}

export function parseMaxNewValue(raw: string): number | null {
  if (raw === 'all') {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--max-new must be a positive integer or 'all': ${raw}`);
  }
  return parsed;
}

export function resolveRequestedMaxNew(
  mode: SyncModeLite,
  maxNewRaw: string | undefined,
  configValue: MaxNewSetting,
  initialDefault: number,
): ResolvedMaxNew {
  if (maxNewRaw !== undefined) {
    const parsed = parseMaxNewValue(maxNewRaw);
    return {
      requestedMaxNew: parsed,
      display: parsed === null ? 'all' : String(parsed),
    };
  }

  if (mode === 'initial') {
    return {
      requestedMaxNew: initialDefault,
      display: String(initialDefault),
    };
  }

  if (configValue === 'all') {
    return {
      requestedMaxNew: null,
      display: 'all',
    };
  }

  return {
    requestedMaxNew: configValue,
    display: String(configValue),
  };
}

export function applyBookmarkObservation(
  state: BoundaryState,
  observed: 'new' | 'existing',
): BoundaryResult {
  const next: BoundaryState = {
    ...state,
    newBookmarksCount: state.newBookmarksCount + (observed === 'new' ? 1 : 0),
    knownStreak: observed === 'existing' ? state.knownStreak + 1 : 0,
  };

  if (next.requestedMaxNew !== null && next.newBookmarksCount >= next.requestedMaxNew) {
    return { stop: true, state: next };
  }

  if (
    next.mode === 'incremental' &&
    next.knownBoundaryThreshold > 0 &&
    next.knownStreak >= next.knownBoundaryThreshold
  ) {
    return { stop: true, state: next };
  }

  return { stop: false, state: next };
}

export function resolveBookmarksPageSize(
  mode: SyncModeLite,
  knownBoundaryThreshold: number,
  incrementalBookmarksPageSize: number | null,
): number {
  if (mode === 'initial') {
    return MAX_BOOKMARKS_PAGE_SIZE;
  }

  if (
    typeof incrementalBookmarksPageSize === 'number' &&
    Number.isFinite(incrementalBookmarksPageSize) &&
    incrementalBookmarksPageSize > 0
  ) {
    return Math.max(
      MIN_BOOKMARKS_PAGE_SIZE,
      Math.min(MAX_BOOKMARKS_PAGE_SIZE, Math.trunc(incrementalBookmarksPageSize)),
    );
  }

  if (!Number.isFinite(knownBoundaryThreshold) || knownBoundaryThreshold <= 0) {
    return DEFAULT_INCREMENTAL_BOOKMARKS_PAGE_SIZE;
  }

  return Math.max(
    MIN_BOOKMARKS_PAGE_SIZE,
    Math.min(MAX_BOOKMARKS_PAGE_SIZE, Math.trunc(knownBoundaryThreshold)),
  );
}

export interface QuoteRef {
  type: 'quoted' | 'replied_to' | 'retweeted';
  id: string;
}

export interface QuotePost {
  id: string;
  referenced_tweets?: QuoteRef[];
}

export interface QuoteEdge {
  fromPostId: string;
  toPostId: string;
  depth: number;
}

export function collectQuotedEdgesWithinDepth(
  roots: QuotePost[],
  postLookup: (id: string) => QuotePost | undefined,
  maxDepth: number,
): QuoteEdge[] {
  const edges: QuoteEdge[] = [];
  let layer = roots;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const nextIds = new Set<string>();
    for (const post of layer) {
      for (const ref of post.referenced_tweets ?? []) {
        if (ref.type !== 'quoted') {
          continue;
        }
        edges.push({
          fromPostId: post.id,
          toPostId: ref.id,
          depth,
        });
        nextIds.add(ref.id);
      }
    }

    if (depth >= maxDepth) {
      break;
    }

    layer = [...nextIds]
      .map((id) => postLookup(id))
      .filter((post): post is QuotePost => Boolean(post));

    if (!layer.length) {
      break;
    }
  }

  return edges;
}
