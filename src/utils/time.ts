export function nowIso(): string {
  return new Date().toISOString();
}

export function utcBilledDay(iso: string): string {
  return iso.slice(0, 10);
}
