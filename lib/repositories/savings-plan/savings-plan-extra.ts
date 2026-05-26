import type { TaskPriorityKey } from '@/components/composer/task-priority-matrix';

export type SavingsPlanExtraPayload = {
  priority?: TaskPriorityKey;
  /** 关联的心愿单好物 id */
  wish_item_id?: string;
};

const VALID_PRIORITIES: TaskPriorityKey[] = [
  'urgent-important',
  'urgent-not-important',
  'not-urgent-important',
  'not-urgent-not-important',
];

export function parseSavingsPlanExtra(raw: string | null | undefined): SavingsPlanExtraPayload | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const o = parsed as Record<string, unknown>;
    const extra: SavingsPlanExtraPayload = {};
    const priority = o.priority;
    if (typeof priority === 'string' && VALID_PRIORITIES.includes(priority as TaskPriorityKey)) {
      extra.priority = priority as TaskPriorityKey;
    }
    const wish_item_id =
      typeof o.wish_item_id === 'string' && o.wish_item_id.trim() ? o.wish_item_id.trim() : undefined;
    if (wish_item_id) extra.wish_item_id = wish_item_id;
    return Object.keys(extra).length > 0 ? extra : {};
  } catch {
    return null;
  }
}

export function serializeSavingsPlanExtra(extra: SavingsPlanExtraPayload | null | undefined): string | null {
  if (!extra) return null;
  const payload: Record<string, string> = {};
  if (extra.priority) payload.priority = extra.priority;
  if (extra.wish_item_id?.trim()) payload.wish_item_id = extra.wish_item_id.trim();
  return Object.keys(payload).length > 0 ? JSON.stringify(payload) : null;
}

export function mergeSavingsPlanExtra(
  raw: string | null | undefined,
  patch: Partial<SavingsPlanExtraPayload> & { wish_item_id?: string | '' },
): string | null {
  const base = parseSavingsPlanExtra(raw) ?? {};
  const next: SavingsPlanExtraPayload = { ...base };
  if ('priority' in patch) {
    if (patch.priority) next.priority = patch.priority;
    else delete next.priority;
  }
  if ('wish_item_id' in patch) {
    const id = patch.wish_item_id?.trim();
    if (id) next.wish_item_id = id;
    else delete next.wish_item_id;
  }
  return serializeSavingsPlanExtra(next);
}

export function getSavingsWishItemIdFromExtra(raw: string | null | undefined): string | null {
  return parseSavingsPlanExtra(raw)?.wish_item_id ?? null;
}

export function setSavingsWishItemIdInExtra(raw: string | null | undefined, wishId: string | null): string | null {
  return mergeSavingsPlanExtra(raw, { wish_item_id: wishId ?? '' });
}

export function priorityLabel(key: TaskPriorityKey): string {
  switch (key) {
    case 'urgent-important':
      return '紧急重要';
    case 'urgent-not-important':
      return '紧急不重要';
    case 'not-urgent-important':
      return '不紧急重要';
    default:
      return '不紧急不重要';
  }
}
