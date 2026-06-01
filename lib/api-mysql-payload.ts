/** REST 上传 MySQL 前缩小单行 payload，避免 413 request entity too large */

/** 目标：单行 JSON 不超过此大小（常见网关 / body-parser 约 100KB–1MB，留余量） */
export const API_UPLOAD_MAX_ROW_BYTES = 64_000;

export const API_UPLOAD_MAX_TEXT_FIELD_CHARS = 4_000;
export const API_UPLOAD_MAX_JSON_FIELD_CHARS = 12_000;

export type ApiUploadSlimOptions = {
  aggressive?: boolean;
  /** 仍 413 时：仅保留 id / 时间 / 数值 / 极短文本 */
  ultra?: boolean;
  maxBytes?: number;
};

const DATA_URI_RE = /^data:[^;]+;base64,/i;

const LOCAL_ONLY_URI_RE = /^(file|content|ph|assets-library):\/\//i;

const BASE64_BLOB_RE = /^[A-Za-z0-9+/=\s]{512,}$/;

/** 上传时置空：本地路径 / base64 在服务器不可用且体积过大 */
const STRIP_URI_COLUMNS = new Set([
  'source_image_uri',
  'avatar_uri',
  'reference_image_uri',
  'finished_image_uri',
  'customBgUri',
  'imageDataUri',
  'image_uri',
  'imageUri',
  'uri',
  'url',
]);

const TRUNCATE_JSON_COLUMNS = new Set([
  'payload_json',
  'extra_data',
  'value_json',
  'ingredients_json',
  'steps_json',
  'ai_evaluation',
  'ai_suggestions',
  'ai_coaching',
  'ai_comment',
  'value',
]);

const TRUNCATE_TEXT_COLUMNS = new Set([
  'body',
  'description',
  'detail',
  'note',
  'notes',
  'title',
  'section_summary',
  'section_plans',
  'section_reflect',
  'section_learnings',
  'section_next_week',
  'last_evaluation',
  'last_suggestions',
  'last_profile_analysis',
  'last_overall_suggestions',
]);

const ULTRA_DROP_COLUMNS = new Set([
  'extra_data',
  'value_json',
  'payload_json',
  'ingredients_json',
  'steps_json',
  'ai_evaluation',
  'ai_suggestions',
  'ai_coaching',
  'ai_comment',
  'body',
  'description',
  'detail',
  'note',
  'notes',
  'section_summary',
  'section_plans',
  'section_reflect',
  'section_learnings',
  'section_next_week',
]);

const ID_LIKE_FIELD_RE = /^(id|.*_id|key|slug|sync_status|version)$/i;

function looksLikeJsonString(value: string): boolean {
  const t = value.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

function isLikelyBase64Blob(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 200 && BASE64_BLOB_RE.test(trimmed);
}

function isIdLikeField(fieldKey: string): boolean {
  return ID_LIKE_FIELD_RE.test(fieldKey);
}

function shouldStripUri(value: string, fieldKey: string): boolean {
  if (!value.trim()) return false;
  if (DATA_URI_RE.test(value)) return true;
  if (isLikelyBase64Blob(value)) return true;
  if (STRIP_URI_COLUMNS.has(fieldKey)) return true;
  if (/^https?:\/\//i.test(value) && /(_uri|_url|Uri|Url|image|Image|avatar|cover|photo|attachment)$/i.test(fieldKey)) {
    return true;
  }
  if (LOCAL_ONLY_URI_RE.test(value) && /(_uri|_url|Uri|Url|image|Image|uri|url|photo|attachment)$/i.test(fieldKey)) {
    return true;
  }
  return false;
}

function truncateText(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen - 1)}…`;
}

function maxTextFieldChars(aggressive: boolean, fieldKey: string): number {
  if (aggressive) return 800;
  if (TRUNCATE_TEXT_COLUMNS.has(fieldKey) || /^section_/i.test(fieldKey)) return 2_000;
  return API_UPLOAD_MAX_TEXT_FIELD_CHARS;
}

function slimJsonValue(value: unknown, aggressive: boolean): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (shouldStripUri(value, '')) return null;
    if (DATA_URI_RE.test(value)) return null;
    if (isLikelyBase64Blob(value)) return null;
    if (LOCAL_ONLY_URI_RE.test(value)) return null;
    const max = aggressive ? 800 : API_UPLOAD_MAX_TEXT_FIELD_CHARS;
    return truncateText(value, max);
  }

  if (Array.isArray(value)) {
    const items = value.map(item => slimJsonValue(item, aggressive));
    if (aggressive && items.length > 32) return items.slice(0, 32);
    return items;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'attachments') {
        out[key] = null;
        continue;
      }
      if (typeof v === 'string' && shouldStripUri(v, key)) {
        out[key] = null;
        continue;
      }
      out[key] = slimJsonValue(v, aggressive);
    }
    return out;
  }

  return value;
}

function slimStringField(
  value: string,
  fieldKey: string,
  aggressive: boolean,
  ultra: boolean,
): string | null {
  if (ultra && ULTRA_DROP_COLUMNS.has(fieldKey)) return null;
  if (shouldStripUri(value, fieldKey)) return null;

  if (
    TRUNCATE_JSON_COLUMNS.has(fieldKey) ||
    fieldKey === 'extra_data' ||
    looksLikeJsonString(value)
  ) {
    try {
      const parsed = JSON.parse(value) as unknown;
      const slimmed = slimJsonValue(parsed, aggressive);
      let json = JSON.stringify(slimmed);
      const maxJson = aggressive ? 2_000 : API_UPLOAD_MAX_JSON_FIELD_CHARS;
      if (json.length > maxJson) {
        json = JSON.stringify({ _upload_truncated: true, preview: json.slice(0, Math.min(256, maxJson - 64)) });
      }
      return json;
    } catch {
      /* 按普通文本截断 */
    }
  }

  if (DATA_URI_RE.test(value) || isLikelyBase64Blob(value)) return null;

  const maxLen = ultra
    ? isIdLikeField(fieldKey)
      ? 64
      : 200
    : value.length > 8_192
      ? 1_000
      : maxTextFieldChars(aggressive, fieldKey);
  return truncateText(value, maxLen);
}

function slimDeepForApiUpload(
  value: unknown,
  fieldKey: string | undefined,
  aggressive: boolean,
  ultra: boolean,
): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return slimStringField(value, fieldKey ?? '', aggressive, ultra);
  }

  if (Array.isArray(value)) {
    return value.map(item => slimDeepForApiUpload(item, fieldKey, aggressive, ultra));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (ultra && ULTRA_DROP_COLUMNS.has(key)) {
        out[key] = null;
        continue;
      }
      out[key] = slimDeepForApiUpload(v, key, aggressive, ultra);
    }
    return out;
  }

  return value;
}

export function estimateJsonUtf8Bytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

/** 上传前缩小整行（去 base64 / 本地 URI、截断超大 JSON 与文本） */
export function slimRecordForMysqlApi(
  row: Record<string, unknown>,
  opts?: ApiUploadSlimOptions,
): Record<string, unknown> {
  const maxBytes = opts?.maxBytes ?? API_UPLOAD_MAX_ROW_BYTES;
  const build = (aggressive: boolean, ultra: boolean) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value === undefined) continue;
      if (ultra && ULTRA_DROP_COLUMNS.has(key)) {
        out[key] = null;
        continue;
      }
      out[key] = slimDeepForApiUpload(value, key, aggressive, ultra);
    }
    return out;
  };

  let slimmed = build(opts?.aggressive ?? false, opts?.ultra ?? false);
  if (estimateJsonUtf8Bytes(slimmed) <= maxBytes) return slimmed;

  slimmed = build(true, false);
  if (estimateJsonUtf8Bytes(slimmed) <= maxBytes) return slimmed;

  slimmed = build(true, true);
  if (estimateJsonUtf8Bytes(slimmed) <= maxBytes) return slimmed;

  const minimal: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(slimmed)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      minimal[key] = truncateText(value, isIdLikeField(key) ? 64 : 120);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      minimal[key] = value;
    }
  }
  return minimal;
}
