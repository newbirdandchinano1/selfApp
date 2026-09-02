import { normalizeRewardPoints, parseRewardPointsFromExtraData, roundPoints } from '@/lib/reward-points';
import { enqueuePointsAdjust } from '@/lib/points-adjust-queue';
import { getProjectById } from '@/lib/repositories/projects/project';
import { getTaskById } from '@/lib/repositories/tasks/task';
import {
  adjustPointsBalance,
  getLocalPointsBalance,
} from '@/lib/repositories/wish-board/wish-board';
import { getDatabase } from '@/lib/database';

export type PointsRewardRefType = 'habit' | 'task' | 'project';

async function sumLedgerDeltaForRef(refType: string, refId: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ net: number }>(
    `SELECT COALESCE(SUM(delta), 0) AS net
     FROM points_ledger
     WHERE ref_type = ? AND ref_id = ?`,
    [refType, refId],
  );
  return roundPoints(Number(row?.net) || 0);
}

async function resolveExtraData(opts: {
  refType: PointsRewardRefType;
  refId: string;
  extraData?: string | null;
}): Promise<string | null> {
  if (opts.extraData !== undefined) return opts.extraData;
  if (opts.refType === 'task') {
    const row = await getTaskById(opts.refId);
    return row?.extra_data ?? null;
  }
  if (opts.refType === 'project') {
    const row = await getProjectById(opts.refId);
    return row?.extra_data ?? null;
  }
  const { getHabitById } = await import('@/lib/repositories/habits/habit');
  const row = await getHabitById(opts.refId);
  return row?.extra_data ?? null;
}

/**
 * 按实体配置发奖 / 按流水净额回退。
 * 正数奖励：完成加分、撤销扣回；负数奖励：完成扣分、撤销返还。
 * `forceUndo`：已知刚从「已完成」撤销时，若流水净额异常，仍按配置回退。
 */
export async function applyEntityPointsReward(opts: {
  refType: PointsRewardRefType;
  refId: string;
  direction: 'earn' | 'undo';
  extraData?: string | null;
  /** 若已知单次奖励分值可传入，否则从 extra_data.reward_points 解析 */
  points?: number;
  earnReason: string;
  undoReason: string;
  forceUndo?: boolean;
}): Promise<number> {
  return enqueuePointsAdjust(async () => {
    const configured =
      opts.points != null
        ? normalizeRewardPoints(opts.points)
        : parseRewardPointsFromExtraData(await resolveExtraData(opts));
    if (configured === 0) return 0;

    if (opts.direction === 'earn') {
      try {
        const result = await adjustPointsBalance({
          delta: configured,
          reason: opts.earnReason,
          ref_type: opts.refType,
          ref_id: opts.refId,
        });
        return result.delta;
      } catch {
        throw new Error(configured > 0 ? '积分发放失败' : '积分扣除失败');
      }
    }

    const net = await sumLedgerDeltaForRef(opts.refType, opts.refId);

    if (configured > 0) {
      let deduct = Math.min(configured, Math.max(0, net));
      if (deduct <= 0 && opts.forceUndo) {
        const balance = await getLocalPointsBalance();
        deduct = Math.min(configured, Math.max(0, balance));
        if (deduct <= 0) deduct = configured;
      }
      if (deduct <= 0) return 0;
      try {
        const result = await adjustPointsBalance({
          delta: -deduct,
          reason: opts.undoReason,
          ref_type: opts.refType,
          ref_id: opts.refId,
        });
        return result.delta;
      } catch (e) {
        if (__DEV__) console.warn('[points-undo]', opts.refType, opts.refId, e);
        return 0;
      }
    }

    // 负数奖励：完成时已扣分，撤销时返还
    const abs = Math.abs(configured);
    let restore = Math.min(abs, Math.max(0, -net));
    if (restore <= 0 && opts.forceUndo) {
      restore = abs;
    }
    if (restore <= 0) return 0;
    try {
      const result = await adjustPointsBalance({
        delta: restore,
        reason: opts.undoReason,
        ref_type: opts.refType,
        ref_id: opts.refId,
      });
      return result.delta;
    } catch (e) {
      if (__DEV__) console.warn('[points-undo-restore]', opts.refType, opts.refId, e);
      return 0;
    }
  });
}

/**
 * 按实体 extra_data.reward_points 发奖 / 扣回。
 * @returns 实际变动积分（正获负扣）；0 表示无配置或未变动
 */
export async function applyCompletionPointsReward(opts: {
  refType: PointsRewardRefType;
  refId: string;
  direction: 'earn' | 'undo';
  /** 若已持有 extra_data，可传入以避免再读库 */
  extraData?: string | null;
  forceUndo?: boolean;
}): Promise<number> {
  return applyEntityPointsReward({
    ...opts,
    earnReason: `${opts.refType}_complete`,
    undoReason: `${opts.refType}_complete_undo`,
  });
}
