import {
  FoldRiseIn,
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { Layout } from '@/constants/design-tokens';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { fetchFinanceStats, type FinanceStatsData } from '@/lib/finance-page-api';
import { ymdPrefix } from '@/lib/date';
import { analyzeFinanceBillSummaryFromText } from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Alert } from '@/lib/app-feedback';
const PAGE_API_KEY = 'finance-stats-detail';
const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const INITIAL_VISIBLE_DAYS = 8;
const ANALYSIS_CACHE_KEY = 'finance-stats-analysis-summary';

function formatMoneyPlain(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return '—';
  return Math.abs(value).toLocaleString('zh-CN', {
    maximumFractionDigits: value % 1 ? 1 : 0,
    minimumFractionDigits: 0,
  });
}

function formatSignedMoney(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return '¥0.00';
  const sign = value > 0 ? '+' : '−';
  return `${sign}¥${Math.abs(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatRankMoney(value: number, side: 'income' | 'expense') {
  const sign = side === 'income' ? '+' : '−';
  return `${sign}¥${Math.abs(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDayLabel(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  return `${m}.${d} ${WEEKDAY_CN[dt.getDay()]}`;
}

function formatRankMeta(happenedAt: string, categoryName: string | null, note: string | null) {
  const ymd = ymdPrefix(happenedAt) ?? happenedAt.slice(0, 10);
  const md = ymd.length >= 10 ? `${Number(ymd.slice(5, 7))}.${Number(ymd.slice(8, 10))}` : ymd;
  const parts = [md, categoryName?.trim() || null, note?.trim() || null].filter(Boolean);
  return parts.join(' · ');
}

/** 排行进度条 growX */
function RankBarFill({
  widthPct,
  color,
  animate,
  index,
}: {
  widthPct: number;
  color: string;
  animate: boolean;
  index: number;
}) {
  const progress = React.useRef(new Animated.Value(animate ? 0 : 1)).current;
  const target = Math.max(0, Math.min(100, widthPct));

  React.useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 700,
      delay: 160 + index * 55,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, index, progress, target]);

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${target}%`],
  });

  return <Animated.View style={[styles.rankFill, { width, backgroundColor: color }]} />;
}

export default function FinanceStatsDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    start?: string;
    end?: string;
    tab?: string;
    label?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { ff, isDark, fonts: ffFonts } = useFinanceFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const bg = ff.paper;
  const card = isDark ? ff.paper2 : ff.card;
  const text = ff.ink;
  const subtle = ff.muted;
  const faint = ff.faint;
  const line = ff.line;
  const pine = ff.pine;
  const incomeColor = ff.income;
  const expenseColor = ff.expense;
  const headerScrim = isDark ? 'rgba(23,43,36,0.94)' : 'rgba(243,238,228,0.94)';
  const trackBg = isDark ? 'rgba(255,255,255,0.08)' : '#EEE8DC';
  const motionOn = foldAnimate;

  const startYmd = typeof params.start === 'string' ? params.start : formatFallbackStart();
  const endYmd = typeof params.end === 'string' ? params.end : formatFallbackEnd();
  const rangeLabel =
    typeof params.label === 'string' && params.label.trim()
      ? params.label
      : `${startYmd} – ${endYmd}`;

  const [stats, setStats] = React.useState<FinanceStatsData | null>(null);
  const [expandedDays, setExpandedDays] = React.useState(false);
  const [aiText, setAiText] = React.useState<string | null>(null);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);
  const [entranceKey, setEntranceKey] = React.useState(0);
  const [saving, setSaving] = React.useState(false);

  const granularity = startYmd.slice(0, 4) !== endYmd.slice(0, 4) || params.tab === '年' ? 'month' : 'day';

  const reload = React.useCallback(
    async (forceRefresh = false) => {
      await wrapLoad(async () => {
        try {
          const data = await fetchFinanceStats({
            start: startYmd,
            end: endYmd,
            granularity: granularity === 'month' ? 'month' : 'day',
            categoryMode: 'both',
            rankMode: 'both',
            rankLimit: 8,
            recentDaysLimit: 31,
            excludeCorrections: true,
            serverFallback: true,
          });
          setStats(data);
          setEntranceKey((k) => k + 1);
        } catch (error) {
          console.warn('Failed to load finance stats detail:', error);
          setStats(null);
        }
      }, forceRefresh);
    },
    [endYmd, granularity, startYmd, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload]),
  );

  const dailyRows = React.useMemo(() => {
    const recent = [...(stats?.billTable.recentDays ?? [])].sort((a, b) => (a.day < b.day ? 1 : -1));
    return recent;
  }, [stats?.billTable.recentDays]);

  const visibleRows = expandedDays ? dailyRows : dailyRows.slice(0, INITIAL_VISIBLE_DAYS);
  const hiddenCount = Math.max(0, dailyRows.length - INITIAL_VISIBLE_DAYS);
  const daysWithRecord = dailyRows.filter((r) => r.income > 0 || r.expense > 0).length;

  const expenseRank = React.useMemo(() => {
    const side = stats?.ranking.expense ?? [];
    const max = Math.max(...side.map((r) => r.amount), 1);
    return side.map((item, index) => ({
      ...item,
      rank: index + 1,
      widthPct: (item.amount / max) * 100,
      meta: formatRankMeta(item.happenedAt, item.categoryName, item.note),
    }));
  }, [stats?.ranking.expense]);

  const incomeRank = React.useMemo(() => {
    const side = stats?.ranking.income ?? [];
    const max = Math.max(...side.map((r) => r.amount), 1);
    return side.map((item, index) => ({
      ...item,
      rank: index + 1,
      widthPct: (item.amount / max) * 100,
      meta: formatRankMeta(item.happenedAt, item.categoryName, item.note),
    }));
  }, [stats?.ranking.income]);

  const summaryForAi = React.useMemo(() => {
    if (!stats) return '';
    const parts = [
      `统计区间：${rangeLabel}（${startYmd} 至 ${endYmd}）`,
      `收入 ${stats.summary.income.toFixed(2)}，支出 ${stats.summary.expense.toFixed(2)}，结余 ${stats.summary.balance.toFixed(2)}，${stats.summary.txnCount} 笔`,
    ];
    if (expenseRank[0]) {
      parts.push(`最大单笔支出：${expenseRank[0].name} ${expenseRank[0].amount.toFixed(2)} 元`);
    }
    if (incomeRank[0]) {
      parts.push(`最大单笔收入：${incomeRank[0].name} ${incomeRank[0].amount.toFixed(2)} 元`);
    }
    const topCats = (stats.categories.expense ?? [])
      .slice(0, 5)
      .map((c) => `${c.name} ${c.percent.toFixed(0)}%`)
      .join('、');
    if (topCats) parts.push(`支出构成：${topCats}`);
    return parts.join('\n');
  }, [endYmd, expenseRank, incomeRank, rangeLabel, startYmd, stats]);

  React.useEffect(() => {
    setAiText(null);
    setAiError(null);
  }, [summaryForAi]);

  const ensureAi = React.useCallback(async () => {
    if (aiText || aiBusy || !summaryForAi) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const r = await analyzeFinanceBillSummaryFromText({
        summaryText: summaryForAi,
        maxAttempts: 8,
        retryDelayMs: 800,
      });
      if (r.ok) setAiText(r.analysis);
      else setAiError(r.error);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, aiText, summaryForAi]);

  React.useEffect(() => {
    if (!stats || !summaryForAi) return;
    const t = setTimeout(() => {
      void ensureAi();
    }, 600);
    return () => clearTimeout(t);
  }, [ensureAi, stats, summaryForAi]);

  const saveSummary = React.useCallback(async () => {
    setSaving(true);
    try {
      const payload = {
        savedAt: Date.now(),
        start: startYmd,
        end: endYmd,
        label: rangeLabel,
        analysis: aiText,
        summary: stats?.summary ?? null,
      };
      await AsyncStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify(payload));
      Alert.alert('已保存', '本月分析摘要已保存到本机。');
    } catch {
      Alert.alert('保存失败', '请稍后重试。');
    } finally {
      setSaving(false);
    }
  }, [aiText, endYmd, rangeLabel, startYmd, stats?.summary]);

  const fallbackInsight = React.useMemo(() => {
    if (!stats) return '加载中…';
    const top = expenseRank[0];
    const rate =
      stats.summary.income > 0
        ? ((stats.summary.income - stats.summary.expense) / stats.summary.income) * 100
        : 0;
    if (top) {
      return `本期最大单笔是「${top.name}」（${formatRankMoney(top.amount, 'expense')}）。储蓄率约 ${rate.toFixed(1)}%，可把高频弹性消费设上限，让结余更稳。`;
    }
    return '本期暂无足够排行数据。记几笔日常流水后，这里会给出更具体的建议。';
  }, [expenseRank, stats]);

  const scrollBottomPad = 40 + Math.max(insets.bottom, 12);
  const periodTag =
    params.tab === '周'
      ? '本周'
      : params.tab === '年'
        ? '本年'
        : params.tab === '自定义'
          ? '自定义'
          : '本月';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]} edges={['left', 'right']}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top, backgroundColor: headerScrim, borderBottomColor: line },
        ]}>
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
            <Text style={[styles.headerTitle, { color: text, fontFamily: ffFonts.serif }]}>统计明细</Text>
            <Text style={[styles.headerSub, { color: subtle }]}>DAILY · RANKING</Text>
          </View>
          <Pressable
            onPress={() => Alert.alert('导出', '导出本月明细即将支持，当前可先截图保存。')}
            style={({ pressed }) => [
              styles.pillBtn,
              {
                borderColor: ff.line2,
                backgroundColor: isDark ? ff.cardSoft : 'rgba(255,252,245,0.66)',
              },
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="导出">
            <Text style={[styles.pillBtnText, { color: ff.ink2 }]}>导出</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: scrollBottomPad,
            maxWidth: Layout.contentMaxWidth,
            alignSelf: 'center',
            width: '100%',
          },
        ]}
        showsVerticalScrollIndicator={false}>
        <FoldRiseIn key={`table-${entranceKey}`} animate={motionOn} index={0} fromY={11}>
          <View style={[styles.card, { backgroundColor: card, borderColor: line }]}>
            <View style={styles.tableHeadRow}>
              <Text style={[styles.cardTitle, { color: text }]}>按日汇总</Text>
              <View
                style={[
                  styles.tag,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#EEEAE1' },
                ]}>
                <Text style={[styles.tagText, { color: subtle }]}>
                  {periodTag} · {daysWithRecord} 天有记录
                </Text>
              </View>
            </View>
            <View style={styles.tableHead}>
              <Text style={[styles.th, { color: faint }]}>日期</Text>
              <Text style={[styles.th, { color: faint }]}>收入</Text>
              <Text style={[styles.th, { color: faint }]}>支出</Text>
              <Text style={[styles.th, { color: faint }]}>净额</Text>
            </View>
            {visibleRows.length ? (
              visibleRows.map((row) => {
                const net = row.balance;
                return (
                  <View
                    key={row.day}
                    style={[styles.tableRow, { borderBottomColor: isDark ? line : '#F0E9DD' }]}>
                    <Text style={[styles.tdDay, { color: text, fontFamily: ffFonts.mono }]}>
                      {formatDayLabel(row.day)}
                    </Text>
                    <Text style={[styles.td, { color: incomeColor, fontFamily: ffFonts.mono }]}>
                      {row.income > 0 ? formatMoneyPlain(row.income) : '—'}
                    </Text>
                    <Text style={[styles.td, { color: expenseColor, fontFamily: ffFonts.mono }]}>
                      {row.expense > 0 ? formatMoneyPlain(row.expense) : '—'}
                    </Text>
                    <Text
                      style={[
                        styles.td,
                        {
                          color: net > 0 ? incomeColor : net < 0 ? text : faint,
                          fontFamily: ffFonts.mono,
                        },
                      ]}>
                      {net > 0 ? `+${formatMoneyPlain(net)}` : net < 0 ? `-${formatMoneyPlain(net)}` : '—'}
                    </Text>
                  </View>
                );
              })
            ) : (
              <Text style={[styles.empty, { color: faint }]}>本期暂无按日数据</Text>
            )}
            {hiddenCount > 0 ? (
              <Pressable
                onPress={() => setExpandedDays((v) => !v)}
                style={({ pressed }) => [styles.expandBtn, pressed && { opacity: 0.75 }]}
                accessibilityRole="button"
                accessibilityLabel={expandedDays ? '收起' : `展开剩余 ${hiddenCount} 天`}>
                <Text style={[styles.expandText, { color: faint }]}>
                  {expandedDays ? '收起' : `展开剩余 ${hiddenCount} 天`}
                </Text>
                <MaterialIcons
                  name={expandedDays ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                  size={16}
                  color={faint}
                />
              </Pressable>
            ) : null}
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={motionOn} index={1} fromY={10}>
          <View style={styles.sectionH}>
            <Text style={[styles.sectionT, { color: '#4D5C52' }]}>
              Top expenses <Text style={{ color: faint }}>/ 单笔排行</Text>
            </Text>
            <Text style={[styles.sectionA, { color: subtle }]}>支出 · {periodTag}</Text>
          </View>
        </FoldRiseIn>

        <FoldRiseIn key={`exp-${entranceKey}`} animate={motionOn} index={2} fromY={12}>
          <View style={[styles.rankCard, { backgroundColor: card, borderColor: line }]}>
            {expenseRank.length ? (
              expenseRank.map((item, index) => (
                <View
                  key={item.id}
                  style={[
                    styles.rankBig,
                    index < expenseRank.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: isDark ? line : '#ECE4D6',
                    },
                  ]}>
                  <View
                    style={[
                      styles.rno,
                      {
                        backgroundColor: isDark ? 'rgba(216,154,77,0.18)' : '#F2E8D8',
                      },
                    ]}>
                    <Text style={[styles.rnoText, { color: '#A37736', fontFamily: ffFonts.mono }]}>
                      {String(item.rank).padStart(2, '0')}
                    </Text>
                  </View>
                  <View style={styles.rm}>
                    <Text style={[styles.rmTitle, { color: text }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[styles.rmMeta, { color: faint }]} numberOfLines={1}>
                      {item.meta}
                    </Text>
                    <View style={[styles.rbar, { backgroundColor: trackBg }]}>
                      <RankBarFill
                        widthPct={item.widthPct}
                        color="#CF7B5D"
                        animate={motionOn}
                        index={index}
                      />
                    </View>
                  </View>
                  <Text style={[styles.rv, { color: expenseColor, fontFamily: ffFonts.mono }]}>
                    {formatRankMoney(item.amount, 'expense')}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={[styles.empty, { color: faint }]}>暂无支出排行</Text>
            )}
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={motionOn} index={3} fromY={10}>
          <View style={styles.sectionH}>
            <Text style={[styles.sectionT, { color: '#4D5C52' }]}>
              Top income <Text style={{ color: faint }}>/ 收入排行</Text>
            </Text>
            <Text style={[styles.sectionA, { color: subtle }]}>{periodTag}</Text>
          </View>
        </FoldRiseIn>

        <FoldRiseIn key={`inc-${entranceKey}`} animate={motionOn} index={4} fromY={12}>
          <View style={[styles.rankCard, { backgroundColor: card, borderColor: line }]}>
            {incomeRank.length ? (
              incomeRank.map((item, index) => (
                <View
                  key={item.id}
                  style={[
                    styles.rankBig,
                    index < incomeRank.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: isDark ? line : '#ECE4D6',
                    },
                  ]}>
                  <View
                    style={[
                      styles.rno,
                      {
                        backgroundColor: isDark ? 'rgba(134,167,149,0.22)' : '#E4EFE7',
                      },
                    ]}>
                    <Text style={[styles.rnoText, { color: '#3F755A', fontFamily: ffFonts.mono }]}>
                      {String(item.rank).padStart(2, '0')}
                    </Text>
                  </View>
                  <View style={styles.rm}>
                    <Text style={[styles.rmTitle, { color: text }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[styles.rmMeta, { color: faint }]} numberOfLines={1}>
                      {item.meta}
                    </Text>
                    <View style={[styles.rbar, { backgroundColor: trackBg }]}>
                      <RankBarFill
                        widthPct={item.widthPct}
                        color="#6D9A80"
                        animate={motionOn}
                        index={index}
                      />
                    </View>
                  </View>
                  <Text style={[styles.rv, { color: incomeColor, fontFamily: ffFonts.mono }]}>
                    {formatRankMoney(item.amount, 'income')}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={[styles.empty, { color: faint }]}>暂无收入排行</Text>
            )}
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={motionOn} index={5} fromY={11}>
          <View
            style={[
              styles.aiInsight,
              {
                backgroundColor: isDark ? 'rgba(216,154,77,0.12)' : '#F3EDE0',
                borderColor: isDark ? 'rgba(216,154,77,0.25)' : '#E8D9BF',
              },
            ]}>
            {aiBusy && !aiText ? (
              <ActivityIndicator size="small" color={ff.amberInk} />
            ) : (
              <MaterialIcons name="auto-awesome" size={16} color={ff.amberInk} />
            )}
            <Text style={[styles.aiInsightText, { color: isDark ? ff.ink2 : '#6D6658' }]}>
              <Text style={{ fontWeight: '700', color: isDark ? ff.amberInk : '#514B40' }}>AI 分析：</Text>
              {aiError ? `获取失败（${aiError}）。${fallbackInsight}` : aiText ?? fallbackInsight}
            </Text>
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={motionOn} index={6} fromY={10}>
          <Pressable
            onPress={() => void saveSummary()}
            disabled={saving}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: pine },
              pressed && !saving && { opacity: 0.92, transform: [{ scale: 0.99 }] },
              saving && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="保存分析摘要">
            {saving ? (
              <ActivityIndicator size="small" color={ff.onPine} />
            ) : (
              <Text style={[styles.primaryBtnText, { color: ff.onPine }]}>保存分析摘要</Text>
            )}
          </Pressable>
        </FoldRiseIn>
      </ScrollView>
    </SafeAreaView>
  );
}

function formatFallbackStart() {
  const d = new Date();
  d.setDate(1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function formatFallbackEnd() {
  const d = new Date();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
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
  pillBtn: {
    height: 27,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillBtnText: { fontSize: 12, fontWeight: '700' },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  tableHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  cardTitle: { fontSize: 14, fontWeight: '700' },
  tag: {
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagText: { fontSize: 10, fontWeight: '600' },
  tableHead: {
    flexDirection: 'row',
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E9E1D2',
  },
  th: { flex: 1, fontSize: 11, textAlign: 'center' },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tdDay: { flex: 1.2, fontSize: 12, fontWeight: '600' },
  td: { flex: 1, fontSize: 12, textAlign: 'center' },
  expandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingTop: 10,
  },
  expandText: { fontSize: 12 },
  sectionH: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginTop: 4,
  },
  sectionT: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  sectionA: { fontSize: 11 },
  rankCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  rankBig: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
  },
  rno: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rnoText: { fontSize: 11, fontWeight: '700' },
  rm: { flex: 1, minWidth: 0 },
  rmTitle: { fontSize: 13, fontWeight: '700' },
  rmMeta: { fontSize: 11, marginTop: 2 },
  rbar: {
    height: 3,
    borderRadius: 3,
    marginTop: 6,
    overflow: 'hidden',
  },
  rankFill: { height: '100%', borderRadius: 3 },
  rv: { fontSize: 13, fontWeight: '700' },
  aiInsight: {
    marginTop: 2,
    paddingHorizontal: 11,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  aiInsightText: { flex: 1, fontSize: 12, lineHeight: 18 },
  primaryBtn: {
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  primaryBtnText: { fontSize: 14, fontWeight: '700' },
  empty: { fontSize: 12, paddingVertical: 14, textAlign: 'center' },
});
