export function logInfo(message: string): void {
  console.log(message);
}

export function logError(message: string): void {
  console.error(message);
}

export function logWarn(message: string): void {
  console.error(`Warning: ${message}`);
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
