import { makeTimestampEntityId } from '@/lib/entity-id';
import { ensureLocalRowForWrite, requireLocalRowForWrite } from '@/lib/api-local-row';
import { formatWallClockDatetimeLocal } from '@/lib/api-mysql-datetime';
import { readApiRecord, readApiTable } from '@/lib/api-read';
import type { PageApiReadOpts } from '@/lib/page-api-session';
import { DEFAULT_WISH_BOARD_ICON_KEY } from '@/lib/constants/wish-board-icons';
import { notifyPointsMutation } from '@/lib/points-events';
import { assertNonNegativeCostPoints, asPoints } from '@/lib/reward-points';
import { getDatabase } from '../../database.native';
import {
  POINTS_WALLET_ID,
  createPointsLedgerId,
  getLocalPointsBalance,
  getPointsBalance,
  resetPointsBalance,
} from '@/lib/repositories/points/points';
import {
  assertWishBoardRedeemEligible,
  emptyWishBoardRedeemConditions,
  mergeWishBoardRedeemConditions,
} from './wish-board-redeem-conditions';
import type {
  CreateWishBoardItemInput,
  PointsLedgerRow,
  UpdateWishBoardItemInput,
  WishBoardItemRow,
  WishBoardWishType,
  WishRedeemRecord,
} from './wish-board.types';

export {
  POINTS_WALLET_ID,
  createPointsLedgerId,
  getLocalPointsBalance,
  getPointsBalance,
  resetPointsBalance,
  adjustPointsBalance,
  deletePointsLedgerRecord,
} from '@/lib/repositories/points/points';

export function createWishBoardItemId(): string {
  return makeTimestampEntityId('wbi_', 8);
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
    cost_points: asPoints(row.cost_points),
  };
}

function assertWishBoardPayload(input: CreateWishBoardItemInput | UpdateWishBoardItemInput) {
  if ('title' in input && input.title != null) {
    const title = input.title.trim();
    if (!title) throw new Error('请输入心愿名称');
    if (title.length > 80) throw new Error('心愿名称最多 80 字');
  }
  if ('cost_points' in input && input.cost_points != null) {
    assertNonNegativeCostPoints(input.cost_points);
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
          const costFromLedger = Math.abs(asPoints(row.delta));
          const costPoints = asPoints(row.cost_points) || costFromLedger;
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
      const costFromLedger = Math.abs(asPoints(row.delta));
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

function resolveWishBoardExtraData(
  currentExtra: string | null | undefined,
  input: Pick<CreateWishBoardItemInput, 'extra_data' | 'redeem_conditions'>,
): string | null {
  let extra =
    input.extra_data !== undefined ? input.extra_data : (currentExtra ?? null);
  if (input.redeem_conditions !== undefined) {
    extra = mergeWishBoardRedeemConditions(
      extra,
      input.redeem_conditions ?? emptyWishBoardRedeemConditions(),
    );
  }
  return extra?.trim() ? extra : null;
}

export async function createWishBoardItem(input: CreateWishBoardItemInput): Promise<string> {
  assertWishBoardPayload(input);
  const db = await getDatabase();
  const id = input.id?.trim() || createWishBoardItemId();
  const title = input.title.trim();
  const cost = assertNonNegativeCostPoints(input.cost_points);
  const description = input.description?.trim() ? input.description.trim() : null;
  const iconKey = input.icon_key?.trim() || DEFAULT_WISH_BOARD_ICON_KEY;
  const wishType = normalizeWishType(input.wish_type);
  const sortOrder = input.sort_order ?? 1000;
  const extraData = resolveWishBoardExtraData(null, input);

  await db.runAsync(
    `INSERT INTO wish_board_items (
      id, title, description, note, icon_key, wish_type, cost_points, status, redeemed_at, sort_order,
      created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, datetime('now'), datetime('now'), 'pending_create', ?)`,
    [id, title, description, description, iconKey, wishType, cost, sortOrder, extraData],
  );
  return id;
}

export async function updateWishBoardItem(id: string, input: UpdateWishBoardItemInput): Promise<void> {
  assertWishBoardPayload(input);
  const current = await requireLocalRowForWrite<WishBoardItemRow>('wish_board_items', id, '心愿');
  const mapped = mapWishBoardRow(current);
  if (
    mapped.status === 'redeemed' &&
    (input.title != null || input.cost_points != null || input.redeem_conditions !== undefined)
  ) {
    throw new Error('已兑换的心愿不可再改名称、积分或兑换条件');
  }

  const title = input.title != null ? input.title.trim() : mapped.title;
  const cost =
    input.cost_points != null ? assertNonNegativeCostPoints(input.cost_points) : mapped.cost_points;
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
  const extraData = resolveWishBoardExtraData(mapped.extra_data, input);

  const db = await getDatabase();
  await db.runAsync(
    `UPDATE wish_board_items SET
      title = ?, description = ?, note = ?, icon_key = ?, wish_type = ?, cost_points = ?,
      status = ?, redeemed_at = ?, sort_order = ?, extra_data = ?,
      updated_at = datetime('now'),
      sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'pending_update' END
     WHERE id = ?`,
    [
      title,
      description,
      description,
      iconKey,
      wishType,
      cost,
      status,
      redeemedAt,
      sortOrder,
      extraData,
      id,
    ],
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
  // 本地先校验绑定条件，避免服务端未支持多重条件时误兑
  const preItem = mapWishBoardRow(
    await requireLocalRowForWrite<WishBoardItemRow>('wish_board_items', id, '心愿'),
  );
  if (preItem.wish_type === 'once' && preItem.status === 'redeemed') {
    throw new Error('该心愿已兑换');
  }
  const preBalance = await getLocalPointsBalance();
  await assertWishBoardRedeemEligible(preItem, preBalance);
  const costPoints = asPoints(preItem.cost_points);

  try {
    const { appWishBoardRedeem } = await import('@/lib/api-app-domain');
    const result = await appWishBoardRedeem(id);
    const balance = asPoints(result.balance);
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
    const appliedDelta = asPoints(balance - preBalance);
    notifyPointsMutation({
      balance,
      delta: appliedDelta !== 0 ? appliedDelta : costPoints !== 0 ? -costPoints : undefined,
    });
    return { balance };
  } catch (e) {
    // 业务错误（积分不足、绑定未完成等）直接抛出；网络类错误走本地回退
    if (
      e instanceof Error &&
      /积分不足|已兑换|不存在|无效|未完成|兑换条件|绑定/.test(e.message)
    ) {
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

  const cost = asPoints(item.cost_points);
  // 事务外先校验绑定条件，避免 IMMEDIATE 事务中嵌套读项目/任务表
  {
    const previewBalance = await getLocalPointsBalance();
    await assertWishBoardRedeemEligible(item, previewBalance);
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
    if (cost > 0 && balance < cost) {
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
    notifyPointsMutation({ balance: next, delta: cost !== 0 ? -cost : undefined });
    return { balance: next };
  } catch (e) {
    await db.execAsync('ROLLBACK');
    throw e;
  }
}

/** 兑换语义别名：与 grant/adjust 并列的 PointsService 入口 */
export const redeemPoints = redeemWishBoardItem;
