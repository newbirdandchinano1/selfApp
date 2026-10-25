/**
 * 打卡管理 — 对齐设计稿 shot 22
 * 筛选切换 · 迷你热力 · 行内详情/编辑/删除 · 戒除重新开始 · 本周概览
 */
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { addDaysToYmd } from '@/lib/date';
import { sortHabitGridSectionsByTagWeight } from '@/lib/habit-grid-sort';
import { cancelScheduledHabitReminder } from '@/lib/habit-reminder-notifications';
import { getHabits, deleteHabit as deleteHabitById } from '@/lib/repositories/habits/habit';
import {
  isBreakHabitSucceeded,
  parseBreakHabitCycle,
  restartBreakHabit,
  syncBreakHabitCompletions,
} from '@/lib/repositories/habits/habit-break-success';
import {
  isBuildHabitSucceeded,
  parseBuildHabitCycle,
  syncBuildHabitCompletions,
} from '@/lib/repositories/habits/habit-build-success';
import { loadHabitCheckInPageData } from '@/lib/repositories/habits/habit-check-in';
import { getHabitContexts } from '@/lib/repositories/habits/habit-context';
import {
  computeConsecutiveGoalMetDays,
  isHabitDayGoalMet,
  parseBuildHabitExpectedGoal,
  parseHabitConsecutiveTargetDays,
  parseHabitDailyGoal,
} from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind, type HabitKind } from '@/lib/repositories/habits/habit-kind';
import {
  formatHabitReminderClock,
  parseHabitReminder,
} from '@/lib/repositories/habits/habit-reminder-meta';
import { parseHabitSubHabitsMeta } from '@/lib/repositories/habits/habit-sub';
import {
  computeTaskPeriodGoalProgress,
  parseTaskHabitExpectedGoal,
  parseTaskRepeatPeriod,
} from '@/lib/repositories/habits/habit-task-period';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import { getTagsByEntityIds } from '@/lib/repositories/tags/tag';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type HabitItem = {
  id: string;
  name: string;
  context: string;
  tag: string | null;
  icon: string;
  kind: HabitKind;
  streak: number;
  todayCount: number;
  weekDone: number;
  weekTotal: number;
  todayDone: boolean;
  miniHeat: HeatLevel[];
  reminderClock: string | null;
  subCount: number;
  breakSucceeded: boolean;
  breakCompletedStreak: number | null;
  consecutiveTargetDays: number | null;
  buildSucceeded: boolean;
  buildCompletedAt: string | null;
  buildExpectedGoal: ReturnType<typeof parseBuildHabitExpectedGoal>;
  taskExpectedGoal: ReturnType<typeof parseTaskHabitExpectedGoal>;
  taskRepeatPeriod: ReturnType<typeof parseTaskRepeatPeriod>;
  taskProgress: { current: number; target: number } | null;
  statusLine: string;
};

type ContextTab = { id: string; name: string; count: number };
type HeatLevel = 0 | 1 | 2 | 3;

const PAGE_API_KEY = 'habit-manage';
const MINI_HEAT_WEEKS = 18;
const MINI_HEAT_ROWS = 3;
const MINI_HEAT_CELLS = MINI_HEAT_WEEKS * MINI_HEAT_ROWS;

function habitKindLabel(kind: HabitKind): string {
  if (kind === 'break') return '戒除';
  if (kind === 'task') return '完成任务';
  return '养成';
}

function heatLevelFromCount(count: number, kind: HabitKind, dailyGoal: number | null): HeatLevel {
  if (kind === 'break') {
    if (count <= 0) return 2;
    return 0;
  }
  if (count <= 0) return 0;
  if (dailyGoal != null && dailyGoal > 0) {
    if (count >= dailyGoal) return 3;
    if (count >= Math.ceil(dailyGoal / 2)) return 2;
    return 1;
  }
  if (count >= 3) return 3;
  if (count === 2) return 2;
  return 1;
}

function buildMiniHeat(
  checkIns: Record<string, number>,
  endYmd: string,
  kind: HabitKind,
  dailyGoal: number | null,
): HeatLevel[] {
  const cells: HeatLevel[] = [];
  for (let i = MINI_HEAT_CELLS - 1; i >= 0; i -= 1) {
    const ymd = addDaysToYmd(endYmd, -i);
    const count = checkIns[ymd] ?? 0;
    const hasRecord = Object.prototype.hasOwnProperty.call(checkIns, ymd);
    if (kind === 'break') {
      if (!hasRecord) {
        cells.push(0);
      } else {
        cells.push(
          isHabitDayGoalMet({
            kind,
            todayCount: count,
            dailyGoal,
            hasDayRecord: true,
            ymd,
            logicalTodayYmd: endYmd,
          })
            ? 2
            : 0,
        );
      }
    } else {
      cells.push(heatLevelFromCount(count, kind, dailyGoal));
    }
  }
  return cells;
}

function countWeekDone(
  checkIns: Record<string, number>,
  endYmd: string,
  kind: HabitKind,
  dailyGoal: number | null,
): number {
  let n = 0;
  for (let i = 0; i < 7; i += 1) {
    const ymd = addDaysToYmd(endYmd, -i);
    const count = checkIns[ymd] ?? 0;
    const hasDayRecord = Object.prototype.hasOwnProperty.call(checkIns, ymd);
    if (
      isHabitDayGoalMet({
        kind,
        todayCount: count,
        dailyGoal,
        hasDayRecord: kind === 'break' ? hasDayRecord : undefined,
        ymd: kind === 'break' ? ymd : undefined,
        logicalTodayYmd: endYmd,
      })
    ) {
      n += 1;
    }
  }
  return n;
}

function MiniHeat({ levels, colors }: { levels: HeatLevel[]; colors: string[] }) {
  return (
    <View style={styles.hminiheat}>
      {Array.from({ length: MINI_HEAT_WEEKS }, (_, col) => (
        <View key={col} style={styles.hminiheatCol}>
          {Array.from({ length: MINI_HEAT_ROWS }, (_, row) => {
            const idx = col * MINI_HEAT_ROWS + row;
            const lv = levels[idx] ?? 0;
            return (
              <View
                key={row}
                style={[styles.hminiheatCell, { backgroundColor: colors[lv] ?? colors[0] }]}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

function ProgressBar({
  ratio,
  from,
  to,
  track,
}: {
  ratio: number;
  from: string;
  to: string;
  track: string;
}) {
  const pct = Math.max(0, Math.min(1, ratio));
  return (
    <View style={[styles.pcprog, { backgroundColor: track }]}>
      <View style={[styles.pcprogFill, { width: `${pct * 100}%`, backgroundColor: from }]}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: to, opacity: 0.55 }]} />
      </View>
    </View>
  );
}

function HabitManageRow({
  item,
  index,
  foldAnimate,
  onDetail,
  onEdit,
  onDelete,
  onRestart,
  restarting,
}: {
  item: HabitItem;
  index: number;
  foldAnimate: boolean;
  onDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRestart: () => void;
  restarting: boolean;
}) {
  const { tf, fonts, isDark } = useTaskFoldTheme();
  const isQuit = item.kind === 'break';
  const isGoal = item.kind === 'task';
  const accent = isQuit ? tf.rose : isGoal ? tf.sun : tf.frog;
  const kindBg = isQuit
    ? isDark
      ? tf.rose2
      : '#F3DED6'
    : isGoal
      ? isDark
        ? tf.sun2
        : '#F5E6CB'
      : isDark
        ? tf.lily2
        : '#EAF0DA';
  const kindFg = isQuit ? '#A35B41' : isGoal ? '#9C6B2B' : '#587752';
  const iconBg = isQuit
    ? isDark
      ? tf.rose2
      : '#F7E6DE'
    : isGoal
      ? isDark
        ? tf.sun2
        : '#F5E6CB'
      : tf.lily2;
  const heatColors = [tf.heat0, '#AFC78F', '#7FA06F', '#477049'];
  const cardBg = isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.82)';

  const metaParts = [item.context];
  if (item.tag) metaParts.push(item.tag);
  if (item.reminderClock) metaParts.push(`${item.reminderClock} 提醒`);

  let rightMeta = item.statusLine;
  if (item.kind === 'build' || (item.kind === 'break' && !item.breakSucceeded)) {
    rightMeta =
      item.weekTotal > 0
        ? `本周 ${item.weekDone} / ${item.weekTotal} · ${item.todayDone ? '今日已打卡' : '今天未打卡'}`
        : item.statusLine;
  }

  const showHeat = item.kind !== 'task';
  const taskRatio =
    item.taskProgress && item.taskProgress.target > 0
      ? item.taskProgress.current / item.taskProgress.target
      : 0;

  return (
    <FoldRiseIn
      animate={foldAnimate}
      index={Math.min(index + 1, 12)}
      duration={460}
      staggerMs={36}
      fromY={8}
      holdHidden={foldAnimate}>
      <View style={[styles.hmrow, { backgroundColor: cardBg, borderColor: tf.line2 }]}>
        <View style={[styles.hmAccent, { backgroundColor: accent }]} />
        <View style={styles.hmhead}>
          <View style={[styles.hmicon, { backgroundColor: iconBg }]}>
            <Text style={styles.hmiconEmoji}>{item.icon || '🌿'}</Text>
          </View>
          <View style={styles.hmname}>
            <View style={styles.hmnameTitle}>
              <Text style={[styles.hmnameText, { color: tf.ink2 }]} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={[styles.kind, { backgroundColor: kindBg }]}>
                <Text style={[styles.kindText, { color: kindFg }]}>{habitKindLabel(item.kind)}</Text>
              </View>
            </View>
            <Text style={[styles.hmmeta, { color: tf.faint }]} numberOfLines={1}>
              {metaParts.join(' · ')}
            </Text>
          </View>
          <View style={styles.hstreak}>
            {item.kind === 'task' && item.taskProgress ? (
              <Text style={[styles.hstreakNum, { color: '#9C6B2B', fontFamily: fonts.mono }]}>
                {item.taskProgress.current}/{item.taskProgress.target}
              </Text>
            ) : (
              <>
                <MaterialIcons name="local-fire-department" size={14} color={tf.sun} />
                <Text
                  style={[
                    styles.hstreakNum,
                    {
                      color: isQuit ? '#A35B41' : '#5D7C58',
                      fontFamily: fonts.mono,
                    },
                  ]}>
                  {item.breakSucceeded
                    ? (item.breakCompletedStreak ?? item.streak)
                    : item.streak}
                </Text>
              </>
            )}
          </View>
        </View>

        {showHeat ? (
          <View style={styles.heatRow}>
            <MiniHeat levels={item.miniHeat} colors={heatColors} />
            <Text style={[styles.heatRight, { color: isQuit ? '#A56547' : tf.faint }]} numberOfLines={2}>
              {rightMeta}
            </Text>
          </View>
        ) : null}

        {isGoal && item.taskProgress ? (
          <View style={{ marginTop: 6 }}>
            <ProgressBar ratio={taskRatio} from="#E3C38E" to="#D6974B" track={tf.track} />
            <View style={styles.goalMetaRow}>
              <Text style={[styles.goalMeta, { color: tf.faint }]}>{item.statusLine}</Text>
            </View>
          </View>
        ) : null}

        <View style={[styles.hmactions, { borderTopColor: isDark ? tf.line : 'rgba(232,224,210,0.45)' }]}>
          <Pressable
            onPress={onDetail}
            style={({ pressed }) => [styles.hmactionBtn, pressed && { opacity: 0.75 }]}
            hitSlop={4}>
            <MaterialIcons name="visibility" size={12} color={tf.frog} />
            <Text style={[styles.hmactionPrimary, { color: '#4F7450' }]}>详情</Text>
          </Pressable>
          <Pressable
            onPress={onEdit}
            style={({ pressed }) => [styles.hmactionBtn, pressed && { opacity: 0.75 }]}
            hitSlop={4}>
            <MaterialIcons name="edit" size={12} color={tf.muted} />
            <Text style={[styles.hmactionText, { color: tf.muted }]}>编辑</Text>
          </Pressable>
          {item.breakSucceeded || isQuit ? (
            <Pressable
              onPress={onRestart}
              disabled={restarting}
              style={({ pressed }) => [
                styles.hmactionBtn,
                { marginLeft: 'auto' },
                pressed && { opacity: 0.75 },
                restarting && { opacity: 0.5 },
              ]}
              hitSlop={4}>
              <MaterialIcons name="refresh" size={12} color="#A56547" />
              <Text style={[styles.hmactionText, { color: '#A56547' }]}>
                {restarting ? '重启中…' : '重新开始'}
              </Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                onPress={onDelete}
                style={({ pressed }) => [styles.hmactionBtn, pressed && { opacity: 0.75 }]}
                hitSlop={4}>
                <MaterialIcons name="delete-outline" size={12} color={tf.muted} />
                <Text style={[styles.hmactionText, { color: tf.muted }]}>删除</Text>
              </Pressable>
              <Text style={[styles.hmactionTrail, { color: tf.faint, marginLeft: 'auto' }]}>
                {item.subCount > 0
                  ? `子习惯 ${item.subCount}`
                  : item.todayDone
                    ? '今日已打卡'
                    : '今天未打卡'}
              </Text>
            </>
          )}
        </View>
      </View>
    </FoldRiseIn>
  );
}

export default function HabitManageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tf, fonts, isDark } = useTaskFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();
  const { wrapLoad, notifyAncestorsDataChanged } = usePageApiSync(PAGE_API_KEY);
  const { logicalTodayYmd } = usePageDayBoundary('tasks');

  const [items, setItems] = React.useState<HabitItem[]>([]);
  const [contextTabs, setContextTabs] = React.useState<ContextTab[]>([]);
  const [selectedContext, setSelectedContext] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [restartingId, setRestartingId] = React.useState<string | null>(null);
  const [weekOverview, setWeekOverview] = React.useState({
    checkIns: 0,
    streaks: 0,
    pendingToday: 0,
    rangeLabel: '',
  });

  const reload = React.useCallback(
    async (forceRefresh = false) => {
      await wrapLoad(async () => {
        try {
          await syncBreakHabitCompletions();
          await syncBuildHabitCompletions();
          const [rows, pageData] = await Promise.all([getHabits(), loadHabitCheckInPageData()]);
          const today = logicalTodayYmd;
          const weekStart = addDaysToYmd(today, -6);

          const nextItems: HabitItem[] = [];
          let weekCheckIns = 0;
          let streakOk = 0;
          let pendingToday = 0;

          for (const r of rows as HabitRow[]) {
            const kind = parseHabitKind(r.extra_data);
            const dailyGoal = parseHabitDailyGoal(r.extra_data, kind);
            const checkIns = pageData.checkInsMaps.get(r.id) ?? {};
            const st = pageData.checkStats.get(r.id);
            const todayCount = st?.todayCount ?? checkIns[today] ?? 0;
            const hasToday = Object.prototype.hasOwnProperty.call(checkIns, today);
            const todayDone = isHabitDayGoalMet({
              kind,
              todayCount,
              dailyGoal,
              hasDayRecord: kind === 'break' ? hasToday : undefined,
              ymd: today,
              logicalTodayYmd: today,
            });

            const cycle = parseBreakHabitCycle(r.extra_data);
            const buildCycle = parseBuildHabitCycle(r.extra_data);
            const breakSucceeded = kind === 'break' && isBreakHabitSucceeded(r.extra_data);
            const buildSucceeded = kind === 'build' && isBuildHabitSucceeded(r.extra_data);
            const rem = parseHabitReminder(r.extra_data);
            const subMeta = parseHabitSubHabitsMeta(r.extra_data);
            const taskGoal = kind === 'task' ? parseTaskHabitExpectedGoal(r.extra_data) : null;
            const taskPeriod = kind === 'task' ? parseTaskRepeatPeriod(r.extra_data) : '每月';
            let taskProgress: { current: number; target: number } | null = null;
            if (kind === 'task' && taskGoal) {
              const current = computeTaskPeriodGoalProgress({
                expectedGoal: taskGoal,
                checkIns,
                dailyGoal,
                logicalYmd: today,
                period: taskPeriod,
              });
              taskProgress = { current, target: taskGoal.value };
            }

            const streak = computeConsecutiveGoalMetDays({
              checkIns,
              endYmd: today,
              kind,
              dailyGoal,
              logicalTodayYmd: today,
            });
            const weekDone = countWeekDone(checkIns, today, kind, dailyGoal);

            for (let i = 0; i < 7; i += 1) {
              const ymd = addDaysToYmd(today, -i);
              const c = checkIns[ymd] ?? 0;
              if (kind === 'break') {
                if (Object.prototype.hasOwnProperty.call(checkIns, ymd) && c === 0) weekCheckIns += 1;
                else if (c > 0) {
                  /* broken day — skip */
                } else if (Object.prototype.hasOwnProperty.call(checkIns, ymd)) weekCheckIns += 1;
              } else if (c > 0) {
                weekCheckIns += c;
              }
            }
            if (streak >= 3) streakOk += 1;
            if (!todayDone && !breakSucceeded && !buildSucceeded) {
              if (kind === 'task' && taskProgress && taskProgress.current >= taskProgress.target) {
                /* period done */
              } else {
                pendingToday += 1;
              }
            }

            let statusLine = todayDone ? '今日已打卡' : '今天未打卡';
            if (breakSucceeded) {
              statusLine = '连续目标已达成 · 可继续累计';
            } else if (buildSucceeded) {
              statusLine = `已达成预期目标${buildCycle.completedAt ? ` · ${buildCycle.completedAt}` : ''}`;
            } else if (kind === 'task' && taskProgress) {
              statusLine =
                taskProgress.current >= taskProgress.target
                  ? '本周期已达标'
                  : `${taskPeriod} · ${taskProgress.current} / ${taskProgress.target}`;
            } else if (kind === 'break' && !todayDone) {
              statusLine = hasToday
                ? todayCount > 0
                  ? `今日破戒 ${todayCount} 次`
                  : '未破戒 · 已确认'
                : '今日待确认';
            }

            nextItems.push({
              id: r.id,
              name: r.name,
              context: r.context,
              tag: r.tag ?? null,
              icon: r.icon,
              kind,
              streak,
              todayCount,
              weekDone,
              weekTotal: 7,
              todayDone,
              miniHeat: buildMiniHeat(checkIns, today, kind, dailyGoal),
              reminderClock: formatHabitReminderClock(rem),
              subCount: subMeta.enabled ? subMeta.items.length : 0,
              breakSucceeded,
              breakCompletedStreak: cycle.completedStreak,
              consecutiveTargetDays: kind === 'break' ? parseHabitConsecutiveTargetDays(r.extra_data) : null,
              buildSucceeded,
              buildCompletedAt: buildCycle.completedAt,
              buildExpectedGoal: kind === 'build' ? parseBuildHabitExpectedGoal(r.extra_data) : null,
              taskExpectedGoal: taskGoal,
              taskRepeatPeriod: taskPeriod,
              taskProgress,
              statusLine,
            });
          }

          const contextRows = await getHabitContexts();
          const orderedContexts = contextRows.map((c) => c.name);
          const known = new Set(orderedContexts);
          const byCtx = new Map<string, HabitItem[]>();
          for (const it of nextItems) {
            const list = byCtx.get(it.context) ?? [];
            list.push(it);
            byCtx.set(it.context, list);
          }
          const legacyContexts = Array.from(byCtx.keys())
            .filter((ctx) => !known.has(ctx))
            .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
          const allContexts = [...orderedContexts, ...legacyContexts];

          const habitIds = rows.map((r) => r.id);
          const tagsByHabitId = await getTagsByEntityIds('habit', habitIds).catch(
            () => new Map<string, { weight?: number | null }[]>(),
          );
          const weightByHabitId = new Map<string, number>();
          for (const [id, tags] of tagsByHabitId) {
            weightByHabitId.set(
              id,
              tags.reduce((m, t) => Math.max(m, typeof t.weight === 'number' ? t.weight : 0), 0),
            );
          }
          const contextSortOrderById = new Map<string, number>();
          const contextIdByName = new Map<string, string>();
          for (const c of contextRows) {
            contextSortOrderById.set(c.id, Number(c.sort_order ?? 1000));
            contextIdByName.set(c.name, c.id);
          }

          const rawSections = allContexts
            .filter((ctx) => (byCtx.get(ctx) ?? []).length > 0)
            .map((ctx) => ({
              id: contextIdByName.get(ctx) ?? ctx,
              title: ctx,
              items: byCtx.get(ctx) ?? [],
            }));
          const sortedSections = sortHabitGridSectionsByTagWeight(
            rawSections,
            weightByHabitId,
            contextSortOrderById,
          );

          const flat: HabitItem[] = [];
          for (const sec of sortedSections) flat.push(...sec.items);

          const tabs: ContextTab[] = [
            { id: '__all__', name: '全部', count: flat.length },
            ...sortedSections.map((sec) => ({
              id: sec.title,
              name: sec.title,
              count: sec.items.length,
            })),
          ];
          for (const ctx of allContexts) {
            if (tabs.some((t) => t.id === ctx)) continue;
            tabs.push({ id: ctx, name: ctx, count: 0 });
          }

          const wsLabel = `${weekStart.slice(5).replace('-', '/')} – ${today.slice(5).replace('-', '/')}`;
          setItems(flat);
          setContextTabs(tabs);
          setWeekOverview({
            checkIns: weekCheckIns,
            streaks: streakOk,
            pendingToday,
            rangeLabel: wsLabel,
          });
        } catch (err) {
          console.warn('加载习惯失败', err);
          setItems([]);
          setContextTabs([{ id: '__all__', name: '全部', count: 0 }]);
          setWeekOverview({ checkIns: 0, streaks: 0, pendingToday: 0, rangeLabel: '' });
        } finally {
          setLoading(false);
        }
      }, forceRefresh);
    },
    [logicalTodayYmd, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload]),
  );

  const visibleItems = React.useMemo(() => {
    if (!selectedContext) return items;
    return items.filter((it) => it.context === selectedContext);
  }, [items, selectedContext]);

  const goDetail = (item: HabitItem) => {
    router.push({ pathname: '/habit-detail', params: { habitId: item.id } });
  };

  const goEdit = (item: HabitItem) => {
    router.push({
      pathname: '/add-habit',
      params: {
        mode: 'edit',
        name: item.name,
        icon: item.icon,
        context: item.context,
        habitId: item.id,
      },
    });
  };

  const confirmRestart = (item: HabitItem) => {
    Alert.alert(
      '重新开始',
      `重新开始「${item.name}」？连续记录将从今天重新计算。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '重新开始',
          onPress: () => {
            void (async () => {
              setRestartingId(item.id);
              try {
                await restartBreakHabit(item.id);
                await reload();
                toast.success('已重新开始');
              } catch (err) {
                console.warn('重启戒除习惯失败', err);
                toast.error(toUserMessage(err, '重启未保存，请稍后重试'));
              } finally {
                setRestartingId(null);
              }
            })();
          },
        },
      ],
    );
  };

  const confirmDelete = (item: HabitItem) => {
    Alert.alert('删除习惯', `确认删除「${item.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteHabitById(item.id);
              void cancelScheduledHabitReminder(item.id);
              notifyAncestorsDataChanged();
              await reload();
              toast.success('已删除');
            } catch (err) {
              console.warn('删除习惯失败', err);
              toast.error(toUserMessage(err, '删除失败，请稍后重试'));
            }
          })();
        },
      },
    ]);
  };

  const footPad = Math.max(insets.bottom, 12);
  const cardBg = isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.86)';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
      <View style={[styles.appbar, { paddingTop: Math.max(insets.top, 8) }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [styles.iconbtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="arrow-back" size={20} color={tf.ink2} />
        </Pressable>
        <View style={styles.appbarCenter}>
          <Text style={[styles.appbarTitle, { color: tf.ink }]}>打卡管理</Text>
          <Text style={[styles.appbarSub, { color: tf.muted }]} numberOfLines={1}>
            浏览与管理所有的打卡项 · {weekOverview.pendingToday} 个今日待打卡
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/add-habit')}
          style={({ pressed }) => [
            styles.pillbtn,
            {
              borderColor: tf.line2,
              backgroundColor: isDark ? 'rgba(255,252,245,0.08)' : 'rgba(255,252,245,0.66)',
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <MaterialIcons name="add" size={14} color={tf.ink2} />
          <Text style={{ fontSize: 12, fontWeight: '700', color: tf.ink2 }}>新建</Text>
        </Pressable>
      </View>

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={[styles.content, { paddingBottom: 28 + footPad }]}
        showsVerticalScrollIndicator={false}>
        <FoldRiseIn animate={foldAnimate} index={0} duration={420} staggerMs={32} fromY={6} holdHidden={foldAnimate}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.hmfilter}>
            {contextTabs.map((tab) => {
              const active =
                tab.id === '__all__' ? selectedContext === null : selectedContext === tab.id;
              const label = tab.id === '__all__' ? `全部 ${tab.count}` : tab.name;
              return (
                <Pressable
                  key={tab.id}
                  onPress={() => setSelectedContext(tab.id === '__all__' ? null : tab.id)}
                  style={({ pressed }) => [
                    styles.cat,
                    {
                      backgroundColor: active
                        ? tf.lily2
                        : isDark
                          ? 'rgba(255,252,245,0.06)'
                          : '#F1EDE1',
                      borderColor: active ? '#AFC38E' : 'transparent',
                      opacity: pressed ? 0.88 : 1,
                    },
                  ]}>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: active ? '700' : '600',
                      color: active ? '#3F5D3E' : tf.muted,
                    }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </FoldRiseIn>

        {loading && items.length === 0 ? (
          <ActivityIndicator color={tf.frog} style={{ marginTop: 40 }} />
        ) : visibleItems.length === 0 ? (
          <FoldRiseIn animate={foldAnimate} index={1} duration={460} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
            <View style={[styles.empty, { backgroundColor: cardBg, borderColor: tf.line2 }]}>
              <Text style={[styles.emptyTitle, { color: tf.ink }]}>暂无打卡项</Text>
              <Text style={[styles.emptySub, { color: tf.muted }]}>
                {selectedContext ? `「${selectedContext}」情境下还没有习惯` : '点右上角新建第一个习惯'}
              </Text>
            </View>
          </FoldRiseIn>
        ) : (
          visibleItems.map((item, index) => (
            <HabitManageRow
              key={item.id}
              item={item}
              index={index}
              foldAnimate={foldAnimate}
              onDetail={() => goDetail(item)}
              onEdit={() => goEdit(item)}
              onDelete={() => confirmDelete(item)}
              onRestart={() => confirmRestart(item)}
              restarting={restartingId === item.id}
            />
          ))
        )}

        <FoldRiseIn
          animate={foldAnimate}
          index={Math.min(visibleItems.length + 2, 12)}
          duration={460}
          staggerMs={36}
          fromY={8}
          holdHidden={foldAnimate}>
          <View style={[styles.overview, { backgroundColor: cardBg, borderColor: tf.line2 }]}>
            <View style={styles.overviewHead}>
              <Text style={[styles.overviewTitle, { color: tf.ink2 }]}>本周打卡概览</Text>
              <Text style={[styles.overviewRange, { color: tf.faint }]}>{weekOverview.rangeLabel}</Text>
              <Pressable onPress={() => void reload(true)} hitSlop={6} style={{ marginLeft: 'auto' }}>
                <Text style={{ fontSize: 11, color: '#6F856B', fontWeight: '600' }}>刷新 ›</Text>
              </Pressable>
            </View>
            <View style={styles.miniStat3}>
              <View style={[styles.miniStatCell, { backgroundColor: isDark ? tf.paper2 : 'rgba(255,252,245,0.62)' }]}>
                <Text style={[styles.miniStatNum, { color: '#4E6552', fontFamily: fonts.mono }]}>
                  {weekOverview.checkIns}
                </Text>
                <Text style={[styles.miniStatLabel, { color: tf.faint }]}>本周打卡</Text>
              </View>
              <View style={[styles.miniStatCell, { backgroundColor: isDark ? tf.paper2 : 'rgba(255,252,245,0.62)' }]}>
                <Text style={[styles.miniStatNum, { color: '#4E6552', fontFamily: fonts.mono }]}>
                  {weekOverview.streaks}
                </Text>
                <Text style={[styles.miniStatLabel, { color: tf.faint }]}>连续达标</Text>
              </View>
              <View style={[styles.miniStatCell, { backgroundColor: isDark ? tf.paper2 : 'rgba(255,252,245,0.62)' }]}>
                <Text style={[styles.miniStatNum, { color: '#4E6552', fontFamily: fonts.mono }]}>
                  {weekOverview.pendingToday}
                </Text>
                <Text style={[styles.miniStatLabel, { color: tf.faint }]}>今日待打卡</Text>
              </View>
            </View>
            <Text style={[styles.overviewHint, { color: tf.faint }]}>
              · 按逻辑日归日，补卡不改连续记录起点。
            </Text>
          </View>
        </FoldRiseIn>

        <FoldRiseIn
          animate={foldAnimate}
          index={Math.min(visibleItems.length + 3, 12)}
          duration={460}
          staggerMs={36}
          fromY={6}
          holdHidden={foldAnimate}>
          <View style={styles.managefoot}>
            <Pressable
              onPress={() => router.push('/habit-context')}
              style={({ pressed }) => [
                styles.ghost,
                {
                  borderColor: tf.line2,
                  backgroundColor: isDark ? 'rgba(255,252,245,0.05)' : 'rgba(255,252,245,0.7)',
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              <MaterialIcons name="layers" size={14} color={tf.ink2} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: tf.ink2 }}>情境管理</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/add-habit')}
              style={({ pressed }) => [
                styles.ghost,
                {
                  borderColor: tf.line2,
                  backgroundColor: isDark ? 'rgba(255,252,245,0.05)' : 'rgba(255,252,245,0.7)',
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              <MaterialIcons name="add" size={14} color={tf.ink2} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: tf.ink2 }}>新建习惯</Text>
            </Pressable>
          </View>
          <View style={styles.hintline}>
            <MaterialIcons name="lightbulb-outline" size={13} color={tf.sun} />
            <Text style={[styles.hintText, { color: tf.muted }]}>
              非打卡日可隐藏「定期」习惯，避免主屏噪声。
            </Text>
          </View>
        </FoldRiseIn>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  appbar: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconbtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appbarCenter: { flex: 1, minWidth: 0 },
  appbarTitle: { fontSize: 15, fontWeight: '700' },
  appbarSub: { fontSize: 10, marginTop: 2 },
  pillbtn: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 4,
    gap: 0,
  },
  hmfilter: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 10,
    paddingHorizontal: 1,
  },
  cat: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hmrow: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  hmAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2.5,
    opacity: 0.7,
  },
  hmhead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hmicon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hmiconEmoji: { fontSize: 14 },
  hmname: { flex: 1, minWidth: 0 },
  hmnameTitle: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  hmnameText: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  kind: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  kindText: { fontSize: 9, fontWeight: '600' },
  hmmeta: { fontSize: 11, marginTop: 2 },
  hstreak: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  hstreakNum: { fontSize: 13, fontWeight: '700' },
  heatRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  hminiheat: { flexDirection: 'row', gap: 1.5 },
  hminiheatCol: { gap: 1.5 },
  hminiheatCell: { width: 4.5, height: 4.5, borderRadius: 1 },
  heatRight: { flex: 1, fontSize: 10, textAlign: 'right', lineHeight: 14 },
  pcprog: { height: 4, borderRadius: 3, overflow: 'hidden' },
  pcprogFill: {
    height: '100%',
    borderRadius: 3,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  goalMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  goalMeta: { fontSize: 10 },
  hmactions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    paddingTop: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  hmactionBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  hmactionPrimary: { fontSize: 11, fontWeight: '700' },
  hmactionText: { fontSize: 11, fontWeight: '600' },
  hmactionTrail: { fontSize: 10 },
  overview: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
  },
  overviewHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  overviewTitle: { fontSize: 13, fontWeight: '700' },
  overviewRange: { fontSize: 10 },
  miniStat3: { flexDirection: 'row', gap: 6, marginTop: 8 },
  miniStatCell: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  miniStatNum: { fontSize: 15, fontWeight: '700' },
  miniStatLabel: { fontSize: 10, marginTop: 2 },
  overviewHint: { fontSize: 10, marginTop: 8, lineHeight: 14 },
  managefoot: { flexDirection: 'row', gap: 8, marginTop: 10 },
  ghost: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  hintline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
  },
  hintText: { fontSize: 11, flexShrink: 1 },
  empty: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    alignItems: 'center',
    marginTop: 8,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700' },
  emptySub: { fontSize: 12, marginTop: 6, textAlign: 'center' },
});
