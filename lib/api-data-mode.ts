/**
 * 为 true 时：展示与查询以 REST 为主；readApiTable/readApiRecord 会自动合并本地待同步行（即时 UI）。
 * 写入经 SQLite → markApiTableDirty → 约 50ms 内合并推送到 REST。
 */
export const API_ONLY_READS = true;

export function isApiOnlyReads(): boolean {
  return API_ONLY_READS;
}
