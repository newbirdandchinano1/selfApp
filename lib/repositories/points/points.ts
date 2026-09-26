import { makeTimestampEntityId } from '@/lib/entity-id';
import { formatWallClockDatetimeLocal } from '@/lib/api-mysql-datetime';
import { readApiRecord } from '@/lib/api-read';
import type { PageApiReadOpts } from '@/lib/page-api-session';
import { notifyPointsMutation } from '@/lib/points-events';
import { enqueuePointsAdjust } from '@/lib/points-adjust-queue';
import { asPoints } from '@/lib/reward-points';
import { getDatabase } from '../../database.native';
import type { PointsWalletRow } from './points.types';

export const POINTS_WALLET_ID = 'default';

export function createPointsLedgerId(): string {
  return makeTimestampEntityId('plg_', 8);
}

/** 积分钱包/流水审计时间：本地墙上时钟，与服务端 OCC 比较一致（勿用 UTC ISO） */
function pointsAuditNowIso(): string {
  return formatWallClockDatetimeLocal(new Date());
}

export async function getPointsBalance(opts?: PageApiReadOpts): Promise<number> {
  if (!opts?.localOnly) {
    try {
      const { appPointsGetBalance } = await import('@/lib/api-app-domain');
      const balance = await appPointsGetBalance();
      const db = await getDatabase();
      const { beginCloudSqliteDirtyIgnoreBatch, endCloudSqliteDirtyIgnoreBatch } = await import(
        '@/lib/cloud-sql-dirty-track'
      );
      beginCloudSqliteDirtyIgnoreBatch();
      try {
        const nowIso = pointsAuditNowIso();
        await db.runAsync(
          `INSERT OR IGNORE INTO points_wallet (id, balance, created_at, updated_at, sync_status)
           VALUES (?, ?, ?, ?, 'synced')`,
          [POINTS_WALLET_ID, balance, nowIso, nowIso],
        );
        await db.runAsync(
          `UPDATE points_wallet SET balance = ?, updated_at = ?, sync_status = 'synced' WHERE id = ?`,
          [balance, nowIso, POINTS_WALLET_ID],
        );
      } finally {
        endCloudSqliteDirtyIgnoreBatch();
      }
      return balance;
    } catch {
      // fall through to local / generic table read
    }
  }

  const row = await readApiRecord<PointsWalletRow>('points_wallet', POINTS_WALLET_ID, {
    offlineFallback: true,
    ...opts,
  });
  if (!row) {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT OR IGNORE INTO points_wallet (id, balance, created_at, updated_at, sync_status)
       VALUES (?, 0, datetime('now'), datetime('now'), 'synced')`,
      [POINTS_WALLET_ID],
    );
    return 0;
  }
  return asPoints(row.balance);
}

/** 只读本地 SQLite 余额，避免撤销时被 REST 快照干扰 */
export async function getLocalPointsBalance(): Promise<number> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR IGNORE INTO points_wallet (id, balance, created_at, updated_at, sync_status)
     VALUES (?, 0, datetime('now'), datetime('now'), 'synced')`,
    [POINTS_WALLET_ID],
  );
  const wallet = await db.getFirstAsync<{ balance: number }>(
    'SELECT balance FROM points_wallet WHERE id = ?',
    [POINTS_WALLET_ID],
  );
  return asPoints(wallet?.balance);
}

/**
 * 调整积分：优先 `POST /api/app/points/adjust`。
 */
export async function adjustPointsBalance(input: {
  delta: number;
  reason: string;
  ref_type?: string | null;
  ref_id?: string | null;
}): Promise<{ balance: number; delta: number; ledger_id: string | null }> {
  const delta = asPoints(input.delta);
  if (!Number.isFinite(delta) || delta === 0) {
    const balance = await getPointsBalance();
    return { balance, delta: 0, ledger_id: null };
  }
  const reason = (input.reason || 'manual_adjust').trim() || 'manual_adjust';
  const refType = input.ref_type?.trim() || null;
  const refId = input.ref_id?.trim() || null;

  try {
    const { appPointsAdjust } = await import('@/lib/api-app-domain');
    const result = await appPointsAdjust({
      delta,
      reason,
      ref_type: refType,
      ref_id: refId,
    });
    const balance = asPoints(result.balance);
    const appliedDelta = asPoints(result.delta ?? delta);
    const ledgerId =
      typeof result.ledger_id === 'string' && result.ledger_id.trim()
        ? result.ledger_id.trim()
        : null;
    const nowIso = pointsAuditNowIso();
    const db = await getDatabase();
    const { beginCloudSqliteDirtyIgnoreBatch, endCloudSqliteDirtyIgnoreBatch } = await import(
      '@/lib/cloud-sql-dirty-track'
    );
    beginCloudSqliteDirtyIgnoreBatch();
    try {
      await db.runAsync(
        `INSERT OR IGNORE INTO points_wallet (id, balance, created_at, updated_at, sync_status)
         VALUES (?, ?, ?, ?, 'synced')`,
        [POINTS_WALLET_ID, balance, nowIso, nowIso],
      );
      await db.runAsync(
        `UPDATE points_wallet SET balance = ?, updated_at = ?, sync_status = 'synced' WHERE id = ?`,
        [balance, nowIso, POINTS_WALLET_ID],
      );
      if (ledgerId) {
        await db.runAsync(
          `INSERT OR REPLACE INTO points_ledger (
            id, delta, balance_after, reason, ref_type, ref_id,
            created_at, updated_at, sync_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
          [ledgerId, appliedDelta, balance, reason, refType, refId, nowIso, nowIso],
        );
      }
    } finally {
      endCloudSqliteDirtyIgnoreBatch();
    }
    notifyPointsMutation({ balance, delta: appliedDelta });
    return { balance, delta: appliedDelta, ledger_id: ledgerId };
  } catch (e) {
    if (e instanceof Error && /积分不足/.test(e.message)) throw e;
    if (__DEV__) console.warn('[points] adjust API failed, local fallback', e);
  }

  const nowIso = pointsAuditNowIso();
  const db = await getDatabase();
  await db.execAsync('BEGIN IMMEDIATE');
  try {
    await db.runAsync(
      `INSERT OR IGNORE INTO points_wallet (id, balance, created_at, updated_at, sync_status)
       VALUES (?, 0, ?, ?, 'synced')`,
      [POINTS_WALLET_ID, nowIso, nowIso],
    );
    const wallet = await db.getFirstAsync<{ balance: number }>(
      'SELECT balance FROM points_wallet WHERE id = ?',
      [POINTS_WALLET_ID],
    );
    const balance = asPoints(wallet?.balance);
    const next = asPoints(balance + delta);
    await db.runAsync(
      `UPDATE points_wallet SET
        balance = ?,
        updated_at = ?,
        sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'pending_update' END
       WHERE id = ?`,
      [next, nowIso, POINTS_WALLET_ID],
    );
    const ledgerId = createPointsLedgerId();
    await db.runAsync(
      `INSERT INTO points_ledger (
        id, delta, balance_after, reason, ref_type, ref_id,
        created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_create')`,
      [ledgerId, delta, next, reason, refType, refId, nowIso, nowIso],
    );
    await db.execAsync('COMMIT');
    notifyPointsMutation({ balance: next, delta });
    return { balance: next, delta, ledger_id: ledgerId };
  } catch (e) {
    await db.execAsync('ROLLBACK');
    throw e;
  }
}

/**
 * 发分 / 调账语义别名：业务侧统一走 PointsService.grant | adjust。
 * 领域 grant 文件（习惯/任务/健康）仍只负责「何时发」，写钱包只经此入口。
 */
export const grantPoints = adjustPointsBalance;
export const adjustPoints = adjustPointsBalance;

/**
 * 重置积分：优先 `POST /api/app/points/reset`。
 */
export async function resetPointsBalance(): Promise<{
  balance: number;
  delta: number;
  ledger_id: string | null;
}> {
  return enqueuePointsAdjust(async () => {
    try {
      const { appPointsReset } = await import('@/lib/api-app-domain');
      const result = await appPointsReset();
      const balance = asPoints(result.balance);
      const delta = asPoints(result.delta);
      const ledgerId =
        typeof result.ledger_id === 'string' && result.ledger_id.trim()
          ? result.ledger_id.trim()
          : null;
      const nowIso = pointsAuditNowIso();
      const db = await getDatabase();
      const { beginCloudSqliteDirtyIgnoreBatch, endCloudSqliteDirtyIgnoreBatch } = await import(
        '@/lib/cloud-sql-dirty-track'
      );
      beginCloudSqliteDirtyIgnoreBatch();
      try {
        await db.runAsync(
          `INSERT OR IGNORE INTO points_wallet (id, balance, created_at, updated_at, sync_status)
           VALUES (?, 0, ?, ?, 'synced')`,
          [POINTS_WALLET_ID, nowIso, nowIso],
        );
        await db.runAsync(
          `UPDATE points_wallet SET balance = ?, updated_at = ?, sync_status = 'synced' WHERE id = ?`,
          [balance, nowIso, POINTS_WALLET_ID],
        );
        if (ledgerId && delta !== 0) {
          await db.runAsync(
            `INSERT OR REPLACE INTO points_ledger (
              id, delta, balance_after, reason, ref_type, ref_id,
              created_at, updated_at, sync_status
            ) VALUES (?, ?, ?, 'points_reset', 'points_wallet', ?, ?, ?, 'synced')`,
            [ledgerId, delta, balance, POINTS_WALLET_ID, nowIso, nowIso],
          );
        }
      } finally {
        endCloudSqliteDirtyIgnoreBatch();
      }
      notifyPointsMutation({ balance });
      return { balance, delta, ledger_id: ledgerId };
    } catch (e) {
      if (__DEV__) console.warn('[points] reset API failed, local fallback', e);
    }

    const balance = await getLocalPointsBalance();
    if (balance === 0) {
      notifyPointsMutation({ balance: 0 });
      return { balance: 0, delta: 0, ledger_id: null };
    }
    return adjustPointsBalance({
      delta: -balance,
      reason: 'points_reset',
      ref_type: 'points_wallet',
      ref_id: POINTS_WALLET_ID,
    });
  });
}

/**
 * 删除积分流水并回退积分：走 `DELETE /api/app/points/ledger/:id`，
 * 成功后对齐本地钱包与流水；失败则抛错（不提供本地盲删，避免余额漂移）。
 */
export async function deletePointsLedgerRecord(
  ledgerId: string,
): Promise<{ balance: number; delta: number; rollback_delta: number }> {
  const id = String(ledgerId ?? '').trim();
  if (!id) throw new Error('缺少流水 id');

  const { appPointsDeleteLedger } = await import('@/lib/api-app-domain');
  const result = await appPointsDeleteLedger(id);
  const balance = asPoints(result.balance);
  const delta = asPoints(result.delta);
  const rollbackDelta = asPoints(result.rollback_delta);
  const nowIso = pointsAuditNowIso();
  const wishId =
    result.reason === 'wish_redeem' &&
    result.ref_type === 'wish_board_item' &&
    result.ref_id &&
    String(result.ref_id).trim()
      ? String(result.ref_id).trim()
      : null;

  const db = await getDatabase();
  const { beginCloudSqliteDirtyIgnoreBatch, endCloudSqliteDirtyIgnoreBatch } = await import(
    '@/lib/cloud-sql-dirty-track'
  );
  beginCloudSqliteDirtyIgnoreBatch();
  try {
    await db.runAsync(`DELETE FROM points_ledger WHERE id = ?`, [id]);
    await db.runAsync(
      `UPDATE points_wallet SET
        balance = ?,
        updated_at = ?,
        sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'pending_update' END
       WHERE id = ?`,
      [balance, nowIso, POINTS_WALLET_ID],
    );
    if (wishId) {
      await db.runAsync(
        `UPDATE wish_board_items SET
          status = 'active',
          redeemed_at = NULL,
          updated_at = ?,
          sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'pending_update' END
         WHERE id = ?
           AND wish_type = 'once'
           AND status = 'redeemed'`,
        [nowIso, wishId],
      );
    }
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }

  notifyPointsMutation({ balance });
  return { balance, delta, rollback_delta: rollbackDelta };
}

export type LocalPointsLedgerListResult = {
  items: Array<{
    id: string;
    delta: number;
    balance_after: number;
    reason: string;
    ref_type: string | null;
    ref_id: string | null;
    note: string | null;
    created_at: string;
  }>;
  balance: number;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

/** 本地分页读取积分流水（API 不可用时的回退）。 */
export async function listLocalPointsLedger(params?: {
  page?: number;
  limit?: number;
}): Promise<LocalPointsLedgerListResult> {
  const page = Math.max(1, Math.floor(Number(params?.page) || 1));
  const limit = Math.min(200, Math.max(1, Math.floor(Number(params?.limit) || 50)));
  const offset = (page - 1) * limit;
  const db = await getDatabase();

  await db.runAsync(
    `INSERT OR IGNORE INTO points_wallet (id, balance, created_at, updated_at, sync_status)
     VALUES (?, 0, datetime('now'), datetime('now'), 'synced')`,
    [POINTS_WALLET_ID],
  );

  const countRow = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM points_ledger WHERE sync_status != 'pending_delete'`,
  );
  const total = Math.max(0, Math.floor(Number(countRow?.total) || 0));
  const rows = await db.getAllAsync<{
    id: string;
    delta: number;
    balance_after: number;
    reason: string;
    ref_type: string | null;
    ref_id: string | null;
    created_at: string;
    extra_data: string | null;
  }>(
    `SELECT id, delta, balance_after, reason, ref_type, ref_id, created_at, extra_data
     FROM points_ledger
     WHERE sync_status != 'pending_delete'
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );

  const items = (rows ?? []).map((row) => {
    let note: string | null = null;
    if (row.extra_data) {
      try {
        const parsed = JSON.parse(row.extra_data) as Record<string, unknown>;
        if (typeof parsed.note === 'string' && parsed.note.trim()) note = parsed.note.trim();
      } catch {
        // ignore
      }
    }
    return {
      id: String(row.id),
      delta: asPoints(row.delta),
      balance_after: asPoints(row.balance_after),
      reason: String(row.reason ?? ''),
      ref_type: row.ref_type == null ? null : String(row.ref_type),
      ref_id: row.ref_id == null ? null : String(row.ref_id),
      note,
      created_at: String(row.created_at ?? ''),
    };
  });

  const balance = await getLocalPointsBalance();
  return {
    items,
    balance,
    pagination: {
      page,
      limit,
      total,
      totalPages: total > 0 ? Math.ceil(total / limit) : 0,
    },
  };
}
