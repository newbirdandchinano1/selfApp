/**
 * 财务提醒纯规则（不触达通知 API）。
 * 供定时支出 / 预算阈值 / 储蓄轻催 / 未记账收口共用。
 */

export type FinanceBudgetThresholdKind = 't50' | 't80' | 'over';

export type FinanceBudgetNotifiedFlags = {
  t50?: boolean;
  t80?: boolean;
  over?: boolean;
};

export type FinanceScheduledExpenseReminderSlotKind = 'advance' | 'evening_wrap';

export type FinanceScheduledExpenseFireCandidate = {
  fireAt: Date;
  kind: FinanceScheduledExpenseReminderSlotKind;
  dueYmd: string;
};

/** 从应记时刻回推提前量；advanceMinutes=0 即到点提醒。 */
export function buildScheduledExpenseAdvanceFireAt(
  dueYmd: string,
  hour: number,
  minute: number,
  advanceMinutes: number,
): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueYmd.trim());
  if (!m) return null;
  const due = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Math.max(0, Math.min(23, Math.floor(hour))),
    Math.max(0, Math.min(59, Math.floor(minute))),
    0,
    0,
  );
  const adv = Math.max(0, Math.min(180, Math.round(advanceMinutes)));
  return new Date(due.getTime() - adv * 60_000);
}

export function buildClockFireAt(
  ymd: string,
  hour: number,
  minute: number,
): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Math.max(0, Math.min(23, Math.floor(hour))),
    Math.max(0, Math.min(59, Math.floor(minute))),
    0,
    0,
  );
}

/**
 * 选定下次定时支出提醒：
 * 1) 应记日提前量时刻（未过）
 * 2) 当日仍未入账且开启收口 → 傍晚收口
 * 3) 否则扫后续应记日
 */
export function pickNextScheduledExpenseReminder(params: {
  dueYmds: string[];
  hour: number;
  minute: number;
  advanceMinutes: number;
  eveningWrapEnabled: boolean;
  eveningWrapHour: number;
  eveningWrapMinute: number;
  now: Date;
  /** 某应记日是否仍需提醒（未全部入账） */
  needsReminderOnYmd: (ymd: string) => boolean;
}): FinanceScheduledExpenseFireCandidate | null {
  const nowMs = params.now.getTime();
  for (const ymd of params.dueYmds) {
    if (!params.needsReminderOnYmd(ymd)) continue;

    const advanceAt = buildScheduledExpenseAdvanceFireAt(
      ymd,
      params.hour,
      params.minute,
      params.advanceMinutes,
    );
    if (advanceAt && advanceAt.getTime() > nowMs + 2000) {
      return { fireAt: advanceAt, kind: 'advance', dueYmd: ymd };
    }

    if (params.eveningWrapEnabled) {
      const wrapAt = buildClockFireAt(ymd, params.eveningWrapHour, params.eveningWrapMinute);
      if (wrapAt && wrapAt.getTime() > nowMs + 2000) {
        // 收口须晚于应记时刻，避免与到点重复
        const dueAt = buildScheduledExpenseAdvanceFireAt(ymd, params.hour, params.minute, 0);
        if (dueAt && wrapAt.getTime() > dueAt.getTime()) {
          return { fireAt: wrapAt, kind: 'evening_wrap', dueYmd: ymd };
        }
      }
    }
  }
  return null;
}

export function computeBudgetUsagePercent(params: {
  baseAmount: number;
  includeLastBalance: boolean;
  lastPeriodRemaining: number;
  scheduledDeduction: number;
  periodIncome: number;
  periodExpense: number;
}): { totalBudget: number; usedExpense: number; percent: number } {
  const base = Math.max(0, Number.isFinite(params.baseAmount) ? params.baseAmount : 0);
  const carry = params.includeLastBalance
    ? Math.max(0, Number.isFinite(params.lastPeriodRemaining) ? params.lastPeriodRemaining : 0)
    : 0;
  const deduction = Math.max(
    0,
    Number.isFinite(params.scheduledDeduction) ? params.scheduledDeduction : 0,
  );
  const income = Math.max(0, Number.isFinite(params.periodIncome) ? params.periodIncome : 0);
  const expense = Math.max(0, Number.isFinite(params.periodExpense) ? params.periodExpense : 0);
  const totalBudget = Math.max(0, base + carry - deduction + income);
  const percent = totalBudget > 0 ? (expense / totalBudget) * 100 : 0;
  return { totalBudget, usedExpense: expense, percent };
}

/** 按当前用量决定本周期应弹出的最高阈值（一次只推一档）。 */
export function resolveBudgetThresholdToNotify(params: {
  percent: number;
  notify50: boolean;
  notify80: boolean;
  notifyOver: boolean;
  already: FinanceBudgetNotifiedFlags;
}): FinanceBudgetThresholdKind | null {
  const pct = Number.isFinite(params.percent) ? params.percent : 0;
  if (params.notifyOver && pct >= 100 && !params.already.over) return 'over';
  if (params.notify80 && pct >= 80 && !params.already.t80) return 't80';
  if (params.notify50 && pct >= 50 && !params.already.t50) return 't50';
  return null;
}

export function markBudgetThresholdNotified(
  already: FinanceBudgetNotifiedFlags,
  kind: FinanceBudgetThresholdKind,
): FinanceBudgetNotifiedFlags {
  const next = { ...already };
  if (kind === 'over') {
    next.over = true;
    next.t80 = true;
    next.t50 = true;
  } else if (kind === 't80') {
    next.t80 = true;
    next.t50 = true;
  } else {
    next.t50 = true;
  }
  return next;
}

export function budgetThresholdCopy(
  kind: FinanceBudgetThresholdKind,
  percent: number,
  usedExpense: number,
  totalBudget: number,
): { title: string; body: string } {
  const pctLabel = Math.round(percent);
  const used = formatYuan(usedExpense);
  const total = formatYuan(totalBudget);
  if (kind === 'over') {
    return {
      title: '预算已超支',
      body: `本周期已用 ${pctLabel}%（${used} / ${total}），留意后续开支。`,
    };
  }
  if (kind === 't80') {
    return {
      title: '预算已用八成',
      body: `本周期已用 ${pctLabel}%（${used} / ${total}）。`,
    };
  }
  return {
    title: '预算过半',
    body: `本周期已用 ${pctLabel}%（${used} / ${total}）。`,
  };
}

/** 找下一个目标星期几的本地时刻（含今天若未过）。weekday: 0=周日 */
export function findNextWeekdayFireAt(params: {
  weekday: number;
  hour: number;
  minute: number;
  now: Date;
  maxDays?: number;
}): Date | null {
  const targetDow = ((Math.floor(params.weekday) % 7) + 7) % 7;
  const maxDays = params.maxDays ?? 14;
  const cursor = new Date(
    params.now.getFullYear(),
    params.now.getMonth(),
    params.now.getDate(),
  );
  for (let i = 0; i < maxDays; i += 1) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() + i);
    if (day.getDay() !== targetDow) continue;
    const fireAt = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      Math.max(0, Math.min(23, Math.floor(params.hour))),
      Math.max(0, Math.min(59, Math.floor(params.minute))),
      0,
      0,
    );
    if (fireAt.getTime() > params.now.getTime() + 2000) return fireAt;
  }
  return null;
}

/** 从今天起找下一个未记账收口时刻（今日已有流水则跳过）。 */
export function findNextLedgerWrapFireAt(params: {
  hour: number;
  minute: number;
  now: Date;
  muteYmd: string | null;
  hasTxnOnYmd: (ymd: string) => boolean;
  ymdOf: (d: Date) => string;
  maxDays?: number;
}): Date | null {
  const maxDays = params.maxDays ?? 14;
  const cursor = new Date(
    params.now.getFullYear(),
    params.now.getMonth(),
    params.now.getDate(),
  );
  for (let i = 0; i < maxDays; i += 1) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() + i);
    const ymd = params.ymdOf(day);
    if (params.muteYmd === ymd) continue;
    if (params.hasTxnOnYmd(ymd)) continue;
    const fireAt = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      Math.max(0, Math.min(23, Math.floor(params.hour))),
      Math.max(0, Math.min(59, Math.floor(params.minute))),
      0,
      0,
    );
    if (fireAt.getTime() > params.now.getTime() + 2000) return fireAt;
  }
  return null;
}

export function formatYuan(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const prefix = n < 0 ? '-¥' : '¥';
  return `${prefix}${Math.abs(n).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatClockLabel(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
