/**
 * 现金流草稿合并（纯函数，无 SQLite / RN 依赖）— 供 commit handler 与单测共用。
 */

import { makeTimestampEntityId } from '@/lib/entity-id';
import { draftNumber, draftString } from './shared';

/** 与 CashFlowState 结构对齐；故意不从 cash-flow.types 引入以免拉 database.native */
export type CashFlowDraftState = {
  necessaryExpenses: number;
  unnecessaryExpenses: number;
  incomes: Array<{ id: string; name: string; amount: number; quadrant: 'E' | 'S' | 'B' | 'I' }>;
  holdings: Array<{
    id: string;
    name: string;
    principal: number;
    inflow: number;
    outflow: number;
    extra?: { repayMonths?: number } | null;
  }>;
  expenseLines: Array<{
    id: string;
    name: string;
    amount: number;
    bucket: 'necessary' | 'unnecessary';
  }>;
  goals: { targetPassiveIncome: number; targetMonths: number };
};

export function mergeCashFlowDraft(
  prev: CashFlowDraftState,
  draft: Record<string, unknown>,
): { state: CashFlowDraftState; entityId: string } | { error: string } {
  const amount = draftNumber(draft, 'amount');
  if (amount == null || amount <= 0) {
    return { error: '缺少有效金额' };
  }
  const kind = (draftString(draft, 'entry_kind') || 'necessary').toLowerCase();
  const title =
    draftString(draft, 'name_hint') || draftString(draft, 'name') || '现金流条目';

  if (kind === 'income') {
    const qRaw = (draftString(draft, 'quadrant') || 'E').toUpperCase();
    const quadrant = (['E', 'S', 'B', 'I'].includes(qRaw) ? qRaw : 'E') as
      | 'E'
      | 'S'
      | 'B'
      | 'I';
    const id = makeTimestampEntityId('cfi_', 8);
    return {
      entityId: id,
      state: {
        ...prev,
        incomes: [...prev.incomes, { id, name: title, amount: Math.abs(amount), quadrant }],
      },
    };
  }

  if (kind === 'necessary' || kind === 'unnecessary') {
    const id = makeTimestampEntityId('cfe_', 8);
    const bucket = kind === 'necessary' ? 'necessary' : 'unnecessary';
    return {
      entityId: id,
      state: {
        ...prev,
        necessaryExpenses:
          bucket === 'necessary' ? prev.necessaryExpenses + Math.abs(amount) : prev.necessaryExpenses,
        unnecessaryExpenses:
          bucket === 'unnecessary'
            ? prev.unnecessaryExpenses + Math.abs(amount)
            : prev.unnecessaryExpenses,
        expenseLines: [
          ...prev.expenseLines,
          { id, name: title, amount: Math.abs(amount), bucket },
        ],
      },
    };
  }

  if (kind === 'asset') {
    const id = makeTimestampEntityId('cfh_', 8);
    const inflow = draftNumber(draft, 'asset_return') ?? 0;
    return {
      entityId: id,
      state: {
        ...prev,
        holdings: [
          ...prev.holdings,
          {
            id,
            name: title,
            principal: Math.abs(amount),
            inflow: Math.max(0, inflow),
            outflow: 0,
          },
        ],
      },
    };
  }

  if (kind === 'liability') {
    const id = makeTimestampEntityId('cfh_', 8);
    const months = Math.max(1, Math.floor(draftNumber(draft, 'liability_months') ?? 12));
    return {
      entityId: id,
      state: {
        ...prev,
        holdings: [
          ...prev.holdings,
          {
            id,
            name: title,
            principal: Math.abs(amount) * months,
            inflow: 0,
            outflow: Math.abs(amount),
            extra: { repayMonths: months },
          },
        ],
      },
    };
  }

  return { error: `不支持的现金流类型：${kind}` };
}
