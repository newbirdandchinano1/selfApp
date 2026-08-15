import { makeTimestampEntityId } from '@/lib/entity-id';
import { ensureLocalRowForWrite } from '@/lib/api-local-row';
import { readApiRecord, readApiTable } from '@/lib/api-read';
import type { PageApiReadOpts } from '@/lib/page-api-session';
import { DEFAULT_WISH_BOARD_ICON_KEY } from '@/lib/constants/wish-board-icons';
import { notifyPointsEarned } from '@/lib/points-earned-toast-events';
import { getDatabase } from '../../database.native';
import type {
  CreateWishBoardItemInput,
  PointsWalletRow,
  UpdateWishBoardItemInput,
  WishBoardItemRow,
  WishBoardWishType,
} from './wish-board.types';

export const POINTS_WALLET_ID = 'default';

export function createWishBoardItemId(): string {
  return makeTimestampEntityId('wbi_', 8);
}

export function createPointsLedgerId(): string {
  return makeTimestampEntityId('plg_', 8);
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
 * 本地兑换：校验余额 → 扣积分 → 记流水。
 * - once：标记 status=redeemed
 * - repeat：保持 active，仅更新 redeemed_at 为最近兑换时间
 * 服务端应对齐 `POST /api/wish-board/redeem`。
 */
export async function redeemWishBoardItem(id: string): Promise<{ balance: number }> {
  const item = mapWishBoardRow(await ensureLocalRowForWrite<WishBoardItemRow>('wish_board_items', id));
  if (item.wish_type === 'once' && item.status === 'redeemed') {
    throw new Error('该心愿已兑换');
  }

  const cost = Math.floor(Number(item.cost_points) || 0);
  if (cost < 0) throw new Error('所需积分无效');

  const db = await getDatabase();
  await db.execAsync('BEGIN IMMEDIATE');
  try {
    await db.runAsync(
      `INSERT OR IGNORE INTO points_wallet (id, balance, created_at, updated_at, sync_status)
       VALUES (?, 0, datetime('now'), datetime('now'), 'synced')`,
      [POINTS_WALLET_ID],
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
        updated_at = datetime('now'),
        sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'pending_update' END
       WHERE id = ?`,
      [next, POINTS_WALLET_ID],
    );
    const ledgerId = createPointsLedgerId();
    await db.runAsync(
      `INSERT INTO points_ledger (
        id, delta, balance_after, reason, ref_type, ref_id,
        created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, 'wish_redeem', 'wish_board_item', ?, datetime('now'), datetime('now'), 'pending_create')`,
      [ledgerId, -cost, next, id],
    );

    if (item.wish_type === 'repeat') {
      await db.runAsync(
        `UPDATE wish_board_items SET
          status = 'active',
          redeemed_at = datetime('now'),
          updated_at = datetime('now'),
          sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'pending_update' END
         WHERE id = ?`,
        [id],
      );
    } else {
      await db.runAsync(
        `UPDATE wish_board_items SET
          status = 'redeemed',
          redeemed_at = datetime('now'),
          updated_at = datetime('now'),
          sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'pending_update' END
         WHERE id = ?`,
        [id],
      );
    }
    await db.execAsync('COMMIT');
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

  const db = await getDatabase();
  await db.execAsync('BEGIN IMMEDIATE');
  try {
    await db.runAsync(
      `INSERT OR IGNORE INTO points_wallet (id, balance, created_at, updated_at, sync_status)
       VALUES (?, 0, datetime('now'), datetime('now'), 'synced')`,
      [POINTS_WALLET_ID],
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
        updated_at = datetime('now'),
        sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'pending_update' END
       WHERE id = ?`,
      [next, POINTS_WALLET_ID],
    );
    const ledgerId = createPointsLedgerId();
    await db.runAsync(
      `INSERT INTO points_ledger (
        id, delta, balance_after, reason, ref_type, ref_id,
        created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create')`,
      [ledgerId, delta, next, reason, refType, refId],
    );
    await db.execAsync('COMMIT');
    if (delta > 0) notifyPointsEarned(delta);
    return { balance: next, delta, ledger_id: ledgerId };
  } catch (e) {
    await db.execAsync('ROLLBACK');
    throw e;
  }
}
