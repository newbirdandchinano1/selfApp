/**
 * 项目道路归属：挂在「月目标下的验收叶子」上。
 * - projects.life_month_goal_id → 所属月目标节点
 * - projects.extra_data.life_acceptance_id → 该月验收叶子 id
 */
import { parseProjectExtraData } from '@/lib/repositories/projects/project-extra-data';

export const LIFE_ACCEPTANCE_ID_KEY = 'life_acceptance_id';

export type ProjectRoadLinkSelection = {
  monthGoalId: string;
  acceptanceId: string;
};

export function parseLifeAcceptanceId(
  extraData: string | null | undefined,
): string | null {
  const extra = parseProjectExtraData(extraData ?? null);
  const raw = extra[LIFE_ACCEPTANCE_ID_KEY];
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  return id || null;
}

export function mergeLifeAcceptanceIdIntoExtraObject(
  extra: Record<string, unknown>,
  acceptanceId: string | null | undefined,
): Record<string, unknown> {
  const next = { ...extra };
  const id = typeof acceptanceId === 'string' ? acceptanceId.trim() : '';
  if (!id) delete next[LIFE_ACCEPTANCE_ID_KEY];
  else next[LIFE_ACCEPTANCE_ID_KEY] = id;
  return next;
}

export function mergeLifeAcceptanceIdIntoExtraData(
  extraData: string | null | undefined,
  acceptanceId: string | null | undefined,
): string {
  const base = parseProjectExtraData(extraData ?? null) as Record<string, unknown>;
  return JSON.stringify(mergeLifeAcceptanceIdIntoExtraObject(base, acceptanceId));
}

/** 展示文案：优先验收叶子，否则回退月目标标题 */
export function formatProjectRoadCaption(opts: {
  month?: number | null;
  monthTitle?: string | null;
  acceptanceText?: string | null;
}): string {
  const monthPrefix =
    opts.month != null && Number.isFinite(opts.month) ? `${opts.month} 月` : null;
  const acceptance = opts.acceptanceText?.trim() || '';
  const monthTitle = opts.monthTitle?.trim() || '';
  const tail = acceptance || monthTitle;
  if (monthPrefix && tail) return `${monthPrefix} · ${tail}`;
  if (monthPrefix) return monthPrefix;
  return tail;
}

export function roadAcceptanceCaptionKey(
  monthGoalId: string,
  acceptanceId: string,
): string {
  return `${monthGoalId}::${acceptanceId}`;
}
