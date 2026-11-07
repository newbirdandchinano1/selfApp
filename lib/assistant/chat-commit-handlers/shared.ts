/**
 * S9.3 / S9.6：commit handler 共用工具（draft 取值 / 失败结果 / sync_status）。
 */

import type { ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import type { WriteSyncStatus } from '@/lib/assistant/write-operation';

export function draftString(draft: Record<string, unknown>, key: string): string {
  const v = draft[key];
  return typeof v === 'string' ? v.trim() : '';
}

export function draftNumber(draft: Record<string, unknown>, key: string): number | null {
  const v = draft[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function fail(code: string, message: string): ChatCommitHandlerResult {
  return { ok: false, error: { code, message } };
}

export function ok(
  entityId: string,
  message: string,
  syncStatus: WriteSyncStatus = 'pending',
): ChatCommitHandlerResult {
  return {
    ok: true,
    entity_id: entityId,
    sync_status: syncStatus,
    message,
  };
}

/** 本地已落库但同步失败：仍 ok，透出 sync_failed 供 UI 诚实文案 */
export function okLocalSyncFailed(entityId: string, message: string): ChatCommitHandlerResult {
  return ok(entityId, message || '本地已保存，同步待重试。', 'sync_failed');
}

/** YYYY-MM-DD → 本地中午墙上时钟（与新建待办页一致） */
export function dueYmdToDueDate(ymd: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]} 12:00:00`;
}

export async function requestPushPending(): Promise<void> {
  try {
    const { requestPush } = await import('@/lib/sync-manager');
    void requestPush();
  } catch {
    /* ignore */
  }
}
