import type { XApiClient } from './client.ts';
import type { XTweetsLookupResponse } from '../types/x.ts';

export async function lookupTweetsInBatches(
  client: XApiClient,
  ids: string[],
): Promise<XTweetsLookupResponse[]> {
  const results: XTweetsLookupResponse[] = [];

  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    if (!chunk.length) {
      continue;
    }
    const response = await client.lookupTweets(chunk);
    results.push(response);
  }

  return results;
}
