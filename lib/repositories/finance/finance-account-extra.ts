/**
 * 财务账户 `extra_data`（JSON）的解析与合并。
 * 与表结构解耦：扩展字段放在 JSON 中，避免频繁改列。
 */

/** 与后端/本地存储约定的键名，勿随意改名（否则历史数据失效） */
export const FINANCE_ACCOUNT_EXTRA_EXCLUDE_FROM_TOTAL_ASSETS = 'exclude_from_total_assets' as const;

/** 将 extra_data 安全解析为普通对象，解析失败时返回空对象 */
export function parseFinanceAccountExtraObject(extraData: string | null): Record<string, unknown> {
  if (!extraData?.trim()) return {};
  try {
    const raw = JSON.parse(extraData) as unknown;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
  } catch {
    // 忽略非法 JSON
  }
  return {};
}

/**
 * 是否勾选「不计入」汇总：为 true 时从聚合数字中剔除该账户。
 * 资产账户：不计入总资产；负债账户：不计入总负债；首页净资产与资产页 hero 区均一致。
 */
export function isFinanceAccountExcludedFromAggregates(extraData: string | null): boolean {
  const obj = parseFinanceAccountExtraObject(extraData);
  return obj[FINANCE_ACCOUNT_EXTRA_EXCLUDE_FROM_TOTAL_ASSETS] === true;
}

/**
 * 在保留原有 extra 字段的前提下，写入或清除「不计入资产/负债汇总」标记（存贮键名仍为 exclude_from_total_assets）。
 * @returns 可传给 `updateFinanceAccount` 的 `extra_data` 字符串
 */
export function mergeFinanceAccountExcludeFromTotalAssets(
  currentExtraData: string | null,
  excluded: boolean,
): string {
  const next = { ...parseFinanceAccountExtraObject(currentExtraData) };
  if (excluded) {
    next[FINANCE_ACCOUNT_EXTRA_EXCLUDE_FROM_TOTAL_ASSETS] = true;
  } else {
    delete next[FINANCE_ACCOUNT_EXTRA_EXCLUDE_FROM_TOTAL_ASSETS];
  }
  return JSON.stringify(next);
}
