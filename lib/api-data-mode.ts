/**
 * 为 true 时：展示优先用内存中的 REST 结果，再叠加重本地 pending 修改；
 * REST 同时写入 SQLite 供写改删；接口不可用时（offlineFallback）最后回退本地库。
 */
export const API_ONLY_READS = true;

export function isApiOnlyReads(): boolean {
  return API_ONLY_READS;
}
