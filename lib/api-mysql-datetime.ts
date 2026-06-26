/** MySQL DATETIME 不接受 ISO8601（如 2026-05-28T07:56:00.549Z），REST 上传前统一规范化 */

const ISO_LIKE_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const MYSQL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;

/** 表列或 extra_data JSON 内常见的时间字段名 */
const DATETIME_FIELD_RE =
  /(_at|_date|At|Date|happened_at|due_date|record_date|review_at|generated_at|fulfilled_at|last_ai_at|inbox_entered_at|completed_at|earned_at|redeemed_at|assigned_ymd|cache_date_ymd|startTime|endTime|fetchedAt)$/i;

/**
 * 时间字段约定（与 MySQL REST 同步）：
 * - **墙上时钟**（happened_at、completed_at 等用户可感知时刻）：按设备本地时区存 YYYY-MM-DD HH:mm:ss（国内通常为东八区）。
 * - **纯审计/同步元数据**（updated_at、created_at 等）：历史上传 REST 时曾转 UTC；任务模块写入已逐步改为墙上时钟。
 * 读取「逻辑日」相关字段请用 parseTaskAuditDatetimeForLogicalDay / ymdFromAuditDatetime。
 */
const WALL_CLOCK_DATETIME_FIELDS = new Set(['happened_at', 'completed_at']);

function looksLikeJsonString(value: string): boolean {
  const t = value.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

function isWallClockDatetimeField(fieldKey?: string): boolean {
  return fieldKey != null && WALL_CLOCK_DATETIME_FIELDS.has(fieldKey);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 本地墙上时钟 → MySQL DATETIME（秒精度） */
export function formatWallClockDatetimeLocal(date: Date): string {
  const day = [date.getFullYear(), pad2(date.getMonth() + 1), pad2(date.getDate())].join('-');
  const time = [pad2(date.getHours()), pad2(date.getMinutes()), pad2(date.getSeconds())].join(':');
  return `${day} ${time}`;
}

/** 解析 ISO 或 MySQL DATETIME；`YYYY-MM-DD HH:mm:ss` 按本地墙上时钟理解 */
export function parseStoredDatetime(value: string): Date {
  const trimmed = value.trim();
  const m = MYSQL_DATETIME_RE.exec(trimmed);
  if (m) {
    const [, y, mo, d, h, mi, se = '0'] = m;
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
  }
  return new Date(trimmed);
}

/**
 * 审计类 _at 字段（completed_at / updated_at 等）：REST 侧按 UTC 写入 MySQL DATETIME。
 * 与 normalizeDateTimeStringForMysql 对称，用于判断「逻辑日完成」。
 */
export function parseAuditDatetimeUtc(value: string): Date {
  const trimmed = value.trim();
  if (!trimmed) return new Date(Number.NaN);
  if (ISO_LIKE_DATETIME_RE.test(trimmed)) return new Date(trimmed);
  const m = MYSQL_DATETIME_RE.exec(trimmed);
  if (m) {
    const [, y, mo, d, h, mi, se = '0'] = m;
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se)));
  }
  return new Date(trimmed);
}

function formatLocalYmdFromDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 任务 completed_at / updated_at：新数据为本地墙上时钟；旧数据可能为 UTC 写入的 MySQL DATETIME。
 * 用于「逻辑日完成」判断，兼容两种存储。
 */
export function parseTaskAuditDatetimeForLogicalDay(value: string): Date {
  const trimmed = value.trim();
  if (!trimmed) return new Date(Number.NaN);
  if (ISO_LIKE_DATETIME_RE.test(trimmed)) return new Date(trimmed);
  if (MYSQL_DATETIME_RE.test(trimmed)) {
    const asLocal = parseStoredDatetime(trimmed);
    const asUtc = parseAuditDatetimeUtc(trimmed);
    const localYmd = formatLocalYmdFromDate(asLocal);
    const utcAsLocalYmd = formatLocalYmdFromDate(asUtc);
    if (localYmd !== utcAsLocalYmd && utcAsLocalYmd > localYmd) {
      return asUtc;
    }
    return asLocal;
  }
  return new Date(trimmed);
}

/** 任务完成/更新时间写入本地 SQLite 与 REST（墙上时钟，与界面一致） */
export function formatTaskAuditDatetimeLocal(date: Date = new Date()): string {
  return formatWallClockDatetimeLocal(date);
}

/** 从 completed_at / updated_at 等审计时间取本地日历 YMD（兼容旧 UTC MySQL 与新墙上时钟） */
export function ymdFromAuditDatetime(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const d = parseTaskAuditDatetimeForLogicalDay(value);
  if (Number.isNaN(d.getTime())) {
    const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return m?.[1] ?? null;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shouldNormalizeDateTimeString(value: string, fieldKey?: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (ISO_LIKE_DATETIME_RE.test(trimmed)) return true;
  if (MYSQL_DATETIME_RE.test(trimmed)) return true;
  if (fieldKey && DATETIME_FIELD_RE.test(fieldKey)) {
    const d = parseStoredDatetime(trimmed);
    return !Number.isNaN(d.getTime());
  }
  return false;
}

/** ISO8601 / MySQL DATETIME → MySQL DATETIME（秒精度，兼容 DATETIME(0)） */
export function normalizeDateTimeStringForMysql(value: string, fieldKey?: string): string {
  const trimmed = value.trim();
  if (!shouldNormalizeDateTimeString(trimmed, fieldKey)) return value;
  const date = parseStoredDatetime(trimmed);
  if (Number.isNaN(date.getTime())) return value;
  if (isWallClockDatetimeField(fieldKey)) {
    return formatWallClockDatetimeLocal(date);
  }
  const day = [date.getUTCFullYear(), pad2(date.getUTCMonth() + 1), pad2(date.getUTCDate())].join('-');
  const time = [pad2(date.getUTCHours()), pad2(date.getUTCMinutes()), pad2(date.getUTCSeconds())].join(':');
  return `${day} ${time}`;
}

/** 递归规范化行内各字段及 extra_data 等 JSON 字符串中的时间 */
export function normalizeDeepForMysqlApi(value: unknown, fieldKey?: string): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (fieldKey === 'extra_data' || looksLikeJsonString(value)) {
      try {
        const parsed = JSON.parse(value) as unknown;
        return JSON.stringify(normalizeDeepForMysqlApi(parsed));
      } catch {
        /* 非 JSON，继续按普通字符串处理 */
      }
    }
    if (shouldNormalizeDateTimeString(value, fieldKey)) {
      const trimmed = value.trim();
      /** MySQL DATE 列：纯 YYYY-MM-DD 保持原样，勿追加时间 */
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
      return normalizeDateTimeStringForMysql(value, fieldKey);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeDeepForMysqlApi(item));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = normalizeDeepForMysqlApi(v, key);
    }
    return out;
  }

  return value;
}

/** 上传 REST / MySQL 前规范化整行记录（所有业务表通用） */
export function normalizeRecordForMysqlApi(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) continue;
    if (key === 'deleted_at' || key === 'version') continue;
    out[key] = normalizeDeepForMysqlApi(value, key);
  }
  return out;
}

/** @alias 财务流水消费/支付时刻（本地墙上时钟） */
export const formatFinanceHappenedAt = formatWallClockDatetimeLocal;
