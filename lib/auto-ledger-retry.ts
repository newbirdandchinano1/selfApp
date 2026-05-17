/** 截图/快捷指令自动记账：整流程重试次数（含首次） */
export const AUTO_LEDGER_MAX_ATTEMPTS = 3;

/** 两次尝试之间的等待（毫秒） */
export const AUTO_LEDGER_RETRY_DELAY_MS = 1500;

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
