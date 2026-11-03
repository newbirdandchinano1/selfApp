/**
 * 道路年 / 季 / 月节点：枚举、时间骨架与字段校验。
 * 方向拆解 + 可选验收标准 checklist；不设截止日期 / 优先级 / 完成百分比。
 */

export const LIFE_ROAD_NODE_KINDS = ['multi', 'farther', 'year', 'quarter', 'month'] as const;
export type LifeRoadNodeKind = (typeof LIFE_ROAD_NODE_KINDS)[number];

export const LIFE_ROAD_NODE_STATUS_VALUES = [
  'on_track',
  'paused',
  'arrived',
  'dropped',
] as const;
export type LifeRoadNodeStatus = (typeof LIFE_ROAD_NODE_STATUS_VALUES)[number];

/** 高于「今年」的层 */
export const LIFE_ROAD_ABOVE_YEAR_KINDS = ['multi', 'farther'] as const;
export type LifeRoadAboveYearKind = (typeof LIFE_ROAD_ABOVE_YEAR_KINDS)[number];

export const QUARTER_MONTHS: Readonly<Record<1 | 2 | 3 | 4, readonly [number, number, number]>> = {
  1: [1, 2, 3],
  2: [4, 5, 6],
  3: [7, 8, 9],
  4: [10, 11, 12],
};

export const LIFE_ROAD_NODE_KIND_LABELS: Record<LifeRoadNodeKind, string> = {
  multi: '多年',
  farther: '更远',
  year: '今年',
  quarter: '季度',
  month: '月',
};

export const LIFE_ROAD_NODE_STATUS_LABELS: Record<LifeRoadNodeStatus, string> = {
  on_track: '在路上',
  paused: '暂搁',
  arrived: '已抵达',
  dropped: '已放弃',
};

export class LifeRoadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LifeRoadValidationError';
  }
}

function unicodeLen(text: string): number {
  return [...text].length;
}

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

export function trimOptionalText(value: unknown, field: string, maxChars: number): string | null {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!text) return null;
  if (unicodeLen(text) > maxChars) {
    throw new LifeRoadValidationError(`${field} 最多 ${maxChars} 字`);
  }
  return text;
}

export function parseLifeRoadNodeKind(value: unknown): LifeRoadNodeKind {
  const kind = String(value ?? '').trim();
  if (!(LIFE_ROAD_NODE_KINDS as readonly string[]).includes(kind)) {
    throw new LifeRoadValidationError(
      `节点类型仅支持 ${LIFE_ROAD_NODE_KINDS.join(' / ')}`,
    );
  }
  return kind as LifeRoadNodeKind;
}

export function parseLifeRoadNodeStatus(
  value: unknown,
  fallback: LifeRoadNodeStatus = 'on_track',
): LifeRoadNodeStatus {
  const raw = value == null || value === '' ? fallback : String(value).trim();
  if (!(LIFE_ROAD_NODE_STATUS_VALUES as readonly string[]).includes(raw)) {
    throw new LifeRoadValidationError(
      `状态仅支持 ${LIFE_ROAD_NODE_STATUS_VALUES.join(' / ')}`,
    );
  }
  return raw as LifeRoadNodeStatus;
}

export function parseCalendarYear(value: unknown): number | null {
  if (value == null || value === '') return null;
  const y = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(y) || !Number.isInteger(y) || y < 1970 || y > 2100) {
    throw new LifeRoadValidationError('公历年须为 1970–2100');
  }
  return y;
}

export function parseQuarter(value: unknown): number | null {
  if (value == null || value === '') return null;
  const q = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(q) || !Number.isInteger(q) || q < 1 || q > 4) {
    throw new LifeRoadValidationError('季度须为 1–4');
  }
  return q;
}

export function parseMonth(value: unknown): number | null {
  if (value == null || value === '') return null;
  const m = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(m) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new LifeRoadValidationError('月份须为 1–12');
  }
  return m;
}

export function parseSortOrder(value: unknown, fallback = 1000): number {
  if (value == null || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new LifeRoadValidationError('sort_order 必须为整数');
  }
  return n;
}

export function currentCalendarYear(): number {
  return new Date().getFullYear();
}

export function currentCalendarMonth(): number {
  return new Date().getMonth() + 1;
}

export function currentQuarter(): 1 | 2 | 3 | 4 {
  return monthToQuarter(currentCalendarMonth());
}

export function monthToQuarter(month: number): 1 | 2 | 3 | 4 {
  if (month >= 1 && month <= 3) return 1;
  if (month >= 4 && month <= 6) return 2;
  if (month >= 7 && month <= 9) return 3;
  if (month >= 10 && month <= 12) return 4;
  throw new LifeRoadValidationError('月份须为 1–12');
}

export function quarterLabel(q: number): string {
  return `Q${q}`;
}

export function monthLabel(month: number): string {
  return `${month}月`;
}

/**
 * 按 kind 校验时间字段与从属规则（不查库）。
 * year / quarter / month 必须带齐骨架字段；multi / farther 不带年季月。
 */
export function assertLifeRoadNodeShape(input: {
  kind: LifeRoadNodeKind;
  calendar_year: number | null;
  quarter: number | null;
  month: number | null;
  parent_id: string | null;
}): void {
  const { kind, calendar_year: year, quarter, month, parent_id } = input;

  if (kind === 'multi' || kind === 'farther') {
    if (year != null || quarter != null || month != null) {
      throw new LifeRoadValidationError('多年 / 更远节点不使用年季月骨架');
    }
    if (parent_id) {
      throw new LifeRoadValidationError('多年 / 更远节点不应挂父节点');
    }
    return;
  }

  if (year == null) {
    throw new LifeRoadValidationError('年 / 季 / 月节点必须填写公历年');
  }

  if (kind === 'year') {
    if (quarter != null || month != null) {
      throw new LifeRoadValidationError('年目标不应填写季 / 月');
    }
    if (parent_id) {
      throw new LifeRoadValidationError('年目标挂在总方向下，不写 parent_id');
    }
    return;
  }

  if (kind === 'quarter') {
    if (quarter == null) {
      throw new LifeRoadValidationError('季度目标必须填写季度 1–4');
    }
    if (month != null) {
      throw new LifeRoadValidationError('季度目标不应填写月份');
    }
    return;
  }

  // month
  if (month == null) {
    throw new LifeRoadValidationError('月目标必须填写月份 1–12');
  }
  const expectedQ = monthToQuarter(month);
  if (quarter != null && quarter !== expectedQ) {
    throw new LifeRoadValidationError(`${month}月属于 Q${expectedQ}，与所填季度不一致`);
  }
}

/** 标题上限：方向短句 */
export const LIFE_ROAD_TITLE_MAX = 40;
export const LIFE_ROAD_NOTE_MAX = 200;
