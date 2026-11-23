/**
 * 健康摄入提醒纯规则（无原生 / 存储依赖，可供 Node 单测直接导入）。
 * 四时段进度阈值：各时段检查点对比「期望进度线」，未达标才提醒。
 * 文案变体 L0/L1 在 health-intake-reminder-notifications 层套用。
 */

export type HealthIntakeFocusKey = 'hydration' | 'protein' | 'carbohydrate' | 'calories';

/** 一天四个监测时段 */
export type HealthIntakePeriodId = 'morning' | 'noon' | 'afternoon' | 'evening';

export type HealthIntakePeriodPref = {
  id: HealthIntakePeriodId;
  /** 是否在该时段检查并可能提醒 */
  enabled: boolean;
  hour: number;
  minute: number;
  /** 相对全日目标的期望进度 0–1（如中午 0.5） */
  expectedRatio: number;
};

/** 排期所需的偏好字段子集 */
export type HealthIntakeReminderLogicPrefs = {
  periods: HealthIntakePeriodPref[];
  focusKeys: HealthIntakeFocusKey[];
  quietStartHour: number;
  quietStartMinute: number;
  quietEndHour: number;
  quietEndMinute: number;
  snoozeUntilMs: number | null;
  dayMuteYmd: string | null;
  dayMuteKeys: HealthIntakeFocusKey[];
};

export type HealthIntakeDayTotalsLike = {
  hydration: number;
  protein: number;
  carbohydrate: number;
  calories: number;
};

export type HealthIntakeTargetsLike = {
  hydration: number;
  protein: number;
  carbohydrate: number;
  calories: number;
};

export const MAX_HEALTH_INTAKE_REMINDERS_PER_DAY = 2;
export const HEALTH_INTAKE_SNOOZE_MINUTES = 90;

export const HEALTH_INTAKE_PERIOD_IDS: readonly HealthIntakePeriodId[] = [
  'morning',
  'noon',
  'afternoon',
  'evening',
] as const;

export const DEFAULT_HEALTH_INTAKE_PERIODS: HealthIntakePeriodPref[] = [
  { id: 'morning', enabled: true, hour: 10, minute: 0, expectedRatio: 0.25 },
  { id: 'noon', enabled: true, hour: 13, minute: 0, expectedRatio: 0.5 },
  { id: 'afternoon', enabled: true, hour: 16, minute: 30, expectedRatio: 0.75 },
  { id: 'evening', enabled: true, hour: 20, minute: 0, expectedRatio: 1 },
];

const UNIT_BY_KEY: Record<HealthIntakeFocusKey, string> = {
  hydration: 'ml',
  protein: 'g',
  carbohydrate: 'g',
  calories: 'kcal',
};

const ACTION_HINT_BY_KEY: Record<HealthIntakeFocusKey, string> = {
  hydration: '喝一口就补上',
  protein: '记一餐就补上',
  carbohydrate: '记一餐就补上',
  calories: '看一眼今日摄入',
};

const LABEL_BY_KEY: Record<HealthIntakeFocusKey, string> = {
  hydration: '水分',
  protein: '蛋白质',
  carbohydrate: '碳水',
  calories: '热量',
};

const PERIOD_LABEL_BY_ID: Record<HealthIntakePeriodId, string> = {
  morning: '早上',
  noon: '中午',
  afternoon: '下午',
  evening: '晚上',
};

function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

export function healthIntakePeriodLabel(id: HealthIntakePeriodId): string {
  return PERIOD_LABEL_BY_ID[id];
}

export function buildFireAtOnLogicalDay(
  logicalYmd: string,
  hour: number,
  minute: number,
): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(logicalYmd.trim());
  if (!m) return null;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Math.max(0, Math.min(23, hour)),
    Math.max(0, Math.min(59, minute)),
    0,
    0,
  );
}

/** 免打扰是否覆盖某本地时刻（支持跨午夜） */
export function isInQuietHours(
  date: Date,
  prefs: Pick<
    HealthIntakeReminderLogicPrefs,
    'quietStartHour' | 'quietStartMinute' | 'quietEndHour' | 'quietEndMinute'
  >,
): boolean {
  const t = minutesOfDay(date.getHours(), date.getMinutes());
  const start = minutesOfDay(prefs.quietStartHour, prefs.quietStartMinute);
  const end = minutesOfDay(prefs.quietEndHour, prefs.quietEndMinute);
  if (start === end) return false;
  if (start < end) return t >= start && t < end;
  return t >= start || t < end;
}

/** 若落在免打扰内，延后到免打扰结束 */
export function deferOutOfQuietHours(
  date: Date,
  prefs: HealthIntakeReminderLogicPrefs,
): Date {
  if (!isInQuietHours(date, prefs)) return date;
  const end = new Date(date);
  end.setHours(prefs.quietEndHour, prefs.quietEndMinute, 0, 0);
  if (end.getTime() <= date.getTime()) {
    end.setDate(end.getDate() + 1);
  }
  return end;
}

export type HealthIntakeDeficit = {
  key: HealthIntakeFocusKey;
  label: string;
  current: number;
  /** 用于比较的目标（可能是时段期望线，非全日目标） */
  target: number;
  gapRatio: number;
  remain: number;
};

/** 解析最近摄入时间 */
export function parseHealthIntakeTimestamp(raw: string | null | undefined): Date | null {
  if (!raw || typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  const d = new Date(t.includes('T') ? t : t.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** 将全日目标按期望进度比缩放到时段阈值 */
export function scaleHealthIntakeTargets(
  dayTargets: HealthIntakeTargetsLike,
  expectedRatio: number,
): HealthIntakeTargetsLike {
  const r = Math.max(0, Math.min(1, expectedRatio));
  return {
    hydration: dayTargets.hydration * r,
    protein: dayTargets.protein * r,
    carbohydrate: dayTargets.carbohydrate * r,
    calories: dayTargets.calories * r,
  };
}

/**
 * 按墙上时钟选出「此刻」应对齐的期望进度：
 * 已过检查点取该点 ratio；落在两点之间线性插值；早于最早点取最早 ratio。
 */
export function resolveExpectedRatioAt(
  now: Date,
  periods: readonly HealthIntakePeriodPref[],
): number {
  const enabled = periods
    .filter(p => p.enabled)
    .slice()
    .sort(
      (a, b) =>
        minutesOfDay(a.hour, a.minute) - minutesOfDay(b.hour, b.minute) ||
        a.expectedRatio - b.expectedRatio,
    );
  if (enabled.length === 0) return 1;
  const t = minutesOfDay(now.getHours(), now.getMinutes());
  const first = enabled[0]!;
  if (t <= minutesOfDay(first.hour, first.minute)) return first.expectedRatio;

  for (let i = 0; i < enabled.length; i++) {
    const cur = enabled[i]!;
    const curMin = minutesOfDay(cur.hour, cur.minute);
    const next = enabled[i + 1];
    if (!next) return cur.expectedRatio;
    const nextMin = minutesOfDay(next.hour, next.minute);
    if (t < nextMin) {
      if (nextMin <= curMin) return cur.expectedRatio;
      const frac = (t - curMin) / (nextMin - curMin);
      return cur.expectedRatio + (next.expectedRatio - cur.expectedRatio) * frac;
    }
  }
  return enabled[enabled.length - 1]!.expectedRatio;
}

/** 按关注项 + 今日静音过滤后的未达标列表（缺口大的在前）；targets 可为时段期望线 */
export function listHealthIntakeDeficits(
  totals: HealthIntakeDayTotalsLike,
  targets: HealthIntakeTargetsLike,
  prefs?: Pick<HealthIntakeReminderLogicPrefs, 'focusKeys' | 'dayMuteYmd' | 'dayMuteKeys'>,
  logicalYmd?: string,
): HealthIntakeDeficit[] {
  const focus =
    prefs && prefs.focusKeys.length > 0
      ? new Set(prefs.focusKeys)
      : new Set<HealthIntakeFocusKey>(['hydration', 'protein', 'carbohydrate', 'calories']);

  const muted =
    prefs &&
    logicalYmd &&
    prefs.dayMuteYmd === logicalYmd &&
    prefs.dayMuteKeys.length > 0
      ? new Set(prefs.dayMuteKeys)
      : null;

  const keys: HealthIntakeFocusKey[] = ['hydration', 'protein', 'carbohydrate', 'calories'];
  const out: HealthIntakeDeficit[] = [];
  for (const key of keys) {
    if (!focus.has(key)) continue;
    if (muted?.has(key)) continue;
    const current = totals[key];
    const target = targets[key];
    if (!(target > 0 && current < target)) continue;
    const remain = Math.max(0, target - current);
    out.push({
      key,
      label: LABEL_BY_KEY[key],
      current,
      target,
      remain,
      gapRatio: remain / target,
    });
  }
  out.sort((a, b) => b.gapRatio - a.gapRatio || b.remain - a.remain);
  return out;
}

/** 相对「某时刻期望进度」的缺口 */
export function listHealthIntakePeriodDeficits(params: {
  totals: HealthIntakeDayTotalsLike;
  dayTargets: HealthIntakeTargetsLike;
  expectedRatio: number;
  prefs?: Pick<HealthIntakeReminderLogicPrefs, 'focusKeys' | 'dayMuteYmd' | 'dayMuteKeys'>;
  logicalYmd?: string;
}): HealthIntakeDeficit[] {
  const scaled = scaleHealthIntakeTargets(params.dayTargets, params.expectedRatio);
  return listHealthIntakeDeficits(params.totals, scaled, params.prefs, params.logicalYmd);
}

/** 通知文案：主打最大缺口 + 轻动作提示（确定性，供单测 / UI 预览） */
export function buildHealthIntakeReminderCopy(deficits: HealthIntakeDeficit[]): {
  title: string;
  body: string;
  primaryKey: HealthIntakeFocusKey | null;
  deficitSummary: string;
} {
  if (deficits.length === 0) {
    return {
      title: '健康摄入',
      body: '此时关注项已跟上进度',
      primaryKey: null,
      deficitSummary: '',
    };
  }
  const primary = deficits[0]!;
  const unit = UNIT_BY_KEY[primary.key];
  const remainText = `${Math.round(primary.remain)}${unit}`;
  const progress = `${Math.round(primary.current)}/${Math.round(primary.target)}${unit}`;
  const hint = ACTION_HINT_BY_KEY[primary.key];
  const others = deficits.slice(1).map(d => d.label);
  const body =
    others.length > 0
      ? `${primary.label}还差 ${remainText}（${progress}）· ${hint}；另有${others.join('、')}未跟上`
      : `${primary.label}还差 ${remainText}（${progress}）· ${hint}`;
  return {
    title: '健康小提醒',
    body,
    primaryKey: primary.key,
    deficitSummary: deficits
      .map(d => `${d.label} ${Math.round(d.current)}/${Math.round(d.target)}`)
      .join('；'),
  };
}

export type HealthIntakeFireSlot = {
  fireAt: Date;
  role: HealthIntakePeriodId;
  periodId: HealthIntakePeriodId;
  expectedRatio: number;
};

/**
 * 计算本逻辑日剩余可登记的时段检查点。
 * 仅保留「当前摄入仍低于该时段期望线」的未来槽；免打扰 / 稍后再说会延后。
 */
export function computeHealthIntakeFireAts(params: {
  prefs: HealthIntakeReminderLogicPrefs;
  logicalYmd: string;
  now: Date;
  totals: HealthIntakeDayTotalsLike;
  dayTargets: HealthIntakeTargetsLike;
}): HealthIntakeFireSlot[] {
  const { prefs, logicalYmd, now, totals, dayTargets } = params;
  const candidates: HealthIntakeFireSlot[] = [];

  const enabledPeriods = (prefs.periods.length > 0 ? prefs.periods : DEFAULT_HEALTH_INTAKE_PERIODS)
    .filter(p => p.enabled)
    .slice()
    .sort(
      (a, b) =>
        minutesOfDay(a.hour, a.minute) - minutesOfDay(b.hour, b.minute) ||
        a.expectedRatio - b.expectedRatio,
    );

  for (const period of enabledPeriods) {
    const raw = buildFireAtOnLogicalDay(logicalYmd, period.hour, period.minute);
    if (!raw) continue;

    const deficits = listHealthIntakePeriodDeficits({
      totals,
      dayTargets,
      expectedRatio: period.expectedRatio,
      prefs,
      logicalYmd,
    });
    if (deficits.length === 0) continue;

    let d = deferOutOfQuietHours(raw, prefs);
    if (prefs.snoozeUntilMs != null && prefs.snoozeUntilMs > now.getTime()) {
      const snoozeAt = new Date(prefs.snoozeUntilMs);
      if (d.getTime() < snoozeAt.getTime()) d = snoozeAt;
      d = deferOutOfQuietHours(d, prefs);
    }

    candidates.push({
      fireAt: d,
      role: period.id,
      periodId: period.id,
      expectedRatio: period.expectedRatio,
    });
  }

  const uniq: HealthIntakeFireSlot[] = [];
  const seen = new Set<number>();
  for (const slot of candidates) {
    const key = Math.floor(slot.fireAt.getTime() / 60_000);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(slot);
  }
  uniq.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  return uniq
    .filter(s => s.fireAt.getTime() > now.getTime() + 2000)
    .slice(0, MAX_HEALTH_INTAKE_REMINDERS_PER_DAY);
}
