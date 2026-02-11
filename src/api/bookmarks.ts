import type { XBookmarksResponse } from '../types/x.ts';

export interface BookmarkPageClient {
  getBookmarksPage(
    userId: string,
    paginationToken?: string,
    maxResults?: number,
  ): Promise<XBookmarksResponse>;
}

export async function fetchBookmarkPages(
  client: BookmarkPageClient,
  userId: string,
  onPage: (page: XBookmarksResponse, pageIndex: number) => Promise<boolean>,
): Promise<void> {
  let token: string | undefined;
  let pageIndex = 0;

  while (true) {
    const page = await client.getBookmarksPage(userId, token);
    pageIndex += 1;
    const shouldContinue = await onPage(page, pageIndex);
    if (!shouldContinue) {
      break;
    }

    token = page.meta?.next_token;
    if (!token) {
      break;
    }
  }
}
