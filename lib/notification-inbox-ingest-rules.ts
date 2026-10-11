/**
 * 收件箱写入门禁纯规则（无依赖，供自测与 ingest 共用）。
 */

export type InboxIngestGateInput = {
  /** Expo Go 沙箱禁用本地通知 */
  sandboxDisabled: boolean;
  /** 无 category 则不应写入 */
  hasCategory: boolean;
  /** 总开关 / 频道关闭 */
  categoryAllowed: boolean;
  /** handler 侧 suppress（已完成等） */
  suppressed: boolean;
};

/** 与 shouldSkipInboxIngest 决策一致：任一为真则跳过写入。 */
export function shouldSkipInboxIngestByGate(input: InboxIngestGateInput): boolean {
  if (input.sandboxDisabled) return true;
  if (!input.hasCategory) return true;
  if (!input.categoryAllowed) return true;
  if (input.suppressed) return true;
  return false;
}
