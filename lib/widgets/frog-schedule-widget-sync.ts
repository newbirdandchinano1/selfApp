/**
 * 将今日入格快照推到 iOS 主屏组件 / Live Activity。
 * 非 iOS 直接 no-op；尊重 widgets.* 开关。
 */
import { Platform } from 'react-native';

import { isFrogAssignedOn } from '@/lib/frog-assignment';
import { getProjectsByIds } from '@/lib/repositories/projects/project';
import { listPlacementsForWeek } from '@/lib/repositories/schedule/schedule-store';
import { getTasksByIds } from '@/lib/repositories/tasks/task';
import { isTaskTerminalStatus } from '@/lib/repositories/tasks/task.types';
import { resolvePlacementInterval } from '@/lib/schedule/timeline/from-placement';
import { getWeekStartMondayYmd, weekdayFromYmd } from '@/lib/schedule/week';
import { loadWeekSchedule } from '@/lib/schedule-service';
import {
  getLogicalLocalYmd,
  logicalYmdToLocalDate,
  resolveDayBoundaryForPage,
} from '@/lib/tasks-logical-day';
import {
  buildFrogScheduleGlance,
  formatRemainLabel,
  frogScheduleGlanceToLiveActivityProps,
  frogScheduleGlanceToWidgetProps,
  type FrogScheduleBlock,
  type FrogScheduleGlance,
  type FrogScheduleWidgetProps,
} from '@/lib/widgets/frog-schedule-glance';
import { isExpoWidgetsNativeAvailable } from '@/lib/widgets/expo-widgets-compat';
import {
  getWidgetsSettings,
  shouldPushFrogScheduleWidget,
  shouldRunFrogScheduleLiveActivity,
} from '@/lib/widgets/widgets-settings';
import {
  ensureHomeWidgetsRegistered,
  pushWidgetSnapshotVerified,
} from '@/lib/widgets/widget-bridge';
import { whenHomeWidgetsDbReady } from '@/lib/widgets/widget-sync-ready';

let syncChain: Promise<void> = Promise.resolve();
let lastWidgetFingerprint = '';
let lastLivePlacementId: string | null = null;

function emptyGlance(): FrogScheduleGlance {
  return {
    status: 'empty',
    focus: null,
    upcoming: [],
    placedCount: 0,
    overdueCount: 0,
    nowMins: 0,
  };
}

function pausedWidgetProps(): FrogScheduleWidgetProps {
  return {
    ...frogScheduleGlanceToWidgetProps(emptyGlance()),
    headline: '组件已暂停',
    statusLine: '在「桌面与状态栏」中开启',
  };
}

export async function buildTodayFrogScheduleGlance(now = new Date()): Promise<FrogScheduleGlance> {
  const settings = await getWidgetsSettings();
  const boundary = await resolveDayBoundaryForPage('tasks');
  const todayYmd = getLogicalLocalYmd(now, boundary);
  const weekStart = getWeekStartMondayYmd(todayYmd);
  const weekday = weekdayFromYmd(todayYmd);

  const view = await loadWeekSchedule(weekStart, todayYmd, { hydrateRemote: false });
  const placements = (await listPlacementsForWeek(weekStart)).filter(
    (p) => p.weekday === weekday && !p.orphaned,
  );

  const taskIds = placements.filter((p) => p.subjectKind === 'task').map((p) => p.subjectId);
  const projectIds = placements.filter((p) => p.subjectKind === 'project').map((p) => p.subjectId);
  const [tasks, projects] = await Promise.all([getTasksByIds(taskIds), getProjectsByIds(projectIds)]);
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  const axis = view.axis;
  const blocks: FrogScheduleBlock[] = [];

  for (const p of placements) {
    // 阶段 I：分钟优先；无存库分钟则 slot 派生；无法解析则跳过
    const iv = resolvePlacementInterval(p, axis);
    if (!iv) continue;
    const startMins = iv.startMinutes;
    const endMins = iv.endMinutes;

    if (p.subjectKind === 'task') {
      const task = taskMap.get(p.subjectId);
      if (!task) continue;
      const done = isTaskTerminalStatus(task.status) || task.status === 'shelved';
      const frog = isFrogAssignedOn(task.extra_data, todayYmd);
      blocks.push({
        placementId: p.id,
        subjectKind: 'task',
        subjectId: task.id,
        title: task.title?.trim() || '待办',
        displayKind: frog ? 'frog' : 'todo',
        startMins,
        endMins,
        done,
      });
      continue;
    }

    const project = projectMap.get(p.subjectId);
    if (!project) continue;
    const done =
      project.status === 'done' ||
      project.status === 'cancelled' ||
      project.status === 'shelved' ||
      project.status === 'completed' ||
      project.status === 'archived' ||
      project.status === 'paused';
    blocks.push({
      placementId: p.id,
      subjectKind: 'project',
      subjectId: project.id,
      title: project.name?.trim() || '项目',
      displayKind: 'project',
      startMins,
      endMins,
      done,
    });
  }

  return buildFrogScheduleGlance({
    blocks,
    now,
    todayLocalDate: logicalYmdToLocalDate(todayYmd),
    focusMode: settings.frogSchedule.focusMode,
    upcomingLimit: settings.frogSchedule.upcomingCount,
  });
}

function dayZeroMs(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
}

async function pushWidgetTimeline(
  props: FrogScheduleWidgetProps,
  glance: FrogScheduleGlance,
  now: Date,
) {
  const FrogScheduleWidget = (await import('@/widgets/FrogScheduleWidget')).default;
  const entries: { date: Date; props: FrogScheduleWidgetProps }[] = [{ date: now, props }];
  const day0 = dayZeroMs(now);

  if (glance.status === 'active' && glance.focus) {
    const endAt = day0 + glance.focus.endMins * 60_000;

    for (let i = 1; i <= 8; i += 1) {
      const tMs = now.getTime() + i * 5 * 60_000;
      if (tMs >= endAt - 5_000) break;
      const remainSec = (endAt - tMs) / 1000;
      entries.push({
        date: new Date(Math.floor(tMs)),
        props: {
          ...props,
          statusLine: `进行中 · ${formatRemainLabel(remainSec)}`,
        },
      });
    }

    if (endAt > now.getTime() + 10_000) {
      entries.push({
        date: new Date(Math.floor(endAt)),
        props: {
          ...props,
          headline: glance.upcoming[0]?.title.slice(0, 40) || '今日入格已清',
          lockHeadline: glance.upcoming[0]?.title.slice(0, 40) || '今日入格已清',
          statusLine: glance.upcoming[0]
            ? `下一场 · ${formatRemainLabel(0, { untilStart: true })}`
            : '时段结束',
          hasFocus: glance.upcoming[0] ? 1 : 0,
          upcoming1: '',
          upcoming2: '',
          upcoming3: '',
          upcomingVisible: 0,
        },
      });
    }
  } else if (glance.status === 'upcoming' && glance.focus && glance.focus.startMins > glance.nowMins) {
    const startAt = day0 + glance.focus.startMins * 60_000;
    if (startAt > now.getTime() + 10_000) {
      entries.push({
        date: new Date(Math.floor(startAt)),
        props: {
          ...props,
          statusLine: `进行中 · ${formatRemainLabel(
            (glance.focus.endMins - glance.focus.startMins) * 60,
          )}`,
        },
      });
    }
  }

  await pushWidgetSnapshotVerified(
    FrogScheduleWidget as never,
    props as never,
    { timeline: entries as never },
  );
}

async function syncLiveActivity(glance: FrogScheduleGlance, enabled: boolean, now: Date) {
  const FrogScheduleLiveActivity = (await import('@/widgets/FrogScheduleLiveActivity')).default;
  const desired = enabled ? frogScheduleGlanceToLiveActivityProps(glance) : null;
  const instances = FrogScheduleLiveActivity.getInstances?.() ?? [];

  if (!desired) {
    for (const inst of instances) {
      try {
        await inst.end('immediate');
      } catch {
        /* ignore */
      }
    }
    lastLivePlacementId = null;
    return;
  }

  const deepLink = `zheng://tasks?placement=${encodeURIComponent(desired.placementId)}`;
  const staleDate =
    glance.focus != null
      ? new Date(dayZeroMs(now) + glance.focus.endMins * 60_000)
      : undefined;

  let updated = false;
  for (const inst of instances) {
    // ActivityKit 实例不一定带回 props；同 placement 优先 update，否则结束旧实例
    const placementId =
      (inst as { props?: { placementId?: string } }).props?.placementId ?? lastLivePlacementId;
    if (!updated && (placementId === desired.placementId || instances.length === 1)) {
      try {
        await inst.update(desired, staleDate);
        updated = true;
        continue;
      } catch (e) {
        if (__DEV__) console.warn('[widgets] Live Activity update failed', e);
      }
    }
    try {
      await inst.end('immediate');
    } catch {
      /* ignore */
    }
  }

  if (!updated) {
    try {
      FrogScheduleLiveActivity.start(desired, deepLink, staleDate);
    } catch (e) {
      if (__DEV__) console.warn('[widgets] Live Activity start failed', e);
    }
  }
  lastLivePlacementId = desired.placementId;
}

async function syncFrogScheduleWidgetsNow(reason: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await whenHomeWidgetsDbReady();
  await ensureHomeWidgetsRegistered();

  const settings = await getWidgetsSettings();
  const now = new Date();

  if (!shouldPushFrogScheduleWidget(settings)) {
    try {
      const FrogScheduleWidget = (await import('@/widgets/FrogScheduleWidget')).default;
      await pushWidgetSnapshotVerified(FrogScheduleWidget as never, pausedWidgetProps() as never);
    } catch (e) {
      console.warn('[widgets] pause snapshot failed', e);
    }
    await syncLiveActivity(emptyGlance(), false, now);
    return;
  }

  const glance = await buildTodayFrogScheduleGlance(now);
  const props = frogScheduleGlanceToWidgetProps(glance, {
    lockScreenStrict: settings.privacy.lockScreenStrict,
  });
  const fp = `${props.headline}|${props.lockHeadline}|${props.statusLine}|${props.summaryLine}|${props.upcoming1}|${glance.status}|${lastLivePlacementId ?? ''}`;
  if (fp === lastWidgetFingerprint && reason === 'debounce') return;

  try {
    await pushWidgetTimeline(props, glance, now);
    lastWidgetFingerprint = fp;
  } catch (e) {
    console.warn('[widgets] timeline update failed', reason, e);
  }

  try {
    await syncLiveActivity(glance, shouldRunFrogScheduleLiveActivity(settings), now);
  } catch (e) {
    console.warn('[widgets] live activity sync failed', e);
  }

  if (__DEV__) {
    console.log('[widgets] frog-schedule synced', reason, {
      status: glance.status,
      title: props.headline,
      placed: glance.placedCount,
      la: lastLivePlacementId,
    });
  }
}

/** 串行调度，避免入格连点打爆原生更新 */
export function scheduleFrogScheduleWidgetSync(reason: string): void {
  if (Platform.OS !== 'ios') return;
  if (!isExpoWidgetsNativeAvailable()) return;
  const task = syncChain.then(() => syncFrogScheduleWidgetsNow(reason));
  syncChain = task.catch((e) => {
    if (__DEV__) console.warn('[widgets] sync chain error', reason, e);
  });
  void task;
}

/** 供控制页预览 */
export async function previewFrogScheduleWidgetProps(): Promise<FrogScheduleWidgetProps> {
  try {
    const settings = await getWidgetsSettings();
    if (!settings.privacy.previewUseRealData) {
      return {
        headline: '写周报',
        lockHeadline: settings.privacy.lockScreenStrict ? '青蛙' : '写周报',
        kindLabel: '青蛙',
        kindColor: '#2F6B4F',
        timeRange: '14:00–15:00',
        statusLine: '下一场 · 还有 42 分',
        summaryLine: '今日 3 格',
        upcoming1: '15:00 站会',
        upcoming2: '16:30 健身',
        upcoming3: '',
        upcomingVisible: 2,
        hasFocus: 1,
        deepLink: 'zheng://tasks',
      };
    }
    return frogScheduleGlanceToWidgetProps(await buildTodayFrogScheduleGlance(), {
      lockScreenStrict: settings.privacy.lockScreenStrict,
    });
  } catch {
    return frogScheduleGlanceToWidgetProps(emptyGlance());
  }
}
