import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';

export type FinanceDefaultAccounts = {
  defaultPaymentAccountId: string | null;
  defaultIncomeAccountId: string | null;
};

const EMPTY_DEFAULTS: FinanceDefaultAccounts = {
  defaultPaymentAccountId: null,
  defaultIncomeAccountId: null,
};

export async function loadFinanceDefaultAccounts(): Promise<FinanceDefaultAccounts> {
  try {
    const parsed = await getAppSetting<Record<string, unknown>>(AppSettingKey.financeDefaultAccounts);
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY_DEFAULTS };
    const o = parsed;
    return {
      defaultPaymentAccountId:
        typeof o.defaultPaymentAccountId === 'string' && o.defaultPaymentAccountId.trim()
          ? o.defaultPaymentAccountId.trim()
          : null,
      defaultIncomeAccountId:
        typeof o.defaultIncomeAccountId === 'string' && o.defaultIncomeAccountId.trim()
          ? o.defaultIncomeAccountId.trim()
          : null,
    };
  } catch {
    return { ...EMPTY_DEFAULTS };
  }
}

export async function persistFinanceDefaultAccounts(settings: FinanceDefaultAccounts): Promise<void> {
  await setAppSetting(AppSettingKey.financeDefaultAccounts, settings);
}

/** 仅保留仍存在的资产类账户 ID */
export function sanitizeFinanceDefaultAccounts(
  settings: FinanceDefaultAccounts,
  accounts: Array<{ id: string; sign_rule?: number }>,
): FinanceDefaultAccounts {
  const assetIds = new Set(accounts.filter((a) => (a.sign_rule ?? 1) > 0).map((a) => a.id));
  return {
    defaultPaymentAccountId:
      settings.defaultPaymentAccountId && assetIds.has(settings.defaultPaymentAccountId)
        ? settings.defaultPaymentAccountId
        : null,
    defaultIncomeAccountId:
      settings.defaultIncomeAccountId && assetIds.has(settings.defaultIncomeAccountId)
        ? settings.defaultIncomeAccountId
        : null,
  };
}

/** 删除账户后清除指向该账户的默认设置 */
export async function clearFinanceDefaultAccountIfDeleted(accountId: string): Promise<void> {
  const current = await loadFinanceDefaultAccounts();
  let changed = false;
  const next = { ...current };
  if (next.defaultPaymentAccountId === accountId) {
    next.defaultPaymentAccountId = null;
    changed = true;
  }
  if (next.defaultIncomeAccountId === accountId) {
    next.defaultIncomeAccountId = null;
    changed = true;
  }
  if (changed) {
    await persistFinanceDefaultAccounts(next);
  }
}
