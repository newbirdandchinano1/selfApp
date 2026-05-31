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

function collectIdLikeValuesFromRow(
  row: Record<string, unknown>,
  remap: Map<string, string>,
  pkCols: string[],
): void {
  for (const col of pkCols) {
    const v = row[col];
    if (typeof v === 'string' && v) reserveRemap(remap, v);
  }
  const id = row.id;
  if (typeof id === 'string' && id) reserveRemap(remap, id);

  for (const [col, value] of Object.entries(row)) {
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
      collectIdLikeValuesFromRow(row, remap, pkCols);
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
      rows.map(row => applyMysqlIdRemapToRow(row, remap)),
    );
  }
}
