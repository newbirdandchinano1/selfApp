/**
 * 完成热力 · 单日展开 — 对齐设计稿 shot 05 / motion 04·16
 * 入场：数据就绪后卡片 riseIn 520ms/42ms + 点阵按列错峰绽放（--i=c*7+r，12ms）
 * 选中：双环（不放大、不改占位）· 明细 300ms 展开（列表不整体重播）· 400ms 防抖
 * 减弱动效：去掉绽放/滚动，仅 120ms 透明度
 */
import {
  FOLD_MOTION_EASE,
  FOLD_MOTION_SPRING,
  FoldCountUpText,
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { HeatBloomCell } from '@/components/tasks/heat-bloom-cell';
import { ScreenHeader, ScreenHeaderIconAction } from '@/components/ui';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { addDays, formatYmd, parseYmd } from '@/lib/date';
import { openFrogHeatmapItem } from '@/lib/open-frog-heatmap-item';
import { getHabits } from '@/lib/repositories/habits/habit';
import { getHabitCheckInCountsByDateRange } from '@/lib/repositories/habits/habit-check-in';
import type { FrogCompletionDayItem } from '@/lib/repositories/tasks/frog-completion-events';
import type { TaskExecutionEventWithTitle } from '@/lib/repositories/tasks/task-execution-events';
import { getProjects } from '@/lib/repositories/projects/project';
import {
  fetchCompletionHeatmap,
  fetchCompletionHeatmapDayDetail,
} from '@/lib/tasks-completion-heatmap-api';
import {
  computeMonthlyAverageMap,
  heatmapLevelFromMonthlyAverage,
} from '@/lib/tasks-global-heatmap';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const HEAT_WEEKS = 16;
/** 设计稿 `.hmap-lg` 基准 12px；按卡片可用宽度放大铺满，高度随格等比 */
const CELL_MIN = 12;
const CELL_MAX = 20;
const CELL_GAP = 3;
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'] as const;
/** 设计稿 `.motion-run .anim-item` */
const PAGE_RISE_MS = 520;
const PAGE_STAGGER_MS = 42;

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addLocalDays(d: Date, n: number): Date {
  return addDays(startOfLocalDay(d), n);
}

function mondayOfWeekContaining(d: Date): Date {
  const sod = startOfLocalDay(d);
  const dow = sod.getDay();
  const deltaMon = dow === 0 ? -6 : 1 - dow;
  return addLocalDays(sod, deltaMon);
}

function mergeDailyCountMaps(...maps: Map<string, number>[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const map of maps) {
    for (const [ymd, count] of map) {
      merged.set(ymd, (merged.get(ymd) ?? 0) + count);
    }
  }
  return merged;
}

function sumCountsInRange(map: Map<string, number>, startYmd: string, endYmd: string): number {
  let n = 0;
  for (const [ymd, c] of map) {
    if (ymd >= startYmd && ymd <= endYmd) n += c;
  }
  return n;
}

function weekdayLabel(ymd: string): string {
  const d = parseYmd(ymd);
  if (!d) return '';
  return `周${WEEKDAY[d.getDay()]}`;
}

function shortMonthDay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  return `${Number(m[2])}月${Number(m[3])}日`;
}

type HeatCell = { level: number | null; ymd: string | null; count: number };

type HabitDayItem = {
  id: string;
  name: string;
  icon: string;
  count: number;
};

function HistRow({
  icon,
  title,
  meta,
  right,
  pts,
  onPress,
  ink,
  muted,
  frog,
  riseAnimate,
  riseIndex,
  riseDuration = PAGE_RISE_MS,
  riseStagger = PAGE_STAGGER_MS,
  riseFromY = 10,
}: {
  icon: React.ReactNode;
  title: string;
  meta: string;
  right?: string;
  pts?: string;
  onPress?: () => void;
  ink: string;
  muted: string;
  frog: string;
  /** 首次展开明细时级联；切日不重播 */
  riseAnimate?: boolean;
  riseIndex?: number;
  riseDuration?: number;
  riseStagger?: number;
  riseFromY?: number;
}) {
  const row = (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.histrow, pressed && onPress ? { opacity: 0.85 } : null]}>
      <View style={styles.hi}>{icon}</View>
      <View style={styles.hc2}>
        <Text style={[styles.histTitle, { color: ink }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.histMeta, { color: muted }]} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      {right ? (
        <Text style={[styles.ht2, { color: muted }]}>{right}</Text>
      ) : null}
      {pts ? (
        <Text style={[styles.pts, { color: frog }]}>{pts}</Text>
      ) : null}
      {onPress ? (
        <MaterialIcons name="chevron-right" size={16} color={muted} style={{ marginLeft: 2 }} />
      ) : null}
    </Pressable>
  );
  if (!riseAnimate) return row;
  return (
    <FoldRiseIn
      animate
      index={riseIndex ?? 0}
      duration={riseDuration}
      staggerMs={riseStagger}
      fromY={riseFromY}
      holdHidden>
      {row}
    </FoldRiseIn>
  );
}

export default function CompletionHeatmapScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ day?: string }>();
  const { colors, isDark } = useAppTheme();
  const { tf, fonts } = useTaskFoldTheme();
  const { animate, motionReduced, motionReady } = useFoldMotionGate();
  const { boundary: dayBoundary, logicalTodayYmd } = usePageDayBoundary('tasks');

  const heatColors = [tf.heat0, tf.heat1, tf.heat2, tf.heat3, tf.heat4, tf.heat5] as const;

  const [mapWidth, setMapWidth] = React.useState(0);
  const cellSize = React.useMemo(() => {
    if (mapWidth <= 0) return CELL_MIN;
    const gaps = (HEAT_WEEKS - 1) * CELL_GAP;
    const raw = (mapWidth - gaps) / HEAT_WEEKS;
    return Math.min(CELL_MAX, Math.max(CELL_MIN, Math.floor(raw * 10) / 10));
  }, [mapWidth]);
  const onMapLayout = React.useCallback((e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    setMapWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
  }, []);
  /**
   * 明细行级联：首次展开（含带日进页 / 点格展开）播一次；
   * 切日不重播（设计稿：「列表不整体重播」）；取消选中后再展开可再播。
   */
  const [listEntranceArmed, setListEntranceArmed] = React.useState(false);
  const [listEntranceToken, setListEntranceToken] = React.useState(0);
  /** 已决定播/跳过级联后才挂载行，避免先闪静态再入场 */
  const [listRevealed, setListRevealed] = React.useState(false);
  const listEntranceSessionRef = React.useRef<'idle' | 'pending' | 'played'>('idle');

  const [selectedYmd, setSelectedYmd] = React.useState<string | null>(
    typeof params.day === 'string' && params.day ? params.day : null,
  );
  const [frogCountByYmd, setFrogCountByYmd] = React.useState<Map<string, number>>(new Map());
  const [todoCountByYmd, setTodoCountByYmd] = React.useState<Map<string, number>>(new Map());
  const [habitCountByYmd, setHabitCountByYmd] = React.useState<Map<string, number>>(new Map());
  const [projects, setProjects] = React.useState<Array<{ id: string; name: string }>>([]);
  const [frogItems, setFrogItems] = React.useState<FrogCompletionDayItem[]>([]);
  const [todoItems, setTodoItems] = React.useState<TaskExecutionEventWithTitle[]>([]);
  const [habitItems, setHabitItems] = React.useState<HabitDayItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [dayLoading, setDayLoading] = React.useState(false);
  const [bloomKey, setBloomKey] = React.useState(0);
  const bloomPlayedRef = React.useRef(false);
  const detailH = React.useRef(new Animated.Value(0)).current;
  const [detailMeasured, setDetailMeasured] = React.useState(0);
  const refreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const combined = React.useMemo(
    () => mergeDailyCountMaps(frogCountByYmd, todoCountByYmd, habitCountByYmd),
    [frogCountByYmd, todoCountByYmd, habitCountByYmd],
  );

  const heatmapRange = React.useMemo(() => {
    const todayCal = startOfLocalDay(new Date());
    const thisMonday = mondayOfWeekContaining(todayCal);
    const gridStartMonday = addLocalDays(thisMonday, -(HEAT_WEEKS - 1) * 7);
    return { startYmd: formatYmd(gridStartMonday), endYmd: logicalTodayYmd };
  }, [logicalTodayYmd]);

  const loadAll = React.useCallback(async () => {
    setLoading(true);
    try {
      const [heat, projectRows, habits] = await Promise.all([
        fetchCompletionHeatmap({
          boundary: dayBoundary,
          heatmapStart: heatmapRange.startYmd,
          heatmapEnd: heatmapRange.endYmd,
        }),
        getProjects().catch(() => []),
        getHabits().catch(() => []),
      ]);
      setFrogCountByYmd(heat.frogCountByYmd);
      setTodoCountByYmd(heat.todoCountByYmd);
      setProjects(projectRows.map((p) => ({ id: p.id, name: p.name })));

      const habitIds = new Set(habits.map((h) => h.id));
      const habitDayMaps = await getHabitCheckInCountsByDateRange(
        heatmapRange.startYmd,
        heatmapRange.endYmd,
        { habitIds },
      );
      const habitTotals = new Map<string, number>();
      for (const [ymd, byHabit] of habitDayMaps) {
        let n = 0;
        for (const c of byHabit.values()) if (c > 0) n += 1;
        habitTotals.set(ymd, n);
      }
      setHabitCountByYmd(habitTotals);

      if (!bloomPlayedRef.current) {
        bloomPlayedRef.current = true;
        setBloomKey((k) => k + 1);
      }
    } catch (e) {
      console.warn('[completion-heatmap] 加载失败', e);
    } finally {
      setLoading(false);
    }
  }, [dayBoundary, heatmapRange.endYmd, heatmapRange.startYmd]);

  useFocusEffect(
    React.useCallback(() => {
      void loadAll();
      return () => {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
      };
    }, [loadAll]),
  );

  const scheduleRefresh = React.useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      void loadAll();
    }, TaskFoldMotion.heatRefreshDebounce);
  }, [loadAll]);

  React.useEffect(() => {
    if (!selectedYmd) {
      setFrogItems([]);
      setTodoItems([]);
      setHabitItems([]);
      listEntranceSessionRef.current = 'idle';
      setListEntranceArmed(false);
      setListRevealed(false);
      Animated.timing(detailH, {
        toValue: 0,
        duration: animate ? TaskFoldMotion.heatDetail : 0,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: false,
      }).start();
      return;
    }

    // 从无选中 → 有选中：准备级联；切日保持 played，不重播
    if (listEntranceSessionRef.current === 'idle') {
      listEntranceSessionRef.current = 'pending';
    }

    let cancelled = false;
    setDayLoading(true);
    void (async () => {
      try {
        const [detail, habits, habitDayMaps] = await Promise.all([
          fetchCompletionHeatmapDayDetail({
            day: selectedYmd,
            boundary: dayBoundary,
            heatmapStart: heatmapRange.startYmd,
            heatmapEnd: heatmapRange.endYmd,
            projects,
          }),
          getHabits().catch(() => []),
          getHabitCheckInCountsByDateRange(selectedYmd, selectedYmd).catch(
            () => new Map<string, Map<string, number>>(),
          ),
        ]);
        if (cancelled) return;
        setFrogItems(detail.frogItems);
        setTodoItems(detail.todoItems);
        const dayHabits = habitDayMaps.get(selectedYmd) ?? new Map();
        const items: HabitDayItem[] = [];
        for (const h of habits) {
          const c = dayHabits.get(h.id) ?? 0;
          if (c > 0) {
            items.push({
              id: h.id,
              name: h.name?.trim() || '习惯',
              icon: h.icon?.trim() || '🌿',
              count: c,
            });
          }
        }
        setHabitItems(items);
      } catch (e) {
        if (!cancelled) {
          console.warn('[completion-heatmap] 日明细失败', e);
          setFrogItems([]);
          setTodoItems([]);
          setHabitItems([]);
        }
      } finally {
        if (!cancelled) setDayLoading(false);
      }
    })();

    Animated.timing(detailH, {
      toValue: 1,
      duration: animate ? TaskFoldMotion.heatDetail : 0,
      easing: FOLD_MOTION_SPRING,
      useNativeDriver: false,
    }).start();

    return () => {
      cancelled = true;
    };
  }, [
    animate,
    dayBoundary,
    detailH,
    heatmapRange.endYmd,
    heatmapRange.startYmd,
    projects,
    selectedYmd,
  ]);

  const weekColumns = React.useMemo(() => {
    const todayCal = startOfLocalDay(new Date());
    const thisMonday = mondayOfWeekContaining(todayCal);
    const gridStartMonday = addLocalDays(thisMonday, -(HEAT_WEEKS - 1) * 7);
    const cols: { cells: HeatCell[] }[] = [];
    const validDayYmds: string[] = [];
    for (let c = 0; c < HEAT_WEEKS; c++) {
      const monday = addLocalDays(gridStartMonday, c * 7);
      const cells: HeatCell[] = [];
      for (let r = 0; r < 7; r++) {
        const day = addLocalDays(monday, r);
        const ymd = formatYmd(day);
        if (ymd > logicalTodayYmd) {
          cells.push({ level: null, ymd: null, count: 0 });
        } else {
          validDayYmds.push(ymd);
          cells.push({ level: 0, ymd, count: combined.get(ymd) ?? 0 });
        }
      }
      cols.push({ cells });
    }
    const monthAvgMap = computeMonthlyAverageMap(validDayYmds, combined);
    for (const col of cols) {
      for (const cell of col.cells) {
        if (!cell.ymd) continue;
        cell.level = heatmapLevelFromMonthlyAverage(
          cell.count,
          cell.ymd.slice(0, 7),
          monthAvgMap,
        );
      }
    }
    return cols;
  }, [combined, logicalTodayYmd]);

  const thisMonday = React.useMemo(() => mondayOfWeekContaining(startOfLocalDay(new Date())), []);
  const weekTotal = sumCountsInRange(combined, formatYmd(thisMonday), logicalTodayYmd);

  const frogCount = dayLoading
    ? frogCountByYmd.get(selectedYmd ?? '') ?? 0
    : frogItems.length;
  const todoCount = dayLoading
    ? todoCountByYmd.get(selectedYmd ?? '') ?? 0
    : todoItems.length;
  const habitCount = dayLoading
    ? habitCountByYmd.get(selectedYmd ?? '') ?? 0
    : habitItems.length;

  const sealed =
    selectedYmd != null && selectedYmd < logicalTodayYmd
      ? '逻辑日已封存'
      : selectedYmd === logicalTodayYmd
        ? '逻辑日进行中'
        : '';

  /** 数据 + 动效偏好就绪后再统一入场，避免先以减弱动效播完、完整绽放丢失 */
  const enterReady = bloomKey > 0 && motionReady;
  /** 减弱动效仍播 120ms 透明度；完整动效才做位移 / 绽放 */
  const pageEnterAnimate = enterReady;
  const fullMotion = animate;
  const riseDuration = fullMotion ? PAGE_RISE_MS : 120;
  const riseFromY = fullMotion ? 10 : 0;
  const riseStagger = fullMotion ? PAGE_STAGGER_MS : 0;

  /** 明细数据就绪后武装行级联（点选展开 / 带日进页都走这里） */
  React.useEffect(() => {
    if (!selectedYmd || dayLoading || !enterReady) return;
    if (listEntranceSessionRef.current !== 'pending') return;

    listEntranceSessionRef.current = 'played';
    if (motionReduced || !fullMotion) {
      setListEntranceArmed(false);
      setListRevealed(true);
      return;
    }

    const rowCount = frogItems.length + todoItems.length + habitItems.length;
    setListEntranceToken((n) => n + 1);
    setListEntranceArmed(true);
    setListRevealed(true);
    const t = setTimeout(
      () => setListEntranceArmed(false),
      riseDuration + riseStagger * Math.max(rowCount + 2, 6),
    );
    return () => clearTimeout(t);
  }, [
    dayLoading,
    enterReady,
    frogItems.length,
    fullMotion,
    habitItems.length,
    motionReduced,
    riseDuration,
    riseStagger,
    selectedYmd,
    todoItems.length,
  ]);

  // 切日：session 已是 played，仍要露出新内容（不重播级联）
  React.useEffect(() => {
    if (!selectedYmd || dayLoading || !enterReady) return;
    if (listEntranceSessionRef.current !== 'played') return;
    setListRevealed(true);
  }, [dayLoading, enterReady, selectedYmd]);

  const detailAnimStyle =
    detailMeasured > 0
      ? {
          maxHeight: detailH.interpolate({
            inputRange: [0, 1],
            outputRange: [0, detailMeasured + 24],
          }),
          opacity: detailH,
          overflow: 'hidden' as const,
        }
      : { opacity: detailH };

  let histRiseIndex = 0;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: tf.paper }]} edges={['left', 'right', 'bottom']}>
      <ScreenHeader
        title="完成热力"
        subtitle={`近 ${HEAT_WEEKS} 周 · 逻辑日聚合`}
        onBack={() => router.back()}
        right={
          <ScreenHeaderIconAction
            icon="bar-chart"
            accessibilityLabel="刷新热力"
            onPress={() => scheduleRefresh()}
          />
        }
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}>
        {!enterReady ? (
          <ActivityIndicator color={tf.frog} style={{ marginVertical: 48 }} />
        ) : (
          <FoldRiseIn
            animate={pageEnterAnimate}
            index={0}
            fromY={riseFromY}
            duration={riseDuration}
            staggerMs={riseStagger}
            holdHidden={pageEnterAnimate}>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: isDark ? colors.surfaceMuted : 'rgba(255,252,245,0.92)',
                  borderColor: tf.line2,
                },
              ]}>
              <View style={styles.htop}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.htopTitle, { color: tf.ink2 }]}>每一天的完成密度</Text>
                  <Text style={[styles.htopSub, { color: tf.faint }]}>
                    颜色越深 = 完成越多 · 点击格子展开
                  </Text>
                </View>
                <View style={styles.super}>
                  <FoldCountUpText
                    value={weekTotal}
                    animate={fullMotion && pageEnterAnimate}
                    duration={TaskFoldMotion.countUp}
                    textStyle={[styles.superNum, { color: tf.pond, fontFamily: fonts.mono }]}
                  />
                  <Text style={[styles.superLabel, { color: tf.faint }]}>本周完成次数</Text>
                </View>
              </View>

              <View
                style={[
                  styles.hmap,
                  {
                    gap: CELL_GAP,
                    minHeight: cellSize * 7 + CELL_GAP * 6,
                    paddingVertical: 4,
                  },
                ]}
                onLayout={onMapLayout}
                key={`bloom-${bloomKey}`}>
                {weekColumns.map((col, c) => (
                  <View key={`w-${c}`} style={{ gap: CELL_GAP }}>
                    {col.cells.map((cell, r) => {
                      const isFuture = cell.level === null || !cell.ymd;
                      const selected = !isFuture && cell.ymd === selectedYmd;
                      const isToday = !isFuture && cell.ymd === logicalTodayYmd;
                      const level = isFuture ? 0 : Math.min(5, Math.max(0, cell.level ?? 0));
                      const color = isFuture
                        ? isDark
                          ? 'transparent'
                          : 'rgba(228,222,209,0.45)'
                        : heatColors[level];
                      // 设计稿 buildHeat：--i = c*7+r（按列错峰，视觉斜向扫过）
                      const bloomIndex = c * 7 + r;
                      return (
                        <HeatBloomCell
                          key={`c-${c}-r-${r}`}
                          index={bloomIndex}
                          color={color}
                          selected={!!selected}
                          isToday={!!isToday}
                          disabled={isFuture}
                          onPress={() => {
                            if (!cell.ymd) return;
                            setSelectedYmd((prev) => (prev === cell.ymd ? null : cell.ymd));
                          }}
                          animate={pageEnterAnimate && !isFuture}
                          fullMotion={fullMotion}
                          paper={isDark ? tf.paper : tf.cream}
                          pond={tf.pond}
                          sun={tf.sun}
                          cellSize={cellSize}
                          hitPadding={cellSize >= 16 ? 0 : 2}
                        />
                      );
                    })}
                  </View>
                ))}
              </View>

              <View style={styles.hlegend}>
                <Text style={[styles.legendText, { color: tf.faint }]}>少</Text>
                {heatColors.map((c, i) => (
                  <View key={i} style={[styles.swatch, { backgroundColor: c }]} />
                ))}
                <Text style={[styles.legendText, { color: tf.faint }]}>多</Text>
                <Text style={[styles.legendText, { color: tf.faint, marginLeft: 'auto' }]}>
                  周一 → 周日 · 共 {HEAT_WEEKS} 周
                </Text>
              </View>

              {selectedYmd ? (
                <View style={[styles.selectedday, { borderTopColor: 'rgba(216,205,187,0.6)' }]}>
                  <Text style={[styles.selDate, { color: tf.pond, fontFamily: fonts.serif }]}>
                    {shortMonthDay(selectedYmd)}
                  </Text>
                  <Text style={[styles.selMeta, { color: tf.faint }]}>
                    {weekdayLabel(selectedYmd)}
                    {sealed ? ` · ${sealed}` : ''}
                  </Text>
                  <View style={styles.chips}>
                    <Text style={[styles.chip, { backgroundColor: tf.lily2, color: '#5D7559' }]}>
                      青蛙 {frogCount}
                    </Text>
                    <Text style={[styles.chip, { backgroundColor: tf.lily2, color: '#5D7559' }]}>
                      待办 {todoCount}
                    </Text>
                    <Text style={[styles.chip, { backgroundColor: tf.lily2, color: '#5D7559' }]}>
                      习惯 {habitCount}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
          </FoldRiseIn>
        )}

        <Animated.View style={detailAnimStyle}>
          <View
            onLayout={(e) => {
              const h = Math.ceil(e.nativeEvent.layout.height);
              if (h > 0 && Math.abs(h - detailMeasured) > 2) setDetailMeasured(h);
            }}>
            {selectedYmd ? (
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: isDark ? colors.surfaceMuted : 'rgba(255,252,245,0.92)',
                    borderColor: tf.line2,
                    marginTop: 8,
                  },
                ]}>
                {dayLoading || !listRevealed ? (
                  <ActivityIndicator color={tf.frog} style={{ marginVertical: 16 }} />
                ) : (
                  <>
                    <View style={styles.hdr}>
                      <Text style={[styles.hdrTitle, { color: tf.ink2 }]}>青蛙</Text>
                      <Text style={[styles.hdrMeta, { color: tf.faint }]}>
                        {frogCount} 项 · 计入项目进度
                      </Text>
                      <View style={[styles.hdrLine, { backgroundColor: tf.line }]} />
                      <Text style={[styles.hdrGo, { color: '#6C8567' }]}>全部 ›</Text>
                    </View>
                    {frogItems.length === 0 ? (
                      <Text style={[styles.empty, { color: tf.faint }]}>该日暂无青蛙完成</Text>
                    ) : (
                      frogItems.map((item) => {
                        const title = (item.task_title ?? '').trim() || '（无标题）';
                        const canOpen = Boolean(item.task_id?.trim());
                        const riseIndex = histRiseIndex++;
                        return (
                          <HistRow
                            key={`${item.id}-e${listEntranceToken}`}
                            ink={tf.ink2}
                            muted={tf.faint}
                            frog={tf.frog}
                            riseAnimate={listEntranceArmed}
                            riseIndex={riseIndex}
                            riseDuration={riseDuration}
                            riseStagger={riseStagger}
                            riseFromY={riseFromY}
                            icon={
                              <MaterialIcons
                                name={item.subject === 'project' ? 'folder-special' : 'eco'}
                                size={12}
                                color={tf.frog}
                              />
                            }
                            title={title}
                            meta={item.subject === 'project' ? '项目青蛙' : '任务青蛙'}
                            right="已完成"
                            onPress={
                              canOpen
                                ? () => void openFrogHeatmapItem(router, item, projects)
                                : undefined
                            }
                          />
                        );
                      })
                    )}

                    <View style={[styles.hdr, { marginTop: 8 }]}>
                      <Text style={[styles.hdrTitle, { color: tf.ink2 }]}>待办</Text>
                      <Text style={[styles.hdrMeta, { color: tf.faint }]}>
                        {todoCount} 项 · 仅独立待办
                      </Text>
                      <View style={[styles.hdrLine, { backgroundColor: tf.line }]} />
                      <Pressable onPress={() => router.push('/tasks-overview')}>
                        <Text style={[styles.hdrGo, { color: '#6C8567' }]}>查看总览 ›</Text>
                      </Pressable>
                    </View>
                    {todoItems.length === 0 ? (
                      <Text style={[styles.empty, { color: tf.faint }]}>该日暂无待办完成</Text>
                    ) : (
                      todoItems.map((item) => {
                        const title = (item.task_title ?? '').trim() || '（无标题）';
                        const canOpen = Boolean(item.task_id);
                        const riseIndex = histRiseIndex++;
                        return (
                          <HistRow
                            key={`${item.id}-e${listEntranceToken}`}
                            ink={tf.ink2}
                            muted={tf.faint}
                            frog={tf.frog}
                            riseAnimate={listEntranceArmed}
                            riseIndex={riseIndex}
                            riseDuration={riseDuration}
                            riseStagger={riseStagger}
                            riseFromY={riseFromY}
                            icon={<Text style={{ fontSize: 12 }}>✓</Text>}
                            title={title}
                            meta="独立待办"
                            onPress={
                              canOpen
                                ? () =>
                                    router.push({
                                      pathname: '/task/[id]',
                                      params: { id: item.task_id },
                                    })
                                : undefined
                            }
                          />
                        );
                      })
                    )}

                    <View style={[styles.hdr, { marginTop: 8 }]}>
                      <Text style={[styles.hdrTitle, { color: tf.ink2 }]}>习惯</Text>
                      <Text style={[styles.hdrMeta, { color: tf.faint }]}>
                        {habitCount} 项 · 由打卡对齐
                      </Text>
                      <View style={[styles.hdrLine, { backgroundColor: tf.line }]} />
                      <Pressable onPress={() => router.push('/habit-manage')}>
                        <Text style={[styles.hdrGo, { color: '#6C8567' }]}>管理 ›</Text>
                      </Pressable>
                    </View>
                    {habitItems.length === 0 ? (
                      <Text style={[styles.empty, { color: tf.faint }]}>该日暂无习惯打卡</Text>
                    ) : (
                      habitItems.map((item) => {
                        const riseIndex = histRiseIndex++;
                        return (
                          <HistRow
                            key={`${item.id}-e${listEntranceToken}`}
                            ink={tf.ink2}
                            muted={tf.faint}
                            frog={tf.frog}
                            riseAnimate={listEntranceArmed}
                            riseIndex={riseIndex}
                            riseDuration={riseDuration}
                            riseStagger={riseStagger}
                            riseFromY={riseFromY}
                            icon={<Text style={{ fontSize: 13 }}>{item.icon}</Text>}
                            title={item.name}
                            meta={`打卡 ${item.count} 次`}
                            onPress={() =>
                              router.push({
                                pathname: '/habit-detail',
                                params: { habitId: item.id },
                              })
                            }
                          />
                        );
                      })
                    )}

                    <View style={styles.hintline}>
                      <MaterialIcons name="lightbulb-outline" size={12} color={tf.sun} />
                      <Text style={[styles.hintText, { color: tf.faint }]}>
                        再点一次 {shortMonthDay(selectedYmd)} 可取消选中
                      </Text>
                    </View>
                  </>
                )}
              </View>
            ) : null}
          </View>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 28 },
  card: {
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  htop: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 6 },
  htopTitle: { fontSize: 14, fontWeight: '700' },
  htopSub: { fontSize: 11, marginTop: 2 },
  super: { alignItems: 'flex-end' },
  superNum: { fontSize: 18, fontWeight: '700' },
  superLabel: { fontSize: 10, marginTop: 1 },
  hmap: {
    flexDirection: 'row',
    alignSelf: 'stretch',
  },
  hlegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 6,
  },
  legendText: { fontSize: 10 },
  swatch: { width: 8, height: 8, borderRadius: 1.5 },
  selectedday: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 8,
    marginTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  selDate: { fontSize: 16, fontWeight: '600' },
  selMeta: { fontSize: 11 },
  chips: { marginLeft: 'auto', flexDirection: 'row', gap: 3 },
  chip: {
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  hdr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  hdrTitle: { fontSize: 13, fontWeight: '800', flexShrink: 0 },
  hdrMeta: { fontSize: 10, flexShrink: 1 },
  hdrLine: { flex: 1, height: StyleSheet.hairlineWidth, minWidth: 8 },
  hdrGo: { fontSize: 11, fontWeight: '600', flexShrink: 0, marginLeft: 'auto' },
  empty: { fontSize: 12, paddingVertical: 6 },
  histrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 2,
  },
  hi: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(232,239,217,0.55)',
  },
  hc2: { flex: 1, minWidth: 0 },
  histTitle: { fontSize: 12, fontWeight: '700' },
  histMeta: { fontSize: 10, marginTop: 1 },
  ht2: { fontSize: 10, fontVariant: ['tabular-nums'] },
  pts: { fontSize: 11, width: 28, textAlign: 'right', fontVariant: ['tabular-nums'] },
  hintline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 8,
    paddingBottom: 2,
  },
  hintText: { fontSize: 11 },
});
