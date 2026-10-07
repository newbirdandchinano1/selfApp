/**
 * 定时预扣展示 / 预期存款抬高的纯计算（无 DB）。
 * 与预算总额扣减（整周期 sum）分离：此处只计「未支付且未过点」的剩余。
 */
import {
  buildScheduledExpenseSlotKey,
  estimateScheduledExpenseAmountInRange,
  sumScheduledExpensesInRange,
  type EstimateScheduledExpenseInRangeOpts,
  type ScheduledFinanceExpense,
} from '@/lib/finance-scheduled-expense';

export type ComputeScheduledWithholdingRemainingInput = {
  items: ScheduledFinanceExpense[];
  /** 逻辑「今天」0 点 */
  today: Date;
  /** 未设存款目标时：预扣统计到本预算周期结束（不含） */
  budgetPeriodEndExclusive: Date;
  /** 已设存款目标时：改统计到目标日次日 0 点（不含） */
  savingsGoalTargetDate?: string | null;
  now?: Date;
  paidSlots?: Set<string>;
};

function parseIsoDateLocal(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 定时预扣栏与预期存款抬高共用口径。 */
export function computeScheduledWithholdingRemaining(
  input: ComputeScheduledWithholdingRemainingInput,
): number {
  const now = input.now ?? new Date();
  const start = new Date(input.today.getFullYear(), input.today.getMonth(), input.today.getDate());
  let endExclusive = input.budgetPeriodEndExclusive;
  const goalIso = input.savingsGoalTargetDate?.trim();
  if (goalIso && /^\d{4}-\d{2}-\d{2}$/.test(goalIso)) {
    const target = parseIsoDateLocal(goalIso);
    if (Number.isFinite(target.getTime())) {
      endExclusive = new Date(target.getFullYear(), target.getMonth(), target.getDate() + 1);
    }
  }
  if (endExclusive.getTime() <= start.getTime()) return 0;
  const opts: EstimateScheduledExpenseInRangeOpts = {
    now,
    paidSlots: input.paidSlots ?? new Set(),
  };
  return sumScheduledExpensesInRange(input.items, start, endExclusive, opts);
}

export {
  buildScheduledExpenseSlotKey,
  estimateScheduledExpenseAmountInRange,
  sumScheduledExpensesInRange,
};
