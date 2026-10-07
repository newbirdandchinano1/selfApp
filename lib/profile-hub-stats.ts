import {
  formatDietaryPrefsSummary,
  isDietaryPrefsEmpty,
  loadDietaryPrefs,
  type DietaryPrefs,
} from '@/lib/dietary-prefs';
import { getDatabase } from '@/lib/database';
import { isYmdInRange } from '@/lib/date';
import { ymdFromAuditDatetime } from '@/lib/api-mysql-datetime';
import { getLifeBetDerivedStats } from '@/lib/life-road/life-road-derived';
import { currentCalendarYear } from '@/lib/life-road/life-road-limits';
import { listDailyReviewsBetween } from '@/lib/repositories/insights/daily-review-journal';
import { getWeeklyReviewJournalByWeek } from '@/lib/repositories/insights/weekly-review-journal';
import { getCurrentWeekRange } from '@/lib/repositories/insights/weekly-review';
import { listWeightLogsLastNDays } from '@/lib/repositories/health/weight-log';
import { getLifeBetsLocal } from '@/lib/repositories/life-road/life-bet';
import { getLifeDirectionLocal } from '@/lib/repositories/life-road/life-direction';
import type { LifeBetHorizon, LifeBetStatus } from '@/lib/life-road/life-road-limits';
import { listWishBoardItems } from '@/lib/repositories/wish-board/wish-board';
import type { UserRow } from '@/lib/repositories/users/user.types';
import { roundPoints } from '@/lib/reward-points';

export type ProfileCompletenessItem = {
  key: 'birthday' | 'height' | 'weight' | 'persona' | 'dietary';
  label: string;
  filled: boolean;
  tab: 'basic' | 'persona' | 'body';
};

export type ProfileWishProgress = {
  nearestWishTitle: string | null;
  nearestWishCost: number;
  pointsBalance: number;
  pointsNeeded: number;
  canRedeemNearest: boolean;
  weekEarned: number;
  weekSpent: number;
};

export type ProfileWeekRhythm = {
  weekStartYmd: string;
  weekEndYmd: string;
  habitCheckInTotal: number;
  activeHabitCount: number;
  habitCheckInRatePercent: number;
  tasksCompleted: number;
  dailyReviewDays: number;
  daysElapsedInclusive: number;
  weeklyReviewDone: boolean;
};

export type ProfileWeightTrend = {
  latestKg: number | null;
  points: { ymd: string; weight_kg: number }[];
};

export type ProfileArchiveSummary = {
  goal: string;
  lifestyle: string;
  workoutDaysLabel: string;
  personaFilled: boolean;
  dietarySummary: string;
  dietaryEmpty: boolean;
};

/** 我的页道路卡片：单条赌注摘要（含派生，失败时 count 为 null） */
export type ProfileRoadBetSummary = {
  id: string;
  title: string;
  status: LifeBetStatus;
  horizon: LifeBetHorizon;
  year: number | null;
  activeProjectCount: number | null;
  latestCompletedName: string | null;
  isEmptyWindow: boolean;
};

export type ProfileRoadHub = {
  direction: string | null;
  yearTheme: string | null;
  /** 今年桶：默认不含放弃；最多 5 条在路上/暂搁/已抵达 */
  yearBets: ProfileRoadBetSummary[];
  /** 两三年/更远（不含放弃），有则卡片出「更远」段 */
  fartherBets: ProfileRoadBetSummary[];
  /** 读缓存失败时非空；UI 显示错误+重试，不编造清单 */
  error: string | null;
};

export type ProfileHubStats = {
  completeness: ProfileCompletenessItem[];
  missingCount: number;
  wish: ProfileWishProgress;
  week: ProfileWeekRhythm;
  weightTrend: ProfileWeightTrend;
  archive: ProfileArchiveSummary;
  dietary: DietaryPrefs;
  road: ProfileRoadHub;
};

const EMPTY_ROAD: ProfileRoadHub = {
  direction: null,
  yearTheme: null,
  yearBets: [],
  fartherBets: [],
  error: null,
};

/** 从本地缓存组装道路 hub；失败不抛，写入 error */
async function loadRoadHub(): Promise<ProfileRoadHub> {
  try {
    const [direction, bets] = await Promise.all([
      getLifeDirectionLocal(),
      getLifeBetsLocal(),
    ]);
    const calendarYear = currentCalendarYear();
    const yearCandidates = bets.filter((b) => {
      if (b.horizon !== 'year') return false;
      if (b.status === 'dropped') return false;
      if (b.year == null) return true;
      return b.year === calendarYear;
    });
    const yearBetsRaw = yearCandidates.slice(0, 5);
    const fartherRaw = bets.filter(
      (b) => (b.horizon === 'multi' || b.horizon === 'farther') && b.status !== 'dropped',
    );

    const toSummary = async (b: (typeof bets)[number]): Promise<ProfileRoadBetSummary> => {
      const derived = await getLifeBetDerivedStats(b.id, b.status);
      return {
        id: b.id,
        title: b.title,
        status: b.status,
        horizon: b.horizon,
        year: b.year,
        activeProjectCount: derived.activeProjectCount,
        latestCompletedName: derived.latestCompletedName,
        isEmptyWindow: derived.isEmptyWindow,
      };
    };

    const [yearBets, fartherBets] = await Promise.all([
      Promise.all(yearBetsRaw.map(toSummary)),
      Promise.all(fartherRaw.map(toSummary)),
    ]);

    return {
      direction: direction?.body?.trim() || null,
      yearTheme: direction?.year_theme?.trim() || null,
      yearBets,
      fartherBets,
      error: null,
    };
  } catch (e) {
    if (__DEV__) console.warn('[profile-hub] road load failed', e);
    return {
      ...EMPTY_ROAD,
      error: e instanceof Error ? e.message : '道路加载失败',
    };
  }
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function localYmd(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseWorkoutDays(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d): d is string => typeof d === 'string' && d.trim().length > 0);
  } catch {
    return [];
  }
}

function daysInclusive(startYmd: string, endYmd: string): number {
  const [ys, ms, ds] = startYmd.split('-').map(Number);
  const [ye, me, de] = endYmd.split('-').map(Number);
  const a = new Date(ys, (ms ?? 1) - 1, ds ?? 1);
  const b = new Date(ye, (me ?? 1) - 1, de ?? 1);
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
  return Math.max(1, diff + 1);
}

async function loadWeekPoints(startYmd: string, endYmd: string): Promise<{ earned: number; spent: number }> {
  const db = await getDatabase();
  if (!db) return { earned: 0, spent: 0 };
  const rows = await db.getAllAsync<{ delta: number; created_at: string }>(
    `SELECT delta, created_at FROM points_ledger WHERE sync_status != 'pending_delete'`,
  );
  let earned = 0;
  let spent = 0;
  for (const row of rows ?? []) {
    const day = ymdFromAuditDatetime(row.created_at) ?? String(row.created_at).slice(0, 10);
    if (!day || !isYmdInRange(day, startYmd, endYmd)) continue;
    const delta = roundPoints(Number(row.delta) || 0);
    if (delta > 0) earned += delta;
    else if (delta < 0) spent += Math.abs(delta);
  }
  return { earned: roundPoints(earned), spent: roundPoints(spent) };
}

function buildCompleteness(user: UserRow | null, dietaryEmpty: boolean): ProfileCompletenessItem[] {
  return [
    {
      key: 'birthday',
      label: '生日',
      filled: Boolean(user?.birthday?.trim()),
      tab: 'basic',
    },
    {
      key: 'height',
      label: '身高',
      filled: Boolean(user && user.height > 0),
      tab: 'body',
    },
    {
      key: 'weight',
      label: '体重',
      filled: Boolean(user && user.weight > 0),
      tab: 'body',
    },
    {
      key: 'persona',
      label: '人物画像',
      filled: Boolean(user?.persona_portrait?.trim()),
      tab: 'persona',
    },
    {
      key: 'dietary',
      label: '饮食偏好',
      filled: !dietaryEmpty,
      tab: 'body',
    },
  ];
}

export async function loadProfileHubStats(
  user: UserRow | null,
  pointsBalance: number,
): Promise<ProfileHubStats> {
  const { startYmd, endYmd } = getCurrentWeekRange();
  const todayYmd = localYmd();
  const elapsedEnd = todayYmd < endYmd ? todayYmd : endYmd;
  const daysElapsedInclusive = daysInclusive(startYmd, elapsedEnd);

  const dietary = await loadDietaryPrefs();
  const dietaryEmpty = isDietaryPrefsEmpty(dietary);

  const [wishItems, weekPoints, weightLogs, dailyReviews, weeklyJournal, habitMeta, tasksDone, road] =
    await Promise.all([
      listWishBoardItems().catch(() => []),
      loadWeekPoints(startYmd, endYmd),
      listWeightLogsLastNDays(30, todayYmd).catch(() => []),
      listDailyReviewsBetween(startYmd, elapsedEnd).catch(() => []),
      getWeeklyReviewJournalByWeek(startYmd).catch(() => null),
      (async () => {
        const db = await getDatabase();
        if (!db) return { checkIns: 0, habits: 0 };
        const [habits, checkIns] = await Promise.all([
          db.getAllAsync<{ id: string }>(`SELECT id FROM habits WHERE sync_status != 'pending_delete'`),
          db.getAllAsync<{ habit_id: string; count: number }>(
            `SELECT habit_id, count FROM habit_check_ins
             WHERE record_date >= ? AND record_date <= ? AND sync_status != 'pending_delete'`,
            [startYmd, elapsedEnd],
          ),
        ]);
        const active = new Set((habits ?? []).map((h) => h.id));
        const total = (checkIns ?? [])
          .filter((c) => active.has(c.habit_id) && (c.count ?? 0) > 0)
          .reduce((sum, c) => sum + Math.max(0, Number(c.count) || 0), 0);
        return { checkIns: total, habits: active.size };
      })(),
      (async () => {
        const db = await getDatabase();
        if (!db) return 0;
        const tasks = await db.getAllAsync<{ status?: string; completed_at?: string | null }>(
          `SELECT status, completed_at FROM tasks WHERE sync_status != 'pending_delete'`,
        );
        return (tasks ?? []).filter((t) => {
          if (t.status !== 'done' || !t.completed_at) return false;
          const day = ymdFromAuditDatetime(t.completed_at);
          return day != null && isYmdInRange(day, startYmd, elapsedEnd);
        }).length;
      })(),
      loadRoadHub(),
    ]);

  const activeWishes = (wishItems ?? []).filter((w) => w.status === 'active');
  const priced = activeWishes
    .map((w) => ({ title: w.title.trim() || '未命名心愿', cost: roundPoints(w.cost_points) }))
    .filter((w) => w.cost > 0)
    .sort((a, b) => a.cost - b.cost);
  const nearest = priced[0] ?? null;
  const balance = roundPoints(pointsBalance);
  const nearestCost = nearest?.cost ?? 0;
  const pointsNeeded = nearest ? Math.max(0, roundPoints(nearestCost - balance)) : 0;

  const expectedSlots = Math.max(1, habitMeta.habits * daysElapsedInclusive);
  const habitRate = Math.min(100, Math.round((habitMeta.checkIns / expectedSlots) * 100));

  const latestFromLog = weightLogs.length ? weightLogs[weightLogs.length - 1] : null;
  const latestKg =
    latestFromLog != null
      ? latestFromLog.weight_kg
      : user && user.weight > 0
        ? user.weight
        : null;

  const workoutDays = parseWorkoutDays(user?.workout_days);
  const completeness = buildCompleteness(user, dietaryEmpty);

  return {
    completeness,
    missingCount: completeness.filter((c) => !c.filled).length,
    wish: {
      nearestWishTitle: nearest?.title ?? null,
      nearestWishCost: nearestCost,
      pointsBalance: balance,
      pointsNeeded,
      canRedeemNearest: Boolean(nearest && pointsNeeded <= 0),
      weekEarned: weekPoints.earned,
      weekSpent: weekPoints.spent,
    },
    week: {
      weekStartYmd: startYmd,
      weekEndYmd: endYmd,
      habitCheckInTotal: habitMeta.checkIns,
      activeHabitCount: habitMeta.habits,
      habitCheckInRatePercent: habitMeta.habits === 0 ? 0 : habitRate,
      tasksCompleted: tasksDone,
      dailyReviewDays: (dailyReviews ?? []).length,
      daysElapsedInclusive,
      weeklyReviewDone: Boolean(weeklyJournal),
    },
    weightTrend: {
      latestKg,
      points: (weightLogs ?? []).map((r) => ({
        ymd: r.recorded_ymd,
        weight_kg: r.weight_kg,
      })),
    },
    archive: {
      goal: (user?.goal ?? '无').trim() || '无',
      lifestyle: (user?.lifestyle ?? '').trim() || '未设置',
      workoutDaysLabel: workoutDays.length ? workoutDays.join('、') : '未设置',
      personaFilled: Boolean(user?.persona_portrait?.trim()),
      dietarySummary: formatDietaryPrefsSummary(dietary),
      dietaryEmpty,
    },
    dietary,
    road,
  };
}
