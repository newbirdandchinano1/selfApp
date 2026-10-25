/**
 * 现金流明细 · 对齐设计稿 23
 * 汇总 · 构成比例生长 · 可删条目 · 洞察 · 模拟 CTA
 * 删除只影响现金流模型，不动日常流水。
 */
import {
  FOLD_MOTION_EASE,
  FoldCountUpText,
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import type { CashFlowMetrics } from '@/lib/cash-flow/cash-flow-metrics';
import type { CashFlowState } from '@/lib/repositories/cash-flow/cash-flow.types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { Alert } from '@/lib/app-feedback';
function formatMoney(value: number) {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatMoney2(value: number) {
  return `¥${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedMoney(value: number, asExpense = false) {
  const abs = formatMoney2(value);
  if (asExpense || value < 0) return `-${abs}`;
  if (value > 0) return `+${abs}`;
  return abs;
}

export type CashFlowDetailTab =
  | 'detail_active'
  | 'detail_passive'
  | 'detail_asset'
  | 'detail_liability'
  | 'detail_expense';

type DetailDeleteAction =
  | { type: 'income'; id: string }
  | { type: 'holding'; id: string }
  | { type: 'expense_line'; id: string };

type CompositionBar = {
  name: string;
  amount: number;
  color: string;
};

type DetailItem = {
  id: string;
  name: string;
  sub: string;
  amount: number;
  signedExpense: boolean;
  icon: keyof typeof MaterialIcons.glyphMap;
  iconBg: string;
  iconFg: string;
  deleteAction?: DetailDeleteAction;
};

type DetailConfig = {
  eyebrow: string;
  title: string;
  sub: string;
  tag: string;
  tagTone: 'clay' | 'sage' | 'amber' | 'pine';
  total: number;
  metaLeft: string;
  metaRight: string;
  stats: { label: string; value: string }[];
  bars: CompositionBar[];
  items: DetailItem[];
  insight: string;
  signedExpense: boolean;
};

const BAR_COLORS = ['#9A7553', '#C8785C', '#779887', '#8A7C95', '#B6B0A1', '#5A8771', '#D89A4D'];

function buildConfig(
  tab: CashFlowDetailTab,
  state: CashFlowState,
  metrics: CashFlowMetrics,
): DetailConfig {
  if (tab === 'detail_active') {
    const rows = state.incomes.filter((i) => i.quadrant === 'E' || i.quadrant === 'S');
    const total = metrics.activeIncome;
    const bars = groupBars(
      rows.map((r) => ({ name: r.name, amount: r.amount })),
      total,
    );
    return {
      eyebrow: '本月主动收入',
      title: '主动收入明细',
      sub: 'CASHFLOW · ACTIVE',
      tag: metrics.totalIncome > 0 ? `占收入 ${Math.round((total / metrics.totalIncome) * 100)}%` : '暂无收入',
      tagTone: 'sage',
      total,
      metaLeft: `${rows.length} 项`,
      metaRight: 'E / S 象限',
      stats: [
        { label: '雇员 (E)', value: formatMoney(rows.filter((r) => r.quadrant === 'E').reduce((s, r) => s + r.amount, 0)) },
        { label: '自雇 (S)', value: formatMoney(rows.filter((r) => r.quadrant === 'S').reduce((s, r) => s + r.amount, 0)) },
        { label: '笔数', value: String(rows.length) },
      ],
      bars,
      items: rows.map((r, i) => ({
        id: r.id,
        name: r.name,
        sub: `象限 ${r.quadrant}`,
        amount: r.amount,
        signedExpense: false,
        icon: (r.quadrant === 'E' ? 'work-outline' : 'storefront') as keyof typeof MaterialIcons.glyphMap,
        iconBg: i % 2 === 0 ? '#E8EFE8' : '#F4E9D7',
        iconFg: i % 2 === 0 ? '#4B6B59' : '#98692D',
        deleteAction: { type: 'income' as const, id: r.id },
      })),
      insight:
        total > 0
          ? `主动收入 ${formatMoney(total)}。工薪与自雇都依赖你持续投入时间；提高被动收入占比，才能降低「停工即停收」的风险。`
          : '还没有主动收入记录。在「记一笔」里按 E/S 象限录入工资或接单收入。',
      signedExpense: false,
    };
  }

  if (tab === 'detail_passive') {
    const pure = state.incomes.filter((i) => i.quadrant === 'B' || i.quadrant === 'I');
    const assetFlows = metrics.categorizedHoldings.filter((h) => h.isAsset && h.netCashflow > 0);
    const total = metrics.totalPassiveIncome;
    const bars = groupBars(
      [
        ...pure.map((r) => ({ name: r.name, amount: r.amount })),
        ...assetFlows.map((h) => ({ name: h.name, amount: h.netCashflow })),
      ],
      total,
    );
    return {
      eyebrow: '本月被动收入',
      title: '被动收入明细',
      sub: 'CASHFLOW · PASSIVE',
      tag: `覆盖率 ${Math.round(metrics.freedomProgress)}%`,
      tagTone: 'amber',
      total,
      metaLeft: `${pure.length + assetFlows.length} 项`,
      metaRight: 'B / I · 资产净流入',
      stats: [
        { label: 'B/I 收入', value: formatMoney(pure.reduce((s, r) => s + r.amount, 0)) },
        { label: '资产流入', value: formatMoney(assetFlows.reduce((s, h) => s + h.netCashflow, 0)) },
        { label: '覆盖月数', value: metrics.necessaryExpenses > 0 ? (total / metrics.necessaryExpenses).toFixed(1) : '—' },
      ],
      bars,
      items: [
        ...pure.map((r) => ({
          id: r.id,
          name: r.name,
          sub: `象限 ${r.quadrant}`,
          amount: r.amount,
          signedExpense: false,
          icon: 'emoji-events' as keyof typeof MaterialIcons.glyphMap,
          iconBg: '#E8EFE8',
          iconFg: '#3E7057',
          deleteAction: { type: 'income' as const, id: r.id },
        })),
        ...assetFlows.map((h) => ({
          id: h.id,
          name: h.name,
          sub: '资产净流入',
          amount: h.netCashflow,
          signedExpense: false,
          icon: 'eco' as keyof typeof MaterialIcons.glyphMap,
          iconBg: '#E7EEF0',
          iconFg: '#567982',
          deleteAction: { type: 'holding' as const, id: h.id },
        })),
      ],
      insight:
        total > 0
          ? `被动收入 ${formatMoney(total)}，对必要支出的覆盖约 ${Math.round(metrics.freedomProgress)}%。持续把自由现金流投入生钱资产，覆盖率会随时间抬升。`
          : '还没有被动收入。买入能把钱放进口袋的资产，或录入股息 / 租金 / 版权等 B/I 收入。',
      signedExpense: false,
    };
  }

  if (tab === 'detail_asset') {
    const rows = metrics.categorizedHoldings.filter((h) => h.isAsset);
    const total = metrics.assetInflow;
    const bars = groupBars(
      rows.map((h) => ({ name: h.name, amount: Math.max(0, h.netCashflow) })),
      Math.max(total, 1),
    );
    return {
      eyebrow: '本月资产流入',
      title: '资产明细',
      sub: 'CASHFLOW · ASSETS',
      tag: `${rows.length} 项生钱资产`,
      tagTone: 'sage',
      total,
      metaLeft: `本金合计 ${formatMoney(rows.reduce((s, h) => s + h.principal, 0))}`,
      metaRight: '净现金流',
      stats: [
        { label: '月流入', value: formatMoney(total) },
        { label: '项数', value: String(rows.length) },
        {
          label: '平均回报',
          value:
            rows.length > 0 && rows.reduce((s, h) => s + h.principal, 0) > 0
              ? `${((total / rows.reduce((s, h) => s + h.principal, 0)) * 100).toFixed(1)}%`
              : '—',
        },
      ],
      bars,
      items: rows.map((h, i) => ({
        id: h.id,
        name: h.name,
        sub: `本金 ${formatMoney(h.principal)} · 净流入`,
        amount: h.netCashflow,
        signedExpense: false,
        icon: 'trending-up' as keyof typeof MaterialIcons.glyphMap,
        iconBg: i % 2 === 0 ? '#E8EFE8' : '#F4E9D7',
        iconFg: i % 2 === 0 ? '#3E7057' : '#98692D',
        deleteAction: { type: 'holding' as const, id: h.id },
      })),
      insight:
        rows.length > 0
          ? `资产池月净流入 ${formatMoney(total)}。真正的资产不需要你持续干预，也能把钱放进口袋。`
          : '台账里还没有生钱资产。可在资产负债台账或记一笔里登记投资 / 出租等流入项。',
      signedExpense: false,
    };
  }

  if (tab === 'detail_liability') {
    const rows = metrics.categorizedHoldings.filter((h) => !h.isAsset);
    const total = metrics.liabilityOutflow;
    const bars = groupBars(
      rows.map((h) => ({ name: h.name, amount: Math.abs(h.netCashflow) || h.outflow })),
      Math.max(total, 1),
    );
    return {
      eyebrow: '本月负债流出',
      title: '负债明细',
      sub: 'CASHFLOW · LIABILITY',
      tag: total > 0 ? `月供 ${formatMoney(total)}` : '无负债',
      tagTone: 'clay',
      total,
      metaLeft: `${rows.length} 项`,
      metaRight: '从口袋掏钱的都是负债',
      stats: [
        { label: '月流出', value: formatMoney(total) },
        { label: '余额', value: formatMoney(rows.reduce((s, h) => s + h.principal, 0)) },
        { label: '项数', value: String(rows.length) },
      ],
      bars,
      items: rows.map((h) => {
        const rm = h.extra?.repayMonths;
        return {
          id: h.id,
          name: h.name,
          sub:
            rm != null
              ? `余额 ${formatMoney(h.principal)} · 剩余 ${rm} 个月`
              : `余额 ${formatMoney(h.principal)}`,
          amount: -(Math.abs(h.netCashflow) || h.outflow),
          signedExpense: true,
          icon: 'credit-card' as keyof typeof MaterialIcons.glyphMap,
          iconBg: '#F4DED6',
          iconFg: '#A45A41',
          deleteAction: { type: 'holding' as const, id: h.id },
        };
      }),
      insight:
        total > 0
          ? `负债每月抽走 ${formatMoney(total)}。任何持续从口袋掏钱的东西都是负债——优先削减高息项。`
          : '当前模型没有负债流出。房贷、车贷、消费贷可在台账中登记。',
      signedExpense: true,
    };
  }

  // detail_expense — 设计稿示例：必要支出明细为主，合并流出
  const nec = state.expenseLines.filter((l) => l.bucket === 'necessary');
  const unn = state.expenseLines.filter((l) => l.bucket === 'unnecessary');
  const liab = metrics.categorizedHoldings.filter((h) => !h.isAsset);
  const necTotal = state.necessaryExpenses;
  const unnTotal = state.unnecessaryExpenses;
  const total = metrics.totalExpenses;
  const necShare = total > 0 ? Math.round((necTotal / total) * 100) : 0;
  const bars = groupBars(
    [
      ...nec.map((l) => ({ name: l.name, amount: l.amount })),
      ...unn.map((l) => ({ name: l.name, amount: l.amount })),
      ...liab.map((h) => ({ name: h.name, amount: h.outflow })),
    ],
    Math.max(total, 1),
  );
  const coverMonths =
    necTotal > 0 && metrics.totalPassiveIncome > 0
      ? (metrics.totalPassiveIncome / necTotal).toFixed(1)
      : '—';

  return {
    eyebrow: '本月必要与流出',
    title: '流出明细',
    sub: 'CASHFLOW · EXPENSE',
    tag: total > 0 ? `必要占流出 ${necShare}%` : '暂无流出',
    tagTone: 'clay',
    total,
    metaLeft: `${nec.length + unn.length + liab.length} 项`,
    metaRight: `必要 ${formatMoney(necTotal)}`,
    stats: [
      { label: '必要', value: formatMoney(necTotal) },
      { label: '非必要', value: formatMoney(unnTotal) },
      { label: '覆盖月数', value: String(coverMonths) },
    ],
    bars,
    items: [
      ...nec.map((l) => ({
        id: l.id,
        name: l.name,
        sub: '必要支出',
        amount: -l.amount,
        signedExpense: true,
        icon: 'home' as keyof typeof MaterialIcons.glyphMap,
        iconBg: '#F4E9D7',
        iconFg: '#98692D',
        deleteAction: { type: 'expense_line' as const, id: l.id },
      })),
      ...unn.map((l) => ({
        id: l.id,
        name: l.name,
        sub: '非必要消费',
        amount: -l.amount,
        signedExpense: true,
        icon: 'shopping-bag' as keyof typeof MaterialIcons.glyphMap,
        iconBg: '#F4DED6',
        iconFg: '#A45A41',
        deleteAction: { type: 'expense_line' as const, id: l.id },
      })),
      ...liab.map((h) => ({
        id: h.id,
        name: h.name,
        sub: '负债月供',
        amount: -h.outflow,
        signedExpense: true,
        icon: 'credit-card' as keyof typeof MaterialIcons.glyphMap,
        iconBg: '#EDE8F1',
        iconFg: '#79647E',
        deleteAction: { type: 'holding' as const, id: h.id },
      })),
    ],
    insight:
      necTotal > 0 && bars[0]
        ? `必要支出中「${bars[0].name}」占比最高（${Math.round((bars[0].amount / Math.max(necTotal, 1)) * 100)}%），是自由现金流的主要约束。削减固定项或提高被动收入，都能加快财务自由进度。`
        : '流出明细为空。在「记一笔 → 录入去向」中添加必要 / 非必要支出，或登记负债月供。',
    signedExpense: true,
  };
}

function groupBars(
  rows: { name: string; amount: number }[],
  _total: number,
): CompositionBar[] {
  const sorted = [...rows].filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
  if (sorted.length === 0) return [];
  const top = sorted.slice(0, 4);
  const rest = sorted.slice(4);
  const restSum = rest.reduce((s, r) => s + r.amount, 0);
  const out: CompositionBar[] = top.map((r, i) => ({
    name: r.name,
    amount: r.amount,
    color: BAR_COLORS[i % BAR_COLORS.length]!,
  }));
  if (restSum > 0) {
    out.push({ name: '其他', amount: restSum, color: BAR_COLORS[4]! });
  }
  return out;
}

function CatBar({
  name,
  amount,
  total,
  color,
  index,
  animate,
  mono,
  muted,
  ink,
}: {
  name: string;
  amount: number;
  total: number;
  color: string;
  index: number;
  animate: boolean;
  mono: string;
  muted: string;
  ink: string;
}) {
  const pct = total > 0 ? amount / total : 0;
  const width = useRef(new Animated.Value(animate ? 0 : pct)).current;

  useEffect(() => {
    if (!animate) {
      width.setValue(pct);
      return;
    }
    width.setValue(0);
    const anim = Animated.timing(width, {
      toValue: pct,
      duration: 700,
      delay: 160 + index * 55,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, index, pct, width]);

  return (
    <View style={styles.catBar}>
      <Text style={[styles.catName, { color: ink }]} numberOfLines={1}>
        {name}
      </Text>
      <View style={styles.catTrack}>
        <Animated.View
          style={[
            styles.catFill,
            {
              backgroundColor: color,
              width: width.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>
      <Text style={[styles.catNum, { color: muted, fontFamily: mono }]}>{formatMoney(amount)}</Text>
      <Text style={[styles.catPct, { color: muted, fontFamily: mono }]}>{Math.round(pct * 100)}%</Text>
    </View>
  );
}

function applyDelete(
  action: DetailDeleteAction,
  setState: React.Dispatch<React.SetStateAction<CashFlowState>>,
  showToast: (m: string, t?: 'success' | 'warning') => void,
) {
  switch (action.type) {
    case 'income':
      setState((prev) => ({ ...prev, incomes: prev.incomes.filter((i) => i.id !== action.id) }));
      showToast('已从现金流模型移除');
      return;
    case 'holding':
      setState((prev) => ({ ...prev, holdings: prev.holdings.filter((h) => h.id !== action.id) }));
      showToast('已从现金流模型移除');
      return;
    case 'expense_line':
      setState((prev) => {
        const line = prev.expenseLines.find((l) => l.id === action.id);
        if (!line) return prev;
        const expenseLines = prev.expenseLines.filter((l) => l.id !== action.id);
        if (line.bucket === 'necessary') {
          return {
            ...prev,
            expenseLines,
            necessaryExpenses: Math.max(0, prev.necessaryExpenses - line.amount),
          };
        }
        return {
          ...prev,
          expenseLines,
          unnecessaryExpenses: Math.max(0, prev.unnecessaryExpenses - line.amount),
        };
      });
      showToast('已从现金流模型移除');
  }
}

const TAG_STYLE: Record<DetailConfig['tagTone'], { bg: string; fg: string }> = {
  clay: { bg: '#F4DED6', fg: '#93452E' },
  sage: { bg: '#DDE9E1', fg: '#3E7057' },
  amber: { bg: '#F4E4C8', fg: '#A96B22' },
  pine: { bg: '#E8EFE8', fg: '#1E4034' },
};

export function CashFlowFoldDetail({
  detailType,
  state,
  metrics,
  setState,
  showToast,
  onSimulate,
}: {
  detailType: CashFlowDetailTab;
  state: CashFlowState;
  metrics: CashFlowMetrics;
  setState: React.Dispatch<React.SetStateAction<CashFlowState>>;
  showToast: (m: string, t?: 'success' | 'warning') => void;
  onSimulate: () => void;
}) {
  const { ff, isDark, fonts } = useFinanceFoldTheme();
  const { animate } = useFoldMotionGate();
  const config = useMemo(() => buildConfig(detailType, state, metrics), [detailType, state, metrics]);
  const tagColors = TAG_STYLE[config.tagTone];
  const barTotal = Math.max(
    config.total,
    config.bars.reduce((s, b) => s + b.amount, 0),
    1,
  );

  let rise = 0;
  const nextRise = () => {
    const i = rise;
    rise += 1;
    return i;
  };

  const confirmDelete = (item: DetailItem) => {
    if (!item.deleteAction) return;
    Alert.alert('从现金流模型移除？', `「${item.name}」只会从模型中删除，不影响日常流水与真实账户。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: () => applyDelete(item.deleteAction!, setState, showToast),
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <FoldRiseIn animate={animate} index={nextRise()} fromY={11}>
        <View
          style={[
            styles.hero,
            {
              backgroundColor: isDark ? ff.paper2 : ff.card,
              borderColor: ff.line,
            },
          ]}>
          <View style={styles.heroTop}>
            <Text style={[styles.eyebrow, { color: ff.faint }]}>{config.eyebrow}</Text>
            <View style={[styles.tag, { backgroundColor: isDark ? ff.clay2 : tagColors.bg }]}>
              <Text style={[styles.tagText, { color: isDark ? ff.clayInk : tagColors.fg }]}>{config.tag}</Text>
            </View>
          </View>
          <FoldCountUpText
            value={Math.abs(config.total)}
            animate={animate}
            duration={760}
            textStyle={[styles.big, { color: ff.ink, fontFamily: fonts.mono }]}
            formatter={(n) =>
              config.signedExpense ? formatMoney2(n) : formatMoney(n)
            }
          />
          <View style={styles.meta}>
            <Text style={[styles.metaText, { color: ff.muted }]}>{config.metaLeft}</Text>
            <Text style={[styles.metaText, { color: ff.muted }]}>{config.metaRight}</Text>
          </View>
          <View style={styles.statsGrid}>
            {config.stats.map((s) => (
              <View
                key={s.label}
                style={[
                  styles.statCell,
                  {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F5F0E5',
                    borderColor: ff.line,
                  },
                ]}>
                <Text style={[styles.statLabel, { color: ff.faint }]}>{s.label}</Text>
                <Text style={[styles.statValue, { color: ff.ink2, fontFamily: fonts.mono }]}>{s.value}</Text>
              </View>
            ))}
          </View>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={11}>
        <View
          style={[
            styles.catCard,
            {
              backgroundColor: isDark ? ff.paper2 : ff.card,
              borderColor: ff.line,
            },
          ]}>
          <View style={styles.catHead}>
            <Text style={[styles.catTitle, { color: ff.ink }]}>构成</Text>
            <Text style={[styles.catHint, { color: ff.faint }]}>按本月实际</Text>
          </View>
          {config.bars.length === 0 ? (
            <Text style={[styles.emptyHint, { color: ff.muted }]}>暂无构成数据</Text>
          ) : (
            config.bars.map((b, i) => (
              <CatBar
                key={`${b.name}-${i}`}
                name={b.name}
                amount={b.amount}
                total={barTotal}
                color={b.color}
                index={i}
                animate={animate}
                mono={fonts.mono}
                muted={ff.muted}
                ink={ff.ink2}
              />
            ))
          )}
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={8}>
        <View style={styles.sectionH}>
          <Text style={[styles.sectionT, { color: ff.faint }]}>Items / 条目</Text>
          <Text style={[styles.sectionA, { color: ff.muted }]}>左滑或点删除</Text>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={11}>
        <View
          style={[
            styles.listCard,
            {
              backgroundColor: isDark ? ff.paper2 : ff.card,
              borderColor: ff.line,
            },
          ]}>
          {config.items.length === 0 ? (
            <Text style={[styles.emptyHint, { color: ff.muted, paddingVertical: 18 }]}>暂无条目</Text>
          ) : (
            config.items.map((item, idx) => {
              const row = (
                <View style={[styles.ledgerRow, idx > 0 && { borderTopColor: ff.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <View style={[styles.lic, { backgroundColor: isDark ? ff.sage2 : item.iconBg }]}>
                    <MaterialIcons name={item.icon} size={14} color={isDark ? ff.sage : item.iconFg} />
                  </View>
                  <View style={styles.lm}>
                    <Text style={[styles.lmTitle, { color: ff.ink }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[styles.lmSub, { color: ff.faint }]} numberOfLines={1}>
                      {item.sub}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.lv,
                      {
                        color: item.signedExpense || item.amount < 0 ? ff.clay : ff.income,
                        fontFamily: fonts.mono,
                      },
                    ]}>
                    {formatSignedMoney(item.amount, item.signedExpense)}
                  </Text>
                  {item.deleteAction ? (
                    <Pressable
                      onPress={() => confirmDelete(item)}
                      hitSlop={6}
                      style={({ pressed }) => [styles.trashBtn, pressed && { opacity: 0.7 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`删除 ${item.name}`}>
                      <MaterialIcons name="delete-outline" size={16} color="#B36A50" />
                    </Pressable>
                  ) : (
                    <View style={{ width: 22 }} />
                  )}
                </View>
              );

              if (!item.deleteAction) {
                return <View key={item.id}>{row}</View>;
              }
              return (
                <Swipeable
                  key={item.id}
                  overshootRight={false}
                  rightThreshold={40}
                  renderRightActions={() => (
                    <Pressable onPress={() => confirmDelete(item)} style={styles.swipeDelete}>
                      <MaterialIcons name="delete" size={18} color="#fff" />
                      <Text style={styles.swipeDeleteText}>删除</Text>
                    </Pressable>
                  )}>
                  {row}
                </Swipeable>
              );
            })
          )}
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={11}>
        <View
          style={[
            styles.insight,
            {
              backgroundColor: isDark ? 'rgba(216,154,77,0.1)' : '#F7F1E6',
              borderColor: isDark ? ff.line2 : '#E8D9BF',
            },
          ]}>
          <MaterialIcons name="auto-awesome" size={14} color={ff.amber} />
          <Text style={[styles.insightText, { color: isDark ? ff.ink2 : '#5C564A' }]}>
            <Text style={{ fontWeight: '700', color: ff.ink }}>洞察：</Text>
            {config.insight}
          </Text>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={10}>
        <Pressable
          onPress={onSimulate}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: ff.pine },
            pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
          ]}>
          <Text style={[styles.primaryText, { color: ff.onPine }]}>用这组数据做一次模拟</Text>
        </Pressable>
        <Text style={[styles.miniNote, { color: ff.faint }]}>
          模型明细与日常流水分开 · 删除不会影响真实账目
        </Text>
      </FoldRiseIn>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8, paddingBottom: 8 },
  hero: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 13,
    marginBottom: 0,
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase' },
  tag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 10, fontWeight: '700' },
  big: { fontSize: 28, fontWeight: '750', marginTop: 6, letterSpacing: -0.5 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  metaText: { fontSize: 11 },
  statsGrid: { flexDirection: 'row', gap: 6, marginTop: 10 },
  statCell: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  statLabel: { fontSize: 10 },
  statValue: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  catCard: { borderRadius: 16, borderWidth: 1, padding: 12 },
  catHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  catTitle: { fontSize: 13, fontWeight: '700' },
  catHint: { fontSize: 11 },
  catBar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 7 },
  catName: { width: 40, fontSize: 11, fontWeight: '600' },
  catTrack: {
    flex: 1,
    height: 6,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.05)',
    overflow: 'hidden',
  },
  catFill: { height: '100%', borderRadius: 4 },
  catNum: { width: 52, fontSize: 10, textAlign: 'right' },
  catPct: { width: 32, fontSize: 10, textAlign: 'right' },
  sectionH: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 2,
  },
  sectionT: { fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' },
  sectionA: { fontSize: 11 },
  listCard: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 10, overflow: 'hidden' },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  lic: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lm: { flex: 1, minWidth: 0 },
  lmTitle: { fontSize: 13, fontWeight: '700' },
  lmSub: { fontSize: 10, marginTop: 1 },
  lv: { fontSize: 13, fontWeight: '700' },
  trashBtn: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  swipeDelete: {
    width: 72,
    backgroundColor: '#C66A4C',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
    borderRadius: 10,
  },
  swipeDeleteText: { color: '#fff', fontSize: 11, fontWeight: '700', marginTop: 2 },
  insight: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    borderRadius: 14,
    borderWidth: 1,
    padding: 11,
  },
  insightText: { flex: 1, fontSize: 12, lineHeight: 18 },
  primary: {
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryText: { fontSize: 14, fontWeight: '750' },
  miniNote: { textAlign: 'center', fontSize: 10, marginTop: 6 },
  emptyHint: { fontSize: 12, textAlign: 'center', paddingVertical: 8 },
});
