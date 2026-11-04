/**
 * 阶段 E：远端 placement 分钟合并
 * - 远端有有效分钟 → 用远端
 * - 远端缺省 / null → **不抹**本地已有有效分钟（防旧 GET / 旧桌面写回）
 */

export type MinuteTriple = {
  startMinutes: number | null;
  endMinutes: number | null;
  allDay: number | null;
};

function asFiniteInt(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function hasValidPair(start: number | null, end: number | null): boolean {
  return start != null && end != null && end > start;
}

/**
 * 合并远端与本地分钟。remote 字段可为 undefined（旧 payload 缺键）。
 */
export function mergeRemotePlacementMinutes(
  remote: {
    startMinutes?: number | null;
    endMinutes?: number | null;
    allDay?: number | null;
  },
  local: {
    startMinutes?: number | null;
    endMinutes?: number | null;
    allDay?: number | null;
  } | null | undefined,
): MinuteTriple {
  const remoteStart = asFiniteInt(remote.startMinutes);
  const remoteEnd = asFiniteInt(remote.endMinutes);
  const remoteAllDay = asFiniteInt(remote.allDay);

  const localStart = asFiniteInt(local?.startMinutes);
  const localEnd = asFiniteInt(local?.endMinutes);
  const localAllDay = asFiniteInt(local?.allDay);

  if (hasValidPair(remoteStart, remoteEnd)) {
    return {
      startMinutes: remoteStart,
      endMinutes: remoteEnd,
      allDay: remoteAllDay ?? localAllDay,
    };
  }

  if (hasValidPair(localStart, localEnd)) {
    return {
      startMinutes: localStart,
      endMinutes: localEnd,
      allDay: localAllDay ?? remoteAllDay,
    };
  }

  return {
    startMinutes: remoteStart ?? localStart,
    endMinutes: remoteEnd ?? localEnd,
    allDay: remoteAllDay ?? localAllDay,
  };
}
