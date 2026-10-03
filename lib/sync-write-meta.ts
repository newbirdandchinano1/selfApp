/** Phase 1：本地 mutation_id / expected_rev 协议字段 */

export function newMutationId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const hex = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return hex.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function parseMutationId(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  return s ? s.slice(0, 36) : null;
}

export function parseExpectedRev(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/** 上传 body：带 mutation_id + expected_rev；去掉仅本地列 */
export function attachPushOccFields(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  const mutationId = parseMutationId(out.mutation_id ?? out.mutationId) ?? newMutationId();
  const expectedRev = parseExpectedRev(out.expected_rev ?? out.expectedRev ?? out.server_rev);
  delete out.last_pushed_mutation_id;
  delete out.server_rev;
  delete out.serverRev;
  out.mutation_id = mutationId;
  out.mutationId = mutationId;
  out.expected_rev = expectedRev;
  out.expectedRev = expectedRev;
  return out;
}

export type SyncOccPayload = {
  conflict?: boolean;
  kind?: string;
  table?: string;
  pk?: string;
  serverRev?: number | null;
  mutationId?: string | null;
  row?: Record<string, unknown> | null;
};

export function isSyncOccConflictApiError(err: unknown): err is Error & {
  httpStatus: number;
  data?: unknown;
} {
  if (!err || typeof err !== 'object') return false;
  const httpStatus = (err as { httpStatus?: number }).httpStatus;
  if (httpStatus !== 409) return false;
  const data = (err as { data?: unknown }).data;
  if (data && typeof data === 'object' && (data as SyncOccPayload).conflict === true) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /tombstone|expected_rev|版本冲突|已删除（tombstone）/.test(message);
}

export function occPayloadOf(err: unknown): SyncOccPayload | null {
  if (!isSyncOccConflictApiError(err)) return null;
  const data = (err as { data?: unknown }).data;
  if (data && typeof data === 'object') return data as SyncOccPayload;
  return null;
}
