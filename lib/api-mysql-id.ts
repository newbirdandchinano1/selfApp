import {
  ENTITY_ID_MAX_LEN,
  isIdLikeColumnName,
  shortStableEntityId,
} from '@/lib/entity-id';

/** @deprecated 使用 ENTITY_ID_MAX_LEN */
export const MYSQL_API_ID_MAX_LEN = ENTITY_ID_MAX_LEN;

export { shortStableEntityId as shortStableIdForMysql };

function looksLikeJsonString(value: string): boolean {
  const t = value.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

function applyIdRemapToString(value: string, remap: Map<string, string>): string {
  if (remap.has(value)) return remap.get(value)!;
  if (looksLikeJsonString(value)) {
    try {
      const parsed = JSON.parse(value) as unknown;
      const next = applyIdRemapDeep(parsed, remap);
      return JSON.stringify(next);
    } catch {
      return value;
    }
  }
  return value;
}

function applyIdRemapDeep(value: unknown, remap: Map<string, string>): unknown {
  if (remap.size === 0) return value;
  if (typeof value === 'string') return applyIdRemapToString(value, remap);
  if (Array.isArray(value)) return value.map(item => applyIdRemapDeep(item, remap));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = applyIdRemapDeep(v, remap);
    }
    return out;
  }
  return value;
}

function reserveRemap(remap: Map<string, string>, oldId: string): void {
  if (!oldId || oldId.length <= ENTITY_ID_MAX_LEN) return;
  if (remap.has(oldId)) return;
  let next = shortStableEntityId(oldId);
  let n = 0;
  while ([...remap.values()].includes(next) && n < 8) {
    next = shortStableEntityId(`${oldId}#${n}`);
    n += 1;
  }
  remap.set(oldId, next);
}

/**
 * `app_settings` / `app_meta` 的主键是业务语义 key（MySQL 为 VARCHAR(255)），
 * 不是实体 id。若按 36 字符缩短，上传 body 与本地 key 脱节，
 * markLocalRowsSynced 会更新 0 行，造成 pending 死循环推送。
 */
const SEMANTIC_KEY_PK_TABLES = new Set(['app_settings', 'app_meta']);

function isSemanticKeyPkColumn(table: string, col: string): boolean {
  return SEMANTIC_KEY_PK_TABLES.has(table) && col === 'key';
}

function collectIdLikeValuesFromRow(
  table: string,
  row: Record<string, unknown>,
  remap: Map<string, string>,
  pkCols: string[],
): void {
  for (const col of pkCols) {
    if (isSemanticKeyPkColumn(table, col)) continue;
    const v = row[col];
    if (typeof v === 'string' && v) reserveRemap(remap, v);
  }
  if (!SEMANTIC_KEY_PK_TABLES.has(table)) {
    const id = row.id;
    if (typeof id === 'string' && id) reserveRemap(remap, id);
  }

  for (const [col, value] of Object.entries(row)) {
    if (isSemanticKeyPkColumn(table, col)) continue;
    if (!isIdLikeColumnName(col)) continue;
    if (typeof value === 'string' && value) reserveRemap(remap, value);
  }
}

/** 从待上传全库数据收集需缩短的 id / 外键，并生成 old→new 映射 */
export function buildMysqlIdRemapForUpload(
  rowsByTable: Map<string, Record<string, unknown>[]>,
  pkColsByTable: Map<string, string[]>,
): Map<string, string> {
  const remap = new Map<string, string>();

  for (const [table, rows] of rowsByTable) {
    const pkCols = pkColsByTable.get(table) ?? ['id'];
    for (const row of rows) {
      collectIdLikeValuesFromRow(table, row, remap, pkCols);
    }
  }

  return remap;
}

/** 将 id 映射应用到单行（含 extra_data 等 JSON 内的引用） */
export function applyMysqlIdRemapToRow(
  row: Record<string, unknown>,
  remap: Map<string, string>,
): Record<string, unknown> {
  if (remap.size === 0) return row;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) continue;
    out[key] = applyIdRemapDeep(value, remap);
  }
  return out;
}

/** 批量应用 id 映射到所有待上传表 */
export function applyMysqlIdRemapToUploadBundle(
  rowsByTable: Map<string, Record<string, unknown>[]>,
  remap: Map<string, string>,
): void {
  if (remap.size === 0) return;
  for (const [table, rows] of rowsByTable) {
    rowsByTable.set(
      table,
      rows.map(row => {
        const next = applyMysqlIdRemapToRow(row, remap);
        // 语义主键不得被其它表的 id 缩短映射误伤
        if (SEMANTIC_KEY_PK_TABLES.has(table) && typeof row.key === 'string') {
          next.key = row.key;
        }
        return next;
      }),
    );
  }
}
