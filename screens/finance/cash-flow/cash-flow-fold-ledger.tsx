/**
 * 资产负债台账 · 对齐设计稿 15（汇总格 / 模型净值 / 构成条 / 列表 / 真实资产对齐）
 */
import {
  FoldCountUpText,
  FoldRiseIn,
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import type { CashFlowMetrics, CategorizedHolding } from '@/lib/cash-flow/cash-flow-metrics';
import {
  computeNetWorthTotal,
  computeTotalAssets,
  computeTotalLiabilitiesAbs,
} from '@/lib/finance-net-worth';
import { getFinanceAccountsWithBalance } from '@/lib/repositories/finance/finance';
import type { FinanceAccountBalanceRow } from '@/lib/repositories/finance/finance.types';
import type { CashFlowState } from '@/lib/repositories/cash-flow/cash-flow.types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

type LedgerKind = 'earning' | 'selfUse' | 'liability';

type LedgerRow = CategorizedHolding & { kind: LedgerKind };

function formatMoney(value: number) {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatMoney2(value: number) {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function classifyHolding(h: CategorizedHolding): LedgerKind {
  if (h.netCashflow < 0 || h.outflow > h.inflow) return 'liability';
  if (h.inflow > 0 || h.netCashflow > 0) return 'earning';
  return 'selfUse';
}

function holdingIcon(kind: LedgerKind, name: string): keyof typeof MaterialIcons.glyphMap {
  const n = name.toLowerCase();
  if (kind === 'liability') return 'account-balance';
  if (n.includes('房') || n.includes('宅') || n.includes('home')) return 'home';
  if (n.includes('现金') || n.includes('活期') || n.includes('钱包') || n.includes('储蓄')) return 'account-balance-wallet';
  if (n.includes('基金') || n.includes('股') || n.includes('证') || n.includes('etf')) return 'show-chart';
  return kind === 'earning' ? 'trending-up' : 'home';
}

function holdingSub(h: LedgerRow, necessary: number): string {
  if (h.kind === 'earning') {
    const inflow = formatMoney(h.inflow);
    return h.inflow > 0 ? `生钱资产 · 月流入 ${inflow}` : '生钱资产 · 净流入为正';
  }
  if (h.kind === 'selfUse') {
    if (necessary > 0 && h.principal > 0) {
      const months = h.principal / necessary;
      if (months >= 0.5) {
        return `流动性 · 必要支出覆盖 ${months.toFixed(1)} 个月`;
      }
    }
    return '自用资产 · 不计入生钱资产';
  }
  const months = h.extra?.repayMonths;
  const out = formatMoney(h.outflow);
  if (months != null && months > 0) return `剩余 ${months} 期 · 月供 ${out}`;
  return `月均消耗 ${out}`;
}

/** 构成条：自左生长 800ms */
function EarningTrack({ ratio, animate }: { ratio: number; animate: boolean }) {
  const { ff, isDark } = useFinanceFoldTheme();
  const w = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const clamped = Math.max(0, Math.min(1, ratio));

  useEffect(() => {
    if (!animate) {
      w.setValue(1);
      return;
    }
    w.setValue(0);
    const anim = Animated.timing(w, {
      toValue: 1,
      duration: 800,
      delay: 220,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, clamped, w]);

  const width = w.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${clamped * 100}%`],
  });

  return (
    <View style={[styles.covTrack, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#EEE8DC' }]}>
      <Animated.View
        style={[
          styles.covFill,
          {
            width,
            backgroundColor: isDark ? ff.sage : undefined,
          },
          !isDark && styles.covFillGrad,
        ]}
      />
    </View>
  );
}

export function CashFlowFoldLedger({
  state,
  metrics,
  onOpenAssets,
}: {
  state: CashFlowState;
  metrics: CashFlowMetrics;
  onOpenAssets: () => void;
}) {
  const { ff, isDark, fonts } = useFinanceFoldTheme();
  const { animate } = useFoldMotionGate();
  const mono = fonts.mono;

  const rows = useMemo<LedgerRow[]>(() => {
    return metrics.categorizedHoldings.map((h) => ({ ...h, kind: classifyHolding(h) }));
  }, [metrics.categorizedHoldings]);

  const earning = useMemo(() => rows.filter((r) => r.kind === 'earning'), [rows]);
  const selfUse = useMemo(() => rows.filter((r) => r.kind === 'selfUse'), [rows]);
  const liabilities = useMemo(() => rows.filter((r) => r.kind === 'liability'), [rows]);
  const assets = useMemo(() => [...earning, ...selfUse], [earning, selfUse]);

  const earningValue = useMemo(() => earning.reduce((s, h) => s + h.principal, 0), [earning]);
  const selfUseValue = useMemo(() => selfUse.reduce((s, h) => s + h.principal, 0), [selfUse]);
  const liabilityValue = useMemo(() => liabilities.reduce((s, h) => s + h.principal, 0), [liabilities]);
  const modelNet = earningValue + selfUseValue - liabilityValue;
  const totalAssetPrincipal = earningValue + selfUseValue;
  const earningRatio = totalAssetPrincipal > 0 ? earningValue / totalAssetPrincipal : 0;

  const liquidForCover = useMemo(() => {
    return selfUse
      .filter((h) => {
        const n = h.name;
        return /现金|活期|钱包|储蓄|货币|余额/.test(n);
      })
      .reduce((s, h) => s + h.principal, 0);
  }, [selfUse]);
  const coverMonths =
    state.necessaryExpenses > 0 ? liquidForCover / state.necessaryExpenses : 0;

  const [realAccounts, setRealAccounts] = useState<FinanceAccountBalanceRow[]>([]);
  const [alignedAt, setAlignedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getFinanceAccountsWithBalance({ cacheOnly: true })
      .then((rowsAcc) => {
        if (cancelled) return;
        setRealAccounts(rowsAcc);
        setAlignedAt(new Date());
      })
      .catch(() => {
        if (cancelled) return;
        setRealAccounts([]);
        setAlignedAt(new Date());
      });
    return () => {
      cancelled = true;
    };
  }, [metrics.totalAssetsValue, metrics.totalLiabilitiesValue, state.holdings.length]);

  const realNet = useMemo(() => computeNetWorthTotal(realAccounts), [realAccounts]);
  const realAssets = useMemo(() => computeTotalAssets(realAccounts), [realAccounts]);
  const realLiab = useMemo(() => computeTotalLiabilitiesAbs(realAccounts), [realAccounts]);
  const modelVsRealDiff = Math.abs(modelNet - realNet);
  const aligned = modelVsRealDiff < 1;
  const accountCount = realAccounts.length;

  const cardBg = isDark ? ff.card : ff.card;
  const softBg = isDark ? ff.paper2 : '#F5F0E5';
  const softBorder = isDark ? ff.line : '#E8DFCF';
  const rowBorder = isDark ? ff.line : '#ECE4D6';
  const iconEarningBg = isDark ? ff.sage2 : '#E9EFE8';
  const iconEarningFg = isDark ? ff.sage : '#4C6B59';
  const iconSelfBg = isDark ? ff.amber2 : '#F4EAD9';
  const iconSelfFg = isDark ? ff.amberInk : '#98692D';
  const iconCashBg = isDark ? 'rgba(107,138,148,0.22)' : '#E7EEF0';
  const iconCashFg = isDark ? '#8FB0BA' : '#567982';
  const iconDebtBg = isDark ? ff.clay2 : '#F3E0D9';
  const iconDebtFg = isDark ? ff.clayInk : '#9E533B';

  const alignTimeLabel = alignedAt
    ? `最后校验 ${String(alignedAt.getHours()).padStart(2, '0')}:${String(alignedAt.getMinutes()).padStart(2, '0')}`
    : '正在校验…';

  let rise = 0;
  const nextRise = () => rise++;

  return (
    <View style={styles.root}>
      <FoldRiseIn animate={animate} index={nextRise()} fromY={11}>
        <View style={styles.summaryRow}>
          <View style={[styles.ls, { backgroundColor: cardBg, borderColor: ff.line }]}>
            <Text style={[styles.lsLab, { color: ff.muted }]}>生钱资产</Text>
            <FoldCountUpText
              value={earningValue}
              animate={animate}
              duration={760}
              delayMs={40}
              textStyle={[styles.lsVal, { color: ff.income, fontFamily: mono }]}
              formatter={(n) => formatMoney(n)}
            />
          </View>
          <View style={[styles.ls, { backgroundColor: cardBg, borderColor: ff.line }]}>
            <Text style={[styles.lsLab, { color: ff.muted }]}>自用资产</Text>
            <FoldCountUpText
              value={selfUseValue}
              animate={animate}
              duration={760}
              delayMs={70}
              textStyle={[styles.lsVal, { color: ff.income, fontFamily: mono }]}
              formatter={(n) => formatMoney(n)}
            />
          </View>
          <View style={[styles.ls, { backgroundColor: cardBg, borderColor: ff.line }]}>
            <Text style={[styles.lsLab, { color: ff.muted }]}>总负债</Text>
            <FoldCountUpText
              value={liabilityValue}
              animate={animate}
              duration={760}
              delayMs={100}
              textStyle={[styles.lsVal, { color: ff.clay, fontFamily: mono }]}
              formatter={(n) => formatMoney(n)}
            />
          </View>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={11}>
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: ff.line }]}>
          <View style={styles.netHead}>
            <Text style={[styles.eyebrow, { color: ff.muted }]}>Net worth / 模型净值</Text>
            <View style={[styles.tag, { backgroundColor: isDark ? ff.sage2 : '#E4EFE7' }]}>
              <Text style={[styles.tagText, { color: ff.income }]}>
                生钱 {Math.round(earningRatio * 100)}%
              </Text>
            </View>
          </View>
          <FoldCountUpText
            value={modelNet}
            animate={animate}
            duration={760}
            delayMs={90}
            textStyle={[styles.netBig, { color: ff.pine, fontFamily: mono }]}
            formatter={(n) => formatMoney2(n)}
          />
          <Text style={[styles.miniNote, { color: ff.muted }]}>
            生钱资产 / 总资产 = {Math.round(earningRatio * 100)}% · 自由模型建议 ≥ 50%
          </Text>
          <View style={styles.covBlock}>
            <View style={styles.covLabRow}>
              <Text style={[styles.covLab, { color: ff.faint }]}>资产构成</Text>
              <Text style={[styles.covLab, { color: ff.faint }]}>
                生钱资产 {Math.round(earningRatio * 100)}%
              </Text>
            </View>
            <EarningTrack ratio={earningRatio} animate={animate} />
          </View>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={8}>
        <View style={styles.sectionH}>
          <Text style={[styles.sectionT, { color: ff.ink, fontFamily: fonts.serif }]}>Assets / 资产</Text>
          <Text style={[styles.sectionA, { color: ff.muted }]}>{assets.length} 项</Text>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={11}>
        <View style={[styles.card, styles.listCard, { backgroundColor: cardBg, borderColor: ff.line }]}>
          {assets.length === 0 ? (
            <Text style={[styles.emptyText, { color: ff.muted }]}>暂无资产台账 · 可在「记一笔」写入资产投入</Text>
          ) : (
            assets.map((h, i) => {
              const isCash = /现金|活期|钱包|储蓄|货币|余额/.test(h.name);
              const bg = h.kind === 'earning' ? iconEarningBg : isCash ? iconCashBg : iconSelfBg;
              const fg = h.kind === 'earning' ? iconEarningFg : isCash ? iconCashFg : iconSelfFg;
              return (
                <Pressable
                  key={h.id}
                  onPress={onOpenAssets}
                  style={({ pressed }) => [
                    styles.row,
                    i < assets.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: rowBorder },
                    pressed && { opacity: 0.75 },
                  ]}>
                  <View style={[styles.lic, { backgroundColor: bg }]}>
                    <MaterialIcons name={holdingIcon(h.kind, h.name)} size={14} color={fg} />
                  </View>
                  <View style={styles.lm}>
                    <Text style={[styles.lmTitle, { color: ff.ink }]} numberOfLines={1}>
                      {h.name || '未命名'}
                    </Text>
                    <Text style={[styles.lmSub, { color: ff.faint }]} numberOfLines={1}>
                      {holdingSub(h, state.necessaryExpenses)}
                    </Text>
                  </View>
                  <Text style={[styles.lv, { color: ff.ink2, fontFamily: mono }]}>{formatMoney(h.principal)}</Text>
                  <MaterialIcons name="chevron-right" size={16} color={ff.faint} />
                </Pressable>
              );
            })
          )}
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={8}>
        <View style={styles.sectionH}>
          <Text style={[styles.sectionT, { color: ff.ink, fontFamily: fonts.serif }]}>Liabilities / 负债</Text>
          <Text style={[styles.sectionA, { color: ff.muted }]}>{liabilities.length} 项</Text>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={11}>
        <View style={[styles.card, styles.listCard, { backgroundColor: cardBg, borderColor: ff.line }]}>
          {liabilities.length === 0 ? (
            <Text style={[styles.emptyText, { color: ff.muted }]}>暂无负债台账</Text>
          ) : (
            liabilities.map((h, i) => (
              <Pressable
                key={h.id}
                onPress={onOpenAssets}
                style={({ pressed }) => [
                  styles.row,
                  i < liabilities.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: rowBorder,
                  },
                  pressed && { opacity: 0.75 },
                ]}>
                <View style={[styles.lic, { backgroundColor: iconDebtBg }]}>
                  <MaterialIcons name={holdingIcon('liability', h.name)} size={14} color={iconDebtFg} />
                </View>
                <View style={styles.lm}>
                  <Text style={[styles.lmTitle, { color: ff.ink }]} numberOfLines={1}>
                    {h.name || '未命名'}
                  </Text>
                  <Text style={[styles.lmSub, { color: ff.faint }]} numberOfLines={1}>
                    {holdingSub(h, state.necessaryExpenses)}
                  </Text>
                </View>
                <Text style={[styles.lv, { color: ff.clay, fontFamily: mono }]}>
                  -{formatMoney(h.principal)}
                </Text>
                <MaterialIcons name="chevron-right" size={16} color={ff.faint} />
              </Pressable>
            ))
          )}
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={11}>
        <Pressable
          onPress={onOpenAssets}
          style={({ pressed }) => [
            styles.linkRow,
            { backgroundColor: softBg, borderColor: softBorder, opacity: pressed ? 0.85 : 1 },
          ]}>
          <MaterialIcons name="account-balance-wallet" size={16} color={ff.amberInk} />
          <Text style={[styles.linkText, { color: ff.muted }]}>
            <Text style={{ color: ff.ink2, fontWeight: '700' }}>去真实资产页登记</Text>
            {' · 详细账户、余额与校正'}
          </Text>
          <MaterialIcons name="chevron-right" size={16} color={ff.faint} style={{ marginLeft: 'auto' }} />
        </Pressable>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={8}>
        <View style={[styles.helper, { backgroundColor: softBg, borderColor: softBorder }]}>
          <MaterialIcons name="lightbulb-outline" size={14} color={ff.amber} style={{ marginTop: 1 }} />
          <Text style={[styles.helperText, { color: ff.muted }]}>
            台账用于现金流模型；真实资产页才是账户余额的唯一来源。两边的汇总口径会在每次打开时自动校验。
          </Text>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={11}>
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: ff.line, paddingVertical: 10 }]}>
          <View style={styles.alignHead}>
            <View style={[styles.alignIcon, { backgroundColor: isDark ? ff.sage2 : '#E8EFE8' }]}>
              <MaterialIcons name="verified-user" size={14} color={isDark ? ff.sage : '#4C6B59'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.alignTitle, { color: ff.ink }]}>
                {aligned ? '与真实资产已对齐' : '与真实资产存在差异'}
              </Text>
              <Text style={[styles.alignSub, { color: ff.faint }]}>
                {alignTimeLabel} · 差异 {formatMoney2(modelVsRealDiff)}
                {!aligned
                  ? `（真实净值 ${formatMoney2(realNet)} · 资产 ${formatMoney(realAssets)} / 负债 ${formatMoney(realLiab)}）`
                  : ''}
              </Text>
            </View>
            <View
              style={[
                styles.tag,
                { backgroundColor: aligned ? (isDark ? ff.sage2 : '#E4EFE7') : isDark ? ff.amber2 : '#F4EAD9' },
              ]}>
              <Text style={[styles.tagText, { color: aligned ? ff.income : ff.amberInk }]}>
                {aligned ? '一致' : '待核'}
              </Text>
            </View>
          </View>
          <View style={styles.statsGrid}>
            <View style={[styles.statCell, { backgroundColor: softBg, borderColor: softBorder }]}>
              <Text style={[styles.statLab, { color: ff.faint }]}>账户数</Text>
              <Text style={[styles.statVal, { color: ff.ink2, fontFamily: mono }]}>{accountCount}</Text>
            </View>
            <View style={[styles.statCell, { backgroundColor: softBg, borderColor: softBorder }]}>
              <Text style={[styles.statLab, { color: ff.faint }]}>生钱资产占比</Text>
              <Text style={[styles.statVal, { color: ff.ink2, fontFamily: mono }]}>
                {Math.round(earningRatio * 100)}%
              </Text>
            </View>
            <View style={[styles.statCell, { backgroundColor: softBg, borderColor: softBorder }]}>
              <Text style={[styles.statLab, { color: ff.faint }]}>应急金覆盖</Text>
              <Text style={[styles.statVal, { color: ff.ink2, fontFamily: mono }]}>
                {coverMonths > 0 ? `${coverMonths.toFixed(1)} 月` : '—'}
              </Text>
            </View>
          </View>
        </View>
      </FoldRiseIn>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingBottom: 12 },
  summaryRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  ls: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 9,
    paddingHorizontal: 8,
  },
  lsLab: { fontSize: 10 },
  lsVal: { fontSize: 13, fontWeight: '700', marginTop: 3 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  listCard: { paddingTop: 2, paddingBottom: 2, paddingHorizontal: 10 },
  netHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: '600' },
  tag: {
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagText: { fontSize: 10, fontWeight: '700' },
  netBig: { fontSize: 26, fontWeight: '700', marginTop: 4 },
  miniNote: { fontSize: 11, marginTop: 4, lineHeight: 16 },
  covBlock: { marginTop: 10 },
  covLabRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  covLab: { fontSize: 10 },
  covTrack: { height: 5, borderRadius: 5, overflow: 'hidden' },
  covFill: { height: '100%', borderRadius: 5 },
  covFillGrad: { backgroundColor: '#7E9F8C' },
  sectionH: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 6,
    marginTop: 2,
    paddingHorizontal: 2,
  },
  sectionT: { fontSize: 14, fontWeight: '700' },
  sectionA: { fontSize: 11 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  lic: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lm: { flex: 1, minWidth: 0 },
  lmTitle: { fontSize: 13, fontWeight: '700' },
  lmSub: { fontSize: 11, marginTop: 2 },
  lv: { fontSize: 13, fontWeight: '700', marginRight: 2 },
  emptyText: { fontSize: 12, textAlign: 'center', paddingVertical: 18, lineHeight: 18 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 11,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  linkText: { flex: 1, fontSize: 12, lineHeight: 17 },
  helper: {
    flexDirection: 'row',
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  helperText: { flex: 1, fontSize: 11, lineHeight: 17 },
  alignHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alignIcon: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alignTitle: { fontSize: 12, fontWeight: '700' },
  alignSub: { fontSize: 10, marginTop: 2, lineHeight: 14 },
  statsGrid: { flexDirection: 'row', gap: 5, marginTop: 10 },
  statCell: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  statLab: { fontSize: 10 },
  statVal: { fontSize: 13, fontWeight: '700', marginTop: 3 },
});
