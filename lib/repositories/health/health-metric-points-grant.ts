import {
  isCaloriesPenaltyEligible,
  isIntakeMetricRewardEligible,
  listIntakeRewardMetricKeys,
  type HealthMetricKey,
  type HealthMetricPointsSettings,
} from '@/lib/health-metric-points-settings';
import { enqueuePointsAdjust } from '@/lib/points-adjust-queue';
import { normalizeRewardPoints, roundPoints } from '@/lib/reward-points';
import {
  adjustPointsBalance,
  getLocalPointsBalance,
} from '@/lib/repositories/wish-board/wish-board';
import { getDatabase } from '@/lib/database';

const REF_TYPE = 'health_metric';

export type HealthMetricPercents = Record<HealthMetricKey, number>;

function healthMetricRefId(ymd: string, metric: HealthMetricKey): string {
  return `${ymd}:${metric}`;
}

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

async function applyHealthMetricPointsReward(opts: {
  ymd: string;
  metric: HealthMetricKey;
  direction: 'earn' | 'undo';
  points: number;
}): Promise<number> {
  const configured = normalizeRewardPoints(opts.points);
  if (configured === 0) return 0;
  const refId = healthMetricRefId(opts.ymd, opts.metric);

  return enqueuePointsAdjust(async () => {
    if (opts.direction === 'earn') {
      const net = await sumLedgerDeltaForRef(REF_TYPE, refId);
      // 正分：已发放过则跳过；负分（扣分）：已扣过则跳过
      if (configured > 0 && net > 0) return 0;
      if (configured < 0 && net < 0) return 0;
      try {
        const result = await adjustPointsBalance({
          delta: configured,
          reason: configured > 0 ? 'health_metric_complete' : 'health_metric_over_penalty',
          ref_type: REF_TYPE,
          ref_id: refId,
        });
        return result.delta;
      } catch {
        throw new Error(configured > 0 ? '积分发放失败' : '积分扣除失败');
      }
    }

    const net = await sumLedgerDeltaForRef(REF_TYPE, refId);
    if (configured > 0) {
      let deduct = Math.min(configured, Math.max(0, net));
      if (deduct <= 0) {
        const balance = await getLocalPointsBalance();
        deduct = Math.min(configured, Math.max(0, balance));
        if (deduct <= 0) return 0;
      }
      try {
        const result = await adjustPointsBalance({
          delta: -deduct,
          reason: 'health_metric_complete_undo',
          ref_type: REF_TYPE,
          ref_id: refId,
        });
        return result.delta;
      } catch (e) {
        if (__DEV__) console.warn('[health-metric-points-undo]', refId, e);
        return 0;
      }
    }

    // 负数奖励（热量超额扣分）：撤销时返还
    const abs = Math.abs(configured);
    let restore = Math.min(abs, Math.max(0, -net));
    if (restore <= 0) {
      // 流水异常时仍尽量按配置返还
      restore = abs;
    }
    if (restore <= 0) return 0;
    try {
      const result = await adjustPointsBalance({
        delta: restore,
        reason: 'health_metric_over_penalty_undo',
        ref_type: REF_TYPE,
        ref_id: refId,
      });
      return result.delta;
    } catch (e) {
      if (__DEV__) console.warn('[health-metric-points-undo-restore]', refId, e);
      return 0;
    }
  });
}

async function syncOneMetric(opts: {
  ymd: string;
  metric: HealthMetricKey;
  active: boolean;
  points: number;
}): Promise<number> {
  const net = await sumLedgerDeltaForRef(REF_TYPE, healthMetricRefId(opts.ymd, opts.metric));
  const points = normalizeRewardPoints(opts.points);
  if (points === 0) return 0;

  if (points > 0) {
    if (opts.active && net <= 0) {
      return applyHealthMetricPointsReward({
        ymd: opts.ymd,
        metric: opts.metric,
        direction: 'earn',
        points,
      });
    }
    if (!opts.active && net > 0) {
      return applyHealthMetricPointsReward({
        ymd: opts.ymd,
        metric: opts.metric,
        direction: 'undo',
        points,
      });
    }
    return 0;
  }

  // 扣分项（热量超额）
  if (opts.active && net >= 0) {
    return applyHealthMetricPointsReward({
      ymd: opts.ymd,
      metric: opts.metric,
      direction: 'earn',
      points,
    });
  }
  if (!opts.active && net < 0) {
    return applyHealthMetricPointsReward({
      ymd: opts.ymd,
      metric: opts.metric,
      direction: 'undo',
      points,
    });
  }
  return 0;
}

/**
 * 按当日各指标进度与阈值设置，同步发奖 / 扣回。
 * - 水分 / 蛋白 / 碳水：达到阈值加分，回落扣回
 * - 热量：超过阈值扣分，回到阈值内返还
 * @returns 净变动积分（正获负扣）
 */
export async function syncHealthMetricPointsForDay(params: {
  ymd: string;
  /** 展示用封顶百分比亦可；热量请传未封顶百分比以便识别 >100% */
  percents: HealthMetricPercents;
  settings: HealthMetricPointsSettings;
}): Promise<number> {
  const { ymd, percents, settings } = params;
  if (!ymd) return 0;
  if (!settings.enabled) return 0;

  let total = 0;
  const reward = Math.abs(normalizeRewardPoints(settings.rewardPoints));

  for (const metric of listIntakeRewardMetricKeys()) {
    total += await syncOneMetric({
      ymd,
      metric,
      active: isIntakeMetricRewardEligible(percents[metric] ?? 0, settings),
      points: reward,
    });
  }

  total += await syncOneMetric({
    ymd,
    metric: 'calories',
    active: isCaloriesPenaltyEligible(percents.calories ?? 0, settings),
    points: -reward,
  });

  return roundPoints(total);
}
