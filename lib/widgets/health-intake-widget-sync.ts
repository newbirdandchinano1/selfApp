/**
 * 健康摄入缺口 → iOS 主屏 / 锁屏小组件。
 * 数据与 health-intake-reminder 同源；不重新发明排期。
 */
import { Platform } from 'react-native';

import { getHealthIntakeReminderStatusSummary } from '@/lib/health-intake-reminder-notifications';
import { getResolvedGlobalIntakeTargets } from '@/lib/global-intake-targets';
import { getNotificationCenterSettings } from '@/lib/notification-center-settings';
import { getHealthDayMetricsForUser } from '@/lib/repositories/health/health';
import type { HealthRecordRow } from '@/lib/repositories/health/health.types';
import { getDefaultUser } from '@/lib/repositories/users/user';
import { getLogicalLocalYmd, resolveDayBoundaryForPage } from '@/lib/tasks-logical-day';
import {
  buildHealthIntakeGlance,
  healthIntakeGlanceToWidgetProps,
  resolveHealthIntakeDisplayKeys,
  type HealthIntakeMetricInput,
  type HealthIntakeWidgetProps,
} from '@/lib/widgets/health-intake-glance';
import {
  getWidgetsSettings,
  shouldPushHealthIntakeWidget,
} from '@/lib/widgets/widgets-settings';

let syncChain: Promise<void> = Promise.resolve();
let lastFingerprint = '';

function resolveTargets(latest: HealthRecordRow | null) {
  const fallback = getResolvedGlobalIntakeTargets();
  const pick = (raw: number | null | undefined, fb: number) => {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
    return Math.max(0, fb);
  };
  return {
    hydration: pick(latest?.target_hydration, fallback.hydrationMl),
    protein: pick(latest?.target_protein, fallback.proteinG),
    carbohydrate: pick(latest?.target_carbohydrate, fallback.carbohydrateG),
    calories: pick(latest?.target_calories, fallback.caloriesKcal),
  };
}

function pausedProps(): HealthIntakeWidgetProps {
  return {
    ...healthIntakeGlanceToWidgetProps(
      buildHealthIntakeGlance({
        metrics: [],
        displayKeys: [],
        ringStyle: 'single',
        statusLine: '组件已暂停',
      }),
    ),
    statusLine: '组件已暂停',
    hasItems: 0,
  };
}

export async function buildTodayHealthIntakeGlance(now = new Date()) {
  const [widgetSettings, notifSettings] = await Promise.all([
    getWidgetsSettings(),
    getNotificationCenterSettings(),
  ]);
  const displayKeys = resolveHealthIntakeDisplayKeys({
    focusSource: widgetSettings.healthIntake.focusSource,
    careKeys: notifSettings.health.focusKeys,
    manualKeys: widgetSettings.healthIntake.manualKeys,
  });

  const user = await getDefaultUser();
  const boundary = await resolveDayBoundaryForPage('health');
  const logicalYmd = getLogicalLocalYmd(now, boundary);

  let metrics: HealthIntakeMetricInput[] = [];
  if (user?.id) {
    const day = await getHealthDayMetricsForUser(user.id, logicalYmd, {
      cacheOnly: true,
    }).catch(() => null);
    const totals = day?.totals ?? {
      hydration: 0,
      protein: 0,
      carbohydrate: 0,
      calories: 0,
    };
    const targets = resolveTargets(day?.latest ?? null);
    metrics = (
      ['hydration', 'protein', 'carbohydrate', 'calories'] as const
    ).map((key) => ({
      key,
      current: totals[key],
      target: targets[key],
    }));
  }

  const summary = await getHealthIntakeReminderStatusSummary(now).catch(() => ({
    kind: 'none' as const,
    line: '打开 App 后同步摄入',
    nextFireAt: null,
    primaryLabel: null,
  }));

  return buildHealthIntakeGlance({
    metrics,
    displayKeys,
    ringStyle: widgetSettings.healthIntake.ringStyle,
    statusLine: summary.line,
  });
}

async function syncHealthIntakeWidgetNow(reason: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const settings = await getWidgetsSettings();
  const HealthIntakeWidget = (await import('@/widgets/HealthIntakeWidget')).default;

  if (!shouldPushHealthIntakeWidget(settings)) {
    try {
      await HealthIntakeWidget.updateSnapshot(pausedProps());
    } catch (e) {
      if (__DEV__) console.warn('[widgets] health pause failed', e);
    }
    return;
  }

  const glance = await buildTodayHealthIntakeGlance();
  const props = healthIntakeGlanceToWidgetProps(glance);
  const fp = [
    props.ringCount,
    props.ring1Label,
    props.ring1Percent,
    props.ring2Label,
    props.ring2Percent,
    props.statusLine,
    props.allDone,
  ].join('|');
  if (fp === lastFingerprint && reason === 'debounce') return;
  lastFingerprint = fp;

  try {
    await HealthIntakeWidget.updateSnapshot(props);
  } catch (e) {
    if (__DEV__) console.warn('[widgets] health snapshot failed', reason, e);
  }

  if (__DEV__) {
    console.log('[widgets] health-intake synced', reason, {
      status: glance.status,
      rings: glance.rings.map((r) => `${r.label}:${r.percent}`),
    });
  }
}

export function scheduleHealthIntakeWidgetSync(reason: string): void {
  if (Platform.OS !== 'ios') return;
  const task = syncChain.then(() => syncHealthIntakeWidgetNow(reason));
  syncChain = task.catch((e) => {
    if (__DEV__) console.warn('[widgets] health sync chain error', reason, e);
  });
  void task;
}

export async function previewHealthIntakeWidgetProps(): Promise<HealthIntakeWidgetProps> {
  try {
    const settings = await getWidgetsSettings();
    if (!settings.privacy.previewUseRealData) {
      return healthIntakeGlanceToWidgetProps(
        buildHealthIntakeGlance({
          metrics: [
            { key: 'hydration', current: 1200, target: 2000 },
            { key: 'calories', current: 1400, target: 2000 },
          ],
          displayKeys: ['hydration', 'calories'],
          ringStyle: settings.healthIntake.ringStyle,
          statusLine: '下次提醒 15:30',
        }),
      );
    }
    return healthIntakeGlanceToWidgetProps(await buildTodayHealthIntakeGlance());
  } catch {
    return healthIntakeGlanceToWidgetProps(
      buildHealthIntakeGlance({
        metrics: [],
        displayKeys: [],
        ringStyle: 'single',
        statusLine: '暂无关注项',
      }),
    );
  }
}
