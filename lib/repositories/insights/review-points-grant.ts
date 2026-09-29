import { enqueuePointsAdjust } from '@/lib/points-adjust-queue';
import { addDaysToYmd } from '@/lib/date';
import {
  loadReviewPointsSettings,
  REVIEW_STREAK_BONUS_DAYS,
  type ReviewPointsSettings,
} from '@/lib/review-points-settings';
import { normalizeRewardPoints, roundPoints } from '@/lib/reward-points';
import { getDatabase } from '@/lib/database';
import {
  collectColumnIds,
  parseDailyReviewBody,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import { listDailyReviewsBetween } from '@/lib/repositories/insights/daily-review-journal';
import { listReviewTemplate } from '@/lib/repositories/insights/review-template';
import { getRollingSevenDayRangeEndingOnNextReviewDay } from '@/lib/repositories/insights/weekly-review';
import {
  adjustPointsBalance,
  getLocalPointsBalance,
} from '@/lib/repositories/points/points';
import { getWeeklyReviewConfiguredWeekday } from '@/lib/weekly-review-settings';

const DAILY_REF_TYPE = 'daily_review';
const STREAK_REF_TYPE = 'daily_review_streak7';

/** 为算连续天数向前多取的日历日 */
const STREAK_LOOKBACK_DAYS = 60;

function shiftYmd(ymd: string, deltaDays: number): string {
  return addDaysToYmd(ymd, deltaDays);
}

function isDailyReviewSkippedForYmd(ymd: string, configuredDow: number | null): boolean {
  if (configuredDow === null) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const { endYmd } = getRollingSevenDayRangeEndingOnNextReviewDay(d, configuredDow);
  return ymd === endYmd;
}

function isDailyReviewDone(fields: ReviewFieldValues): boolean {
  return Object.values(fields).some(v => (v ?? '').trim().length > 0);
}

/** 以 endYmd 为终点的连续复盘天数（跳过周复盘日） */
function countStreakEndingAt(
  byYmd: Map<string, ReviewFieldValues>,
  configuredDow: number | null,
  endYmd: string,
): number {
  if (!endYmd || isDailyReviewSkippedForYmd(endYmd, configuredDow)) return 0;
  const endFields = byYmd.get(endYmd);
  if (!endFields || !isDailyReviewDone(endFields)) return 0;

  let streak = 0;
  let cursor = endYmd;
  for (let i = 0; i < 366; i++) {
    if (isDailyReviewSkippedForYmd(cursor, configuredDow)) {
      cursor = shiftYmd(cursor, -1);
      continue;
    }
    const fields = byYmd.get(cursor);
    if (!fields || !isDailyReviewDone(fields)) break;
    streak += 1;
    cursor = shiftYmd(cursor, -1);
  }
  return streak;
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

async function applyConfiguredPointsReward(opts: {
  refType: string;
  refId: string;
  direction: 'earn' | 'undo';
  points: number;
  earnReason: string;
  undoReason: string;
}): Promise<number> {
  const configured = normalizeRewardPoints(opts.points);
  if (configured === 0) return 0;

  return enqueuePointsAdjust(async () => {
    if (opts.direction === 'earn') {
      const net = await sumLedgerDeltaForRef(opts.refType, opts.refId);
      if (configured > 0 && net > 0) return 0;
      if (configured < 0 && net < 0) return 0;
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
      if (deduct <= 0) {
        const balance = await getLocalPointsBalance();
        deduct = Math.min(configured, Math.max(0, balance));
        if (deduct <= 0) return 0;
      }
      try {
        const result = await adjustPointsBalance({
          delta: -deduct,
          reason: opts.undoReason,
          ref_type: opts.refType,
          ref_id: opts.refId,
        });
        return result.delta;
      } catch (e) {
        if (__DEV__) console.warn('[review-points-undo]', opts.refType, opts.refId, e);
        return 0;
      }
    }

    const abs = Math.abs(configured);
    let restore = Math.min(abs, Math.max(0, -net));
    if (restore <= 0) restore = abs;
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
      if (__DEV__) console.warn('[review-points-undo-restore]', opts.refType, opts.refId, e);
      return 0;
    }
  });
}

async function syncOneReward(opts: {
  refType: string;
  refId: string;
  active: boolean;
  points: number;
  earnReason: string;
  undoReason: string;
}): Promise<number> {
  const points = normalizeRewardPoints(opts.points);
  if (points === 0) return 0;
  const net = await sumLedgerDeltaForRef(opts.refType, opts.refId);

  if (points > 0) {
    if (opts.active && net <= 0) {
      return applyConfiguredPointsReward({
        refType: opts.refType,
        refId: opts.refId,
        direction: 'earn',
        points,
        earnReason: opts.earnReason,
        undoReason: opts.undoReason,
      });
    }
    if (!opts.active && net > 0) {
      return applyConfiguredPointsReward({
        refType: opts.refType,
        refId: opts.refId,
        direction: 'undo',
        points,
        earnReason: opts.earnReason,
        undoReason: opts.undoReason,
      });
    }
    return 0;
  }

  if (opts.active && net >= 0) {
    return applyConfiguredPointsReward({
      refType: opts.refType,
      refId: opts.refId,
      direction: 'earn',
      points,
      earnReason: opts.earnReason,
      undoReason: opts.undoReason,
    });
  }
  if (!opts.active && net < 0) {
    return applyConfiguredPointsReward({
      refType: opts.refType,
      refId: opts.refId,
      direction: 'undo',
      points,
      earnReason: opts.earnReason,
      undoReason: opts.undoReason,
    });
  }
  return 0;
}

/**
 * 日复盘保存后同步积分：
 * - 当日有内容 → 发放每日奖励（可撤销）
 * - 以该日为终点连续满 7 / 14 / … 天 → 发放七天坚持总奖励（可撤销）
 * @returns 净变动积分
 */
export async function syncDailyReviewPointsForYmd(params: {
  ymd: string;
  settings?: ReviewPointsSettings;
}): Promise<number> {
  const ymd = String(params.ymd ?? '').trim();
  if (!ymd) return 0;

  const settings = params.settings ?? (await loadReviewPointsSettings());
  if (!settings.enabled) return 0;

  const [configuredDow, tpl] = await Promise.all([
    getWeeklyReviewConfiguredWeekday(),
    listReviewTemplate('daily'),
  ]);
  if (isDailyReviewSkippedForYmd(ymd, configuredDow)) return 0;

  const colIds = collectColumnIds(tpl);
  const start = shiftYmd(ymd, -STREAK_LOOKBACK_DAYS);
  const rows = await listDailyReviewsBetween(start, ymd);
  const byYmd = new Map(
    rows.map(r => [r.record_date_ymd, parseDailyReviewBody(r.body ?? '', colIds)]),
  );

  const fields = byYmd.get(ymd) ?? {};
  const done = isDailyReviewDone(fields);
  const streak = countStreakEndingAt(byYmd, configuredDow, ymd);
  const streakBonusEligible =
    done && streak > 0 && streak % REVIEW_STREAK_BONUS_DAYS === 0;

  let total = 0;
  total += await syncOneReward({
    refType: DAILY_REF_TYPE,
    refId: ymd,
    active: done,
    points: settings.dailyRewardPoints,
    earnReason: 'daily_review_complete',
    undoReason: 'daily_review_complete_undo',
  });
  total += await syncOneReward({
    refType: STREAK_REF_TYPE,
    refId: ymd,
    active: streakBonusEligible,
    points: settings.streak7BonusPoints,
    earnReason: 'daily_review_streak7',
    undoReason: 'daily_review_streak7_undo',
  });

  return roundPoints(total);
}
