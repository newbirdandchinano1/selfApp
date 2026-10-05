/**
 * 阶段 1：上线前冲刷遗留 pending。
 * 仅在推送抛错时阻断；SQLite 里冲不掉的历史 pending 不得伪装成「没网」。
 * 课表 outbox 已拆除，不再作为闸门条件。
 */

export const PENDING_FLUSH_BLOCK_MESSAGE =
  '有未同步到服务器的本地修改，请保持网络后重试';

export type PendingFlushInventory = {
  /** 各表 pending 行数（仅 >0） */
  tableCounts: Record<string, number>;
  /** 表 pending 行数合计 */
  total: number;
};

export type PendingFlushResult = {
  ok: boolean;
  /** 启动时本来就没有待上传数据 */
  skipped: boolean;
  inventoryBefore: PendingFlushInventory;
  inventoryAfter: PendingFlushInventory;
  error?: string;
};

type BlockListener = (blocked: boolean, message: string | null) => void;

let inflight: Promise<PendingFlushResult> | null = null;
let blockedFromFailedFlush = false;
let lastBlockMessage: string | null = null;
const blockListeners = new Set<BlockListener>();

/**
 * 把冲刷异常转成用户可见文案（保留真实原因，避免永远只提示「请保持网络」）。
 */
function formatFlushBlockMessage(err: unknown): string {
  let detail = '';
  if (err instanceof Error && err.message.trim()) {
    detail = err.message.trim();
  } else if (err != null) {
    detail = String(err).trim();
  }
  if (!detail) return PENDING_FLUSH_BLOCK_MESSAGE;
  if (detail.includes('未同步到服务器') || detail.includes('请保持网络')) return detail;
  return `${PENDING_FLUSH_BLOCK_MESSAGE}\n${detail}`;
}

function logPendingFlushInventory(tag: string, inventory: PendingFlushInventory): void {
  if (!__DEV__) return;
  console.log(`[pending-flush] ${tag}`, {
    tables: inventory.tableCounts,
    total: inventory.total,
  });
}

function setBlockedFromFailedFlush(blocked: boolean, message?: string | null): void {
  blockedFromFailedFlush = blocked;
  lastBlockMessage = blocked ? (message?.trim() || PENDING_FLUSH_BLOCK_MESSAGE) : null;
  for (const listener of blockListeners) {
    listener(blockedFromFailedFlush, lastBlockMessage);
  }
}

/**
 * 订阅冲刷失败阻断状态（启动闸门与登录后二次冲刷共用）。
 */
export function subscribePendingFlushBlock(listener: BlockListener): () => void {
  blockListeners.add(listener);
  listener(blockedFromFailedFlush, lastBlockMessage);
  return () => {
    blockListeners.delete(listener);
  };
}

export function isPendingFlushBlocked(): boolean {
  return blockedFromFailedFlush;
}

/** 扫描 SQLite pending 行。 */
export async function collectPendingFlushInventory(): Promise<PendingFlushInventory> {
  const { countPendingApiSyncRowsByTable } = await import('@/lib/api-incremental-sync');
  const tableCounts = await countPendingApiSyncRowsByTable();
  let tableTotal = 0;
  for (const n of Object.values(tableCounts)) tableTotal += n;
  return {
    tableCounts,
    total: tableTotal,
  };
}

/**
 * 启动或登录后强制把本地 pending 推到服务器。
 * 失败保持队列，返回 ok:false，由 UI 阻断进入。
 */
export async function runStartupPendingFlush(): Promise<PendingFlushResult> {
  if (inflight) return inflight;

  inflight = (async (): Promise<PendingFlushResult> => {
    const before = await collectPendingFlushInventory();
    logPendingFlushInventory('启动扫描', before);

    if (before.total === 0) {
      setBlockedFromFailedFlush(false);
      return {
        ok: true,
        skipped: true,
        inventoryBefore: before,
        inventoryAfter: before,
      };
    }

    try {
      const { getDatabase } = await import('@/lib/database');
      const { markAllPendingTablesDirty } = await import('@/lib/api-incremental-sync');
      const { requestPush } = await import('@/lib/sync-manager');
      if (!(await getDatabase())) {
        throw new Error('本地数据库未就绪，请稍后重试');
      }
      await markAllPendingTablesDirty();
      await requestPush({ awaitSync: true, rethrow: true, quiet: true });

      const after = await collectPendingFlushInventory();
      logPendingFlushInventory('冲刷后', after);

      // 可上传 pending 数量没有下降：飞行模式/请求被吞掉时不得当成功进首页（1-B）
      // 有网时若部分上传成功（after < before），即使 OCC 残留也不按断网拦住
      if (after.total > 0 && after.total >= before.total) {
        const error = PENDING_FLUSH_BLOCK_MESSAGE;
        if (__DEV__) {
          console.warn('[pending-flush] 冲刷后可上传 pending 未减少，阻断进入', after.tableCounts);
        }
        setBlockedFromFailedFlush(true, error);
        return {
          ok: false,
          skipped: false,
          inventoryBefore: before,
          inventoryAfter: after,
          error,
        };
      }

      setBlockedFromFailedFlush(false);
      return {
        ok: true,
        skipped: false,
        inventoryBefore: before,
        inventoryAfter: after,
      };
    } catch (e) {
      const after = await collectPendingFlushInventory().catch(
        (): PendingFlushInventory => before,
      );
      logPendingFlushInventory('冲刷失败', after);
      const error = formatFlushBlockMessage(e);
      if (__DEV__) {
        console.warn('[pending-flush] 冲刷抛错，阻断进入', e);
      }
      setBlockedFromFailedFlush(true, error);
      return {
        ok: false,
        skipped: false,
        inventoryBefore: before,
        inventoryAfter: after,
        error,
      };
    }
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

/**
 * 登录拿到新 token 后再次冲刷（与启动闸门去重）。
 */
export function schedulePendingFlushAfterLogin(): void {
  void runStartupPendingFlush().then(result => {
    if (__DEV__) {
      console.log('[pending-flush] 登录后冲刷', {
        ok: result.ok,
        skipped: result.skipped,
        remaining: result.inventoryAfter.total,
      });
    }
  });
}
