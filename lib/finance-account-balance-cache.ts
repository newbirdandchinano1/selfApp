import type { FinanceAccountBalanceRow } from '@/lib/repositories/finance/finance.types';

/**
 * 服务端汇总的账本余额缓存。
 * 专用接口只回传近期流水时，禁止用「本地不全量流水」重算余额。
 */
const balancesByAccountId = new Map<string, number>();
let netWorthCache: number | null = null;

export function rememberFinanceAccountBalances(rows: FinanceAccountBalanceRow[]): void {
  for (const row of rows) {
    const id = String(row.id ?? '').trim();
    if (!id) continue;
    if (typeof row.balance === 'number' && Number.isFinite(row.balance)) {
      balancesByAccountId.set(id, row.balance);
    }
  }
}

export function rememberFinanceNetWorth(value: number | null | undefined): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    netWorthCache = value;
  }
}

export function getRememberedFinanceAccountBalance(accountId: string): number | undefined {
  const id = accountId.trim();
  if (!id) return undefined;
  return balancesByAccountId.get(id);
}

export function getRememberedFinanceNetWorth(): number | null {
  return netWorthCache;
}

/** 本地记账后按 ledger 增量修正缓存，避免用不完整流水重算 */
export function applyFinanceAccountBalanceDelta(accountId: string, delta: number): void {
  const id = accountId.trim();
  if (!id || !Number.isFinite(delta) || delta === 0) return;
  const cur = balancesByAccountId.get(id);
  if (cur == null) return;
  balancesByAccountId.set(id, cur + delta);
  if (netWorthCache != null) {
    netWorthCache += delta;
  }
}

export function clearFinanceAccountBalanceCache(): void {
  balancesByAccountId.clear();
  netWorthCache = null;
}
