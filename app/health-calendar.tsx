import { Colors } from '@/constants/theme';
import { resetDatabase } from '@/lib/database.native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, FlatList, ListRenderItemInfo, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

type TimelineItem = {
  key: string;
  date: Date;
  monthMark?: string;
  offsetX: number;
  size: number;
  status: 'active' | 'done' | 'warning' | 'empty';
};

type DayMetric = {
  hydration: number;
  hydrationTarget: number;
  protein: number;
  proteinTarget: number;
  sodium: number;
  sodiumTarget: number;
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function normalizeDate(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function calcPercent(value: number, target: number) {
  return Math.min(100, Math.round((value / target) * 100));
}

function createMetricsByDate(d: Date): DayMetric {
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const hydration = 1200 + (seed % 1400);
  const protein = 50 + (seed % 70);
  const sodium = 380 + (seed % 1200);

  return {
    hydration,
    hydrationTarget: 2500,
    protein,
    proteinTarget: 150,
    sodium,
    sodiumTarget: 2400,
  };
}

export default function HealthCalendarScreen() {
  const router = useRouter();
  const scheme = useColorScheme();
  const theme = Colors[scheme ?? 'light'];
  const isDark = scheme === 'dark';

  const today = React.useMemo(() => normalizeDate(new Date()), []);

  const timelineData = React.useMemo<TimelineItem[]>(() => {
    const start = new Date(1990, 0, 1);
    const arr: TimelineItem[] = [];

    let cursor = new Date(today);
    let prevMonth = -1;
    let idx = 0;

    while (cursor >= start) {
      const month = cursor.getMonth();
      const showMonth = month !== prevMonth;
      const phase = idx % 6;

      arr.push({
        key: dateKey(cursor),
        date: new Date(cursor),
        monthMark: showMonth ? `${cursor.getFullYear()}年${month + 1}月` : undefined,
        offsetX: [18, -20, 12, -12, 22, -18][phase],
        size: [64, 50, 44, 40, 52, 48][phase],
        status: idx === 0 ? 'active' : phase === 2 ? 'warning' : phase === 3 ? 'empty' : 'done',
      });

      prevMonth = month;
      cursor.setDate(cursor.getDate() - 1);
      idx += 1;
    }

    return arr;
  }, [today]);

  const listRef = React.useRef<FlatList<TimelineItem>>(null);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [currentMonthLabel, setCurrentMonthLabel] = React.useState(
    `${today.getFullYear()}年${pad2(today.getMonth() + 1)}月`,
  );
  const [showBackToTop, setShowBackToTop] = React.useState(false);

  const onViewableItemsChanged = React.useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: TimelineItem }> }) => {
      const first = viewableItems?.[0]?.item;
      if (!first) return;
      setCurrentMonthLabel(`${first.date.getFullYear()}年${pad2(first.date.getMonth() + 1)}月`);
    },
  ).current;

  const viewabilityConfig = React.useRef({
    itemVisiblePercentThreshold: 40,
  }).current;

  const selectedItem = React.useMemo(
    () => (selectedKey ? timelineData.find((it) => it.key === selectedKey) ?? null : null),
    [selectedKey, timelineData],
  );

  const [isResetting, setIsResetting] = React.useState(false);
  const selectedMetrics = selectedItem ? createMetricsByDate(selectedItem.date) : null;

  const progress = selectedMetrics
    ? Math.round(
        (calcPercent(selectedMetrics.hydration, selectedMetrics.hydrationTarget) +
          calcPercent(selectedMetrics.protein, selectedMetrics.proteinTarget) +
          calcPercent(selectedMetrics.sodium, selectedMetrics.sodiumTarget)) /
          3,
      )
    : 0;

  const handleResetDatabase = React.useCallback(() => {
    Alert.alert('清库确认', '这会删除本地所有数据并重新建表，是否继续？', [
      { text: '取消', style: 'cancel' },
      {
        text: '清库重建',
        style: 'destructive',
        onPress: async () => {
          try {
            setIsResetting(true);
            await resetDatabase();
            setSelectedKey(null);
            Alert.alert('完成', '本地数据库已清空并重建。');
          } catch {
            Alert.alert('失败', '清库失败，请稍后重试。');
          } finally {
            setIsResetting(false);
          }
        },
      },
    ]);
  }, []);

  const renderItem = ({ item, index }: ListRenderItemInfo<TimelineItem>) => {
    const isSelected = item.key === selectedKey;

    const bgColor =
      item.status === 'active'
        ? '#10b981'
        : item.status === 'done'
          ? '#10b981'
          : item.status === 'warning'
            ? '#eab308'
            : isDark
              ? '#334155'
              : '#e2e8f0';

    const curvePath =
      index % 2 === 0
        ? 'M 50 0 C 80 20, 20 68, 50 88'
        : 'M 50 0 C 20 20, 80 68, 50 88';

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
            {item.status === 'active' && <MaterialIcons name="star" size={22} color="#fff" />}
            {item.status === 'done' && (
              <View style={[styles.checkBubble, { backgroundColor: isDark ? '#1e293b' : '#fff' }]}>
                <MaterialIcons name="check" size={11} color="#10b981" />
              </View>
            )}
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
        <TouchableOpacity
          style={[styles.iconBtn, { backgroundColor: theme.surface }]}
          onPress={handleResetDatabase}
          disabled={isResetting}
        >
          <MaterialIcons name="refresh" size={20} color={isResetting ? '#94a3b8' : theme.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.timelineContainer}>
        <Pressable style={styles.timelineBlankArea} onPress={() => setSelectedKey(null)}>
          <FlatList
            ref={listRef}
            data={timelineData}
            keyExtractor={(item) => item.key}
            renderItem={renderItem}
            initialNumToRender={40}
            maxToRenderPerBatch={60}
            windowSize={12}
            viewabilityConfig={viewabilityConfig}
            onViewableItemsChanged={onViewableItemsChanged}
            keyboardShouldPersistTaps="handled"
            onScroll={(e) => {
              const y = e.nativeEvent.contentOffset.y;
              setShowBackToTop(y > 600);
            }}
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
            setSelectedKey(null);
          }}
          activeOpacity={0.9}
        >
          <MaterialIcons name="vertical-align-top" size={20} color="#fff" />
          <Text style={styles.backToTopText}>回到顶部</Text>
        </TouchableOpacity>
      ) : null}

      {selectedItem && selectedMetrics ? (
        <View style={[styles.detailCard, { backgroundColor: theme.surface, borderColor: isDark ? 'rgba(148,163,184,0.22)' : '#f1f5f9' }]}>
          <View style={styles.detailHeader}>
            <View>
              <Text style={[styles.detailDate, { color: theme.text }]}>{selectedItem.date.getFullYear()}年{selectedItem.date.getMonth() + 1}月{selectedItem.date.getDate()}日</Text>
              <Text style={[styles.detailDesc, { color: theme.textSecondary }]}>你已经完成了 {progress}% 的目标</Text>
            </View>
            <View style={styles.trendIconWrap}>
              <MaterialIcons name="trending-up" size={20} color="#10b981" />
            </View>
          </View>

          {[
            { key: 'hydration', label: '水分', icon: 'water-drop' as const, color: '#3b82f6', value: selectedMetrics.hydration, target: selectedMetrics.hydrationTarget, unit: 'ML' },
            { key: 'protein', label: '蛋白质', icon: 'restaurant' as const, color: '#f97316', value: selectedMetrics.protein, target: selectedMetrics.proteinTarget, unit: 'G' },
            { key: 'sodium', label: '钠', icon: 'science' as const, color: '#a855f7', value: selectedMetrics.sodium, target: selectedMetrics.sodiumTarget, unit: 'MG' },
          ].map((m) => {
            const pct = calcPercent(m.value, m.target);
            return (
              <View key={m.key} style={styles.metricRow}>
                <View style={[styles.metricIconWrap, { backgroundColor: `${m.color}1A` }]}>
                  <MaterialIcons name={m.icon} size={20} color={m.color} />
                </View>
                <View style={styles.metricMain}>
                  <View style={styles.metricTopLine}>
                    <Text style={[styles.metricLabel, { color: theme.text }]}>{m.label}</Text>
                    <Text style={[styles.metricValue, { color: theme.textSecondary }]}>
                      {m.value.toLocaleString()} / {m.target.toLocaleString()} {m.unit}
                    </Text>
                  </View>
                  <View style={[styles.progressBg, { backgroundColor: isDark ? 'rgba(148,163,184,0.18)' : '#f1f5f9' }]}>
                    <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: m.color }]} />
                  </View>
                </View>
                <Text style={[styles.metricPercent, { color: theme.text }]}>{pct}%</Text>
              </View>
            );
          })}
        </View>
      ) : null}
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
});
