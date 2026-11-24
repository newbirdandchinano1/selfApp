/**
 * 项目道路归属：挂在「月目标下的某一周」上。
 * - projects.life_month_goal_id → 所属月目标节点
 * - projects.extra_data.life_week_key → 该周 weekKey（本月内起始日 YYYY-MM-DD；可空=仅挂月）
 * 旧字段 life_acceptance_id 读写时清除，不再作为挂载依据。
 */
import { parseProjectExtraData } from '@/lib/repositories/projects/project-extra-data';
import { formatShortMd } from '@/lib/life-road/life-road-weeks';

export const LIFE_WEEK_KEY = 'life_week_key';
/** @deprecated 旧验收叶子挂载；写入时清除 */
export const LIFE_ACCEPTANCE_ID_KEY = 'life_acceptance_id';

export type ProjectRoadLinkSelection = {
  monthGoalId: string;
  /** 周栏 weekKey（本月内起始日 ymd）；空表示只挂月、未分周 */
  weekKey?: string | null;
};

export function parseLifeWeekKey(
  extraData: string | null | undefined,
): string | null {
  const extra = parseProjectExtraData(extraData ?? null);
  const raw = extra[LIFE_WEEK_KEY];
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  return id || null;
}

/** @deprecated 兼容旧数据读取；新链路请用 parseLifeWeekKey */
export function parseLifeAcceptanceId(
  extraData: string | null | undefined,
): string | null {
  const extra = parseProjectExtraData(extraData ?? null);
  const raw = extra[LIFE_ACCEPTANCE_ID_KEY];
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  return id || null;
}

export function mergeLifeWeekKeyIntoExtraObject(
  extra: Record<string, unknown>,
  weekKey: string | null | undefined,
): Record<string, unknown> {
  const next = { ...extra };
  // 去掉旧验收叶子挂载
  delete next[LIFE_ACCEPTANCE_ID_KEY];
  const id = typeof weekKey === 'string' ? weekKey.trim() : '';
  if (!id) delete next[LIFE_WEEK_KEY];
  else next[LIFE_WEEK_KEY] = id;
  return next;
}

export function mergeLifeWeekKeyIntoExtraData(
  extraData: string | null | undefined,
  weekKey: string | null | undefined,
): string {
  const base = parseProjectExtraData(extraData ?? null) as Record<string, unknown>;
  return JSON.stringify(mergeLifeWeekKeyIntoExtraObject(base, weekKey));
}

/** @deprecated 改走 mergeLifeWeekKeyIntoExtraData；调用会清掉验收 id 并写入 weekKey=null */
export function mergeLifeAcceptanceIdIntoExtraData(
  extraData: string | null | undefined,
  _acceptanceId: string | null | undefined,
): string {
  return mergeLifeWeekKeyIntoExtraData(extraData, null);
}

/** 展示文案：优先周标签，否则回退月目标标题 */
export function formatProjectRoadCaption(opts: {
  month?: number | null;
  monthTitle?: string | null;
  weekKey?: string | null;
  weekLabel?: string | null;
}): string {
  const monthPrefix =
    opts.month != null && Number.isFinite(opts.month) ? `${opts.month} 月` : null;
  const week =
    opts.weekLabel?.trim() ||
    (opts.weekKey ? `周 ${formatShortMd(opts.weekKey)}` : '');
  const monthTitle = opts.monthTitle?.trim() || '';
  const tail = week || monthTitle;
  if (monthPrefix && tail) return `${monthPrefix} · ${tail}`;
  if (monthPrefix) return monthPrefix;
  return tail;
}

export function roadWeekCaptionKey(monthGoalId: string, weekKey: string): string {
  return `${monthGoalId}::${weekKey}`;
}
