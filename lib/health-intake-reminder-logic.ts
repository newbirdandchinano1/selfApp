/**
 * 健康摄入提醒纯规则（无原生 / 存储依赖，可供 Node 单测直接导入）。
 */

export type HealthIntakeFocusKey = 'hydration' | 'protein' | 'carbohydrate' | 'calories';

export type HealthIntakeReminderMode = 'meal_windows' | 'evening_wrap' | 'hydration_interval';

export type HealthIntakeIntervalMinutes = 30 | 60 | 120;

export type HealthIntakeMealWindow = { hour: number; minute: number };

/** 排期所需的偏好字段子集 */
export type HealthIntakeReminderLogicPrefs = {
  mode: HealthIntakeReminderMode;
  focusKeys: HealthIntakeFocusKey[];
  mealWindows: HealthIntakeMealWindow[];
  wrapHour: number;
  wrapMinute: number;
  intervalMinutes: HealthIntakeIntervalMinutes;
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

function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

function addMinutes(d: Date, mins: number): Date {
  return new Date(d.getTime() + mins * 60_000);
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
  target: number;
  gapRatio: number;
  remain: number;
};

const LABEL_BY_KEY: Record<HealthIntakeFocusKey, string> = {
  hydration: '水分',
  protein: '蛋白质',
  carbohydrate: '碳水',
  calories: '热量',
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

/** 按关注项 + 今日静音过滤后的未达标列表（缺口大的在前） */
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

/** 通知文案：主打最大缺口 + 轻动作提示 */
export function buildHealthIntakeReminderCopy(deficits: HealthIntakeDeficit[]): {
  title: string;
  body: string;
  primaryKey: HealthIntakeFocusKey | null;
  deficitSummary: string;
} {
  if (deficits.length === 0) {
    return {
      title: '健康摄入',
      body: '今日关注项已达标',
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
      ? `${primary.label}还差 ${remainText}（${progress}）· ${hint}；另有${others.join('、')}未达标`
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
  role: 'meal' | 'wrap' | 'interval';
};

/**
 * 计算本逻辑日剩余可登记的触发时刻。
 * 只取未来槽位；免打扰延后不计入已消耗配额。
 */
export function computeHealthIntakeFireAts(params: {
  prefs: HealthIntakeReminderLogicPrefs;
  logicalYmd: string;
  now: Date;
  lastIntakeAt?: Date | null;
}): HealthIntakeFireSlot[] {
  const { prefs, logicalYmd, now } = params;
  const candidates: HealthIntakeFireSlot[] = [];

  const pushCandidate = (raw: Date | null, role: HealthIntakeFireSlot['role']) => {
    if (!raw) return;
    let d = deferOutOfQuietHours(raw, prefs);
    if (prefs.snoozeUntilMs != null && prefs.snoozeUntilMs > now.getTime()) {
      const snoozeAt = new Date(prefs.snoozeUntilMs);
      if (d.getTime() < snoozeAt.getTime()) d = snoozeAt;
      d = deferOutOfQuietHours(d, prefs);
    }
    candidates.push({ fireAt: d, role });
  };

  if (prefs.mode === 'evening_wrap') {
    pushCandidate(
      buildFireAtOnLogicalDay(logicalYmd, prefs.wrapHour, prefs.wrapMinute),
      'wrap',
    );
  } else if (prefs.mode === 'meal_windows') {
    for (const w of prefs.mealWindows) {
      pushCandidate(buildFireAtOnLogicalDay(logicalYmd, w.hour, w.minute), 'meal');
    }
    pushCandidate(
      buildFireAtOnLogicalDay(logicalYmd, prefs.wrapHour, prefs.wrapMinute),
      'wrap',
    );
  } else {
    const dayStart = buildFireAtOnLogicalDay(logicalYmd, 0, 0);
    if (!dayStart) return [];
    const endOfScan = addMinutes(dayStart, 24 * 60);
    const anchor =
      params.lastIntakeAt && params.lastIntakeAt.getTime() > dayStart.getTime()
        ? params.lastIntakeAt
        : dayStart;
    let t = addMinutes(anchor, prefs.intervalMinutes);
    while (t.getTime() <= now.getTime() + 2000 && t.getTime() < endOfScan.getTime()) {
      t = addMinutes(t, prefs.intervalMinutes);
    }
    let guard = 0;
    while (t.getTime() < endOfScan.getTime() && guard < 48) {
      pushCandidate(new Date(t), 'interval');
      t = addMinutes(t, prefs.intervalMinutes);
      guard += 1;
    }
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
