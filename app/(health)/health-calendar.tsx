import { HealthNutrientAccents } from '@/constants/design-tokens';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { buildUserHealthCalendarSnapshot } from '@/lib/repositories/health/health';
import type { HealthRecordRow } from '@/lib/repositories/health/health.types';
import { getDefaultUser } from '@/lib/repositories/users/user';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

type MetricMode = 'overall' | 'hydration' | 'protein' | 'carbohydrate' | 'calories';
type RangeMode = '7' | '30';

type DayMetrics = {
  hydration: number;
  hydrationTarget: number;
  protein: number;
  proteinTarget: number;
  carbohydrate: number;
  carbohydrateTarget: number;
  calories: number;
  caloriesTarget: number;
  overallPercent: number;
  metricPercents: Record<Exclude<MetricMode, 'overall'>, number>;
  hasRecord: boolean;
  completion?: 'full' | 'partial';
};

type TrendPoint = {
  key: string;
  date: Date;
  label: string;
  value: number;
  hasRecord: boolean;
  metrics: DayMetrics | null;
};

const CHART_W = 320;
const CHART_H = 148;
const CHART_INSET = 14;
const VISIBLE_NODE_COUNT = 5;

const METRIC_MODES: { key: MetricMode; label: string; color: string }[] = [
  { key: 'overall', label: '综合', color: '#10b981' },
  { key: 'hydration', label: '水分', color: HealthNutrientAccents.hydration },
  { key: 'protein', label: '蛋白质', color: HealthNutrientAccents.protein },
  { key: 'carbohydrate', label: '碳水', color: HealthNutrientAccents.carbohydrate },
  { key: 'calories', label: '热量', color: HealthNutrientAccents.calories },
];

const RANGE_MODES: { key: RangeMode; label: string; days: number }[] = [
  { key: '7', label: '7 天', days: 7 },
  { key: '30', label: '30 天', days: 30 },
];

function getWindowSize(rangeMode: RangeMode) {
  return RANGE_MODES.find((item) => item.key === rangeMode)?.days ?? 30;
}

function normalizeDate(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatLocalYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateLabel(d: Date) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatTrendDayLabel(d: Date, logicalToday: Date) {
  if (formatLocalYmd(d) === formatLocalYmd(logicalToday)) return '今天';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatWindowRangeLabel(start: Date, end: Date) {
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${end.getFullYear()}年${end.getMonth() + 1}月${start.getDate()}日 - ${end.getDate()}日`;
  }
  if (sameYear) {
    return `${end.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`;
  }
  return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 - ${end.getFullYear()}年${end.getMonth() + 1}月${end.getDate()}日`;
}

function buildTrendWindow(end: Date, windowSize: number, logicalToday: Date, historyStart: Date) {
  const normalizedEnd = end > logicalToday ? logicalToday : end;
  let start = addDays(normalizedEnd, -(windowSize - 1));
  if (start < historyStart) start = historyStart;
  return { start, end: normalizedEnd };
}

function canShiftWindowOlder(windowEnd: Date, windowSize: number, historyStart: Date) {
  const { start } = buildTrendWindow(windowEnd, windowSize, windowEnd, historyStart);
  return start > historyStart;
}

function canShiftWindowNewer(windowEnd: Date, logicalToday: Date) {
  return windowEnd < logicalToday;
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

function sumDayTotals(dayRows: HealthRecordRow[]) {
  let hydration = 0;
  let protein = 0;
  let carbohydrate = 0;
  let calories = 0;
  for (const row of dayRows) {
    hydration += Number(row.hydration ?? 0);
    protein += Number(row.protein ?? 0);
    carbohydrate += Number(row.carbohydrate ?? 0);
    calories += Number(row.calories ?? 0);
  }
  return { hydration, protein, carbohydrate, calories };
}

function compareUpdatedDesc(a: HealthRecordRow, b: HealthRecordRow) {
  return b.updated_at.localeCompare(a.updated_at);
}

function buildDayMetricsMap(
  records: HealthRecordRow[],
  completionMap: Map<string, 'full' | 'partial'>,
): Map<string, DayMetrics> {
  const datesByDay = new Map<string, HealthRecordRow[]>();
  for (const row of records) {
    const bucket = datesByDay.get(row.record_date);
    if (bucket) bucket.push(row);
    else datesByDay.set(row.record_date, [row]);
  }

  const map = new Map<string, DayMetrics>();
  for (const [ymd, dayRows] of datesByDay) {
    const totals = sumDayTotals(dayRows);
    const latest = [...dayRows].sort(compareUpdatedDesc)[0];
    if (!latest) continue;

    const hydrationTarget = Math.max(0, latest.target_hydration ?? 0);
    const proteinTarget = Math.max(0, latest.target_protein ?? 0);
    const carbohydrateTarget = Math.max(0, latest.target_carbohydrate ?? 0);
    const caloriesTarget = Math.max(0, latest.target_calories ?? 0);

    const metricPercents = {
      hydration: calcPercent(totals.hydration, hydrationTarget),
      protein: calcPercent(totals.protein, proteinTarget),
      carbohydrate: calcPercent(totals.carbohydrate, carbohydrateTarget),
      calories: calcPercent(totals.calories, caloriesTarget),
    };

    map.set(ymd, {
      hydration: totals.hydration,
      protein: totals.protein,
      carbohydrate: totals.carbohydrate,
      calories: totals.calories,
      hydrationTarget,
      proteinTarget,
      carbohydrateTarget,
      caloriesTarget,
      metricPercents,
      overallPercent: Math.round(
        (metricPercents.hydration +
          metricPercents.protein +
          metricPercents.carbohydrate +
          metricPercents.calories) /
          4,
      ),
      hasRecord: true,
      completion: completionMap.get(ymd),
    });
  }
  return map;
}

function buildTrendPoints(
  windowEnd: Date,
  rangeStart: Date,
  dayMetricsMap: Map<string, DayMetrics>,
  metricMode: MetricMode,
  logicalToday: Date,
): TrendPoint[] {
  const points: TrendPoint[] = [];
  let cursor = new Date(rangeStart);
  while (cursor <= windowEnd) {
    const key = formatLocalYmd(cursor);
    const metrics = dayMetricsMap.get(key) ?? null;
    const value =
      metricMode === 'overall'
        ? metrics?.overallPercent ?? 0
        : metrics?.metricPercents[metricMode] ?? 0;
    points.push({
      key,
      date: new Date(cursor),
      label: formatTrendDayLabel(cursor, logicalToday),
      value,
      hasRecord: metrics?.hasRecord ?? false,
      metrics,
    });
    cursor = addDays(cursor, 1);
  }
  return points;
}

function trendIndexFromLocationX(locationX: number, plotWidth: number, pointCount: number) {
  if (pointCount <= 1) return 0;
  if (plotWidth <= 0) return pointCount - 1;
  const innerW = CHART_W - CHART_INSET * 2;
  const viewBoxX = (locationX / plotWidth) * CHART_W;
  const t = (viewBoxX - CHART_INSET) / innerW;
  const clamped = Math.max(0, Math.min(1, t));
  return Math.round(clamped * (pointCount - 1));
}

function getSparseTrendNodeIndices(length: number, count = VISIBLE_NODE_COUNT) {
  if (length <= 0) return [];
  if (length === 1) return [0];
  const n = Math.min(count, length);
  const indices = new Set<number>();
  for (let k = 0; k < n; k++) {
    indices.add(Math.round((k * (length - 1)) / (n - 1)));
  }
  return [...indices].sort((a, b) => a - b);
}

function buildTrendChartGeometry(points: TrendPoint[]) {
  const w = CHART_W;
  const h = CHART_H;
  const inset = CHART_INSET;
  if (points.length < 2) return null;

  const innerW = w - inset * 2;
  const innerH = h - inset * 2;
  const baselineY = h - inset;
  const maxValue = 100;
  const minValue = 0;
  const span = maxValue - minValue || 1;

  const chartPoints = points.map((point, i) => ({
    x: inset + (i / (points.length - 1)) * innerW,
    y: inset + (1 - (point.value - minValue) / span) * innerH,
    raw: point,
  }));

  const pathD = chartPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  const first = chartPoints[0];
  const last = chartPoints[chartPoints.length - 1];
  const areaD = `${pathD} L${last.x.toFixed(1)},${baselineY.toFixed(1)} L${first.x.toFixed(1)},${baselineY.toFixed(1)} Z`;

  return { points: chartPoints, pathD, areaD };
}

type TrendChartPanelProps = {
  chartKey: string;
  trendPoints: TrendPoint[];
  logicalToday: Date;
  metricAccent: string;
  theme: (typeof Colors)['light'];
  isDark: boolean;
  selectedIndex: number | null;
  onSelectIndex: (index: number) => void;
};

function TrendChartPanel({
  chartKey,
  trendPoints,
  logicalToday,
  metricAccent,
  theme,
  isDark,
  selectedIndex,
  onSelectIndex,
}: TrendChartPanelProps) {
  const chartPlotWidthRef = React.useRef(0);
  const lastTrendIndex = Math.max(0, trendPoints.length - 1);
  const activeTrendIndex = selectedIndex ?? lastTrendIndex;
  const selectedTrendPoint = trendPoints[activeTrendIndex] ?? null;
  const isSelectedToday = selectedTrendPoint
    ? formatLocalYmd(selectedTrendPoint.date) === formatLocalYmd(logicalToday)
    : true;

  const trendChartGeometry = React.useMemo(() => buildTrendChartGeometry(trendPoints), [trendPoints]);
  const sparseNodeIndices = React.useMemo(() => getSparseTrendNodeIndices(trendPoints.length), [trendPoints.length]);
  const visibleNodeIndices = React.useMemo(() => {
    const indices = new Set(sparseNodeIndices);
    if (activeTrendIndex >= 0 && activeTrendIndex < trendPoints.length) {
      indices.add(activeTrendIndex);
    }
    return [...indices].sort((a, b) => a - b);
  }, [activeTrendIndex, sparseNodeIndices, trendPoints.length]);

  const selectedChartPoint =
    trendChartGeometry && activeTrendIndex >= 0 ? trendChartGeometry.points[activeTrendIndex] ?? null : null;
  const gradientId = `healthTrendFill-${chartKey}`;

  return (
    <View style={styles.chartWrap}>
      <View style={styles.yAxis}>
        {[100, 75, 50, 25, 0].map((tick) => (
          <Text key={tick} style={[styles.yTickText, { color: theme.textSecondary }]}>
            {tick}
          </Text>
        ))}
      </View>

      <View style={styles.plotArea}>
        {[100, 75, 50, 25, 0].map((tick, index) => (
          <View
            key={tick}
            style={[
              styles.gridLine,
              {
                top: `${index * 25}%`,
                borderColor: isDark ? 'rgba(148,163,184,0.14)' : '#eef2f7',
              },
            ]}
          />
        ))}

        <Pressable
          style={styles.chartPlot}
          onLayout={(e) => {
            chartPlotWidthRef.current = e.nativeEvent.layout.width;
          }}
          onPress={(e) => {
            const n = trendPoints.length;
            if (n < 2) return;
            const idx = trendIndexFromLocationX(e.nativeEvent.locationX, chartPlotWidthRef.current, n);
            onSelectIndex(idx);
          }}
        >
          <Svg
            width="100%"
            height={CHART_H}
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="none"
            style={StyleSheet.absoluteFillObject}
          >
            {trendChartGeometry ? (
              <>
                <Defs>
                  <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={metricAccent} stopOpacity={isDark ? 0.24 : 0.18} />
                    <Stop offset="1" stopColor={metricAccent} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                <Path d={trendChartGeometry.areaD} fill={`url(#${gradientId})`} />
                <Path
                  d={trendChartGeometry.pathD}
                  fill="none"
                  stroke={metricAccent}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {selectedChartPoint && !isSelectedToday ? (
                  <Path
                    d={`M${selectedChartPoint.x.toFixed(1)},${CHART_INSET} L${selectedChartPoint.x.toFixed(1)},${CHART_H - CHART_INSET}`}
                    stroke={isDark ? 'rgba(148,163,184,0.35)' : 'rgba(100,116,139,0.28)'}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                ) : null}
              </>
            ) : null}
          </Svg>

          {trendChartGeometry ? (
            <View style={styles.chartNodes} pointerEvents="none">
              {trendChartGeometry.points.map((point, index) => {
                const isVisible = visibleNodeIndices.includes(index);
                const isSelected = index === activeTrendIndex;
                const isLast = index === lastTrendIndex;
                const dotSize = isSelected ? 10 : isLast ? 8 : 6;
                const hasRecord = point.raw.hasRecord;
                return (
                  <View
                    key={`health-trend-node-${point.raw.key}`}
                    style={[
                      styles.chartNodeHit,
                      {
                        left: `${(point.x / CHART_W) * 100}%`,
                        top: `${(point.y / CHART_H) * 100}%`,
                      },
                    ]}
                  >
                    {isVisible ? (
                      <View
                        style={[
                          styles.chartNodeDot,
                          {
                            width: dotSize,
                            height: dotSize,
                            borderRadius: dotSize / 2,
                            backgroundColor: isSelected ? metricAccent : theme.surface,
                            borderColor: hasRecord ? metricAccent : isDark ? '#475569' : '#cbd5e1',
                            borderWidth: isSelected ? 2 : 1.5,
                            opacity: hasRecord ? 1 : 0.45,
                          },
                        ]}
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}
        </Pressable>

        <View style={styles.xAxis}>
          {sparseNodeIndices.map((index) => {
            const point = trendPoints[index];
            if (!point) return null;
            return (
              <Text key={point.key} style={[styles.xAxisText, { color: theme.textSecondary }]}>
                {point.label}
              </Text>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const PAGE_API_KEY = 'health-calendar';

export default function HealthCalendarScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const scheme = useColorScheme();
  const theme = Colors[scheme ?? 'light'];
  const isDark = scheme === 'dark';
  const today = React.useMemo(() => normalizeDate(new Date()), []);
  const { width: windowWidth } = useWindowDimensions();
  const chartPagerWidth = Math.max(1, windowWidth - 48 - 32);

  const [dayMetricsMap, setDayMetricsMap] = React.useState<Map<string, DayMetrics>>(new Map());
  const [historyStartDate, setHistoryStartDate] = React.useState(() => addDays(today, -29));
  const [rangeMode, setRangeMode] = React.useState<RangeMode>('30');
  const [windowEndDate, setWindowEndDate] = React.useState(() => today);
  const [metricMode, setMetricMode] = React.useState<MetricMode>('overall');
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);
  const chartPagerRef = React.useRef<ScrollView>(null);

  const windowSize = getWindowSize(rangeMode);
  const currentWindow = React.useMemo(
    () => buildTrendWindow(windowEndDate, windowSize, today, historyStartDate),
    [historyStartDate, today, windowEndDate, windowSize],
  );
  const prevWindowEnd = addDays(windowEndDate, -windowSize);
  const nextWindowEnd = addDays(windowEndDate, windowSize);
  const prevWindow = React.useMemo(
    () => buildTrendWindow(prevWindowEnd, windowSize, today, historyStartDate),
    [historyStartDate, prevWindowEnd, today, windowSize],
  );
  const nextWindow = React.useMemo(() => {
    const cappedEnd = nextWindowEnd > today ? today : nextWindowEnd;
    return buildTrendWindow(cappedEnd, windowSize, today, historyStartDate);
  }, [historyStartDate, nextWindowEnd, today, windowSize]);

  const canGoOlder = canShiftWindowOlder(windowEndDate, windowSize, historyStartDate);
  const canGoNewer = canShiftWindowNewer(windowEndDate, today);

  const reloadCalendar = React.useCallback(
    async (forceApi = false) => {
      await wrapLoad(async () => {
        setLoading(true);
        try {
          const user = await getDefaultUser();
          if (!user?.id) {
            setDayMetricsMap(new Map());
            setHistoryStartDate(addDays(today, -29));
            setWindowEndDate(today);
            setSelectedIndex(null);
            return false;
          }

          const { records, completionMap, startDate } = await buildUserHealthCalendarSnapshot(user.id, today);
          setDayMetricsMap(buildDayMetricsMap(records, completionMap));
          setHistoryStartDate(startDate);
          setWindowEndDate(today);
          setSelectedIndex(null);
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
    chartPagerRef.current?.scrollTo({ x: chartPagerWidth, animated: false });
  }, [chartPagerWidth, windowEndDate, rangeMode]);

  const buildWindowTrendPoints = React.useCallback(
    (window: { start: Date; end: Date }) =>
      buildTrendPoints(window.end, window.start, dayMetricsMap, metricMode, today),
    [dayMetricsMap, metricMode, today],
  );

  const trendPoints = React.useMemo(
    () => buildWindowTrendPoints(currentWindow),
    [buildWindowTrendPoints, currentWindow],
  );
  const pagerTrendWindows = React.useMemo(
    () => [
      { key: 'prev', points: buildWindowTrendPoints(prevWindow) },
      { key: 'current', points: trendPoints },
      { key: 'next', points: buildWindowTrendPoints(nextWindow) },
    ],
    [buildWindowTrendPoints, nextWindow, prevWindow, trendPoints],
  );

  const lastTrendIndex = Math.max(0, trendPoints.length - 1);
  const activeTrendIndex = selectedIndex ?? lastTrendIndex;
  const selectedTrendPoint = trendPoints[activeTrendIndex] ?? null;
  const selectedMetrics = selectedTrendPoint?.metrics ?? null;
  const isSelectedToday = selectedTrendPoint ? formatLocalYmd(selectedTrendPoint.date) === formatLocalYmd(today) : true;

  React.useEffect(() => {
    setSelectedIndex(null);
  }, [rangeMode, metricMode, windowEndDate]);

  const onChartPagerEnd = React.useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      if (x < chartPagerWidth * 0.5) {
        if (canGoOlder) {
          setWindowEndDate((prev) => addDays(prev, -windowSize));
        } else {
          chartPagerRef.current?.scrollTo({ x: chartPagerWidth, animated: true });
        }
        return;
      }
      if (x > chartPagerWidth * 1.5) {
        if (canGoNewer) {
          setWindowEndDate((prev) => {
            const nextEnd = addDays(prev, windowSize);
            return nextEnd > today ? today : nextEnd;
          });
        } else {
          chartPagerRef.current?.scrollTo({ x: chartPagerWidth, animated: true });
        }
        return;
      }
      chartPagerRef.current?.scrollTo({ x: chartPagerWidth, animated: false });
    },
    [canGoNewer, canGoOlder, chartPagerWidth, today, windowSize],
  );

  const metricAccent = METRIC_MODES.find((item) => item.key === metricMode)?.color ?? '#10b981';
  const currentMetricLabel = METRIC_MODES.find((item) => item.key === metricMode)?.label ?? '综合';
  const activeTrendValue = selectedTrendPoint?.value ?? 0;
  const recordedDays = trendPoints.filter((point) => point.hasRecord).length;
  const averageValue =
    recordedDays > 0
      ? Math.round(trendPoints.filter((point) => point.hasRecord).reduce((sum, point) => sum + point.value, 0) / recordedDays)
      : 0;

  const trendTipText = selectedTrendPoint
    ? selectedTrendPoint.hasRecord
      ? `${formatDateLabel(selectedTrendPoint.date)} · ${currentMetricLabel} ${activeTrendValue}%`
      : `${formatDateLabel(selectedTrendPoint.date)} · 暂无记录`
    : loading
      ? '正在加载趋势...'
      : recordedDays > 0
        ? `${formatWindowRangeLabel(currentWindow.start, currentWindow.end)} 平均 ${currentMetricLabel} ${averageValue}% · 右滑更早 · 左滑更近 · 点按图表选日`
        : '当前区间暂无健康记录';

  const progress = selectedMetrics?.overallPercent ?? 0;
  const currentRangeLabel = formatWindowRangeLabel(currentWindow.start, currentWindow.end);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.95)' : 'rgba(248,250,252,0.95)' }]}>
        <TouchableOpacity style={[styles.iconBtn, { backgroundColor: theme.surface }]} onPress={() => router.back()}>
          <MaterialIcons name="chevron-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>健康摄入趋势</Text>
          <Text style={styles.headerSub}>{currentRangeLabel}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        refreshControl={refreshControl}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.filterSection}>
          <View style={styles.pillRow}>
            {RANGE_MODES.map((item) => {
              const active = rangeMode === item.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => {
                    setRangeMode(item.key);
                    setWindowEndDate(today);
                  }}
                  style={[
                    styles.pill,
                    {
                      backgroundColor: active ? `${metricAccent}18` : theme.surface,
                      borderColor: active ? metricAccent : isDark ? 'rgba(148,163,184,0.22)' : '#e2e8f0',
                    },
                  ]}
                >
                  <Text style={[styles.pillText, { color: active ? metricAccent : theme.textSecondary }]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.metricPillRow}>
            {METRIC_MODES.map((item) => {
              const active = metricMode === item.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setMetricMode(item.key)}
                  style={[
                    styles.metricPill,
                    {
                      backgroundColor: active ? `${item.color}18` : theme.surface,
                      borderColor: active ? item.color : isDark ? 'rgba(148,163,184,0.22)' : '#e2e8f0',
                    },
                  ]}
                >
                  <View style={[styles.metricDot, { backgroundColor: item.color }]} />
                  <Text style={[styles.metricPillText, { color: active ? item.color : theme.textSecondary }]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View
          style={[
            styles.trendCard,
            {
              backgroundColor: theme.surface,
              borderColor: isDark ? 'rgba(148,163,184,0.22)' : '#f1f5f9',
            },
          ]}
        >
          <View style={styles.trendSummaryRow}>
            <View>
              <Text style={[styles.trendDayLabel, { color: isSelectedToday ? theme.textSecondary : metricAccent }]}>
                {selectedTrendPoint?.label ?? '今天'}
                {!isSelectedToday ? ` · ${currentMetricLabel}` : ''}
              </Text>
              <Text style={[styles.trendValue, { color: theme.text }]}>
                {selectedTrendPoint?.hasRecord ? `${activeTrendValue}%` : '--'}
              </Text>
            </View>
            <View style={[styles.trendBadge, { backgroundColor: `${metricAccent}14` }]}>
              <MaterialIcons name="show-chart" size={18} color={metricAccent} />
              <Text style={[styles.trendBadgeText, { color: metricAccent }]}>{currentMetricLabel}</Text>
            </View>
          </View>

          <View style={styles.trendNavRow}>
            <TouchableOpacity
              style={[
                styles.trendNavBtn,
                {
                  backgroundColor: theme.surface,
                  borderColor: isDark ? 'rgba(148,163,184,0.22)' : '#e2e8f0',
                  opacity: canGoOlder ? 1 : 0.35,
                },
              ]}
              disabled={!canGoOlder}
              onPress={() => setWindowEndDate((prev) => addDays(prev, -windowSize))}
              accessibilityLabel="查看更早记录"
            >
              <MaterialIcons name="chevron-left" size={20} color={theme.textSecondary} />
            </TouchableOpacity>
            <Text style={[styles.trendRangeText, { color: theme.textSecondary }]}>{currentRangeLabel}</Text>
            <TouchableOpacity
              style={[
                styles.trendNavBtn,
                {
                  backgroundColor: theme.surface,
                  borderColor: isDark ? 'rgba(148,163,184,0.22)' : '#e2e8f0',
                  opacity: canGoNewer ? 1 : 0.35,
                },
              ]}
              disabled={!canGoNewer}
              onPress={() =>
                setWindowEndDate((prev) => {
                  const nextEnd = addDays(prev, windowSize);
                  return nextEnd > today ? today : nextEnd;
                })
              }
              accessibilityLabel="查看更近记录"
            >
              <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={[styles.trendTip, { backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : '#f8fafc' }]}>
            <Text style={[styles.trendTipText, { color: theme.textSecondary }]}>{trendTipText}</Text>
          </View>

          <ScrollView
            ref={chartPagerRef}
            horizontal
            pagingEnabled
            nestedScrollEnabled
            directionalLockEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onMomentumScrollEnd={onChartPagerEnd}
            style={styles.chartPager}
          >
            {pagerTrendWindows.map((page) => (
              <View key={`${page.key}-${currentWindow.end.getTime()}`} style={{ width: chartPagerWidth }}>
                <TrendChartPanel
                  chartKey={page.key}
                  trendPoints={page.points}
                  logicalToday={today}
                  metricAccent={metricAccent}
                  theme={theme}
                  isDark={isDark}
                  selectedIndex={page.key === 'current' ? selectedIndex : null}
                  onSelectIndex={page.key === 'current' ? setSelectedIndex : () => {}}
                />
              </View>
            ))}
          </ScrollView>
        </View>

        {selectedTrendPoint && selectedMetrics ? (
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
                <Text style={[styles.detailDate, { color: theme.text }]}>{formatDateLabel(selectedTrendPoint.date)}</Text>
                <Text style={[styles.detailDesc, { color: theme.textSecondary }]}>你已经完成了 {progress}% 的目标</Text>
              </View>
              <TouchableOpacity
                style={styles.trendIconWrap}
                activeOpacity={0.8}
                onPress={() => router.push({ pathname: '/intake-history', params: { date: selectedTrendPoint.key } })}
              >
                <MaterialIcons name="history" size={20} color="#10b981" />
              </TouchableOpacity>
            </View>
            {[
              {
                key: 'hydration',
                label: '水分',
                icon: 'water-drop' as const,
                color: HealthNutrientAccents.hydration,
                value: selectedMetrics.hydration,
                target: selectedMetrics.hydrationTarget,
                unit: 'ML',
              },
              {
                key: 'protein',
                label: '蛋白质',
                icon: 'restaurant' as const,
                color: HealthNutrientAccents.protein,
                value: selectedMetrics.protein,
                target: selectedMetrics.proteinTarget,
                unit: 'G',
              },
              {
                key: 'carbohydrate',
                label: '碳水',
                icon: 'rice-bowl' as const,
                color: HealthNutrientAccents.carbohydrate,
                value: selectedMetrics.carbohydrate,
                target: selectedMetrics.carbohydrateTarget,
                unit: 'G',
              },
              {
                key: 'calories',
                label: '热量',
                icon: 'local-fire-department' as const,
                color: HealthNutrientAccents.calories,
                value: selectedMetrics.calories,
                target: selectedMetrics.caloriesTarget,
                unit: 'KCAL',
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
              {loading
                ? '正在加载健康趋势...'
                : selectedTrendPoint && !selectedTrendPoint.hasRecord
                  ? `${formatDateLabel(selectedTrendPoint.date)} 暂无摄入记录`
                  : '滑动图表选择有记录的日期查看摄入详情'}
            </Text>
          </View>
        )}
      </ScrollView>
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
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  filterSection: {
    paddingHorizontal: 24,
    paddingTop: 8,
    gap: 12,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  metricPillRow: {
    gap: 8,
    paddingRight: 8,
  },
  metricPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  metricDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  metricPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  trendCard: {
    marginHorizontal: 24,
    marginTop: 16,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
  },
  trendSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  trendDayLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  trendValue: {
    marginTop: 4,
    fontSize: 28,
    fontWeight: '800',
  },
  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  trendBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  trendTip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 14,
  },
  trendTipText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  trendNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  trendNavBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendRangeText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
  },
  chartPager: {
    width: '100%',
  },
  chartWrap: {
    flexDirection: 'row',
    gap: 8,
  },
  yAxis: {
    width: 28,
    height: CHART_H + 22,
    justifyContent: 'space-between',
    paddingBottom: 22,
  },
  yTickText: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'right',
  },
  plotArea: {
    flex: 1,
    position: 'relative',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  chartPlot: {
    height: CHART_H,
    position: 'relative',
  },
  chartNodes: {
    ...StyleSheet.absoluteFillObject,
  },
  chartNodeHit: {
    position: 'absolute',
    width: 18,
    height: 18,
    marginLeft: -9,
    marginTop: -9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartNodeDot: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 2,
  },
  xAxis: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  xAxisText: {
    fontSize: 10,
    fontWeight: '600',
  },
  detailCard: {
    marginHorizontal: 24,
    marginTop: 16,
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
    marginTop: 16,
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
