import { Colors } from '@/constants/theme';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getTasksForOverviewList } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  countTaskExecutionEventsByAction,
  countTaskExecutionEventsInScope,
  getFirstCompletedEventDayYmd,
  getRecentTaskExecutionEventsPage,
  getTaskCompletionCountsByDayRange,
  getTaskExecutionEventsByActionPage,
  getNetCompletedTaskEventsForLocalDay,
  getTaskGlobalInsightCounts,
  type TaskExecutionEventWithTitle,
} from '@/lib/repositories/tasks/task-execution-events';
import { isStandaloneTodoTask, standaloneTodoEditorHref } from '@/lib/standalone-todo-task';
import { buildGlobalTaskHeatmapGrid, heatmapGridDayRange, type HeatmapCell } from '@/lib/tasks-global-heatmap';
import { MaterialIcons } from '@expo/vector-icons';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { useFocusEffect, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const DOW = ['一', '二', '三', '四', '五', '六', '日'];
const HISTORY_PAGE_SIZE = 25;

function formatDateTimeCN(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}年${m}月${d}日 · ${hh}:${mm}`;
}

function formatYmdTitleCN(ymd: string) {
  const [y, m, d] = ymd.split('-').map((x) => Number(x));
  if (!y || !m || !d) return ymd;
  return `${y}年${m}月${d}日`;
}

function actionLabel(action: string) {
  if (action === 'completed') return '标记完成';
  if (action === 'reopened') return '恢复为待办';
  return action;
}

type OverviewStatKey = 'open' | 'doneOrCancelled' | 'totalActive' | 'completedEvents' | 'reopenedEvents';

const STAT_CARDS: Array<{
  key: OverviewStatKey;
  label: string;
  countKey: keyof Awaited<ReturnType<typeof getTaskGlobalInsightCounts>>;
  valueColor: 'text' | 'secondary' | 'primary';
  listMode: 'tasks' | 'events';
  eventAction?: 'completed' | 'reopened';
}> = [
  { key: 'open', label: '未完成', countKey: 'open', valueColor: 'text', listMode: 'tasks' },
  { key: 'doneOrCancelled', label: '当前已完成/取消', countKey: 'doneOrCancelled', valueColor: 'secondary', listMode: 'tasks' },
  { key: 'totalActive', label: '待办总数', countKey: 'totalActive', valueColor: 'primary', listMode: 'tasks' },
  { key: 'completedEvents', label: '累计完成记录', countKey: 'completedEvents', valueColor: 'primary', listMode: 'events', eventAction: 'completed' },
  { key: 'reopenedEvents', label: '累计恢复记录', countKey: 'reopenedEvents', valueColor: 'primary', listMode: 'events', eventAction: 'reopened' },
];

function formatTaskStatus(status: string) {
  if (status === 'doing') return '进行中';
  if (status === 'done') return '已完成';
  if (status === 'blocked') return '受阻';
  if (status === 'cancelled') return '已取消';
  if (status === 'shelved') return '暂时搁置';
  return '待办';
}

/** 根据容器宽度计算周数与格子边长，使热力图横向铺满且格子足够大 */
function computeHeatLayout(containerWidth: number) {
  const ROW_LABEL = 26;
  const GAP = 6;
  const MIN_CELL = 15;
  const MAX_CELL = 24;
  const inner = Math.max(100, containerWidth - ROW_LABEL);
  let weeks = Math.floor((inner + GAP) / (MIN_CELL + GAP));
  weeks = Math.max(8, Math.min(20, weeks));
  let cell = (inner - (weeks - 1) * GAP) / weeks;
  while (cell > MAX_CELL + 0.5 && weeks > 8) {
    weeks -= 1;
    cell = (inner - (weeks - 1) * GAP) / weeks;
  }
  while (cell < MIN_CELL - 0.01 && weeks < 20) {
    weeks += 1;
    cell = (inner - (weeks - 1) * GAP) / weeks;
  }
  cell = Math.max(MIN_CELL, Math.min(MAX_CELL, cell));
  return { weeks, cell, gap: GAP, rowLabel: ROW_LABEL };
}

function GlobalHeatmap({
  grid,
  maxCount,
  cell,
  gap,
  rowLabelWidth,
  emptyBg,
  fillLow,
  fillMid,
  fillHigh,
  border,
  muted,
  selectedYmd,
  accentColor,
  onCellPress,
}: {
  grid: HeatmapCell[][];
  maxCount: number;
  cell: number;
  gap: number;
  rowLabelWidth: number;
  emptyBg: string;
  fillLow: string;
  fillMid: string;
  fillHigh: string;
  border: string;
  muted: string;
  selectedYmd: string | null;
  accentColor: string;
  onCellPress: (cellData: HeatmapCell) => void;
}) {
  const levelFor = (c: number) => {
    if (c <= 0) return 0;
    const cap = Math.max(maxCount, 1);
    const r = c / cap;
    if (r <= 0.34) return 1;
    if (r <= 0.67) return 2;
    return 3;
  };
  const colHeight = 7 * cell + 6 * gap;
  const radius = Math.max(4, Math.min(8, cell * 0.22));

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      <View style={{ width: rowLabelWidth, height: colHeight, marginRight: 4 }}>
        {DOW.map((d, i) => (
          <View key={d} style={{ height: cell, marginBottom: i < 6 ? gap : 0, justifyContent: 'center' }}>
            <Text style={{ fontSize: 11, fontWeight: '800', color: muted }}>{d}</Text>
          </View>
        ))}
      </View>
      <View style={{ flex: 1, flexDirection: 'row', gap, height: colHeight }}>
        {grid.map((col, wi) => (
          <View key={wi} style={{ flex: 1, gap }}>
            {col.map((cellData) => {
              const lvl = cellData.inRange ? levelFor(cellData.count) : 0;
              const bg = !cellData.inRange ? emptyBg : lvl === 0 ? emptyBg : lvl === 1 ? fillLow : lvl === 2 ? fillMid : fillHigh;
              const borderColor = cellData.inRange ? border : `${border}44`;
              const selected = selectedYmd === cellData.ymd;
              return (
                <Pressable
                  key={cellData.ymd}
                  onPress={() => onCellPress(cellData)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${cellData.ymd}，完成 ${cellData.count} 次`}
                  style={({ pressed }) => [
                    {
                      width: '100%',
                      height: cell,
                      borderRadius: radius,
                      backgroundColor: bg,
                      borderWidth: selected ? 2.5 : StyleSheet.hairlineWidth,
                      borderColor: selected ? accentColor : borderColor,
                      opacity: pressed ? 0.82 : 1,
                      shadowColor: selected ? accentColor : 'transparent',
                      shadowOffset: { width: 0, height: 0 },
                      shadowOpacity: selected ? 0.45 : 0,
                      shadowRadius: selected ? 4 : 0,
                      elevation: selected ? 3 : 0,
                    },
                  ]}
                />
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const PAGE_API_KEY = 'tasks-overview';

export default function TasksOverviewScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const isDark = colorScheme === 'dark';
  const { logicalTodayYmd } = useDayBoundary();

  const [counts, setCounts] = React.useState<Awaited<ReturnType<typeof getTaskGlobalInsightCounts>> | null>(null);
  const [events, setEvents] = React.useState<TaskExecutionEventWithTitle[]>([]);
  const [eventsTotal, setEventsTotal] = React.useState(0);
  const [eventsHasMore, setEventsHasMore] = React.useState(false);
  const [eventsLoading, setEventsLoading] = React.useState(true);
  const [eventsLoadingMore, setEventsLoadingMore] = React.useState(false);
  const [heatmapGrid, setHeatmapGrid] = React.useState<HeatmapCell[][]>([]);
  const [heatMax, setHeatMax] = React.useState(0);
  const [heatWeeks, setHeatWeeks] = React.useState(14);
  const [minDataYmd, setMinDataYmd] = React.useState<string | null>(null);
  const [heatmapLayoutW, setHeatmapLayoutW] = React.useState(0);
  const [cellSize, setCellSize] = React.useState(17);
  const [cellGap, setCellGap] = React.useState(6);
  const [rowLabelW, setRowLabelW] = React.useState(26);

  const [selectedHeatYmd, setSelectedHeatYmd] = React.useState<string | null>(null);
  const [selectedHeatCount, setSelectedHeatCount] = React.useState(0);
  const [selectedHeatInRange, setSelectedHeatInRange] = React.useState(true);
  const [dayEvents, setDayEvents] = React.useState<Awaited<ReturnType<typeof getNetCompletedTaskEventsForLocalDay>>>([]);
  const [dayEventsLoading, setDayEventsLoading] = React.useState(false);

  const [selectedStatKey, setSelectedStatKey] = React.useState<OverviewStatKey | null>(null);
  const [statTasks, setStatTasks] = React.useState<TaskRow[]>([]);
  const [statEvents, setStatEvents] = React.useState<TaskExecutionEventWithTitle[]>([]);
  const [statEventsTotal, setStatEventsTotal] = React.useState(0);
  const [statEventsHasMore, setStatEventsHasMore] = React.useState(false);
  const [statEventsLoadingMore, setStatEventsLoadingMore] = React.useState(false);
  const [statLoading, setStatLoading] = React.useState(false);

  const screenW = Dimensions.get('window').width;
  const approxCardInner = Math.max(200, screenW - 18 * 2 - 16 * 2);

  const heatLayout = React.useMemo(() => {
    const w = heatmapLayoutW > 40 ? heatmapLayoutW : approxCardInner;
    return computeHeatLayout(w);
  }, [heatmapLayoutW, approxCardInner]);

  const loadOverview = React.useCallback(async (weeks: number) => {
    const { startYmd, endYmd } = heatmapGridDayRange(weeks, logicalTodayYmd);
    const [c, dayMap, firstDay] = await Promise.all([
      getTaskGlobalInsightCounts(),
      getTaskCompletionCountsByDayRange(startYmd, endYmd),
      getFirstCompletedEventDayYmd(),
    ]);
    let maxC = 0;
    for (const v of dayMap.values()) {
      if (v > maxC) maxC = v;
    }
    const grid = buildGlobalTaskHeatmapGrid(weeks, dayMap, firstDay, logicalTodayYmd);
    setHeatWeeks(weeks);
    setCounts(c);
    setHeatmapGrid(grid);
    setHeatMax(maxC);
    setMinDataYmd(firstDay);
  }, [logicalTodayYmd]);

  const loadEventsFirstPage = React.useCallback(async () => {
    setEventsLoading(true);
    try {
      const [total, page] = await Promise.all([
        countTaskExecutionEventsInScope(),
        getRecentTaskExecutionEventsPage(HISTORY_PAGE_SIZE, 0),
      ]);
      setEventsTotal(total);
      setEvents(page);
      setEventsHasMore(page.length < total);
    } catch (e) {
      console.warn('加载执行历史失败', e);
      setEventsTotal(0);
      setEvents([]);
      setEventsHasMore(false);
    } finally {
      setEventsLoading(false);
    }
  }, []);

  const loadMoreEvents = React.useCallback(async () => {
    if (eventsLoading || eventsLoadingMore || !eventsHasMore || selectedHeatYmd || selectedStatKey) return;
    setEventsLoadingMore(true);
    try {
      const page = await getRecentTaskExecutionEventsPage(HISTORY_PAGE_SIZE, events.length);
      setEvents((prev) => {
        const merged = [...prev, ...page];
        setEventsHasMore(merged.length < eventsTotal);
        return merged;
      });
    } catch (e) {
      console.warn('加载更多执行历史失败', e);
    } finally {
      setEventsLoadingMore(false);
    }
  }, [
    events.length,
    eventsHasMore,
    eventsLoading,
    eventsLoadingMore,
    eventsTotal,
    selectedHeatYmd,
    selectedStatKey,
  ]);

  const loadMoreStatEvents = React.useCallback(async () => {
    const card = selectedStatKey ? STAT_CARDS.find((c) => c.key === selectedStatKey) : null;
    if (!card?.eventAction || statLoading || statEventsLoadingMore || !statEventsHasMore || selectedHeatYmd) return;
    setStatEventsLoadingMore(true);
    try {
      const page = await getTaskExecutionEventsByActionPage(card.eventAction, HISTORY_PAGE_SIZE, statEvents.length);
      setStatEvents((prev) => {
        const merged = [...prev, ...page];
        setStatEventsHasMore(merged.length < statEventsTotal);
        return merged;
      });
    } catch (e) {
      console.warn('加载更多概况执行记录失败', e);
    } finally {
      setStatEventsLoadingMore(false);
    }
  }, [selectedHeatYmd, selectedStatKey, statEvents.length, statEventsHasMore, statEventsLoadingMore, statEventsTotal, statLoading]);

  const reload = React.useCallback(async (forceApi = false) => {
    await wrapLoad(async () => {
      await Promise.all([loadOverview(heatLayout.weeks), loadEventsFirstPage()]);
    }, forceApi);
  }, [heatLayout.weeks, loadEventsFirstPage, loadOverview, wrapLoad]);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    React.useCallback(() => {
      void reload().catch((e) => console.warn('加载待办总览失败', e));
    }, [reload])
  );

  const handleMainScroll = React.useCallback(
    (event: {
      nativeEvent: { contentOffset: { y: number }; layoutMeasurement: { height: number }; contentSize: { height: number } };
    }) => {
      if (selectedHeatYmd) return;
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const distanceToBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
      if (distanceToBottom >= 80) return;
      if (selectedStatKey) {
        const card = STAT_CARDS.find((c) => c.key === selectedStatKey);
        if (card?.listMode === 'events') void loadMoreStatEvents();
      } else {
        void loadMoreEvents();
      }
    },
    [loadMoreEvents, loadMoreStatEvents, selectedHeatYmd, selectedStatKey]
  );

  React.useEffect(() => {
    setCellSize(heatLayout.cell);
    setCellGap(heatLayout.gap);
    setRowLabelW(heatLayout.rowLabel);
  }, [heatLayout.cell, heatLayout.gap, heatLayout.rowLabel]);

  React.useEffect(() => {
    if (!selectedHeatYmd) {
      setDayEvents([]);
      setDayEventsLoading(false);
      return;
    }
    let cancelled = false;
    setDayEventsLoading(true);
    getNetCompletedTaskEventsForLocalDay(selectedHeatYmd)
      .then((rows) => {
        if (!cancelled) setDayEvents(rows);
      })
      .catch((e) => {
        console.warn('加载某日执行记录失败', e);
        if (!cancelled) setDayEvents([]);
      })
      .finally(() => {
        if (!cancelled) setDayEventsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedHeatYmd]);

  const clearStatSelection = React.useCallback(() => {
    setSelectedStatKey(null);
    setStatTasks([]);
    setStatEvents([]);
    setStatEventsTotal(0);
    setStatEventsHasMore(false);
    setStatEventsLoadingMore(false);
    setStatLoading(false);
  }, []);

  const onHeatCellPress = React.useCallback((cellData: HeatmapCell) => {
    if (selectedHeatYmd === cellData.ymd) {
      setSelectedHeatYmd(null);
      setSelectedHeatCount(0);
      setSelectedHeatInRange(true);
      return;
    }
    clearStatSelection();
    setSelectedHeatYmd(cellData.ymd);
    setSelectedHeatCount(cellData.count);
    setSelectedHeatInRange(cellData.inRange);
  }, [clearStatSelection, selectedHeatYmd]);

  const clearHeatSelection = React.useCallback(() => {
    setSelectedHeatYmd(null);
    setSelectedHeatCount(0);
    setSelectedHeatInRange(true);
  }, []);

  const onStatCardPress = React.useCallback(
    (key: OverviewStatKey) => {
      if (selectedStatKey === key) {
        clearStatSelection();
        return;
      }
      clearHeatSelection();
      setSelectedStatKey(key);
    },
    [clearHeatSelection, clearStatSelection, selectedStatKey]
  );

  React.useEffect(() => {
    if (!selectedStatKey) return;
    const card = STAT_CARDS.find((c) => c.key === selectedStatKey);
    if (!card) return;
    let cancelled = false;
    setStatLoading(true);
    setStatEvents([]);
    setStatEventsTotal(0);
    setStatEventsHasMore(false);
    setStatEventsLoadingMore(false);
    const run = async () => {
      try {
        if (card.listMode === 'tasks') {
          const rows = await getTasksForOverviewList(
            card.key === 'open' ? 'open' : card.key === 'doneOrCancelled' ? 'doneOrCancelled' : 'totalActive'
          );
          if (!cancelled) {
            setStatTasks(rows);
            setStatEvents([]);
          }
        } else if (card.eventAction) {
          const [total, rows] = await Promise.all([
            countTaskExecutionEventsByAction(card.eventAction),
            getTaskExecutionEventsByActionPage(card.eventAction, HISTORY_PAGE_SIZE, 0),
          ]);
          if (!cancelled) {
            setStatEventsTotal(total);
            setStatEvents(rows);
            setStatEventsHasMore(rows.length < total);
            setStatEventsLoadingMore(false);
            setStatTasks([]);
          }
        }
      } catch (e) {
        console.warn('加载概况明细失败', e);
        if (!cancelled) {
          setStatTasks([]);
          setStatEvents([]);
        }
      } finally {
        if (!cancelled) setStatLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedStatKey]);

  const selectedStatCard = React.useMemo(
    () => (selectedStatKey ? STAT_CARDS.find((c) => c.key === selectedStatKey) : null),
    [selectedStatKey]
  );

  const clearListSelection = React.useCallback(() => {
    clearHeatSelection();
    clearStatSelection();
  }, [clearHeatSelection, clearStatSelection]);

  const showClearSelection = !!selectedHeatYmd || !!selectedStatKey;

  const bg = isDark ? theme.background : '#faf8ff';
  const surface = isDark ? 'rgba(30, 41, 59, 0.70)' : '#ffffff';
  const surfaceLow = isDark ? 'rgba(15, 23, 42, 0.55)' : '#f2f3ff';
  const border = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.55)';
  const outline = isDark ? 'rgba(148,163,184,0.7)' : '#727785';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['top']}>
      <View style={[styles.topBar, { backgroundColor: isDark ? 'rgba(15,23,42,0.75)' : 'rgba(250,248,255,0.86)', borderBottomColor: border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}>
          <MaterialIcons name="arrow-back" size={22} color={primary} />
        </Pressable>
        <Text style={[styles.topTitle, { color: theme.text }]}>待办总览</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={[styles.content, { paddingBottom: 32 }]}
        showsVerticalScrollIndicator={false}
        onScroll={handleMainScroll}
        scrollEventThrottle={16}>
        <Text style={[styles.hint, { color: outline }]}>
          仅统计任务页顶部「待办」中的独立项，不含「任务列表」四象限内的项目/子任务。完成与恢复记录在勾选时写入本地库；删除后仍保留标题快照。点击概况卡片或热力图格子，在下方「执行历史」查看明细；再次点击可取消选中。
        </Text>

        <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
          <Text style={[styles.sectionLabel, { color: outline }]}>概况</Text>
          {counts ? (
            <View style={styles.statsGrid}>
              {STAT_CARDS.map((card) => {
                const selected = selectedStatKey === card.key;
                const valColor =
                  card.valueColor === 'secondary' ? secondary : card.valueColor === 'primary' ? primary : theme.text;
                return (
                  <Pressable
                    key={card.key}
                    onPress={() => onStatCardPress(card.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${card.label}，${counts[card.countKey]}，点击查看明细`}
                    style={({ pressed }) => [
                      styles.statBox,
                      {
                        backgroundColor: selected ? (isDark ? 'rgba(96,165,250,0.14)' : 'rgba(0,88,190,0.08)') : surfaceLow,
                        borderColor: selected ? primary : border,
                        borderWidth: selected ? 2 : 1,
                        opacity: pressed ? 0.88 : 1,
                      },
                    ]}>
                    <Text style={[styles.statVal, { color: valColor }]}>{counts[card.countKey]}</Text>
                    <Text style={[styles.statLbl, { color: outline }]}>{card.label}</Text>
                    {selected ? (
                      <Text style={[styles.statTapHint, { color: primary }]}>已选中 · 见下方列表</Text>
                    ) : (
                      <Text style={[styles.statTapHint, { color: outline }]}>点击查看</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={{ color: outline, fontWeight: '600' }}>加载中…</Text>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
          <Text style={[styles.sectionLabel, { color: outline }]}>完成热力图</Text>
          <Text style={[styles.subHint, { color: outline }]}>
            近 {heatWeeks} 周 · 每日「标记完成」次数（格子宽度随屏幕铺满）
            {minDataYmd ? ` · 最早记录 ${minDataYmd}` : ''}
          </Text>
          <View
            style={{ width: '100%' }}
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              if (w > 40 && Math.abs(w - heatmapLayoutW) > 1) setHeatmapLayoutW(w);
            }}>
            {heatmapGrid.length > 0 ? (
              <GlobalHeatmap
                grid={heatmapGrid}
                maxCount={heatMax}
                cell={cellSize}
                gap={cellGap}
                rowLabelWidth={rowLabelW}
                emptyBg={isDark ? 'rgba(148,163,184,0.12)' : 'rgba(194,198,214,0.35)'}
                fillLow={isDark ? 'rgba(52,211,153,0.28)' : 'rgba(0,108,73,0.22)'}
                fillMid={isDark ? 'rgba(52,211,153,0.48)' : 'rgba(0,108,73,0.45)'}
                fillHigh={isDark ? 'rgba(52,211,153,0.78)' : 'rgba(0,108,73,0.72)'}
                border={border}
                muted={outline}
                selectedYmd={selectedHeatYmd}
                accentColor={primary}
                onCellPress={onHeatCellPress}
              />
            ) : null}
          </View>
          <View style={styles.legendRow}>
            <Text style={[styles.legendText, { color: outline }]}>较少</Text>
            <View style={[styles.legendDot, { backgroundColor: isDark ? 'rgba(52,211,153,0.28)' : 'rgba(0,108,73,0.22)', borderColor: border }]} />
            <View style={[styles.legendDot, { backgroundColor: isDark ? 'rgba(52,211,153,0.48)' : 'rgba(0,108,73,0.45)', borderColor: border }]} />
            <View style={[styles.legendDot, { backgroundColor: isDark ? 'rgba(52,211,153,0.78)' : 'rgba(0,108,73,0.72)', borderColor: border }]} />
            <Text style={[styles.legendText, { color: outline }]}>较多</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
          <View style={styles.historyHeaderRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.sectionLabel, { color: outline }]}>执行历史</Text>
              {selectedStatCard ? (
                <Text style={[styles.subHint, { color: outline, marginTop: 6 }]}>
                  {selectedStatCard.label}
                  {selectedStatCard.listMode === 'events' && !statLoading
                    ? ` · 已加载 ${statEvents.length} / ${statEventsTotal || counts?.[selectedStatCard.countKey] || 0} 条`
                    : ` · 共 ${counts?.[selectedStatCard.countKey] ?? 0} 条`}
                </Text>
              ) : selectedHeatYmd ? (
                <Text style={[styles.subHint, { color: outline, marginTop: 6 }]}>
                  {formatYmdTitleCN(selectedHeatYmd)}
                  {selectedHeatInRange ? ` · 当日标记完成 ${selectedHeatCount} 次` : ' · 该日不在热力图统计范围内'}
                </Text>
              ) : (
                <Text style={[styles.subHint, { color: outline, marginTop: 6 }]}>
                  {eventsLoading
                    ? '加载中…'
                    : eventsTotal > 0
                      ? `已加载 ${events.length} / ${eventsTotal} 条（全待办合并，下滑加载更多）`
                      : '暂无记录'}
                </Text>
              )}
            </View>
            {showClearSelection ? (
              <Pressable
                onPress={clearListSelection}
                style={({ pressed }) => [
                  styles.clearSelectionBtn,
                  { borderColor: `${primary}55`, opacity: pressed ? 0.75 : 1 },
                ]}>
                <MaterialIcons name="close" size={16} color={primary} />
                <Text style={[styles.clearSelectionText, { color: primary }]}>取消选中</Text>
              </Pressable>
            ) : null}
          </View>

          {selectedStatKey ? (
            statLoading ? (
              <View style={styles.dayHistLoading}>
                <ActivityIndicator color={primary} />
                <Text style={[styles.dayHistLoadingText, { color: outline }]}>加载明细…</Text>
              </View>
            ) : selectedStatCard?.listMode === 'tasks' ? (
              statTasks.length === 0 ? (
                <Text style={[styles.emptyHist, { color: theme.textSecondary }]}>暂无符合条件的待办。</Text>
              ) : (
                statTasks.map((t, idx) => (
                  <Pressable
                    key={t.id}
                    onPress={() =>
                      router.push(
                        isStandaloneTodoTask(t) ? standaloneTodoEditorHref(t.id) : { pathname: '/task/[id]', params: { id: t.id } },
                      )
                    }
                    style={({ pressed }) => [
                      styles.histRow,
                      { borderBottomColor: border, opacity: pressed ? 0.86 : 1 },
                      idx === statTasks.length - 1 ? { borderBottomWidth: 0 } : null,
                    ]}>
                    <View
                      style={[
                        styles.histDot,
                        { backgroundColor: t.status === 'done' || t.status === 'cancelled' ? secondary : primary },
                      ]}
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.histTitle, { color: theme.text }]} numberOfLines={2}>
                        {t.title?.trim() || '（无标题）'}
                      </Text>
                      <Text style={[styles.histMeta, { color: outline }]}>
                        {formatTaskStatus(t.status)}
                        {t.due_date?.trim() ? ` · 截止 ${t.due_date.slice(0, 10)}` : ''}
                        {t.updated_at ? ` · 更新 ${formatDateTimeCN(t.updated_at)}` : ''}
                      </Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={20} color={outline} />
                  </Pressable>
                ))
              )
            ) : statEvents.length === 0 ? (
              <Text style={[styles.emptyHist, { color: theme.textSecondary }]}>暂无执行记录。</Text>
            ) : (
              <>
                {statEvents.map((e, idx) => (
                  <View
                    key={e.id}
                    style={[
                      styles.histRow,
                      { borderBottomColor: border },
                      idx === statEvents.length - 1 && !statEventsHasMore && !statEventsLoadingMore
                        ? { borderBottomWidth: 0 }
                        : null,
                    ]}>
                    <View style={[styles.histDot, { backgroundColor: e.action === 'completed' ? secondary : primary }]} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.histTitle, { color: theme.text }]} numberOfLines={2}>
                        {e.task_title?.trim() || '（待办已删除或不可用）'}
                      </Text>
                      <Text style={[styles.histMeta, { color: outline }]}>
                        {actionLabel(e.action)} · {formatDateTimeCN(e.created_at)}
                      </Text>
                    </View>
                  </View>
                ))}
                {statEventsHasMore || statEventsLoadingMore ? (
                  <View style={styles.dayHistLoading}>
                    {statEventsLoadingMore ? <ActivityIndicator color={primary} /> : null}
                    <Text style={[styles.dayHistLoadingText, { color: outline }]}>
                      {statEventsLoadingMore
                        ? '加载更多…'
                        : `已加载 ${statEvents.length} / ${statEventsTotal} 条，继续下滑加载更多`}
                    </Text>
                  </View>
                ) : null}
              </>
            )
          ) : selectedHeatYmd ? (
            dayEventsLoading ? (
              <View style={styles.dayHistLoading}>
                <ActivityIndicator color={primary} />
                <Text style={[styles.dayHistLoadingText, { color: outline }]}>加载该日记录…</Text>
              </View>
            ) : dayEvents.length === 0 ? (
              <Text style={[styles.emptyHist, { color: theme.textSecondary }]}>该日暂无执行记录。</Text>
            ) : (
              dayEvents.map((e, idx) => (
                <View
                  key={e.id}
                  style={[
                    styles.histRow,
                    { borderBottomColor: border },
                    idx === dayEvents.length - 1 ? { borderBottomWidth: 0 } : null,
                  ]}>
                  <View style={[styles.histDot, { backgroundColor: e.action === 'completed' ? secondary : primary }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.histTitle, { color: theme.text }]} numberOfLines={2}>
                      {e.task_title?.trim() || '（待办已删除或不可用）'}
                    </Text>
                    <Text style={[styles.histMeta, { color: outline }]}>
                      {actionLabel(e.action)} · {formatDateTimeCN(e.created_at)}
                    </Text>
                  </View>
                </View>
              ))
            )
          ) : eventsLoading ? (
            <View style={styles.dayHistLoading}>
              <ActivityIndicator color={primary} />
              <Text style={[styles.dayHistLoadingText, { color: outline }]}>加载执行历史…</Text>
            </View>
          ) : events.length === 0 ? (
            <Text style={[styles.emptyHist, { color: theme.textSecondary }]}>暂无记录。请在任务清单中勾选完成或恢复待办。</Text>
          ) : (
            <>
              {events.map((e, idx) => (
                <View
                  key={e.id}
                  style={[
                    styles.histRow,
                    { borderBottomColor: border },
                    idx === events.length - 1 && !eventsHasMore && !eventsLoadingMore ? { borderBottomWidth: 0 } : null,
                  ]}>
                  <View style={[styles.histDot, { backgroundColor: e.action === 'completed' ? secondary : primary }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.histTitle, { color: theme.text }]} numberOfLines={2}>
                      {e.task_title?.trim() || '（待办已删除或不可用）'}
                    </Text>
                    <Text style={[styles.histMeta, { color: outline }]}>
                      {actionLabel(e.action)} · {formatDateTimeCN(e.created_at)}
                    </Text>
                  </View>
                </View>
              ))}
              {eventsHasMore || eventsLoadingMore ? (
                <View style={styles.dayHistLoading}>
                  {eventsLoadingMore ? <ActivityIndicator color={primary} /> : null}
                  <Text style={[styles.dayHistLoadingText, { color: outline }]}>
                    {eventsLoadingMore ? '加载更多…' : '继续下滑加载更多'}
                  </Text>
                </View>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    height: 56,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 38, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
  content: { paddingHorizontal: 18, paddingTop: 16, gap: 18 },
  hint: { fontSize: 12, fontWeight: '600', lineHeight: 18, marginBottom: 2 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  subHint: { fontSize: 11, fontWeight: '600', lineHeight: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statBox: {
    flexGrow: 1,
    flexBasis: '28%',
    minWidth: 100,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  statVal: { fontSize: 20, fontWeight: '900' },
  statLbl: { fontSize: 10, fontWeight: '800', marginTop: 4, textAlign: 'center' },
  statTapHint: { fontSize: 9, fontWeight: '700', marginTop: 6, textAlign: 'center' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  legendText: { fontSize: 10, fontWeight: '700' },
  legendDot: { width: 10, height: 10, borderRadius: 2, borderWidth: StyleSheet.hairlineWidth },
  emptyHist: { fontSize: 13, fontWeight: '600', paddingVertical: 8 },
  histRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
  },
  histDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  histTitle: { fontSize: 14, fontWeight: '800', lineHeight: 20 },
  histMeta: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  historyHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  clearSelectionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexShrink: 0,
  },
  clearSelectionText: { fontSize: 12, fontWeight: '800' },
  dayHistLoading: { paddingVertical: 20, alignItems: 'center', gap: 10 },
  dayHistLoadingText: { fontSize: 12, fontWeight: '600' },
});
