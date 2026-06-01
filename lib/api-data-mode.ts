/**
 * 为 true 时：展示与查询只使用 REST 返回的数据，不读本地 SQLite 缓存、不回退离线库。
 * 写入仍可先落本地再推送到后端（见各 repository 的 pending_* 流程）。
 */
export const API_ONLY_READS = true;

export function isApiOnlyReads(): boolean {
  return API_ONLY_READS;
}
