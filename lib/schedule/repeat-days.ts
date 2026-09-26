/** 周/月重复日数组规范化（任务与定时支出共用，无上层依赖） */

export function normalizeWeeklyDays(raw: unknown): number[] {
  if (typeof raw === 'string') {
    try {
      return normalizeWeeklyDays(JSON.parse(raw) as unknown);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((x) => (typeof x === 'number' ? Math.round(x) : parseInt(String(x), 10)))
        .filter((n) => n >= 1 && n <= 7),
    ),
  ].sort((a, b) => a - b);
}

export function normalizeMonthlyDays(raw: unknown): number[] {
  if (typeof raw === 'string') {
    try {
      return normalizeMonthlyDays(JSON.parse(raw) as unknown);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((x) => (typeof x === 'number' ? Math.round(x) : parseInt(String(x), 10)))
        .filter((n) => n >= 1 && n <= 31),
    ),
  ].sort((a, b) => a - b);
}
