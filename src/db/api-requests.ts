import { DatabaseSync } from 'node:sqlite';

export type ApiResourceType = 'post' | 'user';

export interface ApiRequestRecord {
  syncRunId: number;
  requestedAt: string;
  billedDayUtc: string;
  resourceType: ApiResourceType;
  resourceId: string;
  endpoint: string;
  unitPriceUsd: number;
}

export function insertApiRequests(db: DatabaseSync, records: ApiRequestRecord[]): void {
  if (!records.length) {
    return;
  }

  const stmt = db.prepare(`
    INSERT INTO api_requests (
      sync_run_id,
      requested_at,
      billed_day_utc,
      resource_type,
      resource_id,
      endpoint,
      unit_price_usd
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const record of records) {
    stmt.run(
      record.syncRunId,
      record.requestedAt,
      record.billedDayUtc,
      record.resourceType,
      record.resourceId,
      record.endpoint,
      record.unitPriceUsd,
    );
  }
}

export function estimateRunCost(db: DatabaseSync, syncRunId: number): number {
  const row = db
    .prepare(`
      SELECT COALESCE(SUM(unit_price_usd), 0.0) AS estimated_cost_usd
      FROM (
        SELECT billed_day_utc, resource_type, resource_id, MIN(unit_price_usd) AS unit_price_usd
        FROM api_requests
        WHERE sync_run_id = ?
        GROUP BY billed_day_utc, resource_type, resource_id
      ) t
    `)
    .get(syncRunId) as { estimated_cost_usd: number };

  return row.estimated_cost_usd;
}

export function estimateTotalCost(db: DatabaseSync): number {
  const row = db
    .prepare(`
      SELECT COALESCE(SUM(unit_price_usd), 0.0) AS estimated_cost_usd
      FROM (
        SELECT billed_day_utc, resource_type, resource_id, MIN(unit_price_usd) AS unit_price_usd
        FROM api_requests
        GROUP BY billed_day_utc, resource_type, resource_id
      ) t
    `)
    .get() as { estimated_cost_usd: number };

  return row.estimated_cost_usd;
}
