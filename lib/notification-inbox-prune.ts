/** 本地通知收件箱清理常量与纯选择逻辑（可在 Node 自测中直接 import）。 */

/** 合计最多保留条数（本地通知 + 资讯源合计） */
export const NOTIFICATION_INBOX_MAX_ROWS = 200;
/** 已读超过该天数可清理 */
export const NOTIFICATION_INBOX_READ_RETENTION_DAYS = 30;

/**
 * 按条数上限与已读保留天数选出待删 id。
 * 先删「已读且超过保留期」，再按 created_at 升序删到 ≤ maxRows。
 */
export function pickInboxIdsToPrune(
  rows: ReadonlyArray<{ id: string; createdAt: string; readAt: string | null }>,
  opts: { maxRows: number; readRetentionMs: number; nowMs: number },
): string[] {
  const maxRows = Math.max(0, Math.floor(opts.maxRows));
  const toDelete = new Set<string>();
  const retentionCutoff = opts.nowMs - opts.readRetentionMs;

  for (const row of rows) {
    if (!row.readAt) continue;
    const readMs = Date.parse(row.readAt);
    if (Number.isFinite(readMs) && readMs < retentionCutoff) {
      toDelete.add(row.id);
    }
  }

  const remaining = rows
    .filter(r => !toDelete.has(r.id))
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const overflow = remaining.length - maxRows;
  if (overflow > 0) {
    for (let i = 0; i < overflow; i++) {
      const id = remaining[i]?.id;
      if (id) toDelete.add(id);
    }
  }

  return [...toDelete];
}
