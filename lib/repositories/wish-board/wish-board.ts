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
      return a.sort_order - b.sort_order || b.updated_at.localeCompare(a.updated_at);
    });
}

/**
 * 兑换记录列表：每次 wish_redeem 流水一条（一次性归档 + 重复性每次兑换）。
 * 与「心愿列表」分离；重复性心愿本体仍保持 active。
 * 若历史一次性已兑换缺少流水，仍按 wish_board_items.status=redeemed 兜底展示。
 */
export async function listWishRedeemRecords(opts?: PageApiReadOpts): Promise<WishRedeemRecord[]> {
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

/** 删除「已兑换」中的一条记录：软删流水；一次性已归档则同时软删心愿条目。 */
export async function deleteWishRedeemRecord(record: WishRedeemRecord): Promise<void> {
  if (!record.is_fallback) {
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
  const current = await ensureLocalRowForWrite<WishBoardItemRow>('wish_board_items', id);
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
 * 本地兑换：校验余额 → 扣积分 → 记流水（每次兑换一条 wish_redeem，含 repeat）。
 * - once：标记 status=redeemed
 * - repeat：保持 active，仅更新 redeemed_at 为最近兑换时间；「已兑换」列表靠流水展示每次记录
 * 服务端应对齐 `POST /api/wish-board/redeem`。
 */
export async function redeemWishBoardItem(id: string): Promise<{ balance: number }> {
  const item = mapWishBoardRow(await ensureLocalRowForWrite<WishBoardItemRow>('wish_board_items', id));
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
 * 调整积分余额并记流水（习惯打卡发奖 / 撤销扣回等）。
 * 服务端应对齐 `POST /api/wish-board/points/adjust`。
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
 * 将积分余额清零并记流水（心愿板「重置积分」）。
 * 服务端应对齐 `POST /api/wish-board/points/reset`。
 */
export async function resetPointsBalance(): Promise<{ balance: number; delta: number; ledger_id: string | null }> {
  return enqueuePointsAdjust(async () => {
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
