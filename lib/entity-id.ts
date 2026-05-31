/** 实体主键/外键 id：与 MySQL VARCHAR(36) 对齐，生成与缩短逻辑集中在此 */

export const ENTITY_ID_MAX_LEN = 36;

export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 将任意长字符串稳定映射为 8 位十六进制摘要（用于组合 id 中嵌入父 id） */
export function idDigest8(input: string): string {
  return fnv1a32(input).toString(16).padStart(8, '0');
}

/** 超长 id 稳定缩短为 ≤maxLen（上传兜底、历史数据迁移） */
export function shortStableEntityId(longId: string, maxLen = ENTITY_ID_MAX_LEN): string {
  if (longId.length <= maxLen) return longId;
  const hex = [0, 1, 2, 3, 4]
    .map(s => fnv1a32(`${longId}\0${s}`).toString(16).padStart(8, '0'))
    .join('');
  return (`z${hex}`).slice(0, maxLen);
}

/**
 * 常规时间戳 id：prefix + base36(ts) + random
 * 例：tsk_lq1x2y3_abc12de3（总长 ≤ ENTITY_ID_MAX_LEN）
 */
export function makeTimestampEntityId(prefix: string, randomLen = 8): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 2 + randomLen);
  const id = `${prefix}${ts}_${rand}`;
  return id.length <= ENTITY_ID_MAX_LEN ? id : id.slice(0, ENTITY_ID_MAX_LEN);
}

/**
 * 组合 id：prefix + digest(父id) + suffix，避免把完整父 id 拼进主键导致超长
 * 例：habit_check_ins → hci_a1b2c3d4_20260528
 */
export function makeCompositeEntityId(prefix: string, parentId: string, suffix: string): string {
  const digest = idDigest8(parentId);
  const raw = `${prefix}${digest}_${suffix}`;
  if (raw.length <= ENTITY_ID_MAX_LEN) return raw;
  return shortStableEntityId(`${prefix}${parentId}_${suffix}`);
}

export function isIdLikeColumnName(column: string): boolean {
  return column === 'id' || column.endsWith('_id') || column.endsWith('Id');
}
