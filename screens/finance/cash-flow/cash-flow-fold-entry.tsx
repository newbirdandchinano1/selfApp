/**
 * 记一笔现金流 · 对齐设计稿 14（象限 / 分类标签 / 实时影响 / 模型预览）
 */
import {
  FoldCountUpText,
  FoldPopIn,
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import { calculateCashFlowMetrics, type CashFlowMetrics } from '@/lib/cash-flow/cash-flow-metrics';
import {
  newCashFlowHoldingId,
  newCashFlowIncomeId,
  newExpenseFlowLineId,
} from '@/lib/repositories/cash-flow/cash-flow';
import type {
  CashFlowExpenseBucket,
  CashFlowState,
  IncomeItem,
  Quadrant,
} from '@/lib/repositories/cash-flow/cash-flow.types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

type ExpenseFlowType = CashFlowExpenseBucket;

function formatMoney(value: number) {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatSignedMoney(value: number) {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}¥${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function applyDraftToState(
  prev: CashFlowState,
  draft: {
    entryType: 'income' | 'expense';
    amount: number;
    name: string;
    quadrant: Quadrant;
    expenseType: ExpenseFlowType;
    assetReturn: number;
    liabilityMonths: number;
  },
): CashFlowState {
  const title = draft.name.trim();
  if (draft.entryType === 'income') {
    const newIncome: IncomeItem = {
      id: 'preview',
      name: title || '新增收入',
      amount: draft.amount,
      quadrant: draft.quadrant,
    };
    return { ...prev, incomes: [...prev.incomes, newIncome] };
  }
  if (draft.expenseType === 'necessary') {
    return {
      ...prev,
      necessaryExpenses: prev.necessaryExpenses + draft.amount,
      expenseLines: [
        ...prev.expenseLines,
        { id: 'preview', name: title || '必要支出', amount: draft.amount, bucket: 'necessary' },
      ],
    };
  }
  if (draft.expenseType === 'unnecessary') {
    return {
      ...prev,
      unnecessaryExpenses: prev.unnecessaryExpenses + draft.amount,
      expenseLines: [
        ...prev.expenseLines,
        { id: 'preview', name: title || '非必要消费', amount: draft.amount, bucket: 'unnecessary' },
      ],
    };
  }
  if (draft.expenseType === 'asset') {
    return {
      ...prev,
      holdings: [
        ...prev.holdings,
        {
          id: 'preview',
          name: title || '资产投入',
          principal: draft.amount,
          inflow: draft.assetReturn,
          outflow: 0,
        },
      ],
    };
  }
  const principalApprox = draft.amount * Math.max(1, draft.liabilityMonths);
  return {
    ...prev,
    holdings: [
      ...prev.holdings,
      {
        id: 'preview',
        name: title || '负债偿还',
        principal: principalApprox,
        inflow: 0,
        outflow: draft.amount,
        extra: { repayMonths: draft.liabilityMonths },
      },
    ],
  };
}

const QUAD_OPTIONS: { id: Quadrant; label: string; desc: string }[] = [
  { id: 'E', label: 'E · 雇员', desc: '工资 / 奖金 / 补贴' },
  { id: 'S', label: 'S · 自由职业', desc: '项目 / 咨询 / 稿费' },
  { id: 'B', label: 'B · 企业主', desc: '经营 / 分红' },
  { id: 'I', label: 'I · 投资者', desc: '利息 / 租金 / 股息' },
];

const CASH_TAGS: { id: 'active' | ExpenseFlowType; label: string; mode: 'income' | 'expense' }[] = [
  { id: 'active', label: '主动收入', mode: 'income' },
  { id: 'asset', label: '资产投入', mode: 'expense' },
  { id: 'liability', label: '负债偿还', mode: 'expense' },
  { id: 'necessary', label: '必要支出', mode: 'expense' },
  { id: 'unnecessary', label: '非必要支出', mode: 'expense' },
];

export function CashFlowFoldEntry({
  state,
  metrics,
  setState,
  showToast,
}: {
  state: CashFlowState;
  metrics: CashFlowMetrics;
  setState: React.Dispatch<React.SetStateAction<CashFlowState>>;
  showToast: (m: string, t?: 'success' | 'warning') => void;
}) {
  const { ff, isDark, fonts } = useFinanceFoldTheme();
  const { animate } = useFoldMotionGate();
  const mono = fonts.mono;
  const quadIdleBg = isDark ? ff.paper2 : '#F8F3E9';
  const quadOnBg = isDark ? ff.sage2 : '#E9F0E9';
  const tagIdleBg = isDark ? ff.paper2 : '#F8F3E9';
  const tagOnBg = isDark ? ff.sage2 : '#E7EFE9';
  const impactBg = isDark ? ff.sage2 : '#EAF1EB';
  const impactBorder = isDark ? ff.line : '#D6E4D8';
  const aiBg = isDark ? ff.amber2 : '#F4EAD9';
  const aiBorder = isDark ? ff.line : '#E8D4B6';

  const [entryType, setEntryType] = useState<'income' | 'expense'>('income');
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [quadrant, setQuadrant] = useState<Quadrant>('E');
  const [expenseType, setExpenseType] = useState<ExpenseFlowType>('necessary');
  const [submitting, setSubmitting] = useState(false);
  const [assetReturnAmount, setAssetReturnAmount] = useState('');
  const [liabilityRepayMonths, setLiabilityRepayMonths] = useState('');
  const [linkRealAccount, setLinkRealAccount] = useState(true);

  const amountNum = useMemo(() => {
    const n = parseFloat(amount.replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }, [amount]);

  const assetReturnNum = useMemo(() => {
    const n = parseFloat(assetReturnAmount.replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }, [assetReturnAmount]);

  const liabilityMonthsNum = useMemo(() => {
    const n = parseInt(liabilityRepayMonths.trim(), 10);
    return Number.isFinite(n) && n >= 1 ? n : 12;
  }, [liabilityRepayMonths]);

  const projected = useMemo(() => {
    if (amountNum <= 0) {
      return {
        metrics,
        deltaFcf: 0,
        deltaCover: 0,
        suggestAsset: 0,
        tip: '输入金额后，将实时预估对自由现金流与覆盖率的影响。',
      };
    }
    const nextState = applyDraftToState(state, {
      entryType,
      amount: amountNum,
      name,
      quadrant,
      expenseType,
      assetReturn: assetReturnNum,
      liabilityMonths: liabilityMonthsNum,
    });
    const next = calculateCashFlowMetrics(nextState);
    const deltaFcf = next.freeCashFlow - metrics.freeCashFlow;
    const deltaCover = next.freedomProgress - metrics.freedomProgress;
    const suggestAsset = entryType === 'income' ? Math.round(amountNum * 0.2) : 0;
    let tip = '';
    if (entryType === 'income') {
      const qLabel = QUAD_OPTIONS.find((q) => q.id === quadrant)?.label ?? quadrant;
      tip = `这是一笔${qLabel}收入。若每月把其中 20%（${formatMoney(suggestAsset)}）投入资产池，自由进度将从 ${metrics.freedomProgress.toFixed(0)}% 提升到约 ${Math.min(100, metrics.freedomProgress + Math.max(0.5, deltaCover || suggestAsset / Math.max(1, state.necessaryExpenses) * 100)).toFixed(0)}%。`;
    } else if (expenseType === 'asset') {
      tip = `资产投入会提高台账本金；填写月均回报后，被动覆盖与自由现金流会同步抬升。`;
    } else if (expenseType === 'liability') {
      tip = `负债月供计入流出。缩短剩余月数或降低月供，是改善自由现金流最快的路径之一。`;
    } else if (expenseType === 'necessary') {
      tip = `必要支出抬高财务自由门槛。记入后覆盖率按「被动收入 ÷ 必要支出」重算。`;
    } else {
      tip = `非必要支出直接吞噬自由现金流，却不改变财务自由进度分母——优先审视这类项目。`;
    }
    return { metrics: next, deltaFcf, deltaCover, suggestAsset, tip };
  }, [
    amountNum,
    assetReturnNum,
    entryType,
    expenseType,
    liabilityMonthsNum,
    metrics,
    name,
    quadrant,
    state,
  ]);

  const activeCashTag = entryType === 'income' ? 'active' : expenseType;

  const onSelectCashTag = (tag: (typeof CASH_TAGS)[number]) => {
    if (tag.mode === 'income') {
      setEntryType('income');
      return;
    }
    setEntryType('expense');
    setExpenseType(tag.id as ExpenseFlowType);
  };

  const submit = async () => {
    const n = parseFloat(amount.replace(/,/g, ''));
    if (!amount.trim() || !Number.isFinite(n) || n <= 0) {
      showToast('请输入有效金额', 'warning');
      return;
    }
    if (entryType === 'expense' && expenseType === 'asset') {
      const ret = parseFloat(assetReturnAmount.replace(/,/g, ''));
      if (!assetReturnAmount.trim() || !Number.isFinite(ret) || ret < 0) {
        showToast('请输入回报金额（可为 0）', 'warning');
        return;
      }
    }
    if (entryType === 'expense' && expenseType === 'liability') {
      const monthsRaw = liabilityRepayMonths.trim();
      const months = parseInt(monthsRaw, 10);
      if (!monthsRaw || !Number.isFinite(months) || months < 1) {
        showToast('请输入剩余还款月份（正整数）', 'warning');
        return;
      }
    }
    if (submitting) return;
    setSubmitting(true);
    const title = name.trim();
    try {
      if (entryType === 'income') {
        const newIncome: IncomeItem = {
          id: newCashFlowIncomeId(),
          name: title || '新增收入',
          amount: n,
          quadrant,
        };
        setState((prev) => ({ ...prev, incomes: [...prev.incomes, newIncome] }));
        showToast('已记入现金流模型', 'success');
      } else if (expenseType === 'necessary') {
        const lid = newExpenseFlowLineId();
        setState((prev) => ({
          ...prev,
          necessaryExpenses: prev.necessaryExpenses + n,
          expenseLines: [
            ...prev.expenseLines,
            { id: lid, name: title || '必要支出', amount: n, bucket: 'necessary' as const },
          ],
        }));
        showToast('已记入现金流模型', 'success');
      } else if (expenseType === 'unnecessary') {
        const lid = newExpenseFlowLineId();
        setState((prev) => ({
          ...prev,
          unnecessaryExpenses: prev.unnecessaryExpenses + n,
          expenseLines: [
            ...prev.expenseLines,
            { id: lid, name: title || '非必要消费', amount: n, bucket: 'unnecessary' as const },
          ],
        }));
        showToast('已记入现金流模型', 'success');
      } else if (expenseType === 'asset') {
        const ret = parseFloat(assetReturnAmount.replace(/,/g, ''));
        const id = newCashFlowHoldingId();
        setState((prev) => ({
          ...prev,
          holdings: [
            ...prev.holdings,
            {
              id,
              name: title || '资产投入',
              principal: n,
              inflow: ret,
              outflow: 0,
            },
          ],
        }));
        showToast('已记入资产负债台账（资产）', 'success');
      } else {
        const months = parseInt(liabilityRepayMonths.trim(), 10);
        const id = newCashFlowHoldingId();
        const principalApprox = n * months;
        setState((prev) => ({
          ...prev,
          holdings: [
            ...prev.holdings,
            {
              id,
              name: title || '负债偿还',
              principal: principalApprox,
              inflow: 0,
              outflow: n,
              extra: { repayMonths: months },
            },
          ],
        }));
        showToast('已记入资产负债台账（负债）', 'success');
      }
    } finally {
      setSubmitting(false);
      setAmount('');
      setName('');
      setAssetReturnAmount('');
      setLiabilityRepayMonths('');
    }
  };

  const healthScore = useMemo(() => {
    const rate =
      projected.metrics.totalIncome > 0
        ? Math.max(0, Math.min(1, projected.metrics.freeCashFlow / projected.metrics.totalIncome))
        : 0.4;
    return Math.round(42 + rate * 52);
  }, [projected.metrics.freeCashFlow, projected.metrics.totalIncome]);

  return (
    <View style={styles.root}>
      <FoldRiseIn animate={animate} index={0} fromY={11}>
        <View style={[styles.segment, { backgroundColor: ff.paper2 }]}>
          <Pressable
            onPress={() => setEntryType('income')}
            style={[
              styles.segmentBtn,
              entryType === 'income' && { backgroundColor: ff.card, borderColor: ff.line2, borderWidth: 1 },
            ]}>
            <Text style={[styles.segmentText, { color: entryType === 'income' ? ff.pine : ff.muted }]}>收入</Text>
          </Pressable>
          <Pressable
            onPress={() => setEntryType('expense')}
            style={[
              styles.segmentBtn,
              entryType === 'expense' && { backgroundColor: ff.card, borderColor: ff.line2, borderWidth: 1 },
            ]}>
            <Text style={[styles.segmentText, { color: entryType === 'expense' ? ff.pine : ff.muted }]}>
              去向 / 支出
            </Text>
          </Pressable>
        </View>
      </FoldRiseIn>

      {entryType === 'income' ? (
        <FoldRiseIn animate={animate} index={1} fromY={11}>
          <View style={styles.quadrant}>
            {QUAD_OPTIONS.map((q) => {
              const on = quadrant === q.id;
              return (
                <Pressable
                  key={q.id}
                  onPress={() => setQuadrant(q.id)}
                  style={[
                    styles.quad,
                    {
                      borderColor: on ? ff.sage : ff.line,
                      backgroundColor: on ? quadOnBg : quadIdleBg,
                    },
                  ]}>
                  {on ? <Text style={[styles.quadCheck, { color: ff.income }]}>✓</Text> : null}
                  <Text style={[styles.quadLabel, { fontFamily: mono, color: ff.ink2 }]}>{q.label}</Text>
                  <Text style={[styles.quadDesc, { color: ff.muted }]}>{q.desc}</Text>
                </Pressable>
              );
            })}
          </View>
        </FoldRiseIn>
      ) : (
        <FoldRiseIn animate={animate} index={1} fromY={11}>
          <View style={styles.expenseHintBox}>
            <Text style={[styles.expenseHintTitle, { color: ff.muted }]}>资金去向</Text>
            <Text style={[styles.expenseHintBody, { color: ff.ink2 }]}>
              用下方标签选择：资产投入 / 负债偿还 / 必要与非必要支出
            </Text>
          </View>
        </FoldRiseIn>
      )}

      <FoldPopIn animate={animate} delayMs={80} duration={380}>
        <View style={styles.amountBlock}>
          <View style={styles.amountRow}>
            <Text style={[styles.amountCur, { fontFamily: mono, color: ff.amberInk }]}>¥</Text>
            <TextInput
              value={amount}
              onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={ff.faint}
              style={[styles.amountNum, { fontFamily: mono, color: ff.pine }]}
            />
          </View>
        </View>
      </FoldPopIn>

      <FoldRiseIn animate={animate} index={2} fromY={8}>
        <View style={styles.cashTags}>
          {CASH_TAGS.map((tag) => {
            const on = activeCashTag === tag.id;
            return (
              <Pressable
                key={tag.id}
                onPress={() => onSelectCashTag(tag)}
                style={[
                  styles.cashTag,
                  {
                    borderColor: on ? ff.sage : ff.line,
                    backgroundColor: on ? tagOnBg : tagIdleBg,
                  },
                ]}>
                <Text style={{ fontSize: 11, color: on ? ff.pine : ff.muted, fontWeight: on ? '700' : '500' }}>
                  {tag.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </FoldRiseIn>

      {entryType === 'expense' && expenseType === 'asset' ? (
        <View style={[styles.card, { backgroundColor: ff.card, borderColor: ff.line }]}>
          <View style={styles.formRow}>
            <Text style={[styles.fl, { color: ff.ink2 }]}>月均回报</Text>
            <TextInput
              value={assetReturnAmount}
              onChangeText={setAssetReturnAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={ff.faint}
              style={[styles.frInput, { color: ff.ink, fontFamily: mono }]}
            />
          </View>
        </View>
      ) : null}
      {entryType === 'expense' && expenseType === 'liability' ? (
        <View style={[styles.card, { backgroundColor: ff.card, borderColor: ff.line }]}>
          <View style={styles.formRow}>
            <Text style={[styles.fl, { color: ff.ink2 }]}>剩余还款月份</Text>
            <TextInput
              value={liabilityRepayMonths}
              onChangeText={setLiabilityRepayMonths}
              keyboardType="number-pad"
              placeholder="如 24"
              placeholderTextColor={ff.faint}
              style={[styles.frInput, { color: ff.ink, fontFamily: mono }]}
            />
          </View>
        </View>
      ) : null}

      <FoldRiseIn animate={animate} index={3} fromY={11}>
        <View style={[styles.card, { backgroundColor: ff.card, borderColor: ff.line }]}>
          <View style={[styles.formRow, { borderBottomColor: ff.line }]}>
            <Text style={[styles.fl, { color: ff.ink2 }]}>备注</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={entryType === 'income' ? '10 月工资 · 税后' : '如：房租 / 基金定投'}
              placeholderTextColor={ff.faint}
              style={[styles.frInput, { color: ff.ink }]}
            />
          </View>
          <View style={[styles.formRow, styles.formRowLast]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.fl, { color: ff.ink2 }]}>关联真实账户</Text>
              <Text style={{ fontSize: 11, color: ff.muted, marginTop: 2 }}>
                仅作模型标记，不自动写入日常流水
              </Text>
            </View>
            <Switch
              value={linkRealAccount}
              onValueChange={setLinkRealAccount}
              trackColor={{ false: ff.line2, true: ff.sage }}
              thumbColor={linkRealAccount ? ff.pine : ff.card}
            />
          </View>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={4} fromY={11}>
        <View style={[styles.impact, { backgroundColor: impactBg, borderColor: impactBorder }]}>
          <View style={[styles.impactIcon, { backgroundColor: isDark ? 'rgba(134,167,149,0.28)' : '#DCE9DF' }]}>
            <MaterialIcons name="waterfall-chart" size={16} color={ff.income} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.impactTitle, { color: ff.ink2 }]}>记入后：自由现金流</Text>
            <Text style={[styles.impactSub, { color: ff.muted }]}>
              本月被动收入覆盖率预计{' '}
              {projected.deltaCover >= 0 ? '+' : ''}
              {projected.deltaCover.toFixed(1)}%
            </Text>
          </View>
          <FoldCountUpText
            value={amountNum > 0 ? projected.metrics.freeCashFlow : metrics.freeCashFlow}
            animate={animate}
            duration={600}
            textStyle={[styles.impactVal, { fontFamily: mono, color: ff.income }]}
            formatter={(n) => formatSignedMoney(n)}
          />
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={5} fromY={11}>
        <View style={[styles.card, { backgroundColor: ff.card, borderColor: ff.line, padding: 12 }]}>
          <View style={styles.previewHead}>
            <Text style={[styles.previewTitle, { color: ff.ink }]}>模型预览</Text>
            <View style={[styles.liveTag, { backgroundColor: isDark ? ff.sage2 : 'rgba(134,167,149,0.18)' }]}>
              <Text style={[styles.liveTagText, { color: ff.income }]}>实时</Text>
            </View>
          </View>
          <View style={styles.statsGrid}>
            <View style={[styles.statCell, { backgroundColor: ff.paper2 }]}>
              <Text style={[styles.statLab, { color: ff.muted }]}>建议资产投入</Text>
              <Text style={[styles.statVal, { color: ff.pine, fontFamily: mono }]}>
                {formatMoney(projected.suggestAsset || Math.round(Math.max(0, metrics.freeCashFlow) * 0.2))}
              </Text>
            </View>
            <View style={[styles.statCell, { backgroundColor: ff.paper2 }]}>
              <Text style={[styles.statLab, { color: ff.muted }]}>覆盖率</Text>
              <Text style={[styles.statVal, { color: ff.pine, fontFamily: mono }]}>
                {projected.metrics.freedomProgress.toFixed(1)}%
              </Text>
            </View>
            <View style={[styles.statCell, { backgroundColor: ff.paper2 }]}>
              <Text style={[styles.statLab, { color: ff.muted }]}>健康分</Text>
              <Text style={[styles.statVal, { color: ff.pine, fontFamily: mono }]}>{healthScore}</Text>
            </View>
          </View>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={6} fromY={11}>
        <View style={[styles.aiInsight, { backgroundColor: aiBg, borderColor: aiBorder }]}>
          <MaterialIcons name="auto-awesome" size={15} color={ff.amberInk} style={{ marginTop: 2 }} />
          <Text style={[styles.aiBody, { color: ff.ink2 }]}>
            <Text style={[styles.aiBold, { color: ff.ink }]}>模型提示：</Text>
            {projected.tip}
          </Text>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={7} fromY={11}>
        <Pressable
          onPress={() => void submit()}
          disabled={submitting}
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: ff.pine, opacity: submitting ? 0.55 : pressed ? 0.9 : 1 },
          ]}>
          <Text style={styles.primaryBtnText}>{submitting ? '保存中…' : '确认记入现金流'}</Text>
        </Pressable>
      </FoldRiseIn>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingBottom: 12 },
  segment: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 3,
    marginBottom: 4,
  },
  segmentBtn: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: { fontSize: 13, fontWeight: '700' },
  quadrant: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginVertical: 8,
  },
  quad: {
    width: '48%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    position: 'relative',
  },
  quadCheck: {
    position: 'absolute',
    right: 8,
    top: 6,
    fontSize: 10,
    color: '#4C765E',
    fontWeight: '700',
  },
  quadLabel: { fontSize: 13, fontWeight: '700' },
  quadDesc: { fontSize: 11, marginTop: 3, lineHeight: 15 },
  expenseHintBox: { paddingVertical: 10, paddingHorizontal: 4 },
  expenseHintTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 4 },
  expenseHintBody: { fontSize: 13, lineHeight: 19 },
  amountBlock: { alignItems: 'center', paddingVertical: 14 },
  amountRow: { flexDirection: 'row', alignItems: 'flex-end' },
  amountCur: { fontSize: 16, marginRight: 4, marginBottom: 8 },
  amountNum: {
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: -0.5,
    minWidth: 120,
    textAlign: 'center',
    paddingVertical: 0,
  },
  cashTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    justifyContent: 'center',
    marginBottom: 10,
  },
  cashTag: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ECE4D6',
    gap: 10,
  },
  formRowLast: { borderBottomWidth: 0 },
  fl: { fontSize: 13, fontWeight: '600' },
  frInput: {
    flex: 1,
    textAlign: 'right',
    fontSize: 13,
    paddingVertical: 0,
  },
  impact: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#EAF1EB',
    borderWidth: 1,
    borderColor: '#D6E4D8',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  impactIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: '#DCE9DF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  impactTitle: { fontSize: 12, fontWeight: '700', color: '#3D5A49' },
  impactSub: { fontSize: 11, color: '#819286', marginTop: 2 },
  impactVal: { fontSize: 14, fontWeight: '700', color: '#2D6147' },
  previewHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  previewTitle: { fontSize: 13, fontWeight: '700' },
  liveTag: {
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 6,
    backgroundColor: 'rgba(134,167,149,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveTagText: { fontSize: 10, color: '#3E7057', fontWeight: '700' },
  statsGrid: { flexDirection: 'row', gap: 6 },
  statCell: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  statLab: { fontSize: 10 },
  statVal: { fontSize: 14, fontWeight: '700', marginTop: 4 },
  aiInsight: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F4EAD9',
    borderWidth: 1,
    borderColor: '#E8D4B6',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  aiBold: { fontWeight: '700', color: '#4F4638' },
  aiBody: { flex: 1, fontSize: 12, lineHeight: 19, color: '#6E6455' },
  primaryBtn: {
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#F8F3E9', fontSize: 15, fontWeight: '800' },
});
