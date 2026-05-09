import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type Quadrant = 'E' | 'S' | 'B' | 'I';
type ExpenseFlowType = 'necessary' | 'unnecessary' | 'asset' | 'liability';
type ActiveTab =
  | 'dashboard'
  | 'entry'
  | 'ledger'
  | 'simulator'
  | 'detail_active'
  | 'detail_passive'
  | 'detail_asset'
  | 'detail_liability'
  | 'detail_expense';

type IncomeItem = { id: number; name: string; amount: number; quadrant: Quadrant };
type Holding = { id: number; name: string; principal: number; inflow: number; outflow: number };

type CashFlowState = {
  necessaryExpenses: number;
  unnecessaryExpenses: number;
  incomes: IncomeItem[];
  holdings: Holding[];
  goals: { targetPassiveIncome: number; targetMonths: number };
};

type CategorizedHolding = Holding & { netCashflow: number; isAsset: boolean };

type Metrics = {
  activeIncome: number;
  totalPassiveIncome: number;
  totalIncome: number;
  totalExpenses: number;
  freeCashFlow: number;
  assetInflow: number;
  liabilityOutflow: number;
  freedomProgress: number;
  passiveRatio: number;
  pattern: string;
  categorizedHoldings: CategorizedHolding[];
  totalAssetsValue: number;
  totalLiabilitiesValue: number;
};

const INITIAL_STATE: CashFlowState = {
  necessaryExpenses: 4000,
  unnecessaryExpenses: 1500,
  incomes: [
    { id: 1, name: '主业薪资', amount: 12000, quadrant: 'E' },
    { id: 2, name: '副业接单', amount: 3000, quadrant: 'S' },
    { id: 3, name: '指数基金分红', amount: 800, quadrant: 'I' },
  ],
  holdings: [
    { id: 1, name: '自住房屋按揭', principal: 1_000_000, inflow: 0, outflow: 4500 },
    { id: 2, name: '出租公寓', principal: 500_000, inflow: 3500, outflow: 1500 },
    { id: 3, name: '车贷', principal: 150_000, inflow: 0, outflow: 2500 },
    { id: 4, name: '高息分红股', principal: 100_000, inflow: 800, outflow: 0 },
  ],
  goals: { targetPassiveIncome: 20000, targetMonths: 60 },
};

function calculateMetrics(state: CashFlowState): Metrics {
  const activeIncome = state.incomes
    .filter((i) => ['E', 'S'].includes(i.quadrant))
    .reduce((sum, i) => sum + i.amount, 0);
  const purePassiveIncome = state.incomes
    .filter((i) => ['B', 'I'].includes(i.quadrant))
    .reduce((sum, i) => sum + i.amount, 0);

  let assetInflow = 0;
  let liabilityOutflow = 0;
  let totalAssetsValue = 0;
  let totalLiabilitiesValue = 0;

  const categorizedHoldings: CategorizedHolding[] = state.holdings.map((h) => {
    const netCashflow = h.inflow - h.outflow;
    const isAsset = netCashflow > 0;
    if (isAsset) {
      assetInflow += netCashflow;
      totalAssetsValue += h.principal;
    } else {
      liabilityOutflow += Math.abs(netCashflow);
      totalLiabilitiesValue += h.principal;
    }
    return { ...h, netCashflow, isAsset };
  });

  const totalPassiveIncome = purePassiveIncome + assetInflow;
  const totalIncome = activeIncome + totalPassiveIncome;
  const totalExpenses = state.necessaryExpenses + state.unnecessaryExpenses + liabilityOutflow;
  const freeCashFlow = totalIncome - totalExpenses;

  const freedomProgress =
    state.necessaryExpenses > 0 ? (totalPassiveIncome / state.necessaryExpenses) * 100 : 0;
  const passiveRatio = totalIncome > 0 ? (totalPassiveIncome / totalIncome) * 100 : 0;

  let pattern = '穷人模式';
  if (freedomProgress >= 100) pattern = '财务自由 🎉';
  else if (liabilityOutflow > assetInflow && activeIncome > 0) pattern = '老鼠赛跑 🐀';
  else if (assetInflow > 0) pattern = '快车道起步 🚀';

  return {
    activeIncome,
    totalPassiveIncome,
    totalIncome,
    totalExpenses,
    freeCashFlow,
    assetInflow,
    liabilityOutflow,
    freedomProgress,
    passiveRatio,
    pattern,
    categorizedHoldings,
    totalAssetsValue,
    totalLiabilitiesValue,
  };
}

const VIEW_TITLES: Record<Exclude<ActiveTab, 'dashboard'>, string> = {
  entry: '记一笔流水',
  ledger: '资产负债台账',
  simulator: '财务决策模拟',
  detail_active: '主动收入明细',
  detail_passive: '被动收入明细',
  detail_asset: '资产明细',
  detail_liability: '负债明细',
  detail_expense: '流出明细',
};

function formatMoney(value: number) {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

type ToastState = { message: string; type: 'success' | 'warning' } | null;

export default function CashFlowScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[isDark ? 'dark' : 'light'];

  const bg = isDark ? theme.background : '#f8fafc';
  const surface = isDark ? theme.surface : '#ffffff';
  const text = isDark ? theme.text : '#0f172a';
  const subtle = isDark ? theme.textSecondary : '#64748b';
  const border = isDark ? 'rgba(148,163,184,0.2)' : '#e2e8f0';

  const [state, setState] = useState<CashFlowState>(INITIAL_STATE);
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [toast, setToast] = useState<ToastState>(null);

  const metrics = useMemo(() => calculateMetrics(state), [state]);

  const showToast = useCallback((message: string, type: 'success' | 'warning' = 'success') => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const headerTitle =
    activeTab === 'dashboard'
      ? 'CASHFLOW引擎'
      : VIEW_TITLES[activeTab as Exclude<ActiveTab, 'dashboard'>];

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['left', 'right']}>
      <View style={[styles.header, { borderBottomColor: border, backgroundColor: isDark ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.95)', paddingTop: insets.top }]}>
        {activeTab !== 'dashboard' ? (
          <Pressable
            onPress={() => setActiveTab('dashboard')}
            style={({ pressed }) => [styles.headerBack, pressed && { opacity: 0.75 }]}>
            <MaterialIcons name="chevron-left" size={28} color={subtle} />
            <Text style={[styles.headerBackTitle, { color: text }]}>{headerTitle}</Text>
          </Pressable>
        ) : (
          <View style={styles.headerBrand}>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.headerExit, pressed && { opacity: 0.7 }]}>
              <MaterialIcons name="arrow-back-ios" size={20} color={subtle} />
            </Pressable>
            <View style={styles.headerBrandMid}>
              <View style={styles.headerLogo}>
                <MaterialIcons name="monetization-on" size={20} color="#fff" />
              </View>
              <Text style={[styles.headerTitle, { color: text }]}>{headerTitle}</Text>
            </View>
            <View style={{ width: 36 }} />
          </View>
        )}
      </View>

      {toast ? (
        <View
          style={[
            styles.toast,
            { top: insets.top + 8 },
            toast.type === 'success'
              ? { backgroundColor: '#10b981' }
              : toast.type === 'warning'
                ? { backgroundColor: '#f59e0b' }
                : { backgroundColor: '#3b82f6' },
          ]}>
          <MaterialIcons
            name={toast.type === 'success' ? 'check-circle' : 'warning'}
            size={20}
            color="#fff"
          />
          <Text style={styles.toastText}>{toast.message}</Text>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 28 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {activeTab === 'dashboard' ? (
          <MobileDashboard
            state={state}
            metrics={metrics}
            onNavigate={setActiveTab}
            surface={surface}
            text={text}
            subtle={subtle}
            border={border}
            isDark={isDark}
          />
        ) : null}
        {activeTab === 'entry' ? (
          <MobileEntry
            setState={setState}
            showToast={showToast}
            surface={surface}
            text={text}
            subtle={subtle}
            border={border}
            isDark={isDark}
          />
        ) : null}
        {activeTab === 'ledger' ? (
          <MobileLedger metrics={metrics} surface={surface} text={text} subtle={subtle} border={border} />
        ) : null}
        {activeTab === 'simulator' ? (
          <MobileSimulator
            state={state}
            currentMetrics={metrics}
            surface={surface}
            text={text}
            subtle={subtle}
            border={border}
            isDark={isDark}
          />
        ) : null}
        {activeTab.startsWith('detail_') ? (
          <FlowDetail
            detailType={activeTab}
            state={state}
            metrics={metrics}
            surface={surface}
            text={text}
            subtle={subtle}
            border={border}
            isDark={isDark}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function MobileDashboard({
  state,
  metrics,
  onNavigate,
  surface,
  text,
  subtle,
  border,
  isDark,
}: {
  state: CashFlowState;
  metrics: Metrics;
  onNavigate: (tab: ActiveTab) => void;
  surface: string;
  text: string;
  subtle: string;
  border: string;
  isDark: boolean;
}) {
  const card = [styles.card, { backgroundColor: surface, borderColor: border }];
  const statCard = [styles.card, { backgroundColor: surface, borderColor: border, flex: 1 }];
  const fp = Math.min(metrics.freedomProgress, 100);

  return (
    <View style={styles.section}>
      <View style={[styles.heroCard, { backgroundColor: surface, borderColor: border }]}>
        <View style={styles.heroTop}>
          <View>
            <Text style={[styles.heroKicker, { color: subtle }]}>财务自由进度</Text>
            <Text style={[styles.heroPct, { color: text }]}>
              {metrics.freedomProgress.toFixed(1)}
              <Text style={[styles.heroPctUnit, { color: subtle }]}>%</Text>
            </Text>
          </View>
          <View style={[styles.patternPill, { backgroundColor: isDark ? 'rgba(148,163,184,0.15)' : '#f1f5f9', borderColor: border }]}>
            <Text style={[styles.patternPillText, { color: text }]}>{metrics.pattern}</Text>
          </View>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: isDark ? 'rgba(148,163,184,0.2)' : '#e2e8f0' }]}>
          <View style={[styles.progressFill, { width: `${fp}%` }]} />
        </View>
        <View style={[styles.heroFoot, { backgroundColor: isDark ? 'rgba(148,163,184,0.08)' : '#f8fafc', borderColor: border }]}>
          <View>
            <Text style={[styles.heroFootLabel, { color: subtle }]}>当前被动收入</Text>
            <Text style={styles.heroFootValPassive}>{formatMoney(metrics.totalPassiveIncome)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.heroFootLabel, { color: subtle }]}>目标(必要支出)</Text>
            <Text style={[styles.heroFootVal, { color: text }]}>{formatMoney(state.necessaryExpenses)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.grid2}>
        <View style={statCard}>
          <View style={styles.statRow}>
            <MaterialIcons name="account-balance-wallet" size={14} color={subtle} />
            <Text style={[styles.statKicker, { color: subtle }]}>自由现金流</Text>
          </View>
          <Text style={[styles.statVal, { color: metrics.freeCashFlow >= 0 ? '#059669' : '#f43f5e' }]}>
            {metrics.freeCashFlow >= 0 ? '+' : ''}
            {formatMoney(metrics.freeCashFlow)}
          </Text>
        </View>
        <View style={statCard}>
          <View style={styles.statRow}>
            <MaterialIcons name="pie-chart" size={14} color={subtle} />
            <Text style={[styles.statKicker, { color: subtle }]}>被动收入占比</Text>
          </View>
          <Text style={[styles.statVal, { color: '#2563eb' }]}>{metrics.passiveRatio.toFixed(1)}%</Text>
        </View>
      </View>

      <Pressable
        onPress={() => onNavigate('entry')}
        style={({ pressed }) => [
          styles.entryWide,
          {
            backgroundColor: isDark ? 'rgba(59,130,246,0.12)' : '#eff6ff',
            borderColor: isDark ? 'rgba(59,130,246,0.35)' : '#bfdbfe',
            opacity: pressed ? 0.92 : 1,
          },
        ]}>
        <View style={[styles.entryIconBox, { backgroundColor: surface, borderColor: border }]}>
          <MaterialIcons name="add-circle" size={24} color="#2563eb" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.entryTitle, { color: text }]}>记一笔流水</Text>
          <Text style={[styles.entrySub, { color: subtle }]}>记录收支与资产流向</Text>
        </View>
        <View style={styles.entryRight}>
          <View style={[styles.freqBadge, { backgroundColor: isDark ? 'rgba(59,130,246,0.2)' : '#dbeafe' }]}>
            <Text style={styles.freqBadgeText}>高频</Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color={subtle} />
        </View>
      </Pressable>

      <View style={styles.grid2}>
        <Pressable
          onPress={() => onNavigate('ledger')}
          style={({ pressed }) => [
            styles.tileBtn,
            {
              backgroundColor: isDark ? 'rgba(16,185,129,0.1)' : '#ecfdf5',
              borderColor: isDark ? 'rgba(16,185,129,0.35)' : '#a7f3d0',
              opacity: pressed ? 0.92 : 1,
            },
          ]}>
          <View style={[styles.tileIcon, { backgroundColor: surface, borderColor: border }]}>
            <MaterialIcons name="menu-book" size={20} color="#059669" />
          </View>
          <Text style={[styles.tileTitle, { color: text }]}>资产台账</Text>
          <View style={styles.tileFoot}>
            <Text style={[styles.tileSub, { color: subtle }]}>盘点现金流</Text>
            <MaterialIcons name="chevron-right" size={16} color={subtle} />
          </View>
        </Pressable>
        <Pressable
          onPress={() => onNavigate('simulator')}
          style={({ pressed }) => [
            styles.tileBtn,
            {
              backgroundColor: isDark ? 'rgba(168,85,247,0.12)' : '#faf5ff',
              borderColor: isDark ? 'rgba(168,85,247,0.35)' : '#e9d5ff',
              opacity: pressed ? 0.92 : 1,
            },
          ]}>
          <View style={[styles.tileIcon, { backgroundColor: surface, borderColor: border }]}>
            <MaterialIcons name="science" size={20} color="#9333ea" />
          </View>
          <Text style={[styles.tileTitle, { color: text }]}>决策模拟</Text>
          <View style={styles.tileFoot}>
            <Text style={[styles.tileSub, { color: subtle }]}>防坑沙盒</Text>
            <MaterialIcons name="chevron-right" size={16} color={subtle} />
          </View>
        </Pressable>
      </View>

      <View style={styles.waterfallHeaderRow}>
        <Text style={[styles.waterfallTitle, { color: subtle }]}>全景现金流向图</Text>
        <View style={styles.waterfallHint}>
          <MaterialIcons name="info-outline" size={12} color={subtle} />
          <Text style={[styles.waterfallHintText, { color: subtle }]}>点击卡片查看明细</Text>
        </View>
      </View>
      <View style={[styles.waterfallCard, { backgroundColor: surface, borderColor: border }]}>
        <View style={styles.incomeRow}>
          <Pressable
            onPress={() => onNavigate('detail_active')}
            style={({ pressed }) => [
              styles.incomeBox,
              {
                backgroundColor: isDark ? 'rgba(59,130,246,0.15)' : '#eff6ff',
                borderColor: isDark ? 'rgba(59,130,246,0.4)' : '#bfdbfe',
                opacity: pressed ? 0.85 : 1,
              },
            ]}>
            <Text style={styles.incomeBoxK}>主动收入 (E/S)</Text>
            <Text style={[styles.incomeBoxV, { color: text }]}>{formatMoney(metrics.activeIncome)}</Text>
          </Pressable>
          <Pressable
            onPress={() => onNavigate('detail_passive')}
            style={({ pressed }) => [
              styles.incomeBox,
              styles.incomeBoxPassiveWrap,
              {
                backgroundColor: isDark ? 'rgba(16,185,129,0.15)' : '#ecfdf5',
                borderColor: isDark ? 'rgba(16,185,129,0.4)' : '#a7f3d0',
                opacity: pressed ? 0.85 : 1,
              },
            ]}>
            <Text style={styles.incomeBoxKPassive}>被动收入 (B/I)</Text>
            <Text style={[styles.incomeBoxV, { color: text }]}>{formatMoney(metrics.totalPassiveIncome)}</Text>
          </Pressable>
        </View>
        <View style={styles.arrowCenter}>
          <MaterialIcons name="expand-more" size={26} color="#cbd5e1" />
        </View>
        <View style={styles.incomeRow}>
          <Pressable
            onPress={() => onNavigate('detail_asset')}
            style={({ pressed }) => [
              styles.flowBox,
              {
                backgroundColor: isDark ? 'rgba(16,185,129,0.12)' : '#f0fdf4',
                borderColor: '#6ee7b7',
                opacity: pressed ? 0.85 : 1,
              },
            ]}>
            <Text style={styles.flowBoxK}>资产 (流入口袋)</Text>
            <Text style={styles.flowBoxAsset}>+{formatMoney(metrics.assetInflow)}</Text>
          </Pressable>
          <Pressable
            onPress={() => onNavigate('detail_liability')}
            style={({ pressed }) => [
              styles.flowBox,
              {
                backgroundColor: isDark ? 'rgba(244,63,94,0.12)' : '#fff1f2',
                borderColor: '#fda4af',
                opacity: pressed ? 0.85 : 1,
              },
            ]}>
            <Text style={styles.flowBoxKL}>负债 (把钱掏走)</Text>
            <Text style={styles.flowBoxLiab}>-{formatMoney(metrics.liabilityOutflow)}</Text>
          </Pressable>
        </View>
        <View style={styles.arrowCenter}>
          <MaterialIcons name="expand-more" size={26} color="#cbd5e1" />
        </View>
        <Pressable
          onPress={() => onNavigate('detail_expense')}
          style={({ pressed }) => [
            styles.expenseBlock,
            {
              backgroundColor: isDark ? 'rgba(245,158,11,0.12)' : '#fffbeb',
              borderColor: isDark ? 'rgba(245,158,11,0.35)' : '#fcd34d',
              opacity: pressed ? 0.88 : 1,
            },
          ]}>
          <Text style={styles.expenseK}>总流出 (生活+还款)</Text>
          <Text style={[styles.expenseV, { color: text }]}>{formatMoney(metrics.totalExpenses)}</Text>
          <Text style={[styles.expenseHint, { color: subtle }]}>
            留存的现金将被通胀侵蚀，除非买入资产
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

type DetailTab =
  | 'detail_active'
  | 'detail_passive'
  | 'detail_asset'
  | 'detail_liability'
  | 'detail_expense';

type DetailListItem = {
  name: string;
  amount: string;
  tag: string;
  sub?: string;
  colorOverride?: 'rose';
};

type DetailColorKey = 'blue' | 'emerald' | 'rose' | 'amber';

function buildDetailConfig(detailType: DetailTab, state: CashFlowState, metrics: Metrics) {
  let color: DetailColorKey = 'blue';
  let title = '';
  let icon: keyof typeof MaterialIcons.glyphMap = 'info';
  let totalDisplay = '';
  let quote = '';
  let items: DetailListItem[] = [];

  if (detailType === 'detail_active') {
    color = 'blue';
    title = '主动收入 (E/S)';
    icon = 'fitness-center';
    totalDisplay = formatMoney(metrics.activeIncome);
    quote = '“工薪阶层用时间换钱。只要你停止工作，收入就会停止。这是危险的。”';
    items = state.incomes
      .filter((i) => ['E', 'S'].includes(i.quadrant))
      .map((i) => ({
        name: i.name,
        amount: formatMoney(i.amount),
        tag: `象限 ${i.quadrant}`,
      }));
  } else if (detailType === 'detail_passive') {
    color = 'emerald';
    title = '被动收入 (B/I)';
    icon = 'emoji-events';
    totalDisplay = formatMoney(metrics.totalPassiveIncome);
    quote = '“被动收入是财富的终极标志。哪怕你正在睡觉，钱也在为你工作。”';
    const pureBI = state.incomes
      .filter((i) => ['B', 'I'].includes(i.quadrant))
      .map((i) => ({
        name: i.name,
        amount: formatMoney(i.amount),
        tag: `象限 ${i.quadrant}`,
      }));
    const assetFlows = metrics.categorizedHoldings
      .filter((h) => h.isAsset)
      .map((h) => ({
        name: h.name,
        amount: `+${formatMoney(h.netCashflow)}`,
        tag: '资产净流入',
      }));
    items = [...pureBI, ...assetFlows];
  } else if (detailType === 'detail_asset') {
    color = 'emerald';
    title = '资产 (流入项)';
    icon = 'eco';
    totalDisplay = `+${formatMoney(metrics.assetInflow)}`;
    quote = '“富人买入资产。真正的资产不需要你的干预，每个月都能把钱放进你的口袋。”';
    items = metrics.categorizedHoldings
      .filter((h) => h.isAsset)
      .map((h) => ({
        name: h.name,
        amount: `+${formatMoney(h.netCashflow)}`,
        tag: '净现金流',
        sub: `本金: ${formatMoney(h.principal)}`,
      }));
  } else if (detailType === 'detail_liability') {
    color = 'rose';
    title = '负债 (流出项)';
    icon = 'mood-bad';
    totalDisplay = `-${formatMoney(metrics.liabilityOutflow)}`;
    quote = '“中产阶级买入他们以为是资产的负债。任何从你口袋里掏钱的东西，都是负债。”';
    items = metrics.categorizedHoldings
      .filter((h) => !h.isAsset)
      .map((h) => ({
        name: h.name,
        amount: `-${formatMoney(Math.abs(h.netCashflow))}`,
        tag: '月度消耗',
        sub: `余额: ${formatMoney(h.principal)}`,
      }));
  } else if (detailType === 'detail_expense') {
    color = 'amber';
    title = '总流出';
    icon = 'payments';
    totalDisplay = formatMoney(metrics.totalExpenses);
    quote = '“减少不必要的开支，降低你的财务底线，你就能更快达到财务自由。”';
    items = [
      { name: '必要生活支出', amount: formatMoney(state.necessaryExpenses), tag: '生存底线' },
      { name: '非必要消费', amount: formatMoney(state.unnecessaryExpenses), tag: '拿铁因子' },
      {
        name: '负债还款消耗',
        amount: formatMoney(metrics.liabilityOutflow),
        tag: '现金流黑洞',
        colorOverride: 'rose',
      },
    ];
  }

  return { color, title, icon, totalDisplay, quote, items };
}

const DETAIL_PALETTE: Record<
  DetailColorKey,
  { accent: string; light: string; border: string; iconBg: string }
> = {
  blue: {
    accent: '#2563eb',
    light: 'rgba(59,130,246,0.12)',
    border: '#bfdbfe',
    iconBg: 'rgba(59,130,246,0.08)',
  },
  emerald: {
    accent: '#059669',
    light: 'rgba(16,185,129,0.12)',
    border: '#a7f3d0',
    iconBg: 'rgba(16,185,129,0.08)',
  },
  rose: {
    accent: '#f43f5e',
    light: 'rgba(244,63,94,0.12)',
    border: '#fecdd3',
    iconBg: 'rgba(244,63,94,0.08)',
  },
  amber: {
    accent: '#d97706',
    light: 'rgba(245,158,11,0.15)',
    border: '#fcd34d',
    iconBg: 'rgba(245,158,11,0.1)',
  },
};

function FlowDetail({
  detailType,
  state,
  metrics,
  surface,
  text,
  subtle,
  border,
  isDark,
}: {
  detailType: ActiveTab;
  state: CashFlowState;
  metrics: Metrics;
  surface: string;
  text: string;
  subtle: string;
  border: string;
  isDark: boolean;
}) {
  const tab = detailType as DetailTab;
  const config = useMemo(() => buildDetailConfig(tab, state, metrics), [tab, state, metrics]);
  const palette = DETAIL_PALETTE[config.color];

  return (
    <View style={styles.detailSection}>
      <View
        style={[
          styles.detailHero,
          {
            backgroundColor: surface,
            borderColor: palette.border,
          },
        ]}>
        <MaterialIcons
          name={config.icon}
          size={88}
          color={palette.iconBg}
          style={styles.detailHeroWatermark}
        />
        <Text style={[styles.detailHeroKicker, { color: subtle }]}>{config.title}汇总</Text>
        <Text style={[styles.detailHeroTotal, { color: palette.accent }]}>{config.totalDisplay}</Text>
      </View>

      <Text style={[styles.detailListTitle, { color: subtle }]}>构成明细</Text>
      {config.items.length === 0 ? (
        <View style={[styles.detailEmpty, { borderColor: border }]}>
          <Text style={[styles.detailEmptyText, { color: subtle }]}>暂无数据</Text>
        </View>
      ) : (
        config.items.map((item, idx) => (
          <View
            key={`${item.name}-${idx}`}
            style={[styles.detailRow, { backgroundColor: surface, borderColor: border }]}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={[styles.detailRowName, { color: text }]}>{item.name}</Text>
              {item.sub ? <Text style={[styles.detailRowSub, { color: subtle }]}>{item.sub}</Text> : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text
                style={[
                  styles.detailRowAmount,
                  { color: item.colorOverride === 'rose' ? '#f43f5e' : text },
                ]}>
                {item.amount}
              </Text>
              <View style={[styles.detailTag, { backgroundColor: palette.light }]}>
                <Text style={[styles.detailTagText, { color: palette.accent }]}>{item.tag}</Text>
              </View>
            </View>
          </View>
        ))
      )}

      <View style={[styles.detailInsight, { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#f1f5f9', borderColor: border }]}>
        <View style={styles.detailInsightBadge}>
          <Text style={styles.detailInsightBadgeText}>富爸爸洞察</Text>
        </View>
        <Text style={[styles.detailInsightBody, { color: subtle }]}>{config.quote}</Text>
      </View>
    </View>
  );
}

function MobileEntry({
  setState,
  showToast,
  surface,
  text,
  subtle,
  border,
  isDark,
}: {
  setState: React.Dispatch<React.SetStateAction<CashFlowState>>;
  showToast: (m: string, t?: 'success' | 'warning') => void;
  surface: string;
  text: string;
  subtle: string;
  border: string;
  isDark: boolean;
}) {
  const [entryType, setEntryType] = useState<'income' | 'expense'>('income');
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [quadrant, setQuadrant] = useState<Quadrant>('E');
  const [expenseType, setExpenseType] = useState<ExpenseFlowType>('necessary');

  const submit = () => {
    const n = parseFloat(amount.replace(/,/g, ''));
    if (!amount.trim() || !Number.isFinite(n)) {
      showToast('请输入有效金额', 'warning');
      return;
    }
    if (entryType === 'income') {
      const newIncome: IncomeItem = {
        id: Date.now(),
        name: name.trim() || '新增收入',
        amount: n,
        quadrant,
      };
      setState((prev) => ({ ...prev, incomes: [...prev.incomes, newIncome] }));
      showToast('收入记录成功！请优先支付自己，买入资产！', 'warning');
    } else {
      if (expenseType === 'necessary') {
        setState((prev) => ({ ...prev, necessaryExpenses: prev.necessaryExpenses + n }));
      } else if (expenseType === 'unnecessary') {
        setState((prev) => ({ ...prev, unnecessaryExpenses: prev.unnecessaryExpenses + n }));
      } else if (expenseType === 'asset') {
        showToast('太棒了！请前往[台账]模块详细登记资产。', 'success');
      } else {
        showToast('记录成功。减少负债也能增加现金流。', 'success');
      }
      if (expenseType !== 'asset') showToast('支出已记录。', 'success');
    }
    setAmount('');
    setName('');
  };

  const quadOptions: { id: Quadrant; label: string; desc: string }[] = [
    { id: 'E', label: 'E 员工', desc: '时间换钱' },
    { id: 'S', label: 'S 自由职业', desc: '为自己工作' },
    { id: 'B', label: 'B 企业主', desc: '系统为你工作' },
    { id: 'I', label: 'I 投资者', desc: '钱为你工作' },
  ];

  const expenseOptions: { id: ExpenseFlowType; icon: string; label: string; desc: string }[] = [
    { id: 'asset', icon: '🌱', label: '资产投入', desc: '买入产生现金流的标的' },
    { id: 'liability', icon: '💳', label: '负债偿还', desc: '房贷/车贷/信用卡等' },
    { id: 'necessary', icon: '🏠', label: '必要支出', desc: '生存底线刚需开支' },
    { id: 'unnecessary', icon: '🛍️', label: '非必要消费', desc: '拿铁因子/冲动消费' },
  ];

  return (
    <View style={styles.section}>
      <View style={[styles.segment, { backgroundColor: '#e2e8f0' }]}>
        <Pressable
          onPress={() => setEntryType('income')}
          style={[
            styles.segmentBtn,
            entryType === 'income' && { backgroundColor: surface, shadowOpacity: 0.08, shadowRadius: 4 },
          ]}>
          <Text style={[styles.segmentText, { color: entryType === 'income' ? '#2563eb' : subtle }]}>录入收入</Text>
        </Pressable>
        <Pressable
          onPress={() => setEntryType('expense')}
          style={[
            styles.segmentBtn,
            entryType === 'expense' && { backgroundColor: surface, shadowOpacity: 0.08, shadowRadius: 4 },
          ]}>
          <Text style={[styles.segmentText, { color: entryType === 'expense' ? '#d97706' : subtle }]}>录入去向</Text>
        </Pressable>
      </View>

      <View style={[styles.card, { backgroundColor: surface, borderColor: border, marginTop: 12 }]}>
        <Text style={[styles.inputLabel, { color: subtle }]}>金额 (¥)</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor="#cbd5e1"
          style={[styles.inputAmount, { color: text, borderColor: border, backgroundColor: isDark ? 'rgba(15,23,42,0.5)' : '#f8fafc' }]}
        />
        <Text style={[styles.inputLabel, { color: subtle, marginTop: 14 }]}>简短描述</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={entryType === 'income' ? '如：私活收入' : '如：打车费'}
          placeholderTextColor="#cbd5e1"
          style={[styles.inputName, { color: text, borderColor: border, backgroundColor: isDark ? 'rgba(15,23,42,0.5)' : '#f8fafc' }]}
        />
      </View>

      <View style={[styles.card, { backgroundColor: surface, borderColor: border, marginTop: 12 }]}>
        {entryType === 'income' ? (
          <>
            <Text style={[styles.blockTitle, { color: subtle }]}>ESBI 象限归属</Text>
            <View style={styles.quadGrid}>
              {quadOptions.map((q) => (
                <Pressable
                  key={q.id}
                  onPress={() => setQuadrant(q.id)}
                  style={[
                    styles.quadCell,
                    {
                      borderColor: quadrant === q.id ? (['E', 'S'].includes(q.id) ? '#93c5fd' : '#6ee7b7') : border,
                      backgroundColor:
                        quadrant === q.id
                          ? ['E', 'S'].includes(q.id)
                            ? 'rgba(59,130,246,0.12)'
                            : 'rgba(16,185,129,0.12)'
                          : isDark
                            ? 'rgba(15,23,42,0.4)'
                            : '#f8fafc',
                    },
                  ]}>
                  <Text style={[styles.quadLabel, { color: text }]}>{q.label}</Text>
                  <Text style={[styles.quadDesc, { color: subtle }]}>{q.desc}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.blockTitle, { color: subtle }]}>资金流向 (四类)</Text>
            {expenseOptions.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => setExpenseType(t.id)}
                style={[
                  styles.expOption,
                  {
                    borderColor: expenseType === t.id ? '#fcd34d' : border,
                    backgroundColor: expenseType === t.id ? 'rgba(245,158,11,0.12)' : isDark ? 'rgba(15,23,42,0.4)' : '#f8fafc',
                  },
                ]}>
                <Text style={styles.expIcon}>{t.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.expLabel, { color: text }]}>{t.label}</Text>
                  <Text style={[styles.expDesc, { color: subtle }]}>{t.desc}</Text>
                </View>
                {expenseType === t.id ? <MaterialIcons name="check-circle" size={20} color="#f59e0b" /> : null}
              </Pressable>
            ))}
          </>
        )}
      </View>

      <Pressable
        onPress={submit}
        style={({ pressed }) => [
          styles.submitBtn,
          { backgroundColor: entryType === 'income' ? '#2563eb' : '#f59e0b', opacity: pressed ? 0.9 : 1 },
        ]}>
        <Text style={styles.submitBtnText}>确认记录</Text>
      </Pressable>
    </View>
  );
}

function MobileLedger({
  metrics,
  surface,
  text,
  subtle,
  border,
}: {
  metrics: Metrics;
  surface: string;
  text: string;
  subtle: string;
  border: string;
}) {
  const [view, setView] = useState<'assets' | 'liabilities'>('assets');
  const assets = metrics.categorizedHoldings.filter((h) => h.isAsset);
  const liabilities = metrics.categorizedHoldings.filter((h) => !h.isAsset);

  return (
    <View style={styles.section}>
      <View style={styles.ledgerTabs}>
        <Pressable
          onPress={() => setView('assets')}
          style={[
            styles.ledgerTab,
            view === 'assets' ? { backgroundColor: '#10b981' } : { backgroundColor: surface, borderColor: border, borderWidth: 1 },
          ]}>
          <MaterialIcons name="eco" size={16} color={view === 'assets' ? '#fff' : subtle} />
          <Text style={[styles.ledgerTabText, { color: view === 'assets' ? '#fff' : subtle }]}>资产 ({assets.length})</Text>
        </Pressable>
        <Pressable
          onPress={() => setView('liabilities')}
          style={[
            styles.ledgerTab,
            view === 'liabilities' ? { backgroundColor: '#f43f5e' } : { backgroundColor: surface, borderColor: border, borderWidth: 1 },
          ]}>
          <MaterialIcons name="fitness-center" size={16} color={view === 'liabilities' ? '#fff' : subtle} />
          <Text style={[styles.ledgerTabText, { color: view === 'liabilities' ? '#fff' : subtle }]}>
            负债 ({liabilities.length})
          </Text>
        </Pressable>
      </View>

      {view === 'assets' ? (
        assets.length === 0 ? (
          <View style={[styles.emptyLedger, { borderColor: border }]}>
            <Text style={[styles.emptyLedgerText, { color: subtle }]}>
              暂无带来正向现金流的资产{'\n'}请优先投资自己！
            </Text>
          </View>
        ) : (
          assets.map((a) => (
            <View key={a.id} style={[styles.ledgerCard, { backgroundColor: surface, borderColor: border, borderLeftColor: '#10b981', borderLeftWidth: 5 }]}>
              <Text style={[styles.ledgerName, { color: text }]}>{a.name}</Text>
              <View style={styles.ledgerRow}>
                <Text style={[styles.ledgerMuted, { color: subtle }]}>买入本金</Text>
                <Text style={[styles.ledgerVal, { color: text }]}>¥{a.principal.toLocaleString('zh-CN')}</Text>
              </View>
              <View style={styles.ledgerRow}>
                <Text style={[styles.ledgerMuted, { color: subtle }]}>月均流入</Text>
                <Text style={styles.ledgerPos}>+¥{a.inflow}</Text>
              </View>
              <View style={styles.ledgerRow}>
                <Text style={[styles.ledgerMuted, { color: subtle }]}>月均成本</Text>
                <Text style={styles.ledgerNeg}>-¥{a.outflow}</Text>
              </View>
              <View style={[styles.ledgerFoot, { borderTopColor: border, backgroundColor: 'rgba(16,185,129,0.08)' }]}>
                <Text style={[styles.ledgerFootLabel, { color: subtle }]}>净现金流贡献</Text>
                <Text style={styles.ledgerFootPos}>+¥{a.netCashflow}</Text>
              </View>
            </View>
          ))
        )
      ) : liabilities.length === 0 ? (
        <View style={[styles.emptyLedger, { borderColor: border }]}>
          <Text style={[styles.emptyLedgerText, { color: subtle }]}>暂无负债项</Text>
        </View>
      ) : (
        liabilities.map((l) => (
          <View key={l.id} style={[styles.ledgerCard, { backgroundColor: surface, borderColor: border, borderLeftColor: '#f43f5e', borderLeftWidth: 5 }]}>
            <Text style={[styles.ledgerName, { color: text }]}>{l.name}</Text>
            <View style={styles.ledgerRow}>
              <Text style={[styles.ledgerMuted, { color: subtle }]}>总余额</Text>
              <Text style={[styles.ledgerVal, { color: text }]}>¥{l.principal.toLocaleString('zh-CN')}</Text>
            </View>
            <View style={styles.ledgerRow}>
              <Text style={[styles.ledgerMuted, { color: subtle }]}>月均还款/消耗</Text>
              <Text style={styles.ledgerNeg}>-¥{l.outflow}</Text>
            </View>
            <View style={[styles.ledgerFoot, { borderTopColor: border, backgroundColor: 'rgba(244,63,94,0.08)' }]}>
              <Text style={[styles.ledgerFootLabel, { color: subtle }]}>现金流流失</Text>
              <Text style={styles.ledgerNegBig}>-¥{Math.abs(l.netCashflow)}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function MobileSimulator({
  state,
  currentMetrics,
  surface,
  text,
  subtle,
  border,
  isDark,
}: {
  state: CashFlowState;
  currentMetrics: Metrics;
  surface: string;
  text: string;
  subtle: string;
  border: string;
  isDark: boolean;
}) {
  const [simName, setSimName] = useState('买辆车');
  const [simPrincipal, setSimPrincipal] = useState('200000');
  const [simInflow, setSimInflow] = useState('0');
  const [simOutflow, setSimOutflow] = useState('4000');

  const simulatedState = useMemo(() => {
    const principal = parseFloat(simPrincipal) || 0;
    const inf = parseFloat(simInflow) || 0;
    const outf = parseFloat(simOutflow) || 0;
    return {
      ...state,
      holdings: [...state.holdings, { id: 999, name: simName || '模拟项', principal, inflow: inf, outflow: outf }],
    };
  }, [state, simName, simPrincipal, simInflow, simOutflow]);

  const simMetrics = useMemo(() => calculateMetrics(simulatedState), [simulatedState]);
  const infNum = parseFloat(simInflow) || 0;
  const outNum = parseFloat(simOutflow) || 0;
  const isAsset = infNum > outNum;
  const isPositiveDecision = simMetrics.freedomProgress >= currentMetrics.freedomProgress;

  return (
    <View style={styles.section}>
      <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
        <View style={styles.simTitleRow}>
          <MaterialIcons name="science" size={20} color="#9333ea" />
          <Text style={[styles.simTitle, { color: text }]}>输入模拟决策参数</Text>
        </View>
        <Text style={[styles.simLabel, { color: subtle }]}>假设我要...</Text>
        <TextInput
          value={simName}
          onChangeText={setSimName}
          style={[styles.simInput, { color: text, borderColor: border, backgroundColor: isDark ? 'rgba(15,23,42,0.5)' : '#f8fafc' }]}
        />
        <Text style={[styles.simLabel, { color: subtle }]}>总价/贷款金额</Text>
        <TextInput
          value={simPrincipal}
          onChangeText={setSimPrincipal}
          keyboardType="decimal-pad"
          style={[styles.simInput, { color: text, borderColor: border, backgroundColor: isDark ? 'rgba(15,23,42,0.5)' : '#f8fafc' }]}
        />
        <View style={styles.simRow2}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.simLabel, { color: subtle }]}>预计月流入</Text>
            <TextInput
              value={simInflow}
              onChangeText={setSimInflow}
              keyboardType="decimal-pad"
              style={[styles.simInput, { color: '#059669', borderColor: border, backgroundColor: isDark ? 'rgba(15,23,42,0.5)' : '#f8fafc' }]}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.simLabel, { color: subtle }]}>预计月流出</Text>
            <TextInput
              value={simOutflow}
              onChangeText={setSimOutflow}
              keyboardType="decimal-pad"
              style={[styles.simInput, { color: '#f43f5e', borderColor: border, backgroundColor: isDark ? 'rgba(15,23,42,0.5)' : '#f8fafc' }]}
            />
          </View>
        </View>
        <View style={[styles.simVerdict, { backgroundColor: isAsset ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.12)', borderColor: isAsset ? '#6ee7b7' : '#fda4af' }]}>
          <Text style={[styles.simVerdictText, { color: isAsset ? '#047857' : '#be123c' }]}>
            系统判定: 这是一项 {isAsset ? '资产 🌱' : '负债 💣'}
          </Text>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
        <Text style={[styles.simImpactTitle, { color: text }]}>长期影响预判</Text>
        <View style={[styles.simImpactRow, { borderBottomColor: border }]}>
          <Text style={[styles.simImpactLabel, { color: subtle }]}>自由现金流</Text>
          <View style={styles.simImpactVals}>
            <Text style={[styles.simStrike, { color: subtle }]}>{formatMoney(currentMetrics.freeCashFlow)}</Text>
            <MaterialIcons name="arrow-forward" size={14} color="#cbd5e1" />
            <Text style={[styles.simImpactNum, { color: simMetrics.freeCashFlow >= currentMetrics.freeCashFlow ? '#059669' : '#f43f5e' }]}>
              {formatMoney(simMetrics.freeCashFlow)}
            </Text>
          </View>
        </View>
        <View style={[styles.simImpactRow, { borderBottomColor: border }]}>
          <Text style={[styles.simImpactLabel, { color: subtle }]}>财务自由进度</Text>
          <View style={styles.simImpactVals}>
            <Text style={[styles.simStrike, { color: subtle }]}>{currentMetrics.freedomProgress.toFixed(1)}%</Text>
            <MaterialIcons name="arrow-forward" size={14} color="#cbd5e1" />
            <Text style={[styles.simImpactNum, { color: isPositiveDecision ? '#059669' : '#f43f5e' }]}>
              {simMetrics.freedomProgress.toFixed(1)}%
            </Text>
          </View>
        </View>
        <View style={[styles.simComment, { backgroundColor: isDark ? 'rgba(148,163,184,0.1)' : '#f8fafc', borderColor: border }]}>
          <Text style={[styles.simCommentText, { color: subtle }]}>
            <Text style={{ fontWeight: '800', color: '#2563eb' }}>点评：</Text>
            {isPositiveDecision
              ? '好决定！它每月都在把钱放进你的口袋，加速财务自由。'
              : '警告！这会增加每月流出。这就是中产阶级陷入老鼠赛跑的原因——买入了看似资产的负债。请三思！'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBack: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  headerBackTitle: { fontSize: 15, fontWeight: '800' },
  headerBrand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flex: 1 },
  headerExit: { width: 36, height: 36, justifyContent: 'center' },
  headerBrandMid: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, justifyContent: 'center' },
  headerLogo: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#f59e0b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '900', letterSpacing: 0.5 },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  toastText: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16 },
  section: { gap: 0 },
  heroCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
    overflow: 'hidden',
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  heroKicker: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  heroPct: { fontSize: 40, fontWeight: '900' },
  heroPctUnit: { fontSize: 20, fontWeight: '700' },
  patternPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '46%',
  },
  patternPillText: { fontSize: 11, fontWeight: '800' },
  progressTrack: { height: 10, borderRadius: 999, marginBottom: 16, overflow: 'hidden' },
  progressFill: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#fbbf24',
  },
  heroFoot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  heroFootLabel: { fontSize: 11, marginBottom: 4 },
  heroFootValPassive: { fontSize: 15, fontWeight: '800', color: '#059669' },
  heroFootVal: { fontSize: 15, fontWeight: '800' },
  grid2: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    alignSelf: 'stretch',
  },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  statKicker: { fontSize: 11, fontWeight: '600' },
  statVal: { fontSize: 20, fontWeight: '800' },
  entryWide: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  entryIconBox: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  entryTitle: { fontSize: 15, fontWeight: '800' },
  entrySub: { fontSize: 11, marginTop: 2 },
  entryRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  freqBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  freqBadgeText: { fontSize: 10, fontWeight: '800', color: '#2563eb' },
  tileBtn: {
    flex: 1,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    minHeight: 120,
    minWidth: 0,
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginBottom: 10,
  },
  tileTitle: { fontSize: 14, fontWeight: '800', marginBottom: 8 },
  tileFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' },
  tileSub: { fontSize: 11 },
  waterfallHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 8,
    paddingHorizontal: 2,
  },
  waterfallTitle: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  waterfallHint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  waterfallHintText: { fontSize: 10 },
  incomeBoxPassiveWrap: { overflow: 'hidden' },
  waterfallCard: { borderRadius: 24, borderWidth: 1, padding: 18, gap: 12 },
  incomeRow: { flexDirection: 'row', gap: 10 },
  incomeBox: {
    flex: 1,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  incomeBoxK: { fontSize: 11, color: '#2563eb', fontWeight: '600', marginBottom: 6 },
  incomeBoxKPassive: { fontSize: 11, color: '#059669', fontWeight: '600', marginBottom: 6 },
  incomeBoxV: { fontSize: 15, fontWeight: '800' },
  arrowCenter: { alignItems: 'center', paddingVertical: 2 },
  flowBox: {
    flex: 1,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  flowBoxK: { fontSize: 11, color: '#059669', fontWeight: '800', marginBottom: 6 },
  flowBoxKL: { fontSize: 11, color: '#f43f5e', fontWeight: '800', marginBottom: 6 },
  flowBoxAsset: { fontSize: 16, fontWeight: '900', color: '#059669' },
  flowBoxLiab: { fontSize: 16, fontWeight: '900', color: '#f43f5e' },
  expenseBlock: { padding: 16, borderRadius: 16, borderWidth: 1, alignItems: 'center', width: '100%' },
  expenseK: { fontSize: 11, color: '#d97706', fontWeight: '800', marginBottom: 6 },
  expenseV: { fontSize: 22, fontWeight: '900' },
  expenseHint: { fontSize: 10, marginTop: 8, textAlign: 'center' },
  segment: { flexDirection: 'row', borderRadius: 14, padding: 4, marginBottom: 4 },
  segmentBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  segmentText: { fontSize: 14, fontWeight: '800' },
  inputLabel: { fontSize: 12, fontWeight: '700', marginBottom: 8 },
  inputAmount: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 28,
    fontWeight: '900',
  },
  inputName: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
  blockTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: 12 },
  quadGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quadCell: {
    width: '47%',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  quadLabel: { fontSize: 13, fontWeight: '800', marginBottom: 4 },
  quadDesc: { fontSize: 11 },
  expOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
    gap: 12,
  },
  expIcon: { fontSize: 22 },
  expLabel: { fontSize: 14, fontWeight: '800' },
  expDesc: { fontSize: 11, marginTop: 2 },
  submitBtn: {
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  ledgerTabs: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  ledgerTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 16,
  },
  ledgerTabText: { fontSize: 13, fontWeight: '800' },
  emptyLedger: {
    padding: 32,
    borderRadius: 24,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  emptyLedgerText: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  ledgerCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    marginBottom: 12,
    overflow: 'hidden',
  },
  ledgerName: { fontSize: 16, fontWeight: '800', marginBottom: 12 },
  ledgerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  ledgerMuted: { fontSize: 12 },
  ledgerVal: { fontSize: 12, fontWeight: '700' },
  ledgerPos: { fontSize: 12, fontWeight: '700', color: '#059669' },
  ledgerNeg: { fontSize: 12, fontWeight: '700', color: '#f43f5e' },
  ledgerFoot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginHorizontal: -18,
    marginBottom: -18,
    paddingHorizontal: 18,
    paddingBottom: 18,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  ledgerFootLabel: { fontSize: 12, fontWeight: '700' },
  ledgerFootPos: { fontSize: 18, fontWeight: '900', color: '#059669' },
  ledgerNegBig: { fontSize: 18, fontWeight: '900', color: '#f43f5e' },
  simTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  simTitle: { fontSize: 14, fontWeight: '800' },
  simLabel: { fontSize: 11, fontWeight: '700', marginBottom: 6, marginTop: 8 },
  simInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  simRow2: { flexDirection: 'row', gap: 12 },
  simVerdict: { padding: 14, borderRadius: 16, borderWidth: 1, marginTop: 16, alignItems: 'center' },
  simVerdictText: { fontSize: 13, fontWeight: '800' },
  simImpactTitle: { fontSize: 14, fontWeight: '800', marginBottom: 16 },
  simImpactRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    marginBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  simImpactLabel: { fontSize: 12, fontWeight: '600' },
  simImpactVals: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  simStrike: { fontSize: 13, textDecorationLine: 'line-through' },
  simImpactNum: { fontSize: 18, fontWeight: '900' },
  simComment: { padding: 14, borderRadius: 16, borderWidth: 1, marginTop: 4 },
  simCommentText: { fontSize: 13, lineHeight: 20 },
  detailSection: { gap: 12, paddingBottom: 8 },
  detailHero: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
    overflow: 'hidden',
    position: 'relative',
  },
  detailHeroWatermark: { position: 'absolute', top: 8, right: 8, opacity: 0.35 },
  detailHeroKicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  detailHeroTotal: { fontSize: 36, fontWeight: '900' },
  detailListTitle: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  detailEmpty: {
    padding: 28,
    borderRadius: 24,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  detailEmptyText: { fontSize: 14 },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 10,
  },
  detailRowName: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  detailRowSub: { fontSize: 11 },
  detailRowAmount: { fontSize: 17, fontWeight: '900' },
  detailTag: {
    alignSelf: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginTop: 6,
  },
  detailTagText: { fontSize: 10, fontWeight: '700' },
  detailInsight: {
    marginTop: 12,
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
    paddingTop: 22,
    position: 'relative',
  },
  detailInsightBadge: {
    position: 'absolute',
    top: -12,
    left: 16,
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
  },
  detailInsightBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  detailInsightBody: { fontSize: 13, lineHeight: 22, fontWeight: '600', marginTop: 4 },
});
