/**
 * 小习惯「跳过日」：显式放弃今日，可复盘统计。
 * 对连续为中性（不打断、不计入达标天）。
 */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseExtraRecord(extraData: string | null | undefined): Record<string, unknown> {
  if (!extraData) return {};
  try {
    const parsed = JSON.parse(extraData) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function normalizeYmd(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return YMD_RE.test(trimmed) ? trimmed : null;
}

export function getHabitSkippedDates(extraData: string | null | undefined): string[] {
  const parsed = parseExtraRecord(extraData);
  const dates = new Set<string>();
  if (Array.isArray(parsed.habitSkippedDates)) {
    for (const item of parsed.habitSkippedDates) {
      const ymd = normalizeYmd(item);
      if (ymd) dates.add(ymd);
    }
  }
  return [...dates].sort();
}

export function isHabitSkippedOn(extraData: string | null | undefined, ymd: string): boolean {
  const target = normalizeYmd(ymd);
  if (!target) return false;
  return getHabitSkippedDates(extraData).includes(target);
}

function writeSkippedDates(extraData: string | null | undefined, dates: string[]): string | null {
  const current = parseExtraRecord(extraData);
  const { habitSkippedDates: _removed, ...rest } = current;
  const sorted = [...new Set(dates.map((d) => d.trim()).filter((d) => YMD_RE.test(d)))].sort();
  if (sorted.length === 0) {
    return Object.keys(rest).length === 0 ? null : JSON.stringify(rest);
  }
  return JSON.stringify({ ...rest, habitSkippedDates: sorted });
}

export function mergeHabitSkippedOn(
  extraData: string | null | undefined,
  ymd: string,
): string {
  const target = normalizeYmd(ymd);
  if (!target) {
    return extraData ?? JSON.stringify({});
  }
  const dates = getHabitSkippedDates(extraData);
  if (!dates.includes(target)) dates.push(target);
  return writeSkippedDates(extraData, dates) ?? JSON.stringify({ habitSkippedDates: [target] });
}

export function removeHabitSkippedOn(
  extraData: string | null | undefined,
  ymd: string,
): string | null {
  const target = normalizeYmd(ymd);
  if (!target) return extraData ?? null;
  const next = getHabitSkippedDates(extraData).filter((d) => d !== target);
  return writeSkippedDates(extraData, next);
}
