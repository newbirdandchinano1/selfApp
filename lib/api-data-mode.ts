/**
 * local-first：已同步页面读 SQLite；首次进入页面按范围 REST 全量覆盖本地。
 * 增删改同时写本地（即时 UI）并推送后端。
 */
export const API_ONLY_READS = false;

export function isApiOnlyReads(): boolean {
  return API_ONLY_READS;
}

export function isLocalFirstReads(): boolean {
  return !API_ONLY_READS;
}
