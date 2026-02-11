import { assertEquals } from '@std/assert';
import {
  extractMediaDownloadStatus,
  isSkippableMediaDownloadError,
} from '../src/utils/media-download.ts';

Deno.test('extractMediaDownloadStatus parses status from media download error', () => {
  const error = new Error('Media download failed 403: {"errors":[{"code":453}]}');
  assertEquals(extractMediaDownloadStatus(error), 403);
});

Deno.test('isSkippableMediaDownloadError returns true for permission and not-found statuses', () => {
  assertEquals(
    isSkippableMediaDownloadError(new Error('Media download failed 401: unauthorized')),
    true,
  );
  assertEquals(
    isSkippableMediaDownloadError(new Error('Media download failed 403: forbidden')),
    true,
  );
  assertEquals(
    isSkippableMediaDownloadError(new Error('Media download failed 404: not found')),
    true,
  );
  assertEquals(
    isSkippableMediaDownloadError(new Error('Media download failed 410: gone')),
    true,
  );
  assertEquals(
    isSkippableMediaDownloadError(new Error('Media download failed 429: too many requests')),
    false,
  );
  assertEquals(isSkippableMediaDownloadError(new Error('something else')), false);
});
