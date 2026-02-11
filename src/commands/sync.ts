import { DatabaseSync } from 'node:sqlite';
import { fetchBookmarkPages } from '../api/bookmarks.ts';
import { XApiClient } from '../api/client.ts';
import { lookupTweetsInBatches } from '../api/tweets.ts';
import { estimateRunCost, estimateTotalCost, insertApiRequests } from '../db/api-requests.ts';
import { hasAnyBookmarks, observeBookmark } from '../db/bookmarks.ts';
import { ensureDatabaseParent, openDatabase, withTransaction } from '../db/connection.ts';
import { attachPostMedia, resolveMediaStorageTarget, upsertMedia } from '../db/media.ts';
import { existingPostIds, getPostsByIds, upsertPosts } from '../db/posts.ts';
import { type ReferenceRow, upsertReferences } from '../db/references.ts';
import {
  completeSyncRun,
  createSyncRun,
  failSyncRun,
  type SyncMode,
  type SyncRunCounters,
  updateSyncRunCounters,
} from '../db/sync-runs.ts';
import { migrateSchema } from '../db/schema.ts';
import { upsertUsers } from '../db/users.ts';
import type { AppConfig, AuthOverride } from '../types/config.ts';
import type { XBookmarksResponse, XMediaEntity, XPostEntity, XUserEntity } from '../types/x.ts';
import { envAuthOverride, mergeOAuth, readConfigFile, writeConfigFile } from '../utils/config.ts';
import { logInfo, logWarn } from '../utils/logger.ts';
import { isSkippableMediaDownloadError } from '../utils/media-download.ts';
import { ensureAppDirs, resolveConfigPaths } from '../utils/paths.ts';
import { nowIso, utcBilledDay } from '../utils/time.ts';
import { applyBookmarkObservation, resolveRequestedMaxNew } from './sync-logic.ts';

interface SyncCommandOptions {
  maxNewRaw?: string;
  media: boolean;
  confirmCost: boolean;
  yes: boolean;
  authOverride: AuthOverride;
}

function dedupePosts(posts: XPostEntity[]): XPostEntity[] {
  const map = new Map<string, XPostEntity>();
  for (const post of posts) {
    map.set(post.id, post);
  }
  return [...map.values()];
}

function uniqueUsers(users: XUserEntity[]): XUserEntity[] {
  const map = new Map<string, XUserEntity>();
  for (const user of users) {
    map.set(user.id, user);
  }
  return [...map.values()];
}

function confirmOrAbort(question: string): void {
  const response = prompt(`${question} [y/N]`);
  if (!response || !['y', 'yes'].includes(response.trim().toLowerCase())) {
    throw new Error('Sync cancelled by user');
  }
}

function shouldPromptForCostConfirmation(options: Pick<SyncCommandOptions, 'confirmCost' | 'yes'>): boolean {
  return options.confirmCost && !options.yes;
}

function ensureInteractivePromptAvailable(isTerminal: boolean): void {
  if (!isTerminal) {
    throw new Error(
      'Cost confirmation requires an interactive terminal. Use --yes to auto-accept or --no-confirm-cost to skip confirmation.',
    );
  }
}

function costEstimateText(maxNew: number | null, appConfig: AppConfig): string {
  const postUnit = appConfig.cost.unit_price_post_read_usd;
  const userUnit = appConfig.cost.unit_price_user_read_usd;
  const postCap = maxNew === null ? 'unbounded' : (maxNew * postUnit).toFixed(4);
  const userCap = maxNew === null ? 'unbounded' : (maxNew * userUnit).toFixed(4);
  const maxNewText = maxNew === null ? 'all' : String(maxNew);
  return [
    'Cost estimate:',
    `- max-new: ${maxNewText}`,
    `- unit_price_post_read_usd: ${postUnit}`,
    `- post-read upper bound estimate (USD): ${postCap}`,
    `- unit_price_user_read_usd: ${userUnit}`,
    `- user-read supplementary estimate (USD): ${userCap}`,
    '- note: X daily dedupe in UTC 24h introduces uncertainty',
  ].join('\n');
}

function trackApiReads(params: {
  db: DatabaseSync;
  syncRunId: number;
  endpoint: string;
  postIds: string[];
  userIds: string[];
  appConfig: AppConfig;
}): void {
  const requestedAt = nowIso();
  const billedDay = utcBilledDay(requestedAt);
  const postSet = [...new Set(params.postIds)];
  const userSet = [...new Set(params.userIds)];

  insertApiRequests(params.db, [
    ...postSet.map((resourceId) => ({
      syncRunId: params.syncRunId,
      requestedAt,
      billedDayUtc: billedDay,
      resourceType: 'post' as const,
      resourceId,
      endpoint: params.endpoint,
      unitPriceUsd: params.appConfig.cost.unit_price_post_read_usd,
    })),
    ...userSet.map((resourceId) => ({
      syncRunId: params.syncRunId,
      requestedAt,
      billedDayUtc: billedDay,
      resourceType: 'user' as const,
      resourceId,
      endpoint: params.endpoint,
      unitPriceUsd: params.appConfig.cost.unit_price_user_read_usd,
    })),
  ]);
}

async function saveMediaIfNeeded(
  db: DatabaseSync,
  client: XApiClient,
  mediaRoot: string,
  mediaItems: XMediaEntity[],
  onSkippedDownload?: (params: { mediaKey: string; url: string; reason: string }) => void,
): Promise<void> {
  const pathStmt = db.prepare('SELECT local_path FROM media WHERE media_key = ?');
  for (const media of mediaItems) {
    const target = resolveMediaStorageTarget(mediaRoot, media);
    const row = pathStmt.get(media.media_key) as { local_path: string | null } | undefined;
    const localPath = row?.local_path ?? target.localPath;

    try {
      const info = await Deno.stat(localPath);
      if (info.isFile) {
        continue;
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }

    if (target.url) {
      let result: { downloaded: boolean; actualPath: string };
      try {
        result = await client.downloadMedia(target.url, localPath);
      } catch (error) {
        if (isSkippableMediaDownloadError(error)) {
          onSkippedDownload?.({
            mediaKey: media.media_key,
            url: target.url,
            reason: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        throw error;
      }

      if (result.downloaded && result.actualPath !== localPath) {
        db.prepare('UPDATE media SET local_path = ? WHERE media_key = ?')
          .run(result.actualPath, media.media_key);
      }
    }
  }
}

async function resolveQuoteReferences(params: {
  db: DatabaseSync;
  client: XApiClient;
  rootPosts: XPostEntity[];
  appConfig: AppConfig;
  maxDepth: number;
  syncRunId: number;
  counters: SyncRunCounters;
  mediaEnabled: boolean;
  mediaRoot: string;
  onApiRequest?: () => void;
  onMediaDownloadSkipped?: (params: { mediaKey: string; url: string; reason: string }) => void;
}): Promise<void> {
  let layerPosts = params.rootPosts;

  for (let depth = 1; depth <= params.maxDepth; depth += 1) {
    if (!layerPosts.length) {
      break;
    }

    const immediateReferences: ReferenceRow[] = [];
    const quotedEdges: Array<{ postId: string; refId: string; depth: number }> = [];

    for (const post of layerPosts) {
      for (const ref of post.referenced_tweets ?? []) {
        if (ref.type === 'quoted') {
          quotedEdges.push({ postId: post.id, refId: ref.id, depth });
          continue;
        }

        if (existingPostIds(params.db, [ref.id]).has(ref.id)) {
          immediateReferences.push({
            postId: post.id,
            referencedPostId: ref.id,
            referenceType: ref.type,
            depth,
          });
        }
      }
    }

    if (immediateReferences.length) {
      upsertReferences(params.db, immediateReferences);
    }

    if (!quotedEdges.length) {
      layerPosts = [];
      continue;
    }

    const quotedIds = [...new Set(quotedEdges.map((edge) => edge.refId))];
    let existing = existingPostIds(params.db, quotedIds);
    const missing = quotedIds.filter((id) => !existing.has(id));

    if (missing.length) {
      const responses = await lookupTweetsInBatches(params.client, missing);
      for (const response of responses) {
        params.onApiRequest?.();
        const users = uniqueUsers(response.includes?.users ?? []);
        const apiPosts = dedupePosts([
          ...(response.data ?? []),
          ...(response.includes?.tweets ?? []),
        ]);
        const media = response.includes?.media ?? [];
        const fetchedAt = nowIso();

        withTransaction(params.db, () => {
          upsertUsers(params.db, users, fetchedAt);
          const inserted = upsertPosts(params.db, apiPosts, fetchedAt);
          params.counters.newReferencedPostsCount += inserted;
          if (params.mediaEnabled) {
            params.counters.newMediaCount += upsertMedia(
              params.db,
              media,
              fetchedAt,
              params.mediaRoot,
            );
            attachPostMedia(params.db, apiPosts);
          }
        });

        if (params.mediaEnabled) {
          await saveMediaIfNeeded(
            params.db,
            params.client,
            params.mediaRoot,
            media,
            params.onMediaDownloadSkipped,
          );
        }

        trackApiReads({
          db: params.db,
          syncRunId: params.syncRunId,
          endpoint: '/2/tweets',
          postIds: apiPosts.map((post) => post.id),
          userIds: users.map((user) => user.id),
          appConfig: params.appConfig,
        });
        params.counters.apiPostsReadCount += new Set(apiPosts.map((post) => post.id)).size;
        params.counters.apiUsersReadCount += new Set(users.map((user) => user.id)).size;
      }

      existing = existingPostIds(params.db, quotedIds);
    }

    const resolvable = quotedEdges
      .filter((edge) => existing.has(edge.refId))
      .map((edge) => ({
        postId: edge.postId,
        referencedPostId: edge.refId,
        referenceType: 'quoted' as const,
        depth: edge.depth,
      }));

    if (resolvable.length) {
      upsertReferences(params.db, resolvable);
    }

    if (depth >= params.maxDepth) {
      layerPosts = [];
      continue;
    }

    const nextIds = [...new Set(resolvable.map((edge) => edge.referencedPostId))];
    layerPosts = getPostsByIds(params.db, nextIds);
  }
}

function mergeAppConfigWithAuth(fileConfig: AppConfig, cliOverride: AuthOverride): AppConfig {
  const oauth = mergeOAuth(fileConfig.oauth, envAuthOverride(), cliOverride);
  return {
    ...fileConfig,
    oauth,
  };
}

function ensureAuthConfig(config: AppConfig): void {
  if (!config.oauth.access_token) {
    throw new Error('Missing access token. Run `xstash config init` or set XSTASH_ACCESS_TOKEN.');
  }
  if (!config.oauth.client_id) {
    throw new Error('Missing client_id. Set config oauth.client_id or XSTASH_CLIENT_ID.');
  }
}

export async function runSyncCommand(options: SyncCommandOptions): Promise<void> {
  const paths = resolveConfigPaths();
  await ensureAppDirs(paths);

  let appConfig = mergeAppConfigWithAuth(
    await readConfigFile(paths.configPath),
    options.authOverride,
  );
  ensureAuthConfig(appConfig);

  await ensureDatabaseParent(paths.dbPath);
  const db = openDatabase(paths.dbPath);
  migrateSchema(db);

  const mode: SyncMode = hasAnyBookmarks(db) ? 'incremental' : 'initial';
  const maxNew = resolveRequestedMaxNew(
    mode,
    options.maxNewRaw,
    appConfig.sync.default_incremental_max_new,
    appConfig.sync.default_initial_max_new,
  );

  logInfo(costEstimateText(maxNew.requestedMaxNew, appConfig));
  if (shouldPromptForCostConfirmation(options)) {
    ensureInteractivePromptAvailable(Deno.stdin.isTerminal());
    confirmOrAbort('Continue sync with this estimate?');
  }

  const startedAt = nowIso();
  const syncRunId = createSyncRun(db, {
    startedAt,
    mode,
    requestedMaxNew: maxNew.requestedMaxNew,
  });

  const counters: SyncRunCounters = {
    newBookmarksCount: 0,
    newReferencedPostsCount: 0,
    newMediaCount: 0,
    apiPostsReadCount: 0,
    apiUsersReadCount: 0,
  };
  let rawApiRequestCount = 0;
  let skippedMediaDownloads = 0;

  try {
    const client = new XApiClient({
      oauth: appConfig.oauth,
      onTokenUpdated: async (oauth) => {
        appConfig = { ...appConfig, oauth };
        await writeConfigFile(paths.configPath, appConfig);
      },
    });

    const me = await client.getMe();
    const userId = me.data.id;

    const knownThreshold = appConfig.sync.known_boundary_threshold;
    const maxDepth = Math.min(3, Math.max(1, appConfig.sync.quote_resolve_max_depth));
    const onMediaDownloadSkipped = (params: {
      mediaKey: string;
      url: string;
      reason: string;
    }) => {
      skippedMediaDownloads += 1;
      logWarn(
        `Skipped media download (${params.mediaKey}) ${params.url}: ${params.reason}`,
      );
    };

    let knownStreak = 0;
    let shouldStop = false;

    rawApiRequestCount += 1; // getMe() request
    await fetchBookmarkPages(client, userId, async (page: XBookmarksResponse) => {
      if (shouldStop) {
        return false;
      }
      rawApiRequestCount += 1;

      const now = nowIso();
      const rootPosts = page.data ?? [];
      const includePosts = page.includes?.tweets ?? [];
      const allPosts = dedupePosts([...rootPosts, ...includePosts]);
      const users = uniqueUsers(page.includes?.users ?? []);
      const mediaItems = page.includes?.media ?? [];
      const processedRootPosts: XPostEntity[] = [];

      withTransaction(db, () => {
        upsertUsers(db, users, now);
        upsertPosts(db, allPosts, now);

        if (options.media) {
          counters.newMediaCount += upsertMedia(db, mediaItems, now, paths.mediaRoot);
          attachPostMedia(db, allPosts);
        }

        for (const post of rootPosts) {
          const status = observeBookmark(db, post.id, now);
          processedRootPosts.push(post);

          const boundary = applyBookmarkObservation(
            {
              mode,
              knownBoundaryThreshold: knownThreshold,
              requestedMaxNew: maxNew.requestedMaxNew,
              knownStreak,
              newBookmarksCount: counters.newBookmarksCount,
            },
            status,
          );
          knownStreak = boundary.state.knownStreak;
          counters.newBookmarksCount = boundary.state.newBookmarksCount;
          if (boundary.stop) {
            shouldStop = true;
            break;
          }
        }
      });

      if (options.media) {
        await saveMediaIfNeeded(
          db,
          client,
          paths.mediaRoot,
          mediaItems,
          onMediaDownloadSkipped,
        );
      }

      await resolveQuoteReferences({
        db,
        client,
        rootPosts: processedRootPosts,
        appConfig,
        maxDepth,
        syncRunId,
        counters,
        mediaEnabled: options.media,
        mediaRoot: paths.mediaRoot,
        onApiRequest: () => {
          rawApiRequestCount += 1;
        },
        onMediaDownloadSkipped,
      });

      trackApiReads({
        db,
        syncRunId,
        endpoint: '/2/users/:id/bookmarks',
        postIds: allPosts.map((post) => post.id),
        userIds: users.map((user) => user.id),
        appConfig,
      });
      counters.apiPostsReadCount += new Set(allPosts.map((post) => post.id)).size;
      counters.apiUsersReadCount += new Set(users.map((user) => user.id)).size;

      updateSyncRunCounters(db, syncRunId, counters);

      return !shouldStop;
    });

    const runCost = estimateRunCost(db, syncRunId);
    completeSyncRun(db, syncRunId, nowIso(), runCost);

    const totalCost = estimateTotalCost(db);
    logInfo('Sync completed.');
    logInfo(`- mode: ${mode}`);
    logInfo(`- new bookmarks: ${counters.newBookmarksCount}`);
    logInfo(`- new referenced posts: ${counters.newReferencedPostsCount}`);
    logInfo(`- new media: ${counters.newMediaCount}`);
    logInfo(`- API reads (post): ${counters.apiPostsReadCount}`);
    logInfo(`- API reads (user): ${counters.apiUsersReadCount}`);
    logInfo(`- raw API requests: ${rawApiRequestCount}`);
    logInfo(`- media download skipped: ${skippedMediaDownloads}`);
    logInfo(`- estimated cost USD (run, after daily dedup): ${runCost.toFixed(4)}`);
    logInfo(`- estimated cost USD (total, after daily dedup): ${totalCost.toFixed(4)}`);
  } catch (error) {
    const runCost = estimateRunCost(db, syncRunId);
    failSyncRun(
      db,
      syncRunId,
      nowIso(),
      error instanceof Error ? error.message : String(error),
      runCost,
    );
    throw error;
  } finally {
    db.close();
  }
}

export { ensureInteractivePromptAvailable, shouldPromptForCostConfirmation };
export type { SyncCommandOptions };
