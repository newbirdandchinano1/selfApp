/**
 * 月节点「周目标」切周规则（任意年、任意月同一套，无特例）：
 * 1. 周界：周一～周日
 * 2. 范围：只落在本月 [1 … 月末]，禁止跨月
 * 3. 覆盖：从 1 号扫到月末；被月初/月末截断的残段各自成一周
 * 存于 life_road_nodes.extra_data.week_goals。
 */
export const LIFE_ROAD_WEEK_GOALS_KEY = 'week_goals';
export const LIFE_ROAD_WEEK_GOAL_TEXT_MAX = 120;

export type LifeRoadWeekSlot = {
  /** 1-based，对应「第 N 周」 */
  index: number;
  /** 该周在本月内起始日 YYYY-MM-DD，作稳定 key */
  weekKey: string;
  startYmd: string;
  endYmd: string;
  /** 如：第一周（11.1-11.1） / 第二周（11.2-11.8） */
  label: string;
};

export type LifeRoadWeekGoalEntry = {
  text: string;
  done: boolean;
};

const WEEK_ORDINALS = ['一', '二', '三', '四', '五', '六'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toYmd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseYmdParts(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, m: mo, d };
}

/** 展示用短日期：11.2 */
export function formatShortMd(ymd: string): string {
  const p = parseYmdParts(ymd);
  if (!p) return ymd;
  return `${p.m}.${p.d}`;
}

/** 距本周日（含当天）还剩几天：Mon→6 … Sat→1，Sun→0 */
function daysUntilSunday(dow: number): number {
  return dow === 0 ? 0 : 7 - dow;
}

/**
 * 列出该月全部周栏。规则与年份无关：传入任意 calendar year/month 结果一致适用。
 */
export function listWeeksInMonth(year: number, month: number): LifeRoadWeekSlot[] {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return [];
  }
  const lastDay = new Date(year, month, 0).getDate();
  const out: LifeRoadWeekSlot[] = [];
  let day = 1;
  while (day <= lastDay) {
    const dow = new Date(year, month - 1, day).getDay(); // 0=Sun … 6=Sat
    const endDay = Math.min(day + daysUntilSunday(dow), lastDay);
    const index = out.length + 1;
    const startYmd = toYmd(year, month, day);
    const endYmd = toYmd(year, month, endDay);
    const ordinal = WEEK_ORDINALS[index - 1] ?? String(index);
    out.push({
      index,
      weekKey: startYmd,
      startYmd,
      endYmd,
      label: `第${ordinal}周（${formatShortMd(startYmd)}-${formatShortMd(endYmd)}）`,
    });
    day = endDay + 1;
  }
  return out;
}

function parseExtraObject(raw: string | null | undefined): Record<string, unknown> {
  if (raw == null || !String(raw).trim()) return {};
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...(parsed as Record<string, unknown>) };
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** 读取周目标文案 map：weekKey → entry */
export function parseWeekGoals(
  extraData: string | null | undefined,
): Record<string, LifeRoadWeekGoalEntry> {
  const obj = parseExtraObject(extraData);
  const raw = obj[LIFE_ROAD_WEEK_GOALS_KEY];
  const out: Record<string, LifeRoadWeekGoalEntry> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const weekKey = key.trim();
    if (!weekKey) continue;
    if (typeof val === 'string') {
      const text = val.trim().slice(0, LIFE_ROAD_WEEK_GOAL_TEXT_MAX);
      if (text) out[weekKey] = { text, done: false };
      continue;
    }
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
    const row = val as Record<string, unknown>;
    const text = String(row.text ?? '')
      .trim()
      .slice(0, LIFE_ROAD_WEEK_GOAL_TEXT_MAX);
    if (!text) continue;
    out[weekKey] = { text, done: Boolean(row.done) };
  }
  return out;
}

/** 写回周目标；空 map 时删除键 */
export function writeWeekGoals(
  extraData: string | null | undefined,
  goals: Record<string, LifeRoadWeekGoalEntry>,
): string | null {
  const obj = parseExtraObject(extraData);
  const cleaned: Record<string, { text: string; done: boolean }> = {};
  for (const [key, entry] of Object.entries(goals)) {
    const weekKey = key.trim();
    const text = (entry?.text ?? '').trim().slice(0, LIFE_ROAD_WEEK_GOAL_TEXT_MAX);
    if (!weekKey || !text) continue;
    cleaned[weekKey] = { text, done: Boolean(entry?.done) };
  }
  if (Object.keys(cleaned).length === 0) {
    delete obj[LIFE_ROAD_WEEK_GOALS_KEY];
  } else {
    obj[LIFE_ROAD_WEEK_GOALS_KEY] = cleaned;
  }
  if (Object.keys(obj).length === 0) return null;
  return JSON.stringify(obj);
}

export function weekGoalFingerprint(
  goals: Record<string, LifeRoadWeekGoalEntry>,
): string {
  return Object.keys(goals)
    .sort()
    .map((k) => `${k}:${goals[k]?.done ? 1 : 0}:${(goals[k]?.text ?? '').trim()}`)
    .join('|');
}
