/**
 * 道路赌注：枚举、字段校验与「今年进行中 ≤ 5」限额（App 侧先拦）。
 */

export const LIFE_BET_YEAR_ACTIVE_LIMIT = 5;

export const LIFE_BET_HORIZON_VALUES = ['year', 'multi', 'farther'] as const;
export type LifeBetHorizon = (typeof LIFE_BET_HORIZON_VALUES)[number];

export const LIFE_BET_STATUS_VALUES = ['on_track', 'paused', 'arrived', 'dropped'] as const;
export type LifeBetStatus = (typeof LIFE_BET_STATUS_VALUES)[number];

const ACTIVE_STATUSES = new Set<LifeBetStatus>(['on_track', 'paused']);

/** 道路仓库校验失败（UI 可直接展示 message） */
export class LifeRoadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LifeRoadValidationError';
  }
}

function unicodeLen(text: string): number {
  return [...text].length;
}

/** trim 后必填文本，按 Unicode 码点计长 */
export function trimRequiredText(value: unknown, field: string, maxChars: number): string {
  if (value == null) {
    throw new LifeRoadValidationError(`${field} 必填`);
  }
  const text = String(value).trim();
  if (!text) {
    throw new LifeRoadValidationError(`${field} 必填`);
  }
  if (unicodeLen(text) > maxChars) {
    throw new LifeRoadValidationError(`${field} 最多 ${maxChars} 字`);
  }
  return text;
}

/** trim 后可选文本；空则 null */
export function trimOptionalText(value: unknown, field: string, maxChars: number): string | null {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!text) return null;
  if (unicodeLen(text) > maxChars) {
    throw new LifeRoadValidationError(`${field} 最多 ${maxChars} 字`);
  }
  return text;
}

export function parseLifeBetHorizon(value: unknown): LifeBetHorizon {
  const horizon = String(value ?? '').trim();
  if (!(LIFE_BET_HORIZON_VALUES as readonly string[]).includes(horizon)) {
    throw new LifeRoadValidationError(`时间桶仅支持 ${LIFE_BET_HORIZON_VALUES.join(' / ')}`);
  }
  return horizon as LifeBetHorizon;
}

export function parseLifeBetStatus(value: unknown, fallback: LifeBetStatus = 'on_track'): LifeBetStatus {
  const raw = value == null || value === '' ? fallback : String(value).trim();
  if (!(LIFE_BET_STATUS_VALUES as readonly string[]).includes(raw)) {
    throw new LifeRoadValidationError(`状态仅支持 ${LIFE_BET_STATUS_VALUES.join(' / ')}`);
  }
  return raw as LifeBetStatus;
}

/** 公历年；空串 → null */
export function parseLifeBetYear(value: unknown): number | null {
  if (value == null || value === '') return null;
  const y = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(y) || !Number.isInteger(y) || y < 1970 || y > 2100) {
    throw new LifeRoadValidationError('year 须为 1970–2100 的公历年');
  }
  return y;
}

export function parseSortOrder(value: unknown, fallback = 1000): number {
  if (value == null || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new LifeRoadValidationError('sort_order 必须为整数');
  }
  return n;
}

export function isActiveLifeBetStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status as LifeBetStatus);
}

/**
 * 合并后规则：horizon=year 时 year 必填；进行中今年条数不得超过上限。
 * @param activeCountSameYear 同 year 下已有 on_track|paused 条数（不含自身）
 */
export function assertLifeBetYearRulesMerged(input: {
  horizon: LifeBetHorizon;
  year: number | null;
  status: LifeBetStatus;
  activeCountSameYear: number;
}): void {
  if (input.horizon === 'year') {
    if (input.year == null) {
      throw new LifeRoadValidationError('「今年」桶必须填写公历年');
    }
  }
  if (!isActiveLifeBetStatus(input.status)) return;
  if (input.horizon !== 'year' || input.year == null) return;
  if (input.activeCountSameYear >= LIFE_BET_YEAR_ACTIVE_LIMIT) {
    throw new LifeRoadValidationError(
      `今年进行中的道路赌注最多 ${LIFE_BET_YEAR_ACTIVE_LIMIT} 条（在路上/暂搁）；已抵达或放弃不占名额`,
    );
  }
}

/** 当前公历年（本地墙上时钟） */
export function currentCalendarYear(): number {
  return new Date().getFullYear();
}
