const MEDIA_DOWNLOAD_ERROR_RE = /^Media download failed (\d{3}):/;

export function extractMediaDownloadStatus(error: unknown): number | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const match = MEDIA_DOWNLOAD_ERROR_RE.exec(error.message);
  if (!match) {
    return null;
  }

  const status = Number(match[1]);
  return Number.isInteger(status) ? status : null;
}

export function isSkippableMediaDownloadError(error: unknown): boolean {
  const status = extractMediaDownloadStatus(error);
  if (status === null) {
    return false;
  }

  return status === 401 || status === 403 || status === 404 || status === 410;
}
