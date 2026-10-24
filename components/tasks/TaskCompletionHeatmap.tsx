/**
 * 完成热力卡 — 对齐设计稿 `.heat` / `.hmap` / heatBloom
 * 近 12 周紧凑点阵 + 右侧统计 + 按列错峰绽放（--i=c*7+r）；点格展开日明细。
 */
import {
  FOLD_MOTION_EASE,
  FOLD_MOTION_SPRING,
  FoldCountUpText,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { HeatBloomCell } from '@/components/tasks/heat-bloom-cell';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import { getTaskUiColors } from '@/constants/design-tokens';
import { addDays, formatYmd, formatYmdCN } from '@/lib/date';
import { openFrogHeatmapItem } from '@/lib/open-frog-heatmap-item';
import type { FrogCompletionDayItem } from '@/lib/repositories/tasks/frog-completion-events';
import type { TaskExecutionEventWithTitle } from '@/lib/repositories/tasks/task-execution-events';
import {
  fetchCompletionHeatmap,
  fetchCompletionHeatmapDayDetail,
} from '@/lib/tasks-completion-heatmap-api';
import {
  computeMonthlyAverageMap,
  heatmapLevelFromMonthlyAverage,
} from '@/lib/tasks-global-heatmap';
import type { TasksDayBoundary } from '@/lib/tasks-logical-day';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

const COMPLETION_HEATMAP_WEEKS = 12;
/** 设计稿基准格；实际按可用宽度放大铺满左侧区域 */
const COMPLETION_HEAT_CELL_MIN = 8;
const COMPLETION_HEAT_GAP = 2.5;

type CompletionHeatCell = { level: number | null; ymd: string | null; count: number };

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

function sumCountsInRange(
  map: Map<string, number>,
  startYmd: string,
  endYmd: string,
): number {
  let n = 0;
  for (const [ymd, c] of map) {
    if (ymd >= startYmd && ymd <= endYmd) n += c;
  }
  return n;
}

function computeStreak(map: Map<string, number>, todayYmd: string): number {
  let streak = 0;
  let cursor = todayYmd;
  for (let i = 0; i < 400; i++) {
    if ((map.get(cursor) ?? 0) <= 0) break;
    streak += 1;
    const d = addLocalDays(
      new Date(
        Number(cursor.slice(0, 4)),
        Number(cursor.slice(5, 7)) - 1,
        Number(cursor.slice(8, 10)),
      ),
      -1,
    );
    cursor = formatYmd(d);
  }
  return streak;
}

export function TaskCompletionHeatmap({
  logicalTodayYmd,
  dayBoundary,
  textMain,
  textMuted,
  accentColor,
  todoAccentColor,
  innerCardBg,
  innerBorderColor,
  isDark,
  reloadToken,
  projects,
  onOpenDetail,
}: {
  logicalTodayYmd: string;
  dayBoundary: TasksDayBoundary;
  textMain: string;
  textMuted: string;
  accentColor: string;
  todoAccentColor: string;
  innerCardBg: string;
  innerBorderColor: string;
  isDark: boolean;
  reloadToken: number;
  projects: Array<{ id: string; name: string }>;
  /** 点「日明细」跳转完整热力页（可选） */
  onOpenDetail?: () => void;
}) {
  const router = useRouter();
  const taskUi = getTaskUiColors(isDark);
  const { tf, fonts } = useTaskFoldTheme();
  const { animate: fullMotion, motionReady } = useFoldMotionGate();
  const heatColors = [
    tf.heat0,
    tf.heat1,
    tf.heat2,
    tf.heat3,
    tf.heat4,
    tf.heat5,
  ] as const;

  /** 点阵区实测宽度 → 格宽铺满（避免固定 8px 只占半边） */
  const [mapWidth, setMapWidth] = React.useState(0);
  const cellSize = React.useMemo(() => {
    if (mapWidth <= 0) return COMPLETION_HEAT_CELL_MIN;
    const gaps = (COMPLETION_HEATMAP_WEEKS - 1) * COMPLETION_HEAT_GAP;
    const raw = (mapWidth - gaps) / COMPLETION_HEATMAP_WEEKS;
    return Math.max(COMPLETION_HEAT_CELL_MIN, Math.floor(raw * 10) / 10);
  }, [mapWidth]);
  const onMapLayout = React.useCallback((e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    setMapWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
  }, []);

  const [selectedYmd, setSelectedYmd] = React.useState<string | null>(null);
  const [frogCountByYmd, setFrogCountByYmd] = React.useState<Map<string, number>>(new Map());
  const [todoCountByYmd, setTodoCountByYmd] = React.useState<Map<string, number>>(new Map());
  const [selectedFrogItems, setSelectedFrogItems] = React.useState<FrogCompletionDayItem[]>([]);
  const [selectedTodoItems, setSelectedTodoItems] = React.useState<TaskExecutionEventWithTitle[]>([]);
  const [dayItemsLoading, setDayItemsLoading] = React.useState(false);
  const [bloomKey, setBloomKey] = React.useState(0);
  const bloomPlayedRef = React.useRef(false);
  const detailExpand = React.useRef(new Animated.Value(0)).current;
  const [detailContentH, setDetailContentH] = React.useState(0);

  const combinedCountByYmd = React.useMemo(
    () => mergeDailyCountMaps(frogCountByYmd, todoCountByYmd),
    [frogCountByYmd, todoCountByYmd],
  );

  const heatmapRange = React.useMemo(() => {
    const todayCal = startOfLocalDay(new Date());
    const thisMonday = mondayOfWeekContaining(todayCal);
    const gridStartMonday = addLocalDays(thisMonday, -(COMPLETION_HEATMAP_WEEKS - 1) * 7);
    return { startYmd: formatYmd(gridStartMonday), endYmd: logicalTodayYmd };
  }, [logicalTodayYmd]);

  const loadCompletionHeatmap = React.useCallback(async () => {
    try {
      const data = await fetchCompletionHeatmap({
        boundary: dayBoundary,
        heatmapStart: heatmapRange.startYmd,
        heatmapEnd: heatmapRange.endYmd,
      });
      setFrogCountByYmd(data.frogCountByYmd);
      setTodoCountByYmd(data.todoCountByYmd);
      if (!bloomPlayedRef.current) {
        bloomPlayedRef.current = true;
        setBloomKey((k) => k + 1);
      }
    } catch (e) {
      console.warn('加载完成热力图失败', e);
      setFrogCountByYmd(new Map());
      setTodoCountByYmd(new Map());
    }
  }, [dayBoundary, heatmapRange.endYmd, heatmapRange.startYmd]);

  React.useEffect(() => {
    if (reloadToken <= 0) return;
    const idleId = requestIdleCallback(() => {
      void loadCompletionHeatmap();
    });
    return () => cancelIdleCallback(idleId);
  }, [loadCompletionHeatmap, reloadToken]);

  const weekColumns = React.useMemo(() => {
    const todayCal = startOfLocalDay(new Date());
    const thisMonday = mondayOfWeekContaining(todayCal);
    const gridStartMonday = addLocalDays(thisMonday, -(COMPLETION_HEATMAP_WEEKS - 1) * 7);

    type Col = { cells: CompletionHeatCell[]; monday: Date };
    const cols: Col[] = [];
    const validDayYmds: string[] = [];

    for (let c = 0; c < COMPLETION_HEATMAP_WEEKS; c++) {
      const monday = addLocalDays(gridStartMonday, c * 7);
      const cells: CompletionHeatCell[] = [];
      for (let r = 0; r < 7; r++) {
        const day = addLocalDays(monday, r);
        const ymd = formatYmd(day);
        if (ymd > logicalTodayYmd) {
          cells.push({ level: null, ymd: null, count: 0 });
        } else {
          validDayYmds.push(ymd);
          const n = combinedCountByYmd.get(ymd) ?? 0;
          cells.push({ level: 0, ymd, count: n });
        }
      }
      cols.push({ cells, monday });
    }

    const monthAvgMap = computeMonthlyAverageMap(validDayYmds, combinedCountByYmd);
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
  }, [combinedCountByYmd, logicalTodayYmd]);

  React.useEffect(() => {
    Animated.timing(detailExpand, {
      toValue: selectedYmd ? 1 : 0,
      duration: fullMotion ? TaskFoldMotion.heatDetail : 0,
      easing: selectedYmd ? FOLD_MOTION_SPRING : FOLD_MOTION_EASE,
      useNativeDriver: false,
    }).start();
  }, [detailExpand, fullMotion, selectedYmd]);

  React.useEffect(() => {
    if (!selectedYmd) {
      setSelectedFrogItems([]);
      setSelectedTodoItems([]);
      return;
    }
    let cancelled = false;
    setDayItemsLoading(true);
    void (async () => {
      try {
        const detail = await fetchCompletionHeatmapDayDetail({
          day: selectedYmd,
          boundary: dayBoundary,
          heatmapStart: heatmapRange.startYmd,
          heatmapEnd: heatmapRange.endYmd,
          projects,
        });
        if (!cancelled) {
          setSelectedFrogItems(detail.frogItems);
          setSelectedTodoItems(detail.todoItems);
        }
      } catch (e) {
        console.warn('加载完成明细失败', e);
        if (!cancelled) {
          setSelectedFrogItems([]);
          setSelectedTodoItems([]);
        }
      } finally {
        if (!cancelled) setDayItemsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dayBoundary, heatmapRange.endYmd, heatmapRange.startYmd, selectedYmd, reloadToken, projects]);

  const onHeatCellPress = React.useCallback((cell: CompletionHeatCell) => {
    if (!cell.ymd) return;
    setSelectedYmd((prev) => (prev === cell.ymd ? null : cell.ymd));
  }, []);

  const thisMonday = React.useMemo(() => {
    const todayCal = startOfLocalDay(new Date());
    return mondayOfWeekContaining(todayCal);
  }, [logicalTodayYmd]);
  const thisWeekStart = formatYmd(thisMonday);
  const lastWeekStart = formatYmd(addLocalDays(thisMonday, -7));
  const lastWeekEnd = formatYmd(addLocalDays(thisMonday, -1));

  const weekTotal = sumCountsInRange(combinedCountByYmd, thisWeekStart, logicalTodayYmd);
  const lastWeekTotal = sumCountsInRange(combinedCountByYmd, lastWeekStart, lastWeekEnd);
  const weekDeltaPct =
    lastWeekTotal <= 0
      ? weekTotal > 0
        ? 100
        : 0
      : Math.round(((weekTotal - lastWeekTotal) / lastWeekTotal) * 100);
  const streakDays = computeStreak(combinedCountByYmd, logicalTodayYmd);

  const selectedFrogCount =
    selectedYmd == null
      ? 0
      : dayItemsLoading
        ? frogCountByYmd.get(selectedYmd) ?? 0
        : selectedFrogItems.length;
  const selectedTodoCount =
    selectedYmd == null
      ? 0
      : dayItemsLoading
        ? todoCountByYmd.get(selectedYmd) ?? 0
        : selectedTodoItems.length;
  const hasSelectedDayItems = selectedFrogItems.length > 0 || selectedTodoItems.length > 0;

  const enterReady = bloomKey > 0 && motionReady;
  const bloomAnimate = enterReady;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: innerCardBg,
          borderColor: innerBorderColor,
        },
      ]}>
      <View style={styles.bodyRow}>
        <View style={styles.hc}>
          <View style={styles.hhead}>
            <Text style={[styles.hheadTitle, { color: textMain }]}>完成热力</Text>
            <Text style={[styles.hheadSub, { color: textMuted }]}>近 12 周</Text>
            <Pressable
              onPress={onOpenDetail}
              hitSlop={8}
              style={styles.hheadMore}
              accessibilityRole="button"
              accessibilityLabel="日明细">
              <Text style={[styles.hheadMoreText, { color: textMuted }]}>日明细</Text>
              <MaterialIcons name="chevron-right" size={12} color={textMuted} />
            </Pressable>
          </View>

          <View
            style={[
              styles.hmap,
              {
                gap: COMPLETION_HEAT_GAP,
                minHeight: cellSize * 7 + COMPLETION_HEAT_GAP * 6,
              },
            ]}
            onLayout={onMapLayout}
            key={enterReady ? `bloom-${bloomKey}` : 'bloom-pending'}>
            {enterReady
              ? weekColumns.map((col, c) => (
                  <View key={`w-${c}`} style={{ gap: COMPLETION_HEAT_GAP }}>
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
                      // 设计稿 buildHeat：--i = c*7+r
                      const bloomIndex = c * 7 + r;
                      return (
                        <HeatBloomCell
                          key={`c-${c}-r-${r}`}
                          index={bloomIndex}
                          color={color}
                          selected={!!selected}
                          isToday={!!isToday}
                          disabled={isFuture}
                          onPress={() => onHeatCellPress(cell)}
                          animate={!isFuture}
                          fullMotion={fullMotion}
                          paper={isDark ? tf.paper : tf.cream}
                          pond={tf.pond}
                          sun={tf.sun}
                          cellSize={cellSize}
                        />
                      );
                    })}
                  </View>
                ))
              : null}
          </View>

          <View style={styles.hlegend}>
            <Text style={[styles.hlegendText, { color: textMuted }]}>少</Text>
            {heatColors.map((c, i) => (
              <View key={i} style={[styles.hlegendSwatch, { backgroundColor: c }]} />
            ))}
            <Text style={[styles.hlegendText, { color: textMuted }]}>多</Text>
          </View>
        </View>

        <View style={[styles.hstats, { borderLeftColor: isDark ? tf.line : 'rgba(230,221,206,0.7)' }]}>
          <View style={styles.bigRow}>
            <FoldCountUpText
              value={weekTotal}
              animate={fullMotion && bloomAnimate}
              duration={TaskFoldMotion.countUp}
              textStyle={[styles.bigNum, { color: tf.pond, fontFamily: fonts.mono }]}
            />
            <Text style={[styles.bigUnit, { color: textMuted }]}>次</Text>
          </View>
          <Text style={[styles.st, { color: textMuted }]}>
            本周完成{'\n'}
            <Text style={{ color: '#607361', fontFamily: fonts.mono, fontSize: 11 }}>
              {weekDeltaPct >= 0 ? '+' : ''}
              {weekDeltaPct}%
            </Text>{' '}
            较上周
          </Text>
          <Text style={[styles.st, { color: textMuted }]}>
            连续{'\n'}
            <Text style={{ color: '#607361', fontFamily: fonts.mono, fontSize: 11 }}>{streakDays}</Text> 天
          </Text>
        </View>
      </View>

      <Animated.View
        style={
          detailContentH > 0
            ? {
                maxHeight: detailExpand.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, detailContentH + 12],
                }),
                opacity: detailExpand,
                overflow: 'hidden',
              }
            : { opacity: detailExpand, overflow: 'hidden' }
        }>
        <View
          onLayout={(e) => {
            const h = Math.ceil(e.nativeEvent.layout.height);
            if (h > 0 && Math.abs(h - detailContentH) > 2) setDetailContentH(h);
          }}
          style={[styles.detail, { borderTopColor: taskUi.hairlineStrong }]}>
          {selectedYmd ? (
            <>
              <View style={styles.detailHead}>
                <Text style={[styles.detailDate, { color: textMain }]} numberOfLines={1}>
                  {formatYmdCN(selectedYmd)}
                </Text>
                <Text style={[styles.detailCount, { color: textMain }]}>
                  青蛙×{selectedFrogCount} · 待办×{selectedTodoCount}
                </Text>
              </View>
              {dayItemsLoading ? (
                <Text style={[styles.detailEmpty, { color: textMuted }]}>加载中…</Text>
              ) : !hasSelectedDayItems ? (
                <Text style={[styles.detailEmpty, { color: textMuted }]}>该日暂无已完成记录</Text>
              ) : (
                <View style={styles.detailList}>
                  {selectedFrogItems.length > 0 ? (
                    <>
                      <Text style={[styles.sectionLabel, { color: textMuted }]}>青蛙</Text>
                      {selectedFrogItems.map((item, idx) => {
                        const title = (item.task_title ?? '').trim() || '（无标题）';
                        const canOpen = Boolean(item.task_id?.trim());
                        const isProjectFrog = item.subject === 'project';
                        const isLast =
                          idx === selectedFrogItems.length - 1 && selectedTodoItems.length === 0;
                        return (
                          <Pressable
                            key={item.id}
                            disabled={!canOpen}
                            onPress={() => {
                              void openFrogHeatmapItem(router, item, projects);
                            }}
                            style={({ pressed }) => [
                              styles.detailRow,
                              {
                                borderBottomColor: taskUi.hairlineSoft,
                                opacity: pressed && canOpen ? 0.85 : 1,
                              },
                              isLast && { borderBottomWidth: 0 },
                            ]}>
                            <MaterialIcons
                              name={isProjectFrog ? 'folder-special' : 'eco'}
                              size={16}
                              color={accentColor}
                              style={{ marginTop: 1 }}
                            />
                            <Text style={[styles.detailTitle, { color: textMain }]} numberOfLines={2}>
                              {title}
                            </Text>
                            {canOpen ? (
                              <MaterialIcons name="chevron-right" size={18} color={textMuted} />
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </>
                  ) : null}
                  {selectedTodoItems.length > 0 ? (
                    <>
                      <Text
                        style={[
                          styles.sectionLabel,
                          { color: textMuted, marginTop: selectedFrogItems.length > 0 ? 8 : 0 },
                        ]}>
                        待办
                      </Text>
                      {selectedTodoItems.map((item, idx) => {
                        const title = (item.task_title ?? '').trim() || '（无标题）';
                        const canOpen = Boolean(item.task_id);
                        return (
                          <Pressable
                            key={item.id}
                            disabled={!canOpen}
                            onPress={() => {
                              if (item.task_id) {
                                router.push({ pathname: '/task/[id]', params: { id: item.task_id } });
                              }
                            }}
                            style={({ pressed }) => [
                              styles.detailRow,
                              {
                                borderBottomColor: taskUi.hairlineSoft,
                                opacity: pressed && canOpen ? 0.85 : 1,
                              },
                              idx === selectedTodoItems.length - 1 && { borderBottomWidth: 0 },
                            ]}>
                            <MaterialIcons
                              name="check-circle"
                              size={16}
                              color={todoAccentColor}
                              style={{ marginTop: 1 }}
                            />
                            <Text style={[styles.detailTitle, { color: textMain }]} numberOfLines={2}>
                              {title}
                            </Text>
                            {canOpen ? (
                              <MaterialIcons name="chevron-right" size={18} color={textMuted} />
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </>
                  ) : null}
                </View>
              )}
            </>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 10,
    /** 选中环可略微溢出格缝，勿裁切 */
    overflow: 'visible',
  },
  bodyRow: {
    flexDirection: 'row',
    /** 完成情况列与热力区同高拉伸 */
    alignItems: 'stretch',
    gap: 9,
  },
  hc: { flex: 1, minWidth: 0 },
  hhead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 5,
  },
  hheadTitle: { fontSize: 13, fontWeight: '700', flexShrink: 0 },
  hheadSub: { fontSize: 10, flexShrink: 1 },
  hheadMore: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    flexShrink: 0,
  },
  hheadMoreText: { fontSize: 10 },
  hmap: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    paddingVertical: 2,
  },
  hlegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 5,
  },
  hlegendText: { fontSize: 9 },
  hlegendSwatch: {
    width: 7,
    height: 7,
    borderRadius: 1.5,
  },
  hstats: {
    width: 84,
    paddingLeft: 8,
    borderLeftWidth: StyleSheet.hairlineWidth,
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  bigRow: { flexDirection: 'row', alignItems: 'baseline' },
  bigNum: { fontSize: 17, fontWeight: '700', lineHeight: 20 },
  bigUnit: { fontSize: 10, marginLeft: 2, fontWeight: '500' },
  st: { fontSize: 10, lineHeight: 14 },
  detail: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  detailHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  detailDate: { fontSize: 14, fontWeight: '800', flex: 1, minWidth: 0 },
  detailCount: { fontSize: 13, fontWeight: '800', flexShrink: 0 },
  detailEmpty: { fontSize: 12, fontWeight: '600', paddingVertical: 4 },
  detailList: { marginTop: 2 },
  sectionLabel: { fontSize: 11, fontWeight: '800', marginBottom: 4, letterSpacing: 0.2 },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailTitle: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '700', lineHeight: 18 },
});
