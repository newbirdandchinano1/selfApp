export type GoalDimensionExtraPayload = {
  note?: string;
};

export const DIMENSION_PRIORITY_OPTIONS = [
  { value: 5, label: '最高', sortOrder: 100 },
  { value: 4, label: '高', sortOrder: 200 },
  { value: 3, label: '中', sortOrder: 300 },
  { value: 2, label: '低', sortOrder: 400 },
  { value: 1, label: '最低', sortOrder: 500 },
] as const;

export type DimensionPriorityValue = (typeof DIMENSION_PRIORITY_OPTIONS)[number]['value'];

export const DIMENSION_NOTE_MAX = 300;
export const DIMENSION_TITLE_MAX = 32;

export const DEFAULT_DIMENSION_PRIORITY: DimensionPriorityValue = 3;

export function serializeGoalDimensionExtra(extra: GoalDimensionExtraPayload | null | undefined): string | null {
  const note = extra?.note?.trim();
  if (!note) return null;
  return JSON.stringify({ note });
}

export function parseGoalDimensionExtra(raw: string | null): GoalDimensionExtraPayload | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const note = (v as { note?: unknown }).note;
    return {
      note: typeof note === 'string' ? note : undefined,
    };
  } catch {
    return null;
  }
}

export function priorityValueToSortOrder(value: number): number {
  const opt = DIMENSION_PRIORITY_OPTIONS.find(o => o.value === value);
  return opt?.sortOrder ?? 300;
}

export function sortOrderToPriorityValue(sortOrder: number): DimensionPriorityValue {
  let best = DIMENSION_PRIORITY_OPTIONS[2];
  let bestDist = Math.abs(best.sortOrder - sortOrder);
  for (const opt of DIMENSION_PRIORITY_OPTIONS) {
    const dist = Math.abs(opt.sortOrder - sortOrder);
    if (dist < bestDist) {
      best = opt;
      bestDist = dist;
    }
  }
  return best.value;
}

export function priorityValueToLabel(value: number): string {
  return DIMENSION_PRIORITY_OPTIONS.find(o => o.value === value)?.label ?? '中';
}
