/**
 * 小习惯今日进度 → iOS 主屏 / 锁屏小组件。
 */
import { Platform } from 'react-native';

import { isHabitScheduledOnLogicalYmd } from '@/lib/habit-schedule';
import {
  getHabitDayRecordFlagsForYmd,
  getAllHabitCheckInsMaps,
  getTodayHabitCountsMap,
} from '@/lib/repositories/habits/habit-check-in';
import {
  isHabitDayDisplayCompleted,
  parseHabitDailyGoal,
} from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind } from '@/lib/repositories/habits/habit-kind';
import { getHabits } from '@/lib/repositories/habits/habit';
import {
  getTaskHabitTasksViewState,
  isTaskHabitPeriodGoalMet,
} from '@/lib/repositories/habits/habit-task-period';
import { getLogicalLocalYmd, resolveDayBoundaryForPage } from '@/lib/tasks-logical-day';
import {
  buildHabitsTodayGlance,
  habitsTodayGlanceToWidgetProps,
  type HabitsTodayItem,
  type HabitsTodayWidgetProps,
} from '@/lib/widgets/habits-today-glance';
import { getWidgetsSettings, shouldPushHabitsTodayWidget } from '@/lib/widgets/widgets-settings';

let syncChain: Promise<void> = Promise.resolve();
let lastFingerprint = '';

function pausedProps(): HabitsTodayWidgetProps {
  return {
    ...habitsTodayGlanceToWidgetProps(buildHabitsTodayGlance({ items: [] })),
    progressLine: '—',
    statusLine: '组件已暂停',
    hasItems: 0,
  };
}

export async function buildTodayHabitsGlance(now = new Date()) {
  const settings = await getWidgetsSettings();
  const include = settings.habitsToday.includeKinds;
  const boundary = await resolveDayBoundaryForPage('tasks');
  const todayYmd = getLogicalLocalYmd(now, boundary);

  const [habits, todayCounts, recordFlags, checkInsMaps] = await Promise.all([
    getHabits(),
    getTodayHabitCountsMap(todayYmd),
    getHabitDayRecordFlagsForYmd(todayYmd),
    getAllHabitCheckInsMaps(),
  ]);

  const items: HabitsTodayItem[] = [];

  for (const h of habits) {
    const kind = parseHabitKind(h.extra_data);
    if (kind === 'build' && !include.build) continue;
    if (kind === 'break' && !include.break) continue;
    if (kind === 'task' && !include.task) continue;

    if (kind !== 'task' && !isHabitScheduledOnLogicalYmd(h.extra_data, todayYmd)) {
      continue;
    }

    const todayCount = todayCounts.get(h.id) ?? 0;
    const hasDayRecord = recordFlags.get(h.id) ?? false;
    const dailyGoal = parseHabitDailyGoal(h.extra_data, kind);
    const checkIns = checkInsMaps.get(h.id) ?? {};

    if (kind === 'task') {
      const view = getTaskHabitTasksViewState({
        extraData: h.extra_data,
        checkIns,
        logicalYmd: todayYmd,
      });
      if (view?.hiddenOnViewDay) continue;
      const periodDone =
        view != null
          ? view.periodProgress >= view.periodGoal
          : isTaskHabitPeriodGoalMet({
              extraData: h.extra_data,
              checkIns,
              logicalYmd: todayYmd,
            });
      const dayDone =
        dailyGoal != null
          ? isHabitDayDisplayCompleted({
              kind: 'task',
              todayCount,
              dailyGoal,
              hasDayRecord,
              ymd: todayYmd,
              logicalTodayYmd: todayYmd,
            })
          : periodDone;
      items.push({
        id: h.id,
        name: h.name?.trim() || '习惯',
        kind: 'task',
        done: periodDone || dayDone,
      });
      continue;
    }

    items.push({
      id: h.id,
      name: h.name?.trim() || '习惯',
      kind,
      done: isHabitDayDisplayCompleted({
        kind,
        todayCount,
        dailyGoal,
        hasDayRecord,
        ymd: todayYmd,
        logicalTodayYmd: todayYmd,
      }),
    });
  }

  return buildHabitsTodayGlance({
    items,
    listLimit: settings.habitsToday.listLimit,
  });
}

async function syncHabitsTodayWidgetNow(reason: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const settings = await getWidgetsSettings();
  const HabitsTodayWidget = (await import('@/widgets/HabitsTodayWidget')).default;

  if (!shouldPushHabitsTodayWidget(settings)) {
    try {
      await HabitsTodayWidget.updateSnapshot(pausedProps());
    } catch (e) {
      if (__DEV__) console.warn('[widgets] habits pause failed', e);
    }
    return;
  }

  const glance = await buildTodayHabitsGlance();
  const props = habitsTodayGlanceToWidgetProps(glance, {
    clearedLabel: settings.habitsToday.clearedLabel,
  });
  const fp = `${props.progressLine}|${props.statusLine}|${props.item1}|${props.item2}|${props.moreLine}`;
  if (fp === lastFingerprint && reason === 'debounce') return;
  lastFingerprint = fp;

  try {
    await HabitsTodayWidget.updateSnapshot(props);
  } catch (e) {
    if (__DEV__) console.warn('[widgets] habits snapshot failed', reason, e);
  }

  if (__DEV__) {
    console.log('[widgets] habits-today synced', reason, {
      status: glance.status,
      progress: props.progressLine,
    });
  }
}

export function scheduleHabitsTodayWidgetSync(reason: string): void {
  if (Platform.OS !== 'ios') return;
  const task = syncChain.then(() => syncHabitsTodayWidgetNow(reason));
  syncChain = task.catch((e) => {
    if (__DEV__) console.warn('[widgets] habits sync chain error', reason, e);
  });
  void task;
}

export async function previewHabitsTodayWidgetProps(): Promise<HabitsTodayWidgetProps> {
  try {
    const settings = await getWidgetsSettings();
    if (!settings.privacy.previewUseRealData) {
      return habitsTodayGlanceToWidgetProps(
        buildHabitsTodayGlance({
          items: [
            { id: '1', name: '晨跑', kind: 'build', done: true },
            { id: '2', name: '阅读', kind: 'build', done: false },
            { id: '3', name: '少刷手机', kind: 'break', done: false },
          ],
          listLimit: settings.habitsToday.listLimit,
        }),
        { clearedLabel: settings.habitsToday.clearedLabel },
      );
    }
    return habitsTodayGlanceToWidgetProps(await buildTodayHabitsGlance(), {
      clearedLabel: settings.habitsToday.clearedLabel,
    });
  } catch {
    return habitsTodayGlanceToWidgetProps(buildHabitsTodayGlance({ items: [] }));
  }
}
