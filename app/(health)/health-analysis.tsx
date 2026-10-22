import {
  HealthCountUpText,
  HealthGrowBar,
  HealthRiseIn,
  HEALTH_MOTION_EASE,
  useHealthMotionGate,
} from '@/components/health/health-motion';
import { HealthIntakeTrendSection } from '@/components/health/health-intake-trend-section';
import { useHealthHomeTheme } from '@/constants/health-home-theme';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { toast } from '@/lib/app-feedback';
import { formatStoredDatetimeHm } from '@/lib/api-mysql-datetime';
import { addDaysToYmd, parseYmd } from '@/lib/date';
import { getResolvedGlobalIntakeTargets, loadPersistedIntakeTargets } from '@/lib/global-intake-targets';
import { getHealthRecordsLast7Days } from '@/lib/repositories/health/health';
import type { HealthRecordRow } from '@/lib/repositories/health/health.types';
import { getDefaultUser } from '@/lib/repositories/users/user';
import type { UserRow } from '@/lib/repositories/users/user.types';
import { getUserDayScheduleKind } from '@/lib/user-workout-schedule';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const PAGE_API_KEY = 'health-analysis';

type MetricKey = 'hydration' | 'protein' | 'carbohydrate' | 'calories';

type DayTotals = {
  ymd: string;
  hydration: number;
  protein: number;
  carbohydrate: number;
  calories: number;
  hourHydration: number[];
  mealCarbShare: { morning: number; noon: number; evening: number };
};

type MetricStat = {
  key: MetricKey;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  color: string;
  percent: number;
  prevPercent: number;
  delta: number;
};

type Insight = {
  key: string;
  title: string;
  body: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  tint: string;
  tintBg: string;
};

function recordYmd(row: HealthRecordRow): string {
  const raw = typeof row.record_date === 'string' ? row.record_date.trim() : '';
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : raw;
}

function calcPercent(value: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.min(100, Math.round((value / target) * 100));
}

function hourFromCreatedAt(createdAt: string): number {
  const hm = formatStoredDatetimeHm(createdAt);
  const m = /^(\d{1,2}):/.exec(hm);
  if (!m) return 12;
  return Math.min(23, Math.max(0, Number(m[1])));
}

function formatRangeLabel(startYmd: string, endYmd: string): string {
  const a = parseYmd(startYmd);
  const b = parseYmd(endYmd);
  if (!a || !b) return `${startYmd} – ${endYmd}`;
  return `${a.getMonth() + 1}.${a.getDate()} – ${b.getMonth() + 1}.${b.getDate()}`;
}

function buildDayTotalsMap(rows: HealthRecordRow[]): Map<string, DayTotals> {
  const map = new Map<string, DayTotals>();
  for (const row of rows) {
    const ymd = recordYmd(row);
    if (!ymd) continue;
    let day = map.get(ymd);
    if (!day) {
      day = {
        ymd,
        hydration: 0,
        protein: 0,
        carbohydrate: 0,
        calories: 0,
        hourHydration: Array.from({ length: 24 }, () => 0),
        mealCarbShare: { morning: 0, noon: 0, evening: 0 },
      };
      map.set(ymd, day);
    }
    day.hydration += Number(row.hydration) || 0;
    day.protein += Number(row.protein) || 0;
    day.carbohydrate += Number(row.carbohydrate) || 0;
    day.calories += Number(row.calories) || 0;
    const hour = hourFromCreatedAt(row.created_at);
    day.hourHydration[hour] += Number(row.hydration) || 0;
    const carb = Number(row.carbohydrate) || 0;
    if (hour < 11) day.mealCarbShare.morning += carb;
    else if (hour < 16) day.mealCarbShare.noon += carb;
    else day.mealCarbShare.evening += carb;
  }
  return map;
}

function averageMetricPercents(
  dayMap: Map<string, DayTotals>,
  ymds: string[],
  targets: ReturnType<typeof getResolvedGlobalIntakeTargets>,
): Record<MetricKey, number> {
  let h = 0;
  let p = 0;
  let c = 0;
  let cal = 0;
  let days = 0;
  for (const ymd of ymds) {
    const day = dayMap.get(ymd);
    if (!day) continue;
    days += 1;
    h += calcPercent(day.hydration, targets.hydrationMl);
    p += calcPercent(day.protein, targets.proteinG);
    c += calcPercent(day.carbohydrate, targets.carbohydrateG);
    cal += calcPercent(day.calories, targets.caloriesKcal);
  }
  if (days === 0) {
    return { hydration: 0, protein: 0, carbohydrate: 0, calories: 0 };
  }
  return {
    hydration: Math.round(h / days),
    protein: Math.round(p / days),
    carbohydrate: Math.round(c / days),
    calories: Math.round(cal / days),
  };
}

function overallScore(percents: Record<MetricKey, number>): number {
  return Math.round(
    (percents.hydration + percents.protein + percents.carbohydrate + percents.calories) / 4,
  );
}

function buildHeadline(score: number, deltas: Record<MetricKey, number>, prevScore: number): string {
  if (score <= 0) return '这一周，还没有足够的摄入数据';
  if (prevScore <= 0) return '这一周，开始有了可对照的节奏';
  if (score >= prevScore + 5) return '这一周，吃得比上周更稳';
  if (score + 5 <= prevScore) return '这一周，节奏比上周略松';
  const top = (Object.entries(deltas) as [MetricKey, number][])
    .filter(([, d]) => d > 0)
    .sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 5) {
    const label =
      top[0] === 'hydration' ? '水分' : top[0] === 'protein' ? '蛋白' : top[0] === 'carbohydrate' ? '碳水' : '热量';
    return `这一周，${label}进步最明显`;
  }
  return '这一周，吃得比上周稳';
}

function buildSummaryBody(
  percents: Record<MetricKey, number>,
  deltas: Record<MetricKey, number>,
): string {
  const ranked = (Object.entries(percents) as [MetricKey, number][])
    .slice()
    .sort((a, b) => b[1] - a[1]);
  const name = (k: MetricKey) =>
    k === 'hydration' ? '水分' : k === 'protein' ? '蛋白' : k === 'carbohydrate' ? '碳水' : '热量';
  const top2 = ranked.slice(0, 2).map(([k]) => name(k));
  const low = ranked[ranked.length - 1];
  const calOk = percents.calories <= 105;
  const parts = [
    `${top2.join('与')}完成度最高`,
    low && low[1] < 75 ? `${name(low[0])}略偏低` : null,
    calOk ? '热量未超限' : '热量偶有超标',
  ].filter(Boolean);
  const deltaHint =
    deltas.carbohydrate < 0
      ? '；训练日碳水可再补一点'
      : deltas.protein > 0
        ? '；蛋白节奏保持得不错'
        : '';
  return `${parts.join('，')}${deltaHint}。`;
}

function buildInsights(
  dayMap: Map<string, DayTotals>,
  ymds: string[],
  targets: ReturnType<typeof getResolvedGlobalIntakeTargets>,
  user: UserRow | null,
  nutrients: { hydration: string; protein: string; carbohydrate: string; calories: string },
): Insight[] {
  const insights: Insight[] = [];

  let afternoonHydration = 0;
  let dayHydration = 0;
  for (const ymd of ymds) {
    const day = dayMap.get(ymd);
    if (!day || day.hydration <= 0) continue;
    dayHydration += day.hydration;
    for (let h = 15; h <= 17; h += 1) afternoonHydration += day.hourHydration[h] ?? 0;
  }
  if (dayHydration > 0) {
    const pct = Math.round((afternoonHydration / dayHydration) * 100);
    insights.push({
      key: 'hydration-window',
      title: '水分空窗',
      body:
        pct <= 20
          ? `15:00–18:00 仅占全天水分约 ${pct}%，下午容易忘喝水。`
          : `下午时段水分约占 ${pct}%，可把提醒设在 15:30 左右。`,
      icon: 'water-drop',
      tint: nutrients.hydration,
      tintBg: `${nutrients.hydration}22`,
    });
  }

  if (user) {
    let workoutProtein = 0;
    let workoutDays = 0;
    let restProtein = 0;
    let restDays = 0;
    for (const ymd of ymds) {
      const day = dayMap.get(ymd);
      if (!day) continue;
      const kind = getUserDayScheduleKind(user, ymd);
      const pct = calcPercent(day.protein, targets.proteinG);
      if (kind === 'workout') {
        workoutProtein += pct;
        workoutDays += 1;
      } else if (kind === 'rest') {
        restProtein += pct;
        restDays += 1;
      }
    }
    if (workoutDays > 0 && restDays > 0) {
      const wAvg = Math.round(workoutProtein / workoutDays);
      const rAvg = Math.round(restProtein / restDays);
      insights.push({
        key: 'protein-schedule',
        title: '训练日蛋白',
        body: `训练日蛋白达成约 ${wAvg}%，休息日约 ${rAvg}%。${
          wAvg - rAvg >= 15 ? '休息日可补一顿高蛋白。' : '两边差距不大，节奏稳定。'
        }`,
        icon: 'restaurant',
        tint: nutrients.protein,
        tintBg: `${nutrients.protein}22`,
      });
    }
  }

  let morning = 0;
  let noon = 0;
  let evening = 0;
  for (const ymd of ymds) {
    const day = dayMap.get(ymd);
    if (!day) continue;
    morning += day.mealCarbShare.morning;
    noon += day.mealCarbShare.noon;
    evening += day.mealCarbShare.evening;
  }
  const carbTotal = morning + noon + evening;
  if (carbTotal > 0) {
    const eveningPct = Math.round((evening / carbTotal) * 100);
    insights.push({
      key: 'carb-timing',
      title: '碳水时段',
      body:
        eveningPct >= 45
          ? `碳水集中在晚餐（约 ${eveningPct}%），训练日可把部分前移到中午。`
          : `碳水分布较均匀，晚餐约占 ${eveningPct}%。`,
      icon: 'grain',
      tint: nutrients.carbohydrate,
      tintBg: `${nutrients.carbohydrate}22`,
    });
  }

  return insights.slice(0, 3);
}

function buildSuggestion(
  percents: Record<MetricKey, number>,
  deltas: Record<MetricKey, number>,
  insights: Insight[],
): string {
  const tips: string[] = [];
  if (percents.hydration >= 80) tips.push('保持水分节奏');
  else tips.push('下午补一次水');
  if (percents.protein >= 80) tips.push('维持蛋白摄入');
  else tips.push('每餐加一点蛋白');
  if (deltas.carbohydrate < 0 || percents.carbohydrate < 75) {
    tips.push('训练日碳水 +20g');
  }
  if (insights.some((i) => i.key === 'hydration-window')) {
    tips.push('15:30 设喝水提醒');
  }
  return `下周建议：${tips.slice(0, 3).join('，')}。`;
}

function ScoreRing({
  score,
  color,
  track,
  textColor,
  animate,
}: {
  score: number;
  color: string;
  track: string;
  textColor: string;
  animate: boolean;
}) {
  const size = 84;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, score));
  const targetOffset = c * (1 - clamped / 100);
  const progress = React.useRef(new Animated.Value(animate ? 0 : 1)).current;

  React.useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 1100,
      easing: HEALTH_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, clamped, progress]);

  const dashOffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [c, targetOffset],
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg
        width={size}
        height={size}
        style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
      </Svg>
      <HealthCountUpText
        value={clamped}
        animate={animate}
        duration={900}
        textStyle={[styles.scoreNum, { color: textColor }]}
      />
    </View>
  );
}

export default function HealthAnalysisScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { hh, nutrients } = useHealthHomeTheme();
  const { animate: entranceOn } = useHealthMotionGate();
  const { logicalTodayDate, logicalTodayYmd } = usePageDayBoundary('health');
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const [loading, setLoading] = React.useState(true);
  const [weekOffset, setWeekOffset] = React.useState(0);
  const [user, setUser] = React.useState<UserRow | null>(null);
  const [rows, setRows] = React.useState<HealthRecordRow[]>([]);
  const [prevRows, setPrevRows] = React.useState<HealthRecordRow[]>([]);
  const [showTrend, setShowTrend] = React.useState(false);
  const [contentReady, setContentReady] = React.useState(false);
  const enterTokenRef = React.useRef(`${weekOffset}`);

  const weekEndYmd = React.useMemo(
    () => addDaysToYmd(logicalTodayYmd, weekOffset * 7),
    [logicalTodayYmd, weekOffset],
  );
  const weekStartYmd = React.useMemo(() => addDaysToYmd(weekEndYmd, -6), [weekEndYmd]);
  const prevEndYmd = React.useMemo(() => addDaysToYmd(weekStartYmd, -1), [weekStartYmd]);
  const prevStartYmd = React.useMemo(() => addDaysToYmd(prevEndYmd, -6), [prevEndYmd]);

  const weekYmds = React.useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysToYmd(weekStartYmd, i)),
    [weekStartYmd],
  );
  const prevYmds = React.useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysToYmd(prevStartYmd, i)),
    [prevStartYmd],
  );

  const reload = React.useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      try {
        await wrapLoad(async () => {
          await loadPersistedIntakeTargets();
          const currentUser = await getDefaultUser();
          setUser(currentUser);
          if (!currentUser?.id) {
            setRows([]);
            setPrevRows([]);
            return;
          }
          const [week, prevWeek] = await Promise.all([
            getHealthRecordsLast7Days(currentUser.id, weekEndYmd),
            getHealthRecordsLast7Days(currentUser.id, prevEndYmd),
          ]);
          setRows(week);
          setPrevRows(prevWeek);
        }, forceRefresh);
      } finally {
        setLoading(false);
        const token = `${weekEndYmd}`;
        if (enterTokenRef.current !== token) {
          enterTokenRef.current = token;
          setContentReady(false);
          requestAnimationFrame(() => setContentReady(true));
        } else {
          setContentReady(true);
        }
      }
    },
    [weekEndYmd, prevEndYmd, wrapLoad],
  );

  const analysisEnterOn = entranceOn && contentReady && !loading;

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload]),
  );

  const analysis = React.useMemo(() => {
    const targets = getResolvedGlobalIntakeTargets();
    const dayMap = buildDayTotalsMap([...rows, ...prevRows]);
    const percents = averageMetricPercents(dayMap, weekYmds, targets);
    const prevPercents = averageMetricPercents(dayMap, prevYmds, targets);
    const deltas: Record<MetricKey, number> = {
      hydration: percents.hydration - prevPercents.hydration,
      protein: percents.protein - prevPercents.protein,
      carbohydrate: percents.carbohydrate - prevPercents.carbohydrate,
      calories: percents.calories - prevPercents.calories,
    };
    const score = overallScore(percents);
    const prevScore = overallScore(prevPercents);
    const metrics: MetricStat[] = [
      {
        key: 'hydration',
        label: '水分',
        icon: 'water-drop',
        color: nutrients.hydration,
        percent: percents.hydration,
        prevPercent: prevPercents.hydration,
        delta: deltas.hydration,
      },
      {
        key: 'protein',
        label: '蛋白',
        icon: 'restaurant',
        color: nutrients.protein,
        percent: percents.protein,
        prevPercent: prevPercents.protein,
        delta: deltas.protein,
      },
      {
        key: 'carbohydrate',
        label: '碳水',
        icon: 'grain',
        color: nutrients.carbohydrate,
        percent: percents.carbohydrate,
        prevPercent: prevPercents.carbohydrate,
        delta: deltas.carbohydrate,
      },
      {
        key: 'calories',
        label: '热量',
        icon: 'local-fire-department',
        color: nutrients.calories,
        percent: percents.calories,
        prevPercent: prevPercents.calories,
        delta: deltas.calories,
      },
    ];
    const insights = buildInsights(dayMap, weekYmds, targets, user, nutrients);

    let workoutPct = 0;
    let workoutDays = 0;
    let restPct = 0;
    let restDays = 0;
    if (user) {
      for (const ymd of weekYmds) {
        const day = dayMap.get(ymd);
        if (!day) continue;
        const kind = getUserDayScheduleKind(user, ymd);
        const pct = calcPercent(day.protein, targets.proteinG);
        if (kind === 'workout') {
          workoutPct += pct;
          workoutDays += 1;
        } else if (kind === 'rest') {
          restPct += pct;
          restDays += 1;
        }
      }
    }

    return {
      score,
      prevScore,
      headline: buildHeadline(score, deltas, prevScore),
      body: buildSummaryBody(percents, deltas),
      metrics,
      insights,
      suggestion: buildSuggestion(percents, deltas, insights),
      schedule:
        workoutDays + restDays > 0
          ? {
              workout: {
                pct: workoutDays > 0 ? Math.round(workoutPct / workoutDays) : 0,
                days: workoutDays,
              },
              rest: {
                pct: restDays > 0 ? Math.round(restPct / restDays) : 0,
                days: restDays,
              },
            }
          : null,
    };
  }, [rows, prevRows, weekYmds, prevYmds, user, nutrients]);

  const rangeLabel = formatRangeLabel(weekStartYmd, weekEndYmd);
  const isThisWeek = weekOffset === 0;

  const onApplySuggestion = () => {
    toast.success('已记下下周建议，可在首页目标与提醒里微调');
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: hh.paper }]} edges={['left', 'right']}>
      <View style={[styles.header, { paddingTop: insets.top + 4, borderBottomColor: hh.line }]}>
        <Pressable style={styles.headerBtn} onPress={() => router.back()} hitSlop={10} accessibilityLabel="返回">
          <MaterialIcons name="arrow-back" size={22} color={hh.ink} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: hh.ink }]}>健康分析</Text>
          <Text style={[styles.headerSub, { color: hh.muted }]}>WEEKLY · {rangeLabel}</Text>
        </View>
        <Pressable
          onPress={() => setWeekOffset((o) => (o === 0 ? -1 : 0))}
          style={[styles.weekPill, { backgroundColor: hh.card, borderColor: hh.line }]}
          accessibilityLabel={isThisWeek ? '切换到上周' : '回到本周'}>
          <Text style={[styles.weekPillText, { color: hh.inkSoft }]}>
            {isThisWeek ? '本周' : '上周'}
          </Text>
        </Pressable>
      </View>

      {loading && rows.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={hh.pine} />
        </View>
      ) : (
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[styles.scroll, { paddingBottom: 28 + Math.max(insets.bottom, 12) }]}
          showsVerticalScrollIndicator={false}>
          <HealthRiseIn animate={analysisEnterOn} duration={420} fromY={12}>
            <View style={[styles.summaryCard, { backgroundColor: hh.pine, shadowColor: hh.shadow }]}>
              <ScoreRing
                score={analysis.score}
                color={hh.sage}
                track="rgba(247,245,236,0.18)"
                textColor={hh.onPine}
                animate={analysisEnterOn}
              />
              <View style={styles.summaryTextCol}>
                <Text style={[styles.summaryHeadline, { color: hh.onPine }]}>{analysis.headline}</Text>
                <Text style={[styles.summaryBody, { color: 'rgba(247,245,236,0.72)' }]}>
                  {analysis.body}
                </Text>
              </View>
            </View>
          </HealthRiseIn>

          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: hh.ink }]}>四项完成度</Text>
            <Text style={[styles.sectionHint, { color: hh.faint }]}>按每日目标对照</Text>
          </View>
          <HealthRiseIn animate={analysisEnterOn} index={1} staggerMs={70} delayMs={120} duration={400}>
            <View style={[styles.card, { backgroundColor: hh.card, borderColor: hh.line }]}>
              {analysis.metrics.map((m, index) => (
                <View
                  key={m.key}
                  style={[
                    styles.metricRow,
                    index < analysis.metrics.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: hh.line,
                    },
                  ]}>
                  <View style={[styles.metricIcon, { backgroundColor: `${m.color}22` }]}>
                    <MaterialIcons name={m.icon} size={16} color={m.color} />
                  </View>
                  <Text style={[styles.metricLabel, { color: hh.ink }]}>{m.label}</Text>
                  <View style={styles.barWrap}>
                    <HealthGrowBar
                      animate={analysisEnterOn}
                      percent={m.percent}
                      color={m.color}
                      trackColor={hh.track}
                      index={index}
                      staggerMs={80}
                      duration={500}
                      height={6}
                    />
                  </View>
                  <Text style={[styles.metricPct, { color: hh.ink }]}>{m.percent}%</Text>
                  <Text
                    style={[
                      styles.metricDelta,
                      { color: m.delta >= 0 ? hh.pine : '#C45C4A' },
                    ]}>
                    {m.delta > 0 ? `+${m.delta}` : String(m.delta)}
                  </Text>
                </View>
              ))}
            </View>
          </HealthRiseIn>

          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: hh.ink }]}>本周洞察</Text>
            <Text style={[styles.sectionHint, { color: hh.faint }]}>{analysis.insights.length} 条</Text>
          </View>
          {analysis.insights.length === 0 ? (
            <View style={[styles.emptyInsight, { backgroundColor: hh.cardMuted, borderColor: hh.line }]}>
              <Text style={[styles.emptyInsightText, { color: hh.muted }]}>
                记录再多几天，这里会生成时段与训练日洞察
              </Text>
            </View>
          ) : (
            <View style={styles.insightList}>
              {analysis.insights.map((item, insightIndex) => (
                <HealthRiseIn
                  key={item.key}
                  animate={analysisEnterOn}
                  index={insightIndex}
                  staggerMs={70}
                  delayMs={280}
                  duration={420}
                  fromY={12}
                >
                  <View style={[styles.insightCard, { backgroundColor: hh.card, borderColor: hh.line }]}>
                    <View style={[styles.insightIcon, { backgroundColor: item.tintBg }]}>
                      <MaterialIcons name={item.icon} size={16} color={item.tint} />
                    </View>
                    <View style={styles.insightBody}>
                      <Text style={[styles.insightTitle, { color: hh.ink }]}>{item.title}</Text>
                      <Text style={[styles.insightText, { color: hh.inkSoft }]}>{item.body}</Text>
                    </View>
                  </View>
                </HealthRiseIn>
              ))}
            </View>
          )}

          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: hh.ink }]}>与上周对比</Text>
          </View>
          <View style={[styles.card, { backgroundColor: hh.card, borderColor: hh.line }]}>
            {analysis.metrics.map((m, index) => (
              <View
                key={`cmp-${m.key}`}
                style={[
                  styles.compareRow,
                  index < analysis.metrics.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: hh.line,
                  },
                ]}>
                <Text style={[styles.compareLabel, { color: hh.ink }]}>{m.label}</Text>
                <Text
                  style={[
                    styles.compareDelta,
                    { color: m.delta >= 0 ? hh.pine : '#C45C4A' },
                  ]}>
                  {m.delta > 0 ? `+${m.delta}%` : `${m.delta}%`}
                </Text>
                <Text style={[styles.compareValue, { color: hh.muted }]}>{m.percent}%</Text>
              </View>
            ))}
          </View>

          {analysis.schedule ? (
            <>
              <View style={styles.sectionHead}>
                <Text style={[styles.sectionTitle, { color: hh.ink }]}>训练日 / 休息日</Text>
                <Text style={[styles.sectionHint, { color: hh.faint }]}>蛋白达成</Text>
              </View>
              <View style={[styles.scheduleRow, { backgroundColor: hh.card, borderColor: hh.line }]}>
                <View style={styles.scheduleCell}>
                  <Text style={[styles.scheduleLabel, { color: hh.muted }]}>训练日</Text>
                  <Text style={[styles.scheduleValue, { color: hh.ink }]}>
                    {analysis.schedule.workout.pct}%
                  </Text>
                  <Text style={[styles.scheduleDays, { color: hh.faint }]}>
                    {analysis.schedule.workout.days} 天
                  </Text>
                </View>
                <View style={[styles.scheduleDivider, { backgroundColor: hh.line }]} />
                <View style={styles.scheduleCell}>
                  <Text style={[styles.scheduleLabel, { color: hh.muted }]}>休息日</Text>
                  <Text style={[styles.scheduleValue, { color: hh.ink }]}>
                    {analysis.schedule.rest.pct}%
                  </Text>
                  <Text style={[styles.scheduleDays, { color: hh.faint }]}>
                    {analysis.schedule.rest.days} 天
                  </Text>
                </View>
              </View>
            </>
          ) : null}

          <Text style={[styles.suggestion, { color: hh.inkSoft }]}>{analysis.suggestion}</Text>
          <Pressable
            onPress={onApplySuggestion}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: hh.pine, opacity: pressed ? 0.9 : 1, shadowColor: hh.shadow },
            ]}
            accessibilityRole="button"
            accessibilityLabel="把建议加入下周">
            <Text style={[styles.primaryBtnText, { color: hh.onPine }]}>把建议加入下周</Text>
          </Pressable>

          <Pressable
            onPress={() => setShowTrend((v) => !v)}
            style={styles.trendToggle}
            accessibilityRole="button"
            accessibilityLabel={showTrend ? '收起趋势图' : '展开趋势图'}>
            <Text style={[styles.trendToggleText, { color: hh.pine }]}>
              {showTrend ? '收起摄入趋势' : '查看摄入趋势图'}
            </Text>
            <MaterialIcons
              name={showTrend ? 'expand-less' : 'expand-more'}
              size={20}
              color={hh.pine}
            />
          </Pressable>
          {showTrend ? (
            <View style={styles.trendWrap}>
              <HealthIntakeTrendSection
                logicalToday={logicalTodayDate}
                hideSectionHeader
              />
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  headerSub: { marginTop: 2, fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  weekPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  weekPillText: { fontSize: 12, fontWeight: '700' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 16, paddingTop: 16 },
  summaryCard: {
    borderRadius: 22,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  scoreNum: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  summaryTextCol: { flex: 1, minWidth: 0 },
  summaryHeadline: { fontSize: 17, fontWeight: '800', lineHeight: 24 },
  summaryBody: { marginTop: 6, fontSize: 12, fontWeight: '500', lineHeight: 18 },
  sectionHead: {
    marginTop: 22,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800' },
  sectionHint: { fontSize: 11, fontWeight: '600' },
  card: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  metricIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricLabel: { width: 36, fontSize: 13, fontWeight: '700' },
  barWrap: { flex: 1 },
  barTrack: { height: 8, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999 },
  metricPct: { width: 40, textAlign: 'right', fontSize: 13, fontWeight: '800' },
  metricDelta: { width: 32, textAlign: 'right', fontSize: 12, fontWeight: '700' },
  emptyInsight: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 18,
    paddingHorizontal: 14,
  },
  emptyInsightText: { fontSize: 13, fontWeight: '600', lineHeight: 20 },
  insightList: { gap: 8 },
  insightCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  insightIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightBody: { flex: 1, minWidth: 0 },
  insightTitle: { fontSize: 13, fontWeight: '800', marginBottom: 4 },
  insightText: { fontSize: 12, fontWeight: '500', lineHeight: 18 },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  compareLabel: { flex: 1, fontSize: 14, fontWeight: '700' },
  compareDelta: { width: 56, textAlign: 'right', fontSize: 14, fontWeight: '800' },
  compareValue: { width: 48, textAlign: 'right', fontSize: 13, fontWeight: '600' },
  scheduleRow: {
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    paddingVertical: 16,
  },
  scheduleCell: { flex: 1, alignItems: 'center', gap: 4 },
  scheduleDivider: { width: StyleSheet.hairlineWidth },
  scheduleLabel: { fontSize: 12, fontWeight: '600' },
  scheduleValue: { fontSize: 22, fontWeight: '800' },
  scheduleDays: { fontSize: 11, fontWeight: '600' },
  suggestion: {
    marginTop: 20,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 20,
    paddingHorizontal: 2,
  },
  primaryBtn: {
    marginTop: 12,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800' },
  trendToggle: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  trendToggleText: { fontSize: 13, fontWeight: '700' },
  trendWrap: { marginTop: 8 },
});
