/**
 * 为 true 时：展示以 REST 为主，并将 REST 结果缓存到本地 SQLite 供写改删使用；
 * readApiTable/readApiRecord 还会合并本地 pending 行（即时 UI）。
 */
export const API_ONLY_READS = true;

export function isApiOnlyReads(): boolean {
  return API_ONLY_READS;
}
