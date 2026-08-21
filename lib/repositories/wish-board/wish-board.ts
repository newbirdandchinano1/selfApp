import { makeTimestampEntityId } from '@/lib/entity-id';
import { ensureLocalRowForWrite, requireLocalRowForWrite } from '@/lib/api-local-row';
import { formatWallClockDatetimeLocal } from '@/lib/api-mysql-datetime';
import { readApiRecord, readApiTable } from '@/lib/api-read';
import type { PageApiReadOpts } from '@/lib/page-api-session';
import { DEFAULT_WISH_BOARD_ICON_KEY } from '@/lib/constants/wish-board-icons';
import { notifyPointsBalanceChanged } from '@/lib/points-balance-events';
import { notifyPointsEarned } from '@/lib/points-earned-toast-events';
import { enqueuePointsAdjust } from '@/lib/points-adjust-queue';
import { getDatabase } from '../../database.native';
import type {
  CreateWishBoardItemInput,
  PointsLedgerRow,
  PointsWalletRow,
  UpdateWishBoardItemInput,
  WishBoardItemRow,
  WishBoardWishType,
  WishRedeemRecord,
} from './wish-board.types';

export const POINTS_WALLET_ID = 'default';

export function createWishBoardItemId(): string {
  return makeTimestampEntityId('wbi_', 8);
}

export function createPointsLedgerId(): string {
  return makeTimestampEntityId('plg_', 8);
}

/** 积分钱包/流水审计时间：本地墙上时钟，与服务端 OCC 比较一致（勿用 UTC ISO） */
function pointsAuditNowIso(): string {
  return formatWallClockDatetimeLocal(new Date());
}

function normalizeWishType(raw: unknown): WishBoardWishType {
  return raw === 'repeat' ? 'repeat' : 'once';
}

function normalizeDescription(
  description: string | null | undefined,
  note: string | null | undefined,
): string | null {
  const d = description?.trim();
  if (d) return d;
  const n = note?.trim();
  return n || null;
}

function mapWishBoardRow(row: WishBoardItemRow): WishBoardItemRow {
  const description = normalizeDescription(row.description, row.note);
  return {
    ...row,
    description,
    note: row.note ?? description,
    icon_key: row.icon_key?.trim() || DEFAULT_WISH_BOARD_ICON_KEY,
    wish_type: normalizeWishType(row.wish_type),
    cost_points: Math.max(0, Math.floor(Number(row.cost_points) || 0)),
  };
}

function assertWishBoardPayload(input: CreateWishBoardItemInput | UpdateWishBoardItemInput) {
  if ('title' in input && input.title != null) {
    const title = input.title.trim();
    if (!title) throw new Error('请输入心愿名称');
    if (title.length > 80) throw new Error('心愿名称最多 80 字');
  }
  if ('cost_points' in input && input.cost_points != null) {
    const cost = Math.floor(Number(input.cost_points));
    if (!Number.isFinite(cost) || cost < 0) throw new Error('所需积分须为非负整数');
  }
  if ('description' in input && input.description != null && String(input.description).length > 500) {
    throw new Error('描述最多 500 字');
  }
  if ('note' in input && input.note != null && String(input.note).length > 500) {
    throw new Error('描述最多 500 字');
  }
  if ('wish_type' in input && input.wish_type != null && input.wish_type !== 'once' && input.wish_type !== 'repeat') {
    throw new Error('心愿类型无效');
  }
}

export async function getPointsBalance(opts?: PageApiReadOpts): Promise<number> {
  if (!opts?.localOnly) {
    try {
      const { appWishBoardGetBalance } = await import('@/lib/api-app-domain');
      const balance = await appWishBoardGetBalance();
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
  return Math.max(0, Math.floor(Number(row.balance) || 0));
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
  return Math.max(0, Math.floor(Number(wallet?.balance) || 0));
}

export async function listWishBoardItems(opts?: PageApiReadOpts): Promise<WishBoardItemRow[]> {
  const rows = await readApiTable<WishBoardItemRow>('wish_board_items', {
    offlineFallback: true,
    ...opts,
  });
  return rows
    .map(mapWishBoardRow)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      // 重复性心愿置顶，同类型内保持原 sort_order / updated_at
      if (a.wish_type !== b.wish_type) return a.wish_type === 'repeat' ? -1 : 1;
      return a.sort_order - b.sort_order || b.updated_at.localeCompare(a.updated_at);
    });
}

/**
 * 兑换记录列表：优先 `GET /api/app/wish-board/redeemed`；失败再回退本地流水。
 */
export async function listWishRedeemRecords(opts?: PageApiReadOpts): Promise<WishRedeemRecord[]> {
  if (!opts?.localOnly) {
    try {
      const { appWishBoardListRedeemed } = await import('@/lib/api-app-domain');
      const items = await appWishBoardListRedeemed();
      return items
        .map(row => {
          const costFromLedger = Math.abs(Math.floor(Number(row.delta) || 0));
          const costPoints = Math.max(
            0,
            Math.floor(Number(row.cost_points) || 0) || costFromLedger,
          );
          return {
            ledger_id: String(row.ledger_id),
            wish_id: String(row.wish_id),
            title: (row.title ?? '').trim() || '已删除的心愿',
            description: row.description ?? null,
            icon_key: row.icon_key ?? null,
            wish_type: row.wish_type === 'repeat' ? 'repeat' : 'once',
            cost_points: costPoints,
            redeemed_at: row.redeemed_at,
            item_exists: Boolean(row.title || row.status),
            is_fallback: false,
          } satisfies WishRedeemRecord;
        })
        .sort(
          (a, b) =>
            b.redeemed_at.localeCompare(a.redeemed_at) || b.ledger_id.localeCompare(a.ledger_id),
        );
    } catch {
      // fall through
    }
  }

  const [ledgers, items] = await Promise.all([
    readApiTable<PointsLedgerRow>('points_ledger', {
      offlineFallback: true,
      ...opts,
    }),
    readApiTable<WishBoardItemRow>('wish_board_items', {
      offlineFallback: true,
      ...opts,
    }),
  ]);
  const mappedItems = items.map(mapWishBoardRow);
  const itemMap = new Map(mappedItems.map(row => [row.id, row]));
  const fromLedger: WishRedeemRecord[] = ledgers
    .filter(
      row =>
        row.reason === 'wish_redeem' &&
        row.ref_type === 'wish_board_item' &&
        typeof row.ref_id === 'string' &&
        row.ref_id.trim().length > 0,
    )
    .map(row => {
      const wishId = String(row.ref_id).trim();
      const item = itemMap.get(wishId);
      const costFromLedger = Math.abs(Math.floor(Number(row.delta) || 0));
      return {
        ledger_id: row.id,
        wish_id: wishId,
        title: item?.title?.trim() || '已删除的心愿',
        description: item?.description ?? null,
        icon_key: item?.icon_key ?? null,
        wish_type: item?.wish_type ?? 'once',
        cost_points: costFromLedger > 0 ? costFromLedger : item?.cost_points ?? 0,
        redeemed_at: row.created_at,
        item_exists: Boolean(item),
        is_fallback: false,
      } satisfies WishRedeemRecord;
    });

  const coveredWishIds = new Set(fromLedger.map(r => r.wish_id));
  const fallbackOnce: WishRedeemRecord[] = mappedItems
    .filter(item => item.status === 'redeemed' && !coveredWishIds.has(item.id))
    .map(item => ({
      ledger_id: `fallback_${item.id}`,
      wish_id: item.id,
      title: item.title,
      description: item.description,
      icon_key: item.icon_key,
      wish_type: item.wish_type,
      cost_points: item.cost_points,
      redeemed_at: item.redeemed_at || item.updated_at,
      item_exists: true,
      is_fallback: true,
    }));

  return [...fromLedger, ...fallbackOnce].sort(
    (a, b) => b.redeemed_at.localeCompare(a.redeemed_at) || b.ledger_id.localeCompare(a.ledger_id),
  );
}

/** 删除「已兑换」中的一条记录：优先专用接口；失败再本地软删。 */
export async function deleteWishRedeemRecord(record: WishRedeemRecord): Promise<void> {
  if (!record.is_fallback) {
    try {
      const { appWishBoardDeleteRedeemed } = await import('@/lib/api-app-domain');
      await appWishBoardDeleteRedeemed({ id: record.wish_id });
      // 本地对齐：软删流水；一次性已兑完则软删心愿行
      const db = await getDatabase();
      const { beginCloudSqliteDirtyIgnoreBatch, endCloudSqliteDirtyIgnoreBatch } = await import(
        '@/lib/cloud-sql-dirty-track'
      );
      beginCloudSqliteDirtyIgnoreBatch();
      try {
        await db.runAsync(`DELETE FROM points_ledger WHERE id = ?`, [record.ledger_id]);
        if (record.wish_type === 'once' && record.item_exists) {
          await db.runAsync(`DELETE FROM wish_board_items WHERE id = ? AND status = 'redeemed'`, [
            record.wish_id,
          ]);
        }
      } finally {
        endCloudSqliteDirtyIgnoreBatch();
      }
      return;
    } catch {
      // fall through to local
    }

    await requireLocalRowForWrite('points_ledger', record.ledger_id, '兑换记录');
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE points_ledger SET
        sync_status = 'pending_delete',
        updated_at = datetime('now')
       WHERE id = ?`,
      [record.ledger_id],
    );
  }

  if (record.wish_type === 'once' && record.item_exists) {
    const item = await getWishBoardItemById(record.wish_id);
    if (item && item.status === 'redeemed') {
      await deleteWishBoardItem(record.wish_id);
    }
  }
}

export async function getWishBoardItemById(id: string): Promise<WishBoardItemRow | null> {
  const row = await readApiRecord<WishBoardItemRow>('wish_board_items', id, { offlineFallback: true });
  return row ? mapWishBoardRow(row) : null;
}

export async function createWishBoardItem(input: CreateWishBoardItemInput): Promise<string> {
  assertWishBoardPayload(input);
  const db = await getDatabase();
  const id = input.id?.trim() || createWishBoardItemId();
  const title = input.title.trim();
  const cost = Math.floor(Number(input.cost_points));
  const description = input.description?.trim() ? input.description.trim() : null;
  const iconKey = input.icon_key?.trim() || DEFAULT_WISH_BOARD_ICON_KEY;
  const wishType = normalizeWishType(input.wish_type);
  const sortOrder = input.sort_order ?? 1000;

  await db.runAsync(
    `INSERT INTO wish_board_items (
      id, title, description, note, icon_key, wish_type, cost_points, status, redeemed_at, sort_order,
      created_at, updated_at, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, datetime('now'), datetime('now'), 'pending_create')`,
    [id, title, description, description, iconKey, wishType, cost, sortOrder],
  );
  return id;
}

export async function updateWishBoardItem(id: string, input: UpdateWishBoardItemInput): Promise<void> {
  assertWishBoardPayload(input);
  const current = await requireLocalRowForWrite<WishBoardItemRow>('wish_board_items', id, '心愿');
  const mapped = mapWishBoardRow(current);
  if (mapped.status === 'redeemed' && (input.title != null || input.cost_points != null)) {
    throw new Error('已兑换的心愿不可再改名称或积分');
  }

  const title = input.title != null ? input.title.trim() : mapped.title;
  const cost =
    input.cost_points != null ? Math.floor(Number(input.cost_points)) : mapped.cost_points;
  const description =
    input.description !== undefined
      ? input.description?.trim()
        ? input.description.trim()
        : null
      : input.note !== undefined
        ? input.note?.trim()
          ? input.note.trim()
          : null
        : mapped.description;
  const iconKey =
    input.icon_key !== undefined
      ? input.icon_key?.trim() || DEFAULT_WISH_BOARD_ICON_KEY
      : mapped.icon_key;
  const wishType =
    input.wish_type !== undefined ? normalizeWishType(input.wish_type) : mapped.wish_type;
  const sortOrder = input.sort_order ?? mapped.sort_order;
  const status = input.status ?? mapped.status;
  const redeemedAt =
    input.redeemed_at !== undefined ? input.redeemed_at : mapped.redeemed_at;

  const db = await getDatabase();
  await db.runAsync(
    `UPDATE wish_board_items SET
      title = ?, description = ?, note = ?, icon_key = ?, wish_type = ?, cost_points = ?,
      status = ?, redeemed_at = ?, sort_order = ?,
      updated_at = datetime('now'),
      sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'pending_update' END
     WHERE id = ?`,
    [title, description, description, iconKey, wishType, cost, status, redeemedAt, sortOrder, id],
  );
}

export async function deleteWishBoardItem(id: string): Promise<void> {
  await ensureLocalRowForWrite('wish_board_items', id);
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE wish_board_items SET
      sync_status = 'pending_delete',
      updated_at = datetime('now')
     WHERE id = ?`,
    [id],
  );
}

/**
 * 兑换心愿：优先 `POST /api/app/wish-board/redeem`，成功后用返回余额刷新本地；
 * 离线/失败时回退本地事务（再经表同步推送）。
 */
export async function redeemWishBoardItem(id: string): Promise<{ balance: number }> {
  try {
    const { appWishBoardRedeem } = await import('@/lib/api-app-domain');
    const result = await appWishBoardRedeem(id);
    const balance = Math.max(0, Math.floor(Number(result.balance) || 0));
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

      const serverItem = result.item;
      if (serverItem && typeof serverItem === 'object') {
        const status = serverItem.status === 'redeemed' ? 'redeemed' : 'active';
        const redeemedAt =
          typeof serverItem.redeemed_at === 'string' ? serverItem.redeemed_at : nowIso;
        await db.runAsync(
          `UPDATE wish_board_items SET
            status = ?,
            redeemed_at = ?,
            updated_at = ?,
            sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'synced' END
           WHERE id = ?`,
          [status, redeemedAt, nowIso, id],
        );
      } else {
        const item = mapWishBoardRow(
          await requireLocalRowForWrite<WishBoardItemRow>('wish_board_items', id, '心愿'),
        );
        if (item.wish_type === 'repeat') {
          await db.runAsync(
            `UPDATE wish_board_items SET
              status = 'active', redeemed_at = ?, updated_at = ?,
              sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'synced' END
             WHERE id = ?`,
            [nowIso, nowIso, id],
          );
        } else {
          await db.runAsync(
            `UPDATE wish_board_items SET
              status = 'redeemed', redeemed_at = ?, updated_at = ?,
              sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'synced' END
             WHERE id = ?`,
            [nowIso, nowIso, id],
          );
        }
      }
    } finally {
      endCloudSqliteDirtyIgnoreBatch();
    }
    notifyPointsBalanceChanged(balance);
    return { balance };
  } catch (e) {
    // 业务错误（积分不足等）直接抛出；网络类错误走本地回退
    if (e instanceof Error && /积分不足|已兑换|不存在|无效/.test(e.message)) {
      throw e;
    }
    if (__DEV__) console.warn('[wish-board] redeem API failed, local fallback', e);
  }

  const item = mapWishBoardRow(
    await requireLocalRowForWrite<WishBoardItemRow>('wish_board_items', id, '心愿'),
  );
  if (item.wish_type === 'once' && item.status === 'redeemed') {
    throw new Error('该心愿已兑换');
  }

  const cost = Math.floor(Number(item.cost_points) || 0);
  if (cost < 0) throw new Error('所需积分无效');

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
    const balance = Math.max(0, Math.floor(Number(wallet?.balance) || 0));
    if (balance < cost) {
      throw new Error(`积分不足（需要 ${cost}，当前 ${balance}）`);
    }
    const next = balance - cost;
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
      ) VALUES (?, ?, ?, 'wish_redeem', 'wish_board_item', ?, ?, ?, 'pending_create')`,
      [ledgerId, -cost, next, id, nowIso, nowIso],
    );

    if (item.wish_type === 'repeat') {
      await db.runAsync(
        `UPDATE wish_board_items SET
          status = 'active',
          redeemed_at = ?,
          updated_at = ?,
          sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'pending_update' END
         WHERE id = ?`,
        [nowIso, nowIso, id],
      );
    } else {
      await db.runAsync(
        `UPDATE wish_board_items SET
          status = 'redeemed',
          redeemed_at = ?,
          updated_at = ?,
          sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'pending_update' END
         WHERE id = ?`,
        [nowIso, nowIso, id],
      );
    }
    await db.execAsync('COMMIT');
    notifyPointsBalanceChanged(next);
    return { balance: next };
  } catch (e) {
    await db.execAsync('ROLLBACK');
    throw e;
  }
}

/**
 * 调整积分：优先 `POST /api/app/wish-board/points/adjust`。
 */
export async function adjustPointsBalance(input: {
  delta: number;
  reason: string;
  ref_type?: string | null;
  ref_id?: string | null;
}): Promise<{ balance: number; delta: number; ledger_id: string | null }> {
  const delta = Math.floor(Number(input.delta));
  if (!Number.isFinite(delta) || delta === 0) {
    const balance = await getPointsBalance();
    return { balance, delta: 0, ledger_id: null };
  }
  const reason = (input.reason || 'manual_adjust').trim() || 'manual_adjust';
  const refType = input.ref_type?.trim() || null;
  const refId = input.ref_id?.trim() || null;

  try {
    const { appWishBoardAdjustPoints } = await import('@/lib/api-app-domain');
    const result = await appWishBoardAdjustPoints({
      delta,
      reason,
      ref_type: refType,
      ref_id: refId,
    });
    const balance = Math.max(0, Math.floor(Number(result.balance) || 0));
    const appliedDelta = Math.floor(Number(result.delta ?? delta) || 0);
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
    notifyPointsBalanceChanged(balance);
    if (appliedDelta > 0) notifyPointsEarned(appliedDelta);
    return { balance, delta: appliedDelta, ledger_id: ledgerId };
  } catch (e) {
    if (e instanceof Error && /积分不足/.test(e.message)) throw e;
    if (__DEV__) console.warn('[wish-board] adjust API failed, local fallback', e);
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
    const balance = Math.max(0, Math.floor(Number(wallet?.balance) || 0));
    const next = balance + delta;
    if (next < 0) {
      throw new Error(`积分不足（需要 ${Math.abs(delta)}，当前 ${balance}）`);
    }
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
    notifyPointsBalanceChanged(next);
    if (delta > 0) notifyPointsEarned(delta);
    return { balance: next, delta, ledger_id: ledgerId };
  } catch (e) {
    await db.execAsync('ROLLBACK');
    throw e;
  }
}

/**
 * 重置积分：优先 `POST /api/app/wish-board/points/reset`。
 */
export async function resetPointsBalance(): Promise<{ balance: number; delta: number; ledger_id: string | null }> {
  return enqueuePointsAdjust(async () => {
    try {
      const { appWishBoardResetPoints } = await import('@/lib/api-app-domain');
      const result = await appWishBoardResetPoints();
      const balance = Math.max(0, Math.floor(Number(result.balance) || 0));
      const delta = Math.floor(Number(result.delta) || 0);
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
      notifyPointsBalanceChanged(balance);
      return { balance, delta, ledger_id: ledgerId };
    } catch (e) {
      if (__DEV__) console.warn('[wish-board] reset API failed, local fallback', e);
    }

    const balance = await getLocalPointsBalance();
    if (balance <= 0) {
      notifyPointsBalanceChanged(0);
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
