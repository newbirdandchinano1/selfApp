/** MySQL DATETIME 不接受 ISO8601（如 2026-05-28T07:56:00.549Z），REST 上传前统一规范化 */

const ISO_LIKE_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** 表列或 extra_data JSON 内常见的时间字段名 */
const DATETIME_FIELD_RE =
  /(_at|_date|At|Date|happened_at|due_date|record_date|review_at|generated_at|fulfilled_at|last_ai_at|inbox_entered_at|completed_at|earned_at|redeemed_at|assigned_ymd|cache_date_ymd|startTime|endTime|fetchedAt)$/i;

function looksLikeJsonString(value: string): boolean {
  const t = value.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

function shouldNormalizeDateTimeString(value: string, fieldKey?: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (ISO_LIKE_DATETIME_RE.test(trimmed)) return true;
  if (fieldKey && DATETIME_FIELD_RE.test(fieldKey)) {
    const d = new Date(trimmed);
    return !Number.isNaN(d.getTime());
  }
  return false;
}

/** ISO8601 → MySQL DATETIME（UTC，秒精度，兼容 DATETIME(0)） */
export function normalizeDateTimeStringForMysql(value: string): string {
  const trimmed = value.trim();
  if (!shouldNormalizeDateTimeString(trimmed)) return value;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join('-');
  const time = [pad(date.getUTCHours()), pad(date.getUTCMinutes()), pad(date.getUTCSeconds())].join(':');
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
      return normalizeDateTimeStringForMysql(value);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeDeepForMysqlApi(item));
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
