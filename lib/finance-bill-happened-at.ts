const BILL_HAPPENED_AT_FIELD_KEYS = [
  'happened_at',
  'consumption_time',
  'paid_at',
  'transaction_time',
  'payment_time',
] as const;

function normalizeBillDatetimeString(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  let d = new Date(s);
  if (Number.isFinite(d.getTime())) return d.toISOString();

  const spaced = s.replace(/\//g, '-').replace(' ', 'T');
  d = new Date(spaced);
  if (Number.isFinite(d.getTime())) return d.toISOString();

  const zhFull = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (zhFull) {
    const [, y, mo, da, h = '0', mi = '0', se = '0'] = zhFull;
    d = new Date(Number(y), Number(mo) - 1, Number(da), Number(h), Number(mi), Number(se));
    if (Number.isFinite(d.getTime())) return d.toISOString();
  }

  const zhShort = s.match(/^(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (zhShort) {
    const now = new Date();
    const [, mo, da, h = '0', mi = '0', se = '0'] = zhShort;
    d = new Date(now.getFullYear(), Number(mo) - 1, Number(da), Number(h), Number(mi), Number(se));
    if (Number.isFinite(d.getTime())) return d.toISOString();
  }

  return null;
}

function normalizeBillDatetimeValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  if (typeof value === 'string') return normalizeBillDatetimeString(value);
  return null;
}

/** 从 AI 账单识别 JSON 中提取消费/支付时间（ISO8601）。 */
export function extractBillHappenedAtFromAiJson(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  for (const key of BILL_HAPPENED_AT_FIELD_KEYS) {
    const iso = normalizeBillDatetimeValue(o[key]);
    if (iso) return iso;
  }
  return null;
}

const FIVE_YEARS_MS = 5 * 365.25 * 24 * 60 * 60 * 1000;
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

/** 账单识图记账：优先用截图上的消费时间，无法识别或异常则回退当前时间。 */
export function resolveHappenedAtForBillLedger(billIso: string | null | undefined): {
  iso: string;
  fromBill: boolean;
} {
  if (billIso) {
    const d = new Date(billIso);
    if (Number.isFinite(d.getTime())) {
      const now = Date.now();
      const t = d.getTime();
      if (t >= now - FIVE_YEARS_MS && t <= now + TWO_DAYS_MS) {
        return { iso: d.toISOString(), fromBill: true };
      }
    }
  }
  return { iso: new Date().toISOString(), fromBill: false };
}
