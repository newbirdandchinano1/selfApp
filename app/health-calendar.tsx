import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import {
  buildUserHealthCalendarSnapshot,
  getHealthDayMetricsForUser,
} from '@/lib/repositories/health/health';
import { getDefaultUser } from '@/lib/repositories/users/user';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React from 'react';
import { FlatList, ListRenderItemInfo, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

type TimelineItem = {
  key: string;
  date: Date;
  monthMark?: string;
  offsetX: number;
  size: number;
  status: 'active' | 'full' | 'partial' | 'empty';
};

type SelectedDayMetrics = {
  hydration: number;
  hydrationTarget: number;
  protein: number;
  proteinTarget: number;
  carbohydrate: number;
  carbohydrateTarget: number;
  sodium: number;
  sodiumTarget: number;
};

function normalizeDate(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatLocalYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatMonthLabel(d: Date) {
  return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月`;
}

function formatDateLabel(d: Date) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function calcPercent(value: number, target: number) {
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.min(100, Math.round((value / target) * 100));
}

function addDays(base: Date, delta: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + delta);
  return normalizeDate(next);
}

function buildTimelineData(
  today: Date,
  startDate: Date,
  hasRecordDateSet: Set<string>,
  completionMap: Map<string, 'full' | 'partial'>
): TimelineItem[] {
  const items: TimelineItem[] = [];
  let cursor = new Date(today);
  let prevMonth = -1;
  let idx = 0;

  while (cursor >= startDate) {
    const month = cursor.getMonth();
    const ymd = formatLocalYmd(cursor);
    const hasRecord = hasRecordDateSet.has(ymd);
    const completion = completionMap.get(ymd);
    items.push({
      key: ymd,
      date: new Date(cursor),
      monthMark: month !== prevMonth ? `${cursor.getFullYear()}年${month + 1}月` : undefined,
      offsetX: [18, -20, 12, -12, 22, -18][idx % 6],
      size: [64, 50, 44, 40, 52, 48][idx % 6],
      status: idx === 0 ? 'active' : hasRecord ? completion ?? 'partial' : 'empty',
    });
    prevMonth = month;
    idx += 1;
    cursor = addDays(cursor, -1);
  }
  return items;
}

const PAGE_API_KEY = 'health-calendar';

export default function HealthCalendarScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const scheme = useColorScheme();
  const theme = Colors[scheme ?? 'light'];
  const isDark = scheme === 'dark';
  const today = React.useMemo(() => normalizeDate(new Date()), []);

  const [timelineData, setTimelineData] = React.useState<TimelineItem[]>([]);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [selectedMetrics, setSelectedMetrics] = React.useState<SelectedDayMetrics | null>(null);
  const [showBackToTop, setShowBackToTop] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const listRef = React.useRef<FlatList<TimelineItem>>(null);

  const reloadCalendar = React.useCallback(
    async (forceApi = false) => {
      await wrapLoad(async () => {
        setLoading(true);
        try {
          const user = await getDefaultUser();
          if (!user?.id) {
            const fallback = buildTimelineData(today, addDays(today, -29), new Set<string>(), new Map());
            setTimelineData(fallback);
            setSelectedKey(null);
            setSelectedMetrics(null);
            return false;
          }

          const applySnapshot = async (opts?: { localOnly?: boolean }) => {
            const { records, completionMap, startDate } = await buildUserHealthCalendarSnapshot(user.id, today, opts);
            const hasRecordDateSet = new Set(records.map((r) => r.record_date));
            const nextTimeline = buildTimelineData(today, startDate, hasRecordDateSet, completionMap);
            setTimelineData(nextTimeline);
            setSelectedKey((prev) => prev ?? formatLocalYmd(today));
          };

          await applySnapshot();
          return true;
        } finally {
          setLoading(false);
        }
      }, forceApi);
    },
    [today, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reloadCalendar);

  useFocusEffect(
    React.useCallback(() => {
      void reloadCalendar().catch((e) => console.warn('刷新健康日历失败', e));
    }, [reloadCalendar]),
  );

  React.useEffect(() => {
    let cancelled = false;
    const loadSelectedMetrics = async () => {
      if (!selectedKey) {
        setSelectedMetrics(null);
        return;
      }
      const user = await getDefaultUser();
      if (!user?.id) {
        if (!cancelled) setSelectedMetrics(null);
        return;
      }
      try {
        const metrics = await getHealthDayMetricsForUser(user.id, selectedKey);
        if (cancelled) return;
        if (!metrics) {
          setSelectedMetrics(null);
          return;
        }
        const { totals, latest } = metrics;
        setSelectedMetrics({
          hydration: totals.hydration,
          protein: totals.protein,
          carbohydrate: totals.carbohydrate,
          sodium: totals.sodium,
          hydrationTarget: Math.max(0, latest.target_hydration ?? 0),
          proteinTarget: Math.max(0, latest.target_protein ?? 0),
          carbohydrateTarget: Math.max(0, latest.target_carbohydrate ?? 0),
          sodiumTarget: Math.max(0, latest.target_sodium ?? 0),
        });
      } catch (error) {
        console.warn('加载选中日指标失败', error);
        if (!cancelled) setSelectedMetrics(null);
      }
    };
    void loadSelectedMetrics();
    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  const selectedItem = React.useMemo(
    () => (selectedKey ? timelineData.find((item) => item.key === selectedKey) ?? null : null),
    [selectedKey, timelineData]
  );

  const currentMonthLabel = selectedItem ? formatMonthLabel(selectedItem.date) : formatMonthLabel(today);
  const progress = selectedMetrics
    ? Math.round(
        (calcPercent(selectedMetrics.hydration, selectedMetrics.hydrationTarget) +
          calcPercent(selectedMetrics.protein, selectedMetrics.proteinTarget) +
          calcPercent(selectedMetrics.carbohydrate, selectedMetrics.carbohydrateTarget) +
          calcPercent(selectedMetrics.sodium, selectedMetrics.sodiumTarget)) /
          4
      )
    : 0;

  const onViewableItemsChanged = React.useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: TimelineItem }> }) => {
      const topItem = viewableItems?.[0]?.item;
      if (!topItem) return;
    }
  ).current;

  const viewabilityConfig = React.useRef({ itemVisiblePercentThreshold: 40 }).current;

  const renderItem = ({ item, index }: ListRenderItemInfo<TimelineItem>) => {
    const isSelected = item.key === selectedKey;
    const bgColor =
      item.status === 'full'
        ? '#10b981'
        : item.status === 'partial'
          ? '#f59e0b'
          : item.status === 'active'
            ? '#22c55e'
            : isDark
              ? '#334155'
              : '#e2e8f0';
    const curvePath =
      index % 2 === 0 ? 'M 50 0 C 80 20, 20 68, 50 88' : 'M 50 0 C 20 20, 80 68, 50 88';

    return (
      <View style={styles.row}>
        <View style={styles.rowCurveWrap} pointerEvents="none">
          <Svg width="100%" height="100%" viewBox="0 0 100 88" preserveAspectRatio="none">
            <Path
              d={curvePath}
              fill="none"
              stroke={isDark ? 'rgba(148,163,184,0.22)' : 'rgba(100,116,139,0.24)'}
              strokeWidth={2}
            />
          </Svg>
        </View>
        {item.monthMark ? <Text style={[styles.monthMark, { color: theme.textSecondary }]}>{item.monthMark}</Text> : null}
        <View style={[styles.nodeRow, { transform: [{ translateX: item.offsetX }] }]}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={(e) => {
              e.stopPropagation();
              setSelectedKey(item.key);
            }}
            style={[
              styles.node,
              {
                width: item.size,
                height: item.size,
                borderRadius: item.status === 'active' ? 20 : item.size / 2,
                backgroundColor: bgColor,
                borderWidth: isSelected ? 4 : item.status === 'active' ? 4 : 0,
                borderColor: isDark ? '#1e293b' : '#fff',
              },
            ]}
          >
            <Text style={styles.nodeDay}>{item.date.getDate()}</Text>
            {item.status === 'active' ? <MaterialIcons name="star" size={22} color="#fff" /> : null}
            {item.status === 'full' ? (
              <View style={[styles.checkBubble, { backgroundColor: isDark ? '#1e293b' : '#fff' }]}>
                <MaterialIcons name="check" size={11} color="#10b981" />
              </View>
            ) : null}
            {item.status === 'partial' ? (
              <View style={[styles.checkBubble, { backgroundColor: isDark ? '#1e293b' : '#fff' }]}>
                <MaterialIcons name="remove" size={11} color="#f59e0b" />
              </View>
            ) : null}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.95)' : 'rgba(248,250,252,0.95)' }]}>
        <TouchableOpacity style={[styles.iconBtn, { backgroundColor: theme.surface }]} onPress={() => router.back()}>
          <MaterialIcons name="chevron-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>健康日历脉络</Text>
          <Text style={styles.headerSub}>{currentMonthLabel}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.timelineContainer}>
        <Pressable style={styles.timelineBlankArea} onPress={() => setSelectedKey(null)}>
          <FlatList
            ref={listRef}
            data={timelineData}
            keyExtractor={(item) => item.key}
            renderItem={renderItem}
            refreshControl={refreshControl}
            initialNumToRender={40}
            maxToRenderPerBatch={60}
            windowSize={12}
            viewabilityConfig={viewabilityConfig}
            onViewableItemsChanged={onViewableItemsChanged}
            keyboardShouldPersistTaps="handled"
            onScroll={(e) => setShowBackToTop(e.nativeEvent.contentOffset.y > 600)}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
          />
        </Pressable>
      </View>

      {showBackToTop ? (
        <TouchableOpacity
          style={[styles.backToTopBtn, { backgroundColor: theme.primary }]}
          onPress={() => {
            listRef.current?.scrollToOffset({ offset: 0, animated: true });
            setSelectedKey(formatLocalYmd(today));
          }}
          activeOpacity={0.9}
        >
          <MaterialIcons name="vertical-align-top" size={20} color="#fff" />
          <Text style={styles.backToTopText}>回到顶部</Text>
        </TouchableOpacity>
      ) : null}

      {selectedItem && selectedMetrics ? (
        <View
          style={[
            styles.detailCard,
            {
              backgroundColor: theme.surface,
              borderColor: isDark ? 'rgba(148,163,184,0.22)' : '#f1f5f9',
            },
          ]}
        >
          <View style={styles.detailHeader}>
            <View>
              <Text style={[styles.detailDate, { color: theme.text }]}>{formatDateLabel(selectedItem.date)}</Text>
              <Text style={[styles.detailDesc, { color: theme.textSecondary }]}>你已经完成了 {progress}% 的目标</Text>
            </View>
            <TouchableOpacity
              style={styles.trendIconWrap}
              activeOpacity={0.8}
              onPress={() => router.push({ pathname: '/intake-history', params: { date: selectedItem.key } })}
            >
              <MaterialIcons name="history" size={20} color="#10b981" />
            </TouchableOpacity>
          </View>
          {[
            {
              key: 'hydration',
              label: '水分',
              icon: 'water-drop' as const,
              color: '#3b82f6',
              value: selectedMetrics.hydration,
              target: selectedMetrics.hydrationTarget,
              unit: 'ML',
            },
            {
              key: 'protein',
              label: '蛋白质',
              icon: 'restaurant' as const,
              color: '#f97316',
              value: selectedMetrics.protein,
              target: selectedMetrics.proteinTarget,
              unit: 'G',
            },
            {
              key: 'carbohydrate',
              label: '碳水',
              icon: 'rice-bowl' as const,
              color: '#eab308',
              value: selectedMetrics.carbohydrate,
              target: selectedMetrics.carbohydrateTarget,
              unit: 'G',
            },
            {
              key: 'sodium',
              label: '钠',
              icon: 'science' as const,
              color: '#a855f7',
              value: selectedMetrics.sodium,
              target: selectedMetrics.sodiumTarget,
              unit: 'MG',
            },
          ].map((metric) => {
            const pct = calcPercent(metric.value, metric.target);
            return (
              <View key={metric.key} style={styles.metricRow}>
                <View style={[styles.metricIconWrap, { backgroundColor: `${metric.color}1A` }]}>
                  <MaterialIcons name={metric.icon} size={20} color={metric.color} />
                </View>
                <View style={styles.metricMain}>
                  <View style={styles.metricTopLine}>
                    <Text style={[styles.metricLabel, { color: theme.text }]}>{metric.label}</Text>
                    <Text style={[styles.metricValue, { color: theme.textSecondary }]}>
                      {Math.round(metric.value).toLocaleString()} / {Math.round(metric.target).toLocaleString()} {metric.unit}
                    </Text>
                  </View>
                  <View style={[styles.progressBg, { backgroundColor: isDark ? 'rgba(148,163,184,0.18)' : '#f1f5f9' }]}>
                    <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: metric.color }]} />
                  </View>
                </View>
                <Text style={[styles.metricPercent, { color: theme.text }]}>{pct}%</Text>
              </View>
            );
          })}
        </View>
      ) : (
        <View
          style={[
            styles.emptyTipCard,
            { backgroundColor: theme.surface, borderColor: isDark ? 'rgba(148,163,184,0.16)' : '#e2e8f0' },
          ]}
        >
          <Text style={[styles.emptyTipText, { color: theme.textSecondary }]}>
            {loading ? '正在加载健康脉络...' : '选中一个有记录的日期查看摄入详情'}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: { width: 40, height: 40 },
  headerCenter: { alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerSub: { marginTop: 2, fontSize: 10, letterSpacing: 1.1, fontWeight: '800', color: '#10b981' },
  timelineContainer: {
    position: 'relative',
    flex: 1,
  },
  timelineBlankArea: {
    flex: 1,
  },
  listContent: { paddingBottom: 18, paddingTop: 6 },
  row: {
    height: 88,
    justifyContent: 'center',
  },
  rowCurveWrap: {
    position: 'absolute',
    left: '50%',
    marginLeft: -130,
    width: 260,
    top: 0,
    bottom: 0,
    opacity: 0.35,
  },
  monthMark: {
    position: 'absolute',
    left: 22,
    top: 2,
    fontSize: 11,
    fontWeight: '700',
  },
  nodeRow: {
    alignItems: 'center',
  },
  node: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeDay: {
    color: '#fff',
    fontWeight: '800',
    marginBottom: 2,
  },
  checkBubble: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backToTopBtn: {
    position: 'absolute',
    right: 24,
    bottom: 24,
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  backToTopText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  detailCard: {
    marginHorizontal: 24,
    marginBottom: 16,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  detailDate: { fontSize: 20, fontWeight: '800' },
  detailDesc: { fontSize: 12, marginTop: 2 },
  trendIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(16,185,129,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  metricIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  metricMain: { flex: 1 },
  metricTopLine: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  metricLabel: { fontSize: 12, fontWeight: '700' },
  metricValue: { fontSize: 11, fontWeight: '500' },
  progressBg: { height: 8, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  metricPercent: { width: 34, textAlign: 'right', fontSize: 12, fontWeight: '800' },
  emptyTipCard: {
    marginHorizontal: 24,
    marginBottom: 16,
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  emptyTipText: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '500',
  },
});
