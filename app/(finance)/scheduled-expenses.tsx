import {
  FoldBreathe,
  FoldCountUpText,
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { FinanceFoldSwitch } from '@/components/finance/finance-fold-switch';
import { Skeleton } from '@/components/ui';
import { Layout } from '@/constants/design-tokens';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { ymdFromDatetime } from '@/lib/api-mysql-datetime';
import { fetchFinanceCatalog } from '@/lib/finance-page-api';
import {
  deleteScheduledFinanceExpense,
  describeScheduledFinanceExpense,
  estimateScheduledExpenseAmountInRange,
  findNextScheduledExpenseOccurrence,
  loadScheduledFinanceExpenses,
  sumScheduledExpensesInRange,
  upsertScheduledFinanceExpense,
  type ScheduledFinanceExpense,
} from '@/lib/finance-scheduled-expense';
import { scheduleRunScheduledFinanceExpenses } from '@/lib/finance-scheduled-expense-runner';
import {
  FINANCE_TXN_EXTRA_SCHEDULED_EXPENSE_AUTO,
  getScheduledExpenseIdFromTxnExtra,
} from '@/lib/repositories/finance/finance-transaction-extra';
import { getFinanceTransactions } from '@/lib/repositories/finance/finance';
import type {
  FinanceAccountBalanceRow,
  FinanceTransactionRow,
} from '@/lib/repositories/finance/finance.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'scheduled-expenses';

const TEMPLATES = [
  { key: 'rent', label: '房租', sub: '每月 1 日', icon: 'home' as const },
  { key: 'membership', label: '会员', sub: '每月自动续', icon: 'notifications-none' as const },
  { key: 'insurance', label: '保险', sub: '年度折月', icon: 'verified-user' as const },
];

type ItemVisual = {
  icon: keyof typeof MaterialIcons.glyphMap;
  bg: string;
  fg: string;
};

function formatMoney0(amount: number): string {
  const abs = Math.abs(amount);
  return `¥${abs.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}

function formatMoney2(amount: number): string {
  const abs = Math.abs(amount);
  return `¥${abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function itemVisual(name: string, enabled: boolean, isDark: boolean): ItemVisual {
  const n = name.toLowerCase();
  if (!enabled) {
    return {
      icon: 'notifications-none',
      bg: isDark ? 'rgba(235,219,189,0.1)' : '#EEEAE1',
      fg: isDark ? '#8E938C' : '#8E938C',
    };
  }
  if (/房|租|home|rent/.test(n)) {
    return { icon: 'home', bg: isDark ? 'rgba(216,154,77,0.18)' : '#F4E9D7', fg: '#9D6D2D' };
  }
  if (/健身|gym|flame|运动/.test(n)) {
    return { icon: 'local-fire-department', bg: isDark ? 'rgba(86,121,130,0.22)' : '#E7EEF0', fg: '#567982' };
  }
  if (/音乐|云|会员|subscribe|icloud|apple/.test(n)) {
    return { icon: 'notifications-none', bg: isDark ? 'rgba(121,100,126,0.22)' : '#EDE8F1', fg: '#79647E' };
  }
  return { icon: 'event-repeat', bg: isDark ? 'rgba(134,167,149,0.2)' : '#E8EFE9', fg: '#4A6B59' };
}

function metaLine(
  item: ScheduledFinanceExpense,
  accountName: string,
): string {
  const base = describeScheduledFinanceExpense(item)
    .replace(/\s+/g, ' ')
    .trim();
  const withhold = item.includeInBudget ? '预扣' : '不预扣';
  return `${base} · ${accountName} · ${withhold}`;
}

function isAutoScheduledTxn(txn: FinanceTransactionRow): boolean {
  if (!txn.extra_data) return false;
  try {
    const raw = JSON.parse(txn.extra_data) as Record<string, unknown>;
    return raw[FINANCE_TXN_EXTRA_SCHEDULED_EXPENSE_AUTO] === true;
  } catch {
    return false;
  }
}

function formatTriggeredWhen(happenedAt: string): string {
  const ymd = ymdFromDatetime(happenedAt);
  if (!ymd) return happenedAt;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = happenedAt.match(/(\d{2}):(\d{2})/);
  const time = d ? `${d[1]}:${d[2]}` : '';
  return `${Number(m[2])}.${m[3]}${time ? ` ${time}` : ''}`;
}

function NextChip({
  enabled,
  label,
  flashKey,
  animate,
  mutedBg,
  mutedFg,
  activeBg,
  activeFg,
}: {
  enabled: boolean;
  label: string;
  flashKey: number;
  animate: boolean;
  mutedBg: string;
  mutedFg: string;
  activeBg: string;
  activeFg: string;
}) {
  const opacity = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (!animate || flashKey === 0) return;
    opacity.setValue(0.35);
    const anim = Animated.timing(opacity, {
      toValue: 1,
      duration: 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, flashKey, opacity]);

  return (
    <Animated.View
      style={[
        styles.nextChip,
        {
          backgroundColor: enabled ? activeBg : mutedBg,
          opacity,
        },
      ]}>
      {enabled ? <MaterialIcons name="calendar-today" size={10} color={activeFg} /> : null}
      <Text style={[styles.nextChipText, { color: enabled ? activeFg : mutedFg }]} numberOfLines={1}>
        {label}
      </Text>
    </Animated.View>
  );
}

function PageSkeleton({ paper2, line }: { paper2: string; line: string }) {
  return (
    <View style={styles.skeletonWrap}>
      <Skeleton width="100%" height={42} borderRadius={11} />
      <View style={[styles.sumCard, { backgroundColor: paper2, borderColor: line }]}>
        <Skeleton width={33} height={33} borderRadius={10} />
        <View style={{ flex: 1, gap: 8 }}>
          <Skeleton width="55%" height={18} borderRadius={6} />
          <Skeleton width="40%" height={10} borderRadius={5} />
        </View>
      </View>
      {Array.from({ length: 3 }).map((_, i) => (
        <View key={i} style={[styles.itemCard, { backgroundColor: paper2, borderColor: line }]}>
          <Skeleton width={29} height={29} borderRadius={9} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="50%" height={14} borderRadius={5} />
            <Skeleton width="80%" height={10} borderRadius={5} />
            <Skeleton width={72} height={16} borderRadius={5} />
          </View>
          <Skeleton width={46} height={28} borderRadius={14} />
        </View>
      ))}
    </View>
  );
}

export default function ScheduledExpensesScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ff, isDark, fonts: ffFonts } = useFinanceFoldTheme();
  const { animate: foldAnimate, motionReady } = useFoldMotionGate();

  const bg = ff.paper;
  const card = isDark ? ff.paper2 : ff.card;
  const paper2 = isDark ? ff.cardSoft : ff.paper2;
  const text = ff.ink;
  const subtle = ff.muted;
  const faint = ff.faint;
  const line = ff.line;
  const pine = ff.pine;
  const headerScrim = isDark ? 'rgba(23,43,36,0.94)' : 'rgba(243,238,228,0.94)';

  const [items, setItems] = React.useState<ScheduledFinanceExpense[]>([]);
  const [accounts, setAccounts] = React.useState<FinanceAccountBalanceRow[]>([]);
  const [transactions, setTransactions] = React.useState<FinanceTransactionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [entranceReady, setEntranceReady] = React.useState(false);
  const [nextFlash, setNextFlash] = React.useState<Record<string, number>>({});

  const reload = React.useCallback(
    async (forceRefresh = false) => {
      await wrapLoad(async () => {
        try {
          const [catalog, rows, txns] = await Promise.all([
            fetchFinanceCatalog({ serverFallback: true }),
            loadScheduledFinanceExpenses(),
            getFinanceTransactions({ cacheOnly: !forceRefresh }),
          ]);
          setItems(rows);
          setAccounts(catalog.accounts);
          setTransactions(txns);
        } catch (e) {
          console.warn('Failed to load scheduled expenses:', e);
        } finally {
          setLoading(false);
        }
      }, forceRefresh);
    },
    [wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    React.useCallback(() => {
      scheduleRunScheduledFinanceExpenses('scheduled-expenses-focus');
      void reload();
    }, [reload]),
  );

  React.useEffect(() => {
    if (loading || !motionReady) return;
    setEntranceReady(true);
  }, [loading, motionReady]);

  const motionOn = foldAnimate && entranceReady && !loading;
  const accountNameById = React.useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );

  const enabledCount = React.useMemo(() => items.filter((i) => i.enabled).length, [items]);

  const monthRange = React.useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start, end };
  }, []);

  const monthlyFixedTotal = React.useMemo(
    () =>
      items.reduce(
        (sum, item) =>
          sum +
          estimateScheduledExpenseAmountInRange(item, monthRange.start, monthRange.end, {
            onlyIncludeInBudget: false,
          }),
        0,
      ),
    [items, monthRange.end, monthRange.start],
  );

  const budgetWithheld = React.useMemo(
    () => sumScheduledExpensesInRange(items, monthRange.start, monthRange.end),
    [items, monthRange.end, monthRange.start],
  );

  const budgetItemCount = React.useMemo(
    () => items.filter((i) => i.enabled && i.includeInBudget).length,
    [items],
  );

  const monthTriggered = React.useMemo(() => {
    const startYmd = `${monthRange.start.getFullYear()}-${String(monthRange.start.getMonth() + 1).padStart(2, '0')}-01`;
    const endExclusive = monthRange.end;
    const endYmd = `${endExclusive.getFullYear()}-${String(endExclusive.getMonth() + 1).padStart(2, '0')}-${String(endExclusive.getDate()).padStart(2, '0')}`;
    return transactions
      .filter((t) => {
        if (!isAutoScheduledTxn(t)) return false;
        const ymd = ymdFromDatetime(t.happened_at);
        if (!ymd) return false;
        return ymd >= startYmd && ymd < endYmd;
      })
      .sort((a, b) => (a.happened_at < b.happened_at ? 1 : -1))
      .slice(0, 6);
  }, [monthRange.end, monthRange.start, transactions]);

  const handleToggle = React.useCallback(
    async (item: ScheduledFinanceExpense, enabled: boolean) => {
      try {
        await upsertScheduledFinanceExpense({ ...item, enabled });
        setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, enabled } : row)));
        setNextFlash((prev) => ({ ...prev, [item.id]: (prev[item.id] ?? 0) + 1 }));
        if (enabled) scheduleRunScheduledFinanceExpenses('toggle-on');
      } catch (e) {
        toast.error(toUserMessage(e, '保存失败，请稍后重试'));
      }
    },
    [],
  );

  const handleDelete = React.useCallback((item: ScheduledFinanceExpense) => {
    Alert.alert('删除定时支出', `确定删除「${item.name}」？已自动记下的流水不会删除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteScheduledFinanceExpense(item.id);
              setItems((prev) => prev.filter((row) => row.id !== item.id));
              toast.success('已删除该定时支出');
            } catch (e) {
              toast.error(toUserMessage(e, '删除失败，请稍后重试'));
            }
          })();
        },
      },
    ]);
  }, []);

  const openAdd = React.useCallback(
    (template?: string) => {
      if (template) {
        router.push({ pathname: '/add-scheduled-expense', params: { template } });
        return;
      }
      router.push('/add-scheduled-expense');
    },
    [router],
  );

  const headerSub =
    items.length === 0
      ? 'AUTOMATION · EMPTY'
      : `AUTOMATION · ${enabledCount} ACTIVE`;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['left', 'right']}>
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: headerScrim, borderBottomColor: line }]}>
        <View style={styles.headerInner}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.foldIconBtn,
              { borderColor: line, backgroundColor: card },
              pressed && { opacity: 0.85, transform: [{ scale: 0.94 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="返回">
            <MaterialIcons name="arrow-back" size={16} color={ff.ink2} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: text, fontFamily: ffFonts.serif }]}>定时支出</Text>
            <Text style={[styles.headerSub, { color: subtle }]} numberOfLines={1}>
              {headerSub}
            </Text>
          </View>
          <Pressable
            onPress={() => openAdd()}
            style={({ pressed }) => [
              styles.foldIconBtnDark,
              { backgroundColor: pine },
              pressed && { opacity: 0.9, transform: [{ scale: 0.94 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="添加定时支出">
            <MaterialIcons name="add" size={18} color={ff.onPine} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: insets.bottom + 28,
            maxWidth: Layout.contentMaxWidth,
            alignSelf: 'center',
            width: '100%',
          },
        ]}
        showsVerticalScrollIndicator={false}>
        {loading ? (
          <PageSkeleton paper2={paper2} line={line} />
        ) : items.length === 0 ? (
          <>
            <FoldRiseIn animate={motionOn} index={0} staggerMs={45} fromY={11}>
              <View
                style={[
                  styles.infoBanner,
                  {
                    backgroundColor: isDark ? 'rgba(216,154,77,0.12)' : '#F3EDE0',
                    borderColor: isDark ? ff.line2 : '#E8D9BF',
                  },
                ]}>
                <MaterialIcons name="schedule" size={14} color={ff.amberInk} />
                <Text style={[styles.infoBannerText, { color: isDark ? ff.amberInk : '#776B58' }]}>
                  <Text style={{ fontWeight: '700', color: isDark ? ff.ink : '#50493E' }}>到点自动记账。</Text>
                  错过的可在前台补记近 14 天，并自动参与本月预算预扣。
                </Text>
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={1} staggerMs={45} fromY={11}>
              <View
                style={[
                  styles.emptyCard,
                  {
                    backgroundColor: isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.54)',
                    borderColor: isDark ? line : '#D5C7B3',
                  },
                ]}>
                <FoldBreathe animate={motionOn} style={styles.emptyIllus}>
                  <View style={[styles.emptyEc, styles.emptyEc1, { backgroundColor: isDark ? ff.paper2 : '#F2EBDD', borderColor: line }]} />
                  <View style={[styles.emptyEc, styles.emptyEc2, { backgroundColor: isDark ? ff.cardSoft : '#F8F4EA', borderColor: line }]} />
                  <View
                    style={[
                      styles.emptyEc,
                      styles.emptyEc3,
                      { backgroundColor: card, borderColor: line },
                    ]}>
                    <MaterialIcons name="event-repeat" size={22} color={pine} />
                  </View>
                </FoldBreathe>
                <Text style={[styles.emptyTitle, { color: pine, fontFamily: ffFonts.serif }]}>
                  把固定支出交给账本
                </Text>
                <Text style={[styles.emptyBody, { color: subtle }]}>
                  房租、会员、保险和通勤，不必每月手动记。{'\n'}
                  到点自动写入流水，预算里也会提前留出位置。
                </Text>
                <Pressable
                  onPress={() => openAdd()}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: pine },
                    pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
                  ]}>
                  <MaterialIcons name="add" size={16} color={ff.onPine} />
                  <Text style={[styles.primaryBtnText, { color: ff.onPine }]}>添加定时支出</Text>
                </Pressable>
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={2} staggerMs={45} fromY={11}>
              <View style={styles.sectionH}>
                <Text style={[styles.sectionT, { color: faint }]}>Start from template / 从模板开始</Text>
                <Text style={[styles.sectionA, { color: subtle }]}>3 个常用</Text>
              </View>
              <View style={styles.templateRow}>
                {TEMPLATES.map((t) => (
                  <Pressable
                    key={t.key}
                    onPress={() => openAdd(t.key)}
                    style={({ pressed }) => [
                      styles.templateCard,
                      { backgroundColor: card, borderColor: line },
                      pressed && { opacity: 0.88, transform: [{ scale: 0.985 }] },
                    ]}>
                    <View style={[styles.templateIcon, { backgroundColor: isDark ? ff.sage2 : '#E8EFE9' }]}>
                      <MaterialIcons name={t.icon} size={16} color={pine} />
                    </View>
                    <Text style={[styles.templateLabel, { color: text }]}>{t.label}</Text>
                    <Text style={[styles.templateSub, { color: faint }]}>{t.sub}</Text>
                  </Pressable>
                ))}
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={3} staggerMs={45} fromY={11}>
              <View style={[styles.tipCard, { backgroundColor: card, borderColor: line }]}>
                <View style={styles.tipTop}>
                  <View style={[styles.tipIcon, { backgroundColor: isDark ? ff.amber2 : '#F4E9D7' }]}>
                    <MaterialIcons name="lightbulb-outline" size={14} color={ff.amberInk} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.tipTitle, { color: text }]}>预算预扣是怎么工作的？</Text>
                    <Text style={[styles.tipBody, { color: faint }]}>
                      规则创建后，本月预算会先减去它的金额；到账后不再重复占用。
                    </Text>
                  </View>
                </View>
                <View style={styles.tipMath}>
                  <Text style={[styles.tipMathText, { color: subtle }]}>可用预算</Text>
                  <Text style={[styles.tipMathText, { color: subtle, fontFamily: ffFonts.mono }]}>¥12,000</Text>
                  <Text style={[styles.tipMathText, { color: subtle }]}>− 预扣 ¥3,000</Text>
                  <Text style={[styles.tipMathText, { color: pine, fontWeight: '750', fontFamily: ffFonts.mono }]}>
                    = ¥9,000
                  </Text>
                </View>
              </View>
            </FoldRiseIn>
          </>
        ) : (
          <>
            <FoldRiseIn animate={motionOn} index={0} staggerMs={45} fromY={11}>
              <View
                style={[
                  styles.infoBanner,
                  {
                    backgroundColor: isDark ? 'rgba(216,154,77,0.12)' : '#F3EDE0',
                    borderColor: isDark ? ff.line2 : '#E8D9BF',
                  },
                ]}>
                <MaterialIcons name="schedule" size={14} color={ff.amberInk} />
                <Text style={[styles.infoBannerText, { color: isDark ? ff.amberInk : '#776B58' }]}>
                  <Text style={{ fontWeight: '700', color: isDark ? ff.ink : '#50493E' }}>
                    到点自动记入日常流水。
                  </Text>
                  错过的可在前台补记近 14 天，不影响预算预扣。
                </Text>
              </View>
            </FoldRiseIn>

            <FoldRiseIn animate={motionOn} index={1} staggerMs={45} fromY={11}>
              <View style={[styles.sumCard, { backgroundColor: card, borderColor: line }]}>
                <View style={[styles.sumIcon, { backgroundColor: isDark ? ff.sage2 : '#E8EFE9' }]}>
                  <MaterialIcons name="event-repeat" size={16} color={pine} />
                </View>
                <View style={styles.sumMain}>
                  <FoldCountUpText
                    value={monthlyFixedTotal}
                    animate={motionOn}
                    duration={760}
                    textStyle={[styles.sumAmount, { color: pine, fontFamily: ffFonts.mono }]}
                    formatter={(n) => formatMoney2(n)}
                  />
                  <Text style={[styles.sumSub, { color: faint }]}>
                    每月固定支出 · {enabledCount} 项启用
                  </Text>
                </View>
                <View style={styles.sumRight}>
                  <Text style={[styles.sumRightLab, { color: faint }]}>本月已自动记账</Text>
                  <Text style={[styles.sumRightVal, { color: '#4D6C59', fontFamily: ffFonts.mono }]}>
                    {monthTriggered.length} 笔
                  </Text>
                </View>
              </View>
            </FoldRiseIn>

            {items.map((item, index) => {
              const accountName = accountNameById.get(item.accountId) ?? '未知账户';
              const visual = itemVisual(item.name, item.enabled, isDark);
              const next = findNextScheduledExpenseOccurrence(item);
              const nextLabel = item.enabled
                ? next
                  ? `下次 ${next.shortLabel}`
                  : '下次未安排'
                : '已暂停 · 下次未安排';
              return (
                <FoldRiseIn key={item.id} animate={motionOn} index={index + 2} staggerMs={50} fromY={12} fromScale={0.985}>
                  <View
                    style={[
                      styles.itemCard,
                      {
                        backgroundColor: card,
                        borderColor: line,
                        opacity: item.enabled ? 1 : 0.72,
                      },
                    ]}>
                    <View style={[styles.itemIcon, { backgroundColor: visual.bg }]}>
                      <MaterialIcons name={visual.icon} size={15} color={visual.fg} />
                    </View>
                    <View style={styles.itemMain}>
                      <View style={styles.itemTitleRow}>
                        <Text style={[styles.itemName, { color: text }]} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <View
                          style={[
                            styles.tag,
                            {
                              backgroundColor: item.enabled
                                ? isDark
                                  ? ff.sage2
                                  : '#E7EFE9'
                                : isDark
                                  ? 'rgba(235,219,189,0.12)'
                                  : '#EEEAE1',
                            },
                          ]}>
                          <Text
                            style={[
                              styles.tagText,
                              { color: item.enabled ? pine : faint },
                            ]}>
                            {item.enabled ? '启用' : '暂停'}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.itemMeta, { color: faint }]} numberOfLines={2}>
                        {metaLine(item, accountName)}
                      </Text>
                      <NextChip
                        enabled={item.enabled}
                        label={nextLabel}
                        flashKey={nextFlash[item.id] ?? 0}
                        animate={foldAnimate}
                        mutedBg={isDark ? 'rgba(235,219,189,0.1)' : '#F0ECE4'}
                        mutedFg={faint}
                        activeBg={isDark ? ff.sage2 : '#EDF3ED'}
                        activeFg={isDark ? ff.sage : '#4F775F'}
                      />
                    </View>
                    <View style={styles.itemAct}>
                      <Text style={[styles.itemAmt, { color: '#405147', fontFamily: ffFonts.mono }]}>
                        {formatMoney0(item.amount)}
                      </Text>
                      <FinanceFoldSwitch
                        value={item.enabled}
                        onValueChange={(v) => void handleToggle(item, v)}
                        accessibilityLabel={`${item.name}启用开关`}
                      />
                      <View style={styles.itemTools}>
                        <Pressable
                          onPress={() =>
                            router.push({ pathname: '/add-scheduled-expense', params: { id: item.id } })
                          }
                          hitSlop={8}
                          style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                          accessibilityLabel="编辑">
                          <MaterialIcons name="edit" size={15} color={faint} />
                        </Pressable>
                        <Pressable
                          onPress={() => handleDelete(item)}
                          hitSlop={8}
                          style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                          accessibilityLabel="删除">
                          <MaterialIcons name="delete-outline" size={15} color={faint} />
                        </Pressable>
                      </View>
                    </View>
                  </View>
                </FoldRiseIn>
              );
            })}

            {budgetWithheld > 0 ? (
              <FoldRiseIn animate={motionOn} index={items.length + 2} staggerMs={45} fromY={11}>
                <Pressable
                  onPress={() => router.back()}
                  style={({ pressed }) => [
                    styles.budgetLink,
                    {
                      backgroundColor: isDark ? 'rgba(235,219,189,0.08)' : '#F5F0E5',
                      borderColor: isDark ? line : '#E5DBC9',
                    },
                    pressed && { opacity: 0.88 },
                  ]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.budgetLinkTitle, { color: text }]}>
                      本月预算已预扣 {formatMoney0(budgetWithheld)}
                    </Text>
                    <Text style={[styles.budgetLinkSub, { color: faint }]}>
                      {budgetItemCount} 项参与预算 · 返回首页可调整预算
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={18} color={faint} />
                </Pressable>
              </FoldRiseIn>
            ) : null}

            {monthTriggered.length > 0 ? (
              <FoldRiseIn animate={motionOn} index={items.length + 3} staggerMs={45} fromY={11}>
                <View style={styles.sectionH}>
                  <Text style={[styles.sectionT, { color: faint }]}>Recently triggered / 最近触发</Text>
                  <Text style={[styles.sectionA, { color: subtle }]}>本月 {monthTriggered.length} 笔</Text>
                </View>
                <View style={[styles.recentCard, { backgroundColor: card, borderColor: line }]}>
                  {monthTriggered.map((txn, i) => {
                    const expenseId = getScheduledExpenseIdFromTxnExtra(txn.extra_data);
                    const rule = expenseId ? items.find((x) => x.id === expenseId) : null;
                    const visual = itemVisual(rule?.name ?? txn.name, true, isDark);
                    const accountName = accountNameById.get(txn.account_id) ?? '';
                    return (
                      <View
                        key={txn.id}
                        style={[
                          styles.recentRow,
                          i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: isDark ? line : '#ECE4D6' },
                        ]}>
                        <View style={[styles.recentIcon, { backgroundColor: visual.bg }]}>
                          <MaterialIcons name={visual.icon} size={13} color={visual.fg} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.recentName, { color: text }]} numberOfLines={1}>
                            {(rule?.name ?? txn.name)} · 自动记账
                          </Text>
                          <Text style={[styles.recentMeta, { color: faint }]} numberOfLines={1}>
                            {formatTriggeredWhen(txn.happened_at)}
                            {accountName ? ` · ${accountName}` : ''}
                            {` · ${formatMoney0(Math.abs(txn.amount))}`}
                          </Text>
                        </View>
                        <View style={[styles.tag, { backgroundColor: isDark ? ff.sage2 : '#E7EFE9' }]}>
                          <Text style={[styles.tagText, { color: pine }]}>已入账</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </FoldRiseIn>
            ) : null}

            <Text style={[styles.miniNote, { color: faint }]}>
              补记入口会在过期 14 天内出现在每条记录下方
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 60 },
  headerInner: {
    minHeight: 54,
    paddingHorizontal: 14,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerCenter: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  headerTitle: { fontSize: 17, fontWeight: '600', letterSpacing: 0.2 },
  headerSub: { fontSize: 10, fontWeight: '600', letterSpacing: 0.6 },
  foldIconBtn: {
    width: 31,
    height: 31,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foldIconBtnDark: {
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  skeletonWrap: { gap: 8 },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 11,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  infoBannerText: { flex: 1, fontSize: 12, lineHeight: 18 },
  sumCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sumIcon: {
    width: 33,
    height: 33,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sumMain: { flex: 1, minWidth: 0 },
  sumAmount: { fontSize: 18, fontWeight: '700' },
  sumSub: { fontSize: 11, marginTop: 2 },
  sumRight: { alignItems: 'flex-end' },
  sumRightLab: { fontSize: 10 },
  sumRightVal: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    paddingVertical: 11,
    paddingHorizontal: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  itemIcon: {
    width: 29,
    height: 29,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemMain: { flex: 1, minWidth: 0 },
  itemTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemName: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  itemMeta: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  nextChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 6,
    marginTop: 5,
  },
  nextChipText: { fontSize: 10, fontWeight: '600' },
  itemAct: { alignItems: 'flex-end', gap: 5 },
  itemAmt: { fontSize: 13, fontWeight: '700' },
  itemTools: { flexDirection: 'row', gap: 8, marginTop: 2 },
  tag: {
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagText: { fontSize: 10, fontWeight: '700' },
  budgetLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  budgetLinkTitle: { fontSize: 13, fontWeight: '700' },
  budgetLinkSub: { fontSize: 11, marginTop: 2 },
  sectionH: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 2,
  },
  sectionT: { fontSize: 10, letterSpacing: 0.4, fontWeight: '700', textTransform: 'uppercase' },
  sectionA: { fontSize: 11 },
  recentCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  recentIcon: {
    width: 25,
    height: 25,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentName: { fontSize: 13, fontWeight: '700' },
  recentMeta: { fontSize: 11, marginTop: 2 },
  miniNote: { textAlign: 'center', fontSize: 11, marginTop: 4, marginBottom: 8 },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 26,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  emptyIllus: { width: 74, height: 78, marginBottom: 10, alignSelf: 'center', position: 'relative' },
  emptyEc: {
    position: 'absolute',
    width: 61,
    height: 41,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyEc1: { left: 7, top: 16, transform: [{ rotate: '-10deg' }] },
  emptyEc2: { left: 10, top: 12, transform: [{ rotate: '8deg' }] },
  emptyEc3: { left: 9, top: 8, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '600' },
  emptyBody: { fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 6, marginBottom: 14 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 38,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  primaryBtnText: { fontSize: 13, fontWeight: '700' },
  templateRow: { flexDirection: 'row', gap: 6 },
  templateCard: {
    flex: 1,
    minHeight: 72,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'flex-start',
    gap: 4,
  },
  templateIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateLabel: { fontSize: 13, fontWeight: '700' },
  templateSub: { fontSize: 10 },
  tipCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  tipTop: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  tipIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipTitle: { fontSize: 13, fontWeight: '700' },
  tipBody: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  tipMath: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    flexWrap: 'wrap',
    gap: 4,
  },
  tipMathText: { fontSize: 11 },
});
