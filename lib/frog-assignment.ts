/** 从任务 extra_data 中移除今日青蛙指派标记 */
export function clearFrogAssignedOn(extraData: string | null): string | null {
  if (!extraData) return null;
  try {
    const parsed = JSON.parse(extraData) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return extraData;
    if (!('frogAssignedOn' in parsed)) return extraData;
    const { frogAssignedOn: _removed, ...rest } = parsed;
    return Object.keys(rest).length === 0 ? null : JSON.stringify(rest);
  } catch {
    return extraData;
  }
}

export function getFrogAssignedOn(extraData: string | null): string {
  if (!extraData) return '';
  try {
    const parsed = JSON.parse(extraData) as { frogAssignedOn?: unknown };
    return typeof parsed.frogAssignedOn === 'string' ? parsed.frogAssignedOn.trim() : '';
  } catch {
    return '';
  }
}
