import { SAVINGS_PLAN_MAX_TARGET_AMOUNT } from '@/lib/repositories/savings-plan/savings-plan';

export function toIsoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 本地日历解析 YYYY-MM-DD，避免 UTC 偏移导致日期错一天 */
export function parseIsoDateLocal(iso: string) {
  const parts = iso.split('-').map((x) => parseInt(x, 10));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

export function addCalendarDays(d: Date, days: number) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + days);
  return x;
}

export function daysBetweenIso(startIso: string, endIso: string) {
  const s = parseIsoDateLocal(startIso);
  const e = parseIsoDateLocal(endIso);
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / 86400000));
}

export function formatChineseDate(d: Date) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function defaultWishSavingsFormDates() {
  const start = new Date();
  return { start, end: addCalendarDays(start, 1) };
}

export type WishSavingsFormValidated = {
  name: string;
  start_date: string;
  end_date: string;
  target_amount: number;
};

export function validateWishSavingsForm(
  name: string,
  startDate: Date,
  endDate: Date,
  targetAmountText: string,
): { ok: true; value: WishSavingsFormValidated } | { ok: false; message: string } {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { ok: false, message: '请输入名称' };
  }

  const start_date = toIsoDate(startDate);
  const end_date = toIsoDate(endDate);
  if (daysBetweenIso(start_date, end_date) < 1) {
    return {
      ok: false,
      message: '日期跨度至少为 1 天：结束日须晚于起始日。',
    };
  }

  const amount = parseInt(targetAmountText.replace(/\D/g, ''), 10) || 0;
  if (amount > SAVINGS_PLAN_MAX_TARGET_AMOUNT) {
    return {
      ok: false,
      message: `目标金额不得超过 8 位数（最大 ${SAVINGS_PLAN_MAX_TARGET_AMOUNT.toLocaleString('zh-CN')}）。`,
    };
  }

  return {
    ok: true,
    value: {
      name: trimmedName,
      start_date,
      end_date,
      target_amount: amount,
    },
  };
}
