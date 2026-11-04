/**
 * 桌面组件控制中心设置（app_settings，键前缀 widgets.）。
 * 覆盖总闸 + 青蛙 / 习惯 / 健康 / 财务一眼账 / 紧急度。
 */
import { getAppSetting, setAppSetting } from '@/lib/app-settings-store';
import type { FrogScheduleFocusMode } from '@/lib/widgets/frog-schedule-glance';
import type {
  FinanceGlanceMaskMode,
  FinanceGlancePrimaryMetric,
} from '@/lib/widgets/finance-glance';
import type {
  HealthIntakeFocusKey,
  HealthIntakeFocusSource,
  HealthIntakeRingStyle,
} from '@/lib/widgets/health-intake-glance';
import {
  clampUrgencyDueSoonWindowDays,
  type UrgencyDueSoonWindowDays,
} from '@/lib/widgets/urgency-glance';

const KEY = {
  master: 'widgets.masterEnabled',
  liveActivityMaster: 'widgets.liveActivityEnabled',
  frogEnabled: 'widgets.frogSchedule.enabled',
  frogLiveActivity: 'widgets.frogSchedule.liveActivity',
  frogFocus: 'widgets.frogSchedule.focusMode',
  frogUpcoming: 'widgets.frogSchedule.upcomingCount',
  habitsEnabled: 'widgets.habitsToday.enabled',
  habitsIncludeBuild: 'widgets.habitsToday.include.build',
  habitsIncludeBreak: 'widgets.habitsToday.include.break',
  habitsIncludeTask: 'widgets.habitsToday.include.task',
  habitsListLimit: 'widgets.habitsToday.listLimit',
  habitsClearedLabel: 'widgets.habitsToday.clearedLabel',
  healthEnabled: 'widgets.healthIntake.enabled',
  healthRingStyle: 'widgets.healthIntake.ringStyle',
  healthFocusSource: 'widgets.healthIntake.focusSource',
  healthManualKeys: 'widgets.healthIntake.manualKeys',
  financeEnabled: 'widgets.financeGlance.enabled',
  financePrimary: 'widgets.financeGlance.primaryMetric',
  financeShowNext: 'widgets.financeGlance.showNextScheduled',
  financeMaskMode: 'widgets.financeGlance.maskMode',
  financeAllowLock: 'widgets.financeGlance.allowLockScreen',
  urgencyEnabled: 'widgets.urgency.enabled',
  urgencyShowOverdue: 'widgets.urgency.showOverdue',
  urgencyShowDueToday: 'widgets.urgency.showDueToday',
  urgencyShowDueSoon: 'widgets.urgency.showDueSoonProjects',
  urgencyWindow: 'widgets.urgency.dueSoonWindowDays',
  urgencyShowTop: 'widgets.urgency.showTopTitle',
  urgencyEmptyLabel: 'widgets.urgency.emptyLabel',
  privacyFinanceMask: 'widgets.privacy.financeMaskDefault',
  privacyLockStrict: 'widgets.privacy.lockScreenStrict',
  privacyPreviewReal: 'widgets.privacy.previewUseRealData',
} as const;

export type WidgetsSettings = {
  masterEnabled: boolean;
  liveActivityEnabled: boolean;
  frogSchedule: {
    enabled: boolean;
    liveActivity: boolean;
    focusMode: FrogScheduleFocusMode;
    upcomingCount: 2 | 3;
  };
  habitsToday: {
    enabled: boolean;
    includeKinds: { build: boolean; break: boolean; task: boolean };
    listLimit: 2 | 3;
    clearedLabel: string;
  };
  healthIntake: {
    enabled: boolean;
    ringStyle: HealthIntakeRingStyle;
    focusSource: HealthIntakeFocusSource;
    manualKeys: HealthIntakeFocusKey[];
  };
  financeGlance: {
    enabled: boolean;
    primaryMetric: FinanceGlancePrimaryMetric;
    showNextScheduled: boolean;
    maskMode: FinanceGlanceMaskMode;
    allowLockScreen: boolean;
  };
  urgency: {
    enabled: boolean;
    showOverdue: boolean;
    showDueToday: boolean;
    showDueSoonProjects: boolean;
    dueSoonWindowDays: UrgencyDueSoonWindowDays;
    showTopTitle: boolean;
    emptyLabel: string;
  };
  privacy: {
    financeMaskDefault: boolean;
    /** 锁屏一律不显示金额与具体待办标题 */
    lockScreenStrict: boolean;
    /** 控制页预览用真实快照；关则用占位文案 */
    previewUseRealData: boolean;
  };
};

export const DEFAULT_WIDGETS_SETTINGS: WidgetsSettings = {
  masterEnabled: true,
  liveActivityEnabled: true,
  frogSchedule: {
    enabled: true,
    liveActivity: true,
    focusMode: 'active_first',
    upcomingCount: 3,
  },
  habitsToday: {
    enabled: true,
    includeKinds: { build: true, break: true, task: false },
    listLimit: 3,
    clearedLabel: '今日习惯已收齐',
  },
  healthIntake: {
    enabled: true,
    ringStyle: 'dual',
    focusSource: 'follow_care',
    manualKeys: ['hydration', 'calories'],
  },
  financeGlance: {
    enabled: true,
    primaryMetric: 'today_spent',
    showNextScheduled: true,
    maskMode: 'follow',
    allowLockScreen: false,
  },
  urgency: {
    enabled: true,
    showOverdue: true,
    showDueToday: true,
    showDueSoonProjects: true,
    dueSoonWindowDays: 1,
    showTopTitle: true,
    emptyLabel: '暂无紧急项',
  },
  privacy: {
    financeMaskDefault: false,
    lockScreenStrict: false,
    previewUseRealData: true,
  },
};

const ALL_FOCUS: HealthIntakeFocusKey[] = [
  'hydration',
  'protein',
  'carbohydrate',
  'calories',
];

function asBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw === 0 || raw === '0' || raw === 'false') return false;
  if (raw === 1 || raw === '1' || raw === 'true') return true;
  return fallback;
}

function asFocus(raw: unknown): FrogScheduleFocusMode {
  return raw === 'next_first' ? 'next_first' : 'active_first';
}

function asUpcoming(raw: unknown): 2 | 3 {
  return raw === 2 || raw === '2' ? 2 : 3;
}

function asClearedLabel(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 24);
  return DEFAULT_WIDGETS_SETTINGS.habitsToday.clearedLabel;
}

function asRingStyle(raw: unknown): HealthIntakeRingStyle {
  return raw === 'single' ? 'single' : 'dual';
}

function asFocusSource(raw: unknown): HealthIntakeFocusSource {
  return raw === 'manual' ? 'manual' : 'follow_care';
}

function asManualKeys(raw: unknown): HealthIntakeFocusKey[] {
  const fallback = DEFAULT_WIDGETS_SETTINGS.healthIntake.manualKeys;
  if (!Array.isArray(raw)) return [...fallback];
  const seen = new Set<HealthIntakeFocusKey>();
  const out: HealthIntakeFocusKey[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    if (!ALL_FOCUS.includes(item as HealthIntakeFocusKey)) continue;
    const key = item as HealthIntakeFocusKey;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= 2) break;
  }
  return out.length > 0 ? out : [...fallback];
}

function asPrimaryMetric(raw: unknown): FinanceGlancePrimaryMetric {
  return raw === 'budget_remaining' ? 'budget_remaining' : 'today_spent';
}

function asMaskMode(raw: unknown): FinanceGlanceMaskMode {
  if (raw === 'force_mask' || raw === 'plain') return raw;
  return 'follow';
}

function asEmptyLabel(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 24);
  return DEFAULT_WIDGETS_SETTINGS.urgency.emptyLabel;
}

export async function getWidgetsSettings(): Promise<WidgetsSettings> {
  const [
    master,
    la,
    frogOn,
    frogLa,
    focus,
    upcoming,
    habitsOn,
    incBuild,
    incBreak,
    incTask,
    listLimit,
    cleared,
    healthOn,
    ringStyle,
    focusSource,
    manualKeys,
    financeOn,
    financePrimary,
    financeShowNext,
    financeMaskMode,
    financeAllowLock,
    urgencyOn,
    urgencyOverdue,
    urgencyDueToday,
    urgencyDueSoon,
    urgencyWindow,
    urgencyShowTop,
    urgencyEmpty,
    privacyFinanceMask,
    privacyLockStrict,
    privacyPreviewReal,
  ] = await Promise.all([
    getAppSetting<unknown>(KEY.master),
    getAppSetting<unknown>(KEY.liveActivityMaster),
    getAppSetting<unknown>(KEY.frogEnabled),
    getAppSetting<unknown>(KEY.frogLiveActivity),
    getAppSetting<unknown>(KEY.frogFocus),
    getAppSetting<unknown>(KEY.frogUpcoming),
    getAppSetting<unknown>(KEY.habitsEnabled),
    getAppSetting<unknown>(KEY.habitsIncludeBuild),
    getAppSetting<unknown>(KEY.habitsIncludeBreak),
    getAppSetting<unknown>(KEY.habitsIncludeTask),
    getAppSetting<unknown>(KEY.habitsListLimit),
    getAppSetting<unknown>(KEY.habitsClearedLabel),
    getAppSetting<unknown>(KEY.healthEnabled),
    getAppSetting<unknown>(KEY.healthRingStyle),
    getAppSetting<unknown>(KEY.healthFocusSource),
    getAppSetting<unknown>(KEY.healthManualKeys),
    getAppSetting<unknown>(KEY.financeEnabled),
    getAppSetting<unknown>(KEY.financePrimary),
    getAppSetting<unknown>(KEY.financeShowNext),
    getAppSetting<unknown>(KEY.financeMaskMode),
    getAppSetting<unknown>(KEY.financeAllowLock),
    getAppSetting<unknown>(KEY.urgencyEnabled),
    getAppSetting<unknown>(KEY.urgencyShowOverdue),
    getAppSetting<unknown>(KEY.urgencyShowDueToday),
    getAppSetting<unknown>(KEY.urgencyShowDueSoon),
    getAppSetting<unknown>(KEY.urgencyWindow),
    getAppSetting<unknown>(KEY.urgencyShowTop),
    getAppSetting<unknown>(KEY.urgencyEmptyLabel),
    getAppSetting<unknown>(KEY.privacyFinanceMask),
    getAppSetting<unknown>(KEY.privacyLockStrict),
    getAppSetting<unknown>(KEY.privacyPreviewReal),
  ]);
  return {
    masterEnabled: asBool(master, DEFAULT_WIDGETS_SETTINGS.masterEnabled),
    liveActivityEnabled: asBool(la, DEFAULT_WIDGETS_SETTINGS.liveActivityEnabled),
    frogSchedule: {
      enabled: asBool(frogOn, DEFAULT_WIDGETS_SETTINGS.frogSchedule.enabled),
      liveActivity: asBool(frogLa, DEFAULT_WIDGETS_SETTINGS.frogSchedule.liveActivity),
      focusMode: asFocus(focus),
      upcomingCount: asUpcoming(upcoming),
    },
    habitsToday: {
      enabled: asBool(habitsOn, DEFAULT_WIDGETS_SETTINGS.habitsToday.enabled),
      includeKinds: {
        build: asBool(incBuild, DEFAULT_WIDGETS_SETTINGS.habitsToday.includeKinds.build),
        break: asBool(incBreak, DEFAULT_WIDGETS_SETTINGS.habitsToday.includeKinds.break),
        task: asBool(incTask, DEFAULT_WIDGETS_SETTINGS.habitsToday.includeKinds.task),
      },
      listLimit: asUpcoming(listLimit),
      clearedLabel: asClearedLabel(cleared),
    },
    healthIntake: {
      enabled: asBool(healthOn, DEFAULT_WIDGETS_SETTINGS.healthIntake.enabled),
      ringStyle: asRingStyle(ringStyle),
      focusSource: asFocusSource(focusSource),
      manualKeys: asManualKeys(manualKeys),
    },
    financeGlance: {
      enabled: asBool(financeOn, DEFAULT_WIDGETS_SETTINGS.financeGlance.enabled),
      primaryMetric: asPrimaryMetric(financePrimary),
      showNextScheduled: asBool(
        financeShowNext,
        DEFAULT_WIDGETS_SETTINGS.financeGlance.showNextScheduled,
      ),
      maskMode: asMaskMode(financeMaskMode),
      allowLockScreen: asBool(
        financeAllowLock,
        DEFAULT_WIDGETS_SETTINGS.financeGlance.allowLockScreen,
      ),
    },
    urgency: {
      enabled: asBool(urgencyOn, DEFAULT_WIDGETS_SETTINGS.urgency.enabled),
      showOverdue: asBool(urgencyOverdue, DEFAULT_WIDGETS_SETTINGS.urgency.showOverdue),
      showDueToday: asBool(urgencyDueToday, DEFAULT_WIDGETS_SETTINGS.urgency.showDueToday),
      showDueSoonProjects: asBool(
        urgencyDueSoon,
        DEFAULT_WIDGETS_SETTINGS.urgency.showDueSoonProjects,
      ),
      dueSoonWindowDays: clampUrgencyDueSoonWindowDays(
        urgencyWindow ?? DEFAULT_WIDGETS_SETTINGS.urgency.dueSoonWindowDays,
      ),
      showTopTitle: asBool(urgencyShowTop, DEFAULT_WIDGETS_SETTINGS.urgency.showTopTitle),
      emptyLabel: asEmptyLabel(urgencyEmpty),
    },
    privacy: {
      financeMaskDefault: asBool(
        privacyFinanceMask,
        DEFAULT_WIDGETS_SETTINGS.privacy.financeMaskDefault,
      ),
      lockScreenStrict: asBool(
        privacyLockStrict,
        DEFAULT_WIDGETS_SETTINGS.privacy.lockScreenStrict,
      ),
      previewUseRealData: asBool(
        privacyPreviewReal,
        DEFAULT_WIDGETS_SETTINGS.privacy.previewUseRealData,
      ),
    },
  };
}

export async function patchWidgetsSettings(
  patch: Partial<{
    masterEnabled: boolean;
    liveActivityEnabled: boolean;
    frogSchedule: Partial<WidgetsSettings['frogSchedule']>;
    habitsToday: Partial<
      Omit<WidgetsSettings['habitsToday'], 'includeKinds'> & {
        includeKinds: Partial<WidgetsSettings['habitsToday']['includeKinds']>;
      }
    >;
    healthIntake: Partial<WidgetsSettings['healthIntake']>;
    financeGlance: Partial<WidgetsSettings['financeGlance']>;
    urgency: Partial<WidgetsSettings['urgency']>;
    privacy: Partial<WidgetsSettings['privacy']>;
  }>,
): Promise<WidgetsSettings> {
  const cur = await getWidgetsSettings();
  const next: WidgetsSettings = {
    masterEnabled: patch.masterEnabled ?? cur.masterEnabled,
    liveActivityEnabled: patch.liveActivityEnabled ?? cur.liveActivityEnabled,
    frogSchedule: {
      ...cur.frogSchedule,
      ...(patch.frogSchedule ?? {}),
    },
    habitsToday: {
      enabled: patch.habitsToday?.enabled ?? cur.habitsToday.enabled,
      listLimit: patch.habitsToday?.listLimit ?? cur.habitsToday.listLimit,
      clearedLabel: patch.habitsToday?.clearedLabel ?? cur.habitsToday.clearedLabel,
      includeKinds: {
        ...cur.habitsToday.includeKinds,
        ...(patch.habitsToday?.includeKinds ?? {}),
      },
    },
    healthIntake: {
      enabled: patch.healthIntake?.enabled ?? cur.healthIntake.enabled,
      ringStyle: patch.healthIntake?.ringStyle ?? cur.healthIntake.ringStyle,
      focusSource: patch.healthIntake?.focusSource ?? cur.healthIntake.focusSource,
      manualKeys: patch.healthIntake?.manualKeys
        ? asManualKeys(patch.healthIntake.manualKeys)
        : cur.healthIntake.manualKeys,
    },
    financeGlance: {
      enabled: patch.financeGlance?.enabled ?? cur.financeGlance.enabled,
      primaryMetric: patch.financeGlance?.primaryMetric ?? cur.financeGlance.primaryMetric,
      showNextScheduled:
        patch.financeGlance?.showNextScheduled ?? cur.financeGlance.showNextScheduled,
      maskMode: patch.financeGlance?.maskMode ?? cur.financeGlance.maskMode,
      allowLockScreen: patch.financeGlance?.allowLockScreen ?? cur.financeGlance.allowLockScreen,
    },
    urgency: {
      enabled: patch.urgency?.enabled ?? cur.urgency.enabled,
      showOverdue: patch.urgency?.showOverdue ?? cur.urgency.showOverdue,
      showDueToday: patch.urgency?.showDueToday ?? cur.urgency.showDueToday,
      showDueSoonProjects:
        patch.urgency?.showDueSoonProjects ?? cur.urgency.showDueSoonProjects,
      dueSoonWindowDays: clampUrgencyDueSoonWindowDays(
        patch.urgency?.dueSoonWindowDays ?? cur.urgency.dueSoonWindowDays,
      ),
      showTopTitle: patch.urgency?.showTopTitle ?? cur.urgency.showTopTitle,
      emptyLabel: asEmptyLabel(patch.urgency?.emptyLabel ?? cur.urgency.emptyLabel),
    },
    privacy: {
      financeMaskDefault: patch.privacy?.financeMaskDefault ?? cur.privacy.financeMaskDefault,
      lockScreenStrict: patch.privacy?.lockScreenStrict ?? cur.privacy.lockScreenStrict,
      previewUseRealData: patch.privacy?.previewUseRealData ?? cur.privacy.previewUseRealData,
    },
  };
  await Promise.all([
    setAppSetting(KEY.master, next.masterEnabled),
    setAppSetting(KEY.liveActivityMaster, next.liveActivityEnabled),
    setAppSetting(KEY.frogEnabled, next.frogSchedule.enabled),
    setAppSetting(KEY.frogLiveActivity, next.frogSchedule.liveActivity),
    setAppSetting(KEY.frogFocus, next.frogSchedule.focusMode),
    setAppSetting(KEY.frogUpcoming, next.frogSchedule.upcomingCount),
    setAppSetting(KEY.habitsEnabled, next.habitsToday.enabled),
    setAppSetting(KEY.habitsIncludeBuild, next.habitsToday.includeKinds.build),
    setAppSetting(KEY.habitsIncludeBreak, next.habitsToday.includeKinds.break),
    setAppSetting(KEY.habitsIncludeTask, next.habitsToday.includeKinds.task),
    setAppSetting(KEY.habitsListLimit, next.habitsToday.listLimit),
    setAppSetting(KEY.habitsClearedLabel, next.habitsToday.clearedLabel),
    setAppSetting(KEY.healthEnabled, next.healthIntake.enabled),
    setAppSetting(KEY.healthRingStyle, next.healthIntake.ringStyle),
    setAppSetting(KEY.healthFocusSource, next.healthIntake.focusSource),
    setAppSetting(KEY.healthManualKeys, next.healthIntake.manualKeys),
    setAppSetting(KEY.financeEnabled, next.financeGlance.enabled),
    setAppSetting(KEY.financePrimary, next.financeGlance.primaryMetric),
    setAppSetting(KEY.financeShowNext, next.financeGlance.showNextScheduled),
    setAppSetting(KEY.financeMaskMode, next.financeGlance.maskMode),
    setAppSetting(KEY.financeAllowLock, next.financeGlance.allowLockScreen),
    setAppSetting(KEY.urgencyEnabled, next.urgency.enabled),
    setAppSetting(KEY.urgencyShowOverdue, next.urgency.showOverdue),
    setAppSetting(KEY.urgencyShowDueToday, next.urgency.showDueToday),
    setAppSetting(KEY.urgencyShowDueSoon, next.urgency.showDueSoonProjects),
    setAppSetting(KEY.urgencyWindow, next.urgency.dueSoonWindowDays),
    setAppSetting(KEY.urgencyShowTop, next.urgency.showTopTitle),
    setAppSetting(KEY.urgencyEmptyLabel, next.urgency.emptyLabel),
    setAppSetting(KEY.privacyFinanceMask, next.privacy.financeMaskDefault),
    setAppSetting(KEY.privacyLockStrict, next.privacy.lockScreenStrict),
    setAppSetting(KEY.privacyPreviewReal, next.privacy.previewUseRealData),
  ]);
  return next;
}

export function shouldPushFrogScheduleWidget(settings: WidgetsSettings): boolean {
  return settings.masterEnabled && settings.frogSchedule.enabled;
}

export function shouldRunFrogScheduleLiveActivity(settings: WidgetsSettings): boolean {
  return (
    settings.masterEnabled &&
    settings.liveActivityEnabled &&
    settings.frogSchedule.enabled &&
    settings.frogSchedule.liveActivity
  );
}

export function shouldPushHabitsTodayWidget(settings: WidgetsSettings): boolean {
  return settings.masterEnabled && settings.habitsToday.enabled;
}

export function shouldPushHealthIntakeWidget(settings: WidgetsSettings): boolean {
  return settings.masterEnabled && settings.healthIntake.enabled;
}

export function shouldPushFinanceGlanceWidget(settings: WidgetsSettings): boolean {
  return settings.masterEnabled && settings.financeGlance.enabled;
}

export function shouldPushUrgencyWidget(settings: WidgetsSettings): boolean {
  return settings.masterEnabled && settings.urgency.enabled;
}
