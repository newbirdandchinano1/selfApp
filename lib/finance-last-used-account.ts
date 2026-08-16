import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';

let cachedLastUsedAccountId: string | null | undefined;

function normalizeAccountId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function migrateFromLegacyDefaultAccounts(): Promise<string | null> {
  try {
    const parsed = await getAppSetting<Record<string, unknown>>(AppSettingKey.financeDefaultAccounts);
    if (!parsed || typeof parsed !== 'object') return null;
    return (
      normalizeAccountId(parsed.defaultPaymentAccountId) ??
      normalizeAccountId(parsed.defaultIncomeAccountId)
    );
  } catch {
    return null;
  }
}

/** 同步读取内存缓存（未 load 过时为 null） */
export function getCachedFinanceLastUsedAccountId(): string | null {
  return cachedLastUsedAccountId ?? null;
}

export async function loadFinanceLastUsedAccountId(): Promise<string | null> {
  if (cachedLastUsedAccountId !== undefined) return cachedLastUsedAccountId;
  try {
    const parsed = await getAppSetting<Record<string, unknown>>(AppSettingKey.financeLastUsedAccount);
    let id: string | null = null;
    if (parsed && typeof parsed === 'object') {
      id = normalizeAccountId(parsed.accountId);
    }
    if (!id) {
      id = await migrateFromLegacyDefaultAccounts();
      if (id) {
        await setAppSetting(AppSettingKey.financeLastUsedAccount, { accountId: id });
      }
    }
    cachedLastUsedAccountId = id;
    return id;
  } catch {
    cachedLastUsedAccountId = null;
    return null;
  }
}

export async function rememberFinanceLastUsedAccount(accountId: string): Promise<void> {
  const id = accountId.trim();
  if (!id) return;
  cachedLastUsedAccountId = id;
  await setAppSetting(AppSettingKey.financeLastUsedAccount, { accountId: id });
}

/** 仅保留仍存在的账户 ID */
export function sanitizeFinanceLastUsedAccountId(
  accountId: string | null,
  accounts: Array<{ id: string }>,
): string | null {
  if (!accountId) return null;
  return accounts.some((a) => a.id === accountId) ? accountId : null;
}

/** 删除账户后清除指向该账户的上次记账记录 */
export async function clearFinanceLastUsedAccountIfDeleted(accountId: string): Promise<void> {
  const current = await loadFinanceLastUsedAccountId();
  if (current !== accountId) return;
  cachedLastUsedAccountId = null;
  await setAppSetting(AppSettingKey.financeLastUsedAccount, { accountId: null });
}
