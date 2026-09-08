import { isFinanceLiabilityAccount } from '@/lib/finance-net-worth';
import type { FinanceAccountBalanceRow } from '@/lib/repositories/finance/finance.types';
import type { MaterialIcons } from '@expo/vector-icons';

export type SheetTab = 'sentence' | 'expense' | 'income' | 'transfer';

export type AccountPickerTarget = 'sheet' | 'transferFrom' | 'transferTo';

/** 解析转账弹窗默认扣款/入账账户（支持负债还款：资产扣款 → 负债入账）。 */
export function resolveTransferLaunchAccounts(
  list: FinanceAccountBalanceRow[],
  intent: { fromAccountId?: string | null; toAccountId?: string | null },
): { fromId: string; toId: string } | null {
  if (list.length < 2) return null;

  const pick = (id: string | null | undefined) =>
    id && list.some((a) => a.id === id) ? id : null;

  let fromId = pick(intent.fromAccountId);
  let toId = pick(intent.toAccountId);

  if (fromId && toId && fromId === toId) {
    toId = null;
  }

  const otherOf = (id: string, preferOppositeLiability: boolean) => {
    const base = list.find((a) => a.id === id);
    if (!base) return list.find((a) => a.id !== id) ?? null;
    const baseLiability = isFinanceLiabilityAccount(base);
    if (preferOppositeLiability) {
      const opposite = list.find(
        (a) => a.id !== id && isFinanceLiabilityAccount(a) !== baseLiability,
      );
      if (opposite) return opposite;
    }
    return list.find((a) => a.id !== id) ?? null;
  };

  if (fromId && toId) return { fromId, toId };

  if (toId && !fromId) {
    const toAcc = list.find((a) => a.id === toId);
    // 负债还款：优先选资产作为扣款账户
    if (toAcc && isFinanceLiabilityAccount(toAcc)) {
      const asset = list.find((a) => a.id !== toId && !isFinanceLiabilityAccount(a));
      if (asset) return { fromId: asset.id, toId };
    }
    const other = otherOf(toId, true);
    if (!other) return null;
    return { fromId: other.id, toId };
  }

  if (fromId && !toId) {
    const other = otherOf(fromId, true);
    if (!other) return null;
    return { fromId, toId: other.id };
  }

  const assets = list.filter((a) => !isFinanceLiabilityAccount(a));
  if (assets.length >= 2) {
    return { fromId: assets[0].id, toId: assets[1].id };
  }
  return { fromId: list[0].id, toId: list[1].id };
}

/** 转账双方文案：普通转账 / 负债还款 / 负债取款 */
export function describeFinanceTransferPair(
  from: Pick<FinanceAccountBalanceRow, 'sign_rule' | 'account_type' | 'extra_data'> | null,
  to: Pick<FinanceAccountBalanceRow, 'sign_rule' | 'account_type' | 'extra_data'> | null,
): {
  fromLabel: string;
  toLabel: string;
  hint: string | null;
  mode: 'transfer' | 'repay' | 'draw' | 'liability_move';
} {
  const fromLiability = from ? isFinanceLiabilityAccount(from) : false;
  const toLiability = to ? isFinanceLiabilityAccount(to) : false;
  if (!fromLiability && toLiability) {
    return {
      fromLabel: '扣款账户',
      toLabel: '还款账户',
      hint: '从资产扣款并减少负债欠款（还款）。',
      mode: 'repay',
    };
  }
  if (fromLiability && !toLiability) {
    return {
      fromLabel: '负债账户',
      toLabel: '入账账户',
      hint: '从负债取用资金并增加欠款（取款/透支）。',
      mode: 'draw',
    };
  }
  if (fromLiability && toLiability) {
    return {
      fromLabel: '转出负债',
      toLabel: '转入负债',
      hint: '在负债账户之间调整欠款。',
      mode: 'liability_move',
    };
  }
  return {
    fromLabel: '扣款账户',
    toLabel: '入账账户',
    hint: null,
    mode: 'transfer',
  };
}

export type SheetCategory = {
  key: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  color: string;
  /** 用户自定义分类（可长按删除） */
  isCustom?: boolean;
};

export type ParsedOneLiner = {
  transaction_type: 'expense' | 'income';
  amount: number;
  name: string;
  category_label?: string | null;
  account_name?: string | null;
  payment_account_label?: string | null;
};

export type SentenceResolveResult =
  | { ok: true; parsed: ParsedOneLiner; source: 'ai' | 'local' }
  | { ok: false; error: string };

export type SentenceLedgerPreviewState =
  | null
  | {
      kind: 'ok';
      source: 'ai' | 'local';
      transaction_type: 'expense' | 'income';
      amount: number;
      name: string;
      categoryLabel: string;
    }
  | { kind: 'error'; message: string };

/** 无智谱密钥时的极简规则解析（需含阿拉伯数字金额）。 */
export function parseFinanceSentenceLocal(raw: string): ({ ok: true } & ParsedOneLiner) | { ok: false } {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return { ok: false };
  const incomeHints = /(?:^|[\s,，])(收入|到账|进账|工资|奖金|补贴|退款|回款)/;
  const transaction_type: 'expense' | 'income' = incomeHints.test(s) ? 'income' : 'expense';
  const numRe = /(\d+(?:\.\d+)?)\s*(?:元|块|￥|¥)?/;
  const m = s.match(numRe);
  if (!m) return { ok: false };
  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false };
  const capped = Math.min(amount, 99999999.99);
  let name = s
    .replace(m[0], ' ')
    .replace(/[,，。、;；]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  name = name
    .replace(/^(支出|花了|消费|买了|买|付|支付)/, '')
    .replace(/^(收入|到账|进账|收到)/, '')
    .trim();
  if (!name) name = transaction_type === 'income' ? '收入' : '支出';
  if (name.length > 80) name = `${name.slice(0, 77)}…`;
  return { ok: true, transaction_type, amount: capped, name, category_label: null };
}

export function pickSheetCategoryForParsed(
  transactionType: 'expense' | 'income',
  categoryLabelHint: string | null | undefined,
  expenseCats: SheetCategory[],
  incomeCats: SheetCategory[],
): SheetCategory {
  const pool = transactionType === 'income' ? incomeCats : expenseCats;
  if (!pool.length) {
    return { key: 'other', icon: 'label', label: '其他', color: '#94a3b8' };
  }
  const h = categoryLabelHint?.trim();
  if (h) {
    const exact = pool.find((c) => c.label === h);
    if (exact) return exact;
    const fuzzy = pool.find((c) => h.includes(c.label) || c.label.includes(h));
    if (fuzzy) return fuzzy;
  }
  return pool[0];
}

export function buildExpenseCategories(primary: string, secondary: string, tertiary: string, subtle: string): SheetCategory[] {
  return [
    { key: 'food', icon: 'restaurant', label: '餐饮', color: primary },
    { key: 'snack', icon: 'icecream', label: '零食', color: secondary },
    { key: 'fruit', icon: 'eco', label: '水果', color: tertiary },
    { key: 'drink', icon: 'local-cafe', label: '饮品', color: primary },
    { key: 'cook', icon: 'set-meal', label: '做饭食材', color: secondary },
    { key: 'traffic', icon: 'directions-car', label: '交通', color: tertiary },
    { key: 'home', icon: 'home', label: '居住', color: primary },
    { key: 'cloth', icon: 'checkroom', label: '服饰', color: secondary },
    { key: 'play', icon: 'sports-esports', label: '娱乐', color: tertiary },
    { key: 'other', icon: 'more-horiz', label: '其他', color: subtle },
  ];
}

export function buildIncomeCategories(primary: string, secondary: string, tertiary: string, subtle: string): SheetCategory[] {
  return [
    { key: 'salary', icon: 'payments', label: '工资', color: secondary },
    { key: 'bonus', icon: 'card-giftcard', label: '奖金', color: primary },
    { key: 'refund', icon: 'receipt-long', label: '报销', color: tertiary },
    { key: 'invest', icon: 'savings', label: '理财', color: secondary },
    { key: 'sideline', icon: 'storefront', label: '副业', color: primary },
    { key: 'allowance', icon: 'volunteer-activism', label: '补贴', color: tertiary },
    { key: 'redpack', icon: 'redeem', label: '红包', color: secondary },
    { key: 'gift', icon: 'card-membership', label: '礼金', color: primary },
    { key: 'rent', icon: 'home-work', label: '租金', color: tertiary },
    { key: 'other-income', icon: 'add-card', label: '其他', color: subtle },
  ];
}

/** 将用户自定义分类插入到内置「其他」之前。 */
export function mergeSheetCategories(builtin: SheetCategory[], custom: SheetCategory[]): SheetCategory[] {
  if (!custom.length) return builtin;
  const builtinKeys = new Set(builtin.map((c) => c.key));
  const extra = custom.filter((c) => !builtinKeys.has(c.key));
  if (!extra.length) return builtin;
  const otherIdx = builtin.findIndex((c) => c.key === 'other' || c.key === 'other-income');
  if (otherIdx < 0) return [...builtin, ...extra];
  return [...builtin.slice(0, otherIdx), ...extra, ...builtin.slice(otherIdx)];
}
