/**
 * 提醒设置 · 页面频道详情：健康 / 财务 / 任务 / 复盘。
 * 旧类别 id 深链会解析到对应页面。
 */
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui';
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import {
  dailyReviewReminderTimeToDate,
  formatDailyReviewReminderClock,
  getDailyReviewReminderSettings,
  readDailyReviewReminderTimeFromDate,
  setDailyReviewReminderSettings,
} from '@/lib/daily-review-reminder-settings';
import { syncDailyReviewReminderNotification } from '@/lib/daily-review-reminder-notifications';
import {
  formatWeeklyReviewReminderClock,
  getWeeklyReviewReminderSettings,
  readWeeklyReviewReminderTimeFromDate,
  setWeeklyReviewReminderSettings,
  weeklyReviewReminderTimeToDate,
} from '@/lib/weekly-review-reminder-settings';
import { syncWeeklyReviewReminderNotification } from '@/lib/weekly-review-reminder-notifications';
import { syncHabitReminderNotification } from '@/lib/habit-reminder-notifications';
import {
  getCategoriesForPage,
  getNotificationCategoryMeta,
  getNotificationPageChannelMeta,
  isNotificationPageEnabled,
  resolveNotificationPageChannelId,
  type NotificationCategoryId,
  type NotificationPageChannelId,
} from '@/lib/notification-catalog';
import {
  resyncAppNotificationsAfterPreferenceChange,
} from '@/lib/notification-center';
import {
  getNotificationCenterSettings,
  HEALTH_INTAKE_FOCUS_KEYS,
  healthFocusKeyLabel,
  healthReminderModeLabel,
  patchNotificationCenterSettings,
  type FinanceReminderPrefs,
  type HealthIntakeFocusKey,
  type HealthIntakeIntervalMinutes,
  type HealthIntakeReminderMode,
  type NotificationCategoryPrefs,
  type NotificationCenterSettings,
  type ScheduleSlotSubjectKind,
} from '@/lib/notification-center-settings';
import { getHabits, updateHabit } from '@/lib/repositories/habits/habit';
import {
  formatHabitReminderClock,
  mergeHabitReminderIntoExtraData,
  parseHabitReminder,
} from '@/lib/repositories/habits/habit-reminder-meta';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type HabitRowUi = {
  id: string;
  name: string;
  enabled: boolean;
  hour: number;
  minute: number;
};

const INTERVAL_OPTIONS: HealthIntakeIntervalMinutes[] = [30, 60, 120];

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

export type NotificationChannelDetailScreenProps = {
  /** 页面频道 id，或兼容旧类别 id */
  categoryId: string;
};

export function NotificationChannelDetailScreen({
  categoryId: rawId,
}: NotificationChannelDetailScreenProps) {
  const router = useRouter();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();

  const pageId = resolveNotificationPageChannelId(rawId);
  const pageMeta = pageId ? getNotificationPageChannelMeta(pageId) : null;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<NotificationCenterSettings | null>(null);
  const [habits, setHabits] = useState<HabitRowUi[]>([]);
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [reviewTime, setReviewTime] = useState(() => dailyReviewReminderTimeToDate(21, 0));
  const [weeklyReviewEnabled, setWeeklyReviewEnabled] = useState(false);
  const [weeklyReviewTime, setWeeklyReviewTime] = useState(() => weeklyReviewReminderTimeToDate(20, 0));
  const [timePicker, setTimePicker] = useState<
    | null
    | {
        kind:
          | 'health-wrap'
          | 'health-meal'
          | 'health-quiet-start'
          | 'health-quiet-end'
          | 'review'
          | 'weekly-review'
          | 'habit'
          | 'finance-scheduled-wrap'
          | 'finance-savings'
          | 'finance-ledger-wrap';
        habitId?: string;
        mealIndex?: number;
      }
  >(null);
  const [draftTime, setDraftTime] = useState(() => dailyReviewReminderTimeToDate(20, 0));

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSettings, habitRows, review, weeklyReview] = await Promise.all([
        getNotificationCenterSettings(),
        getHabits().catch(() => []),
        getDailyReviewReminderSettings(),
        getWeeklyReviewReminderSettings(),
      ]);
      setSettings(nextSettings);
      setHabits(
        habitRows.map((h) => {
          const rem = parseHabitReminder(h.extra_data);
          return {
            id: h.id,
            name: h.name?.trim() || '习惯',
            enabled: rem.enabled,
            hour: rem.enabled ? rem.hour : 20,
            minute: rem.enabled ? rem.minute : 0,
          };
        }),
      );
      setReviewEnabled(review.enabled);
      setWeeklyReviewEnabled(weeklyReview.enabled);
      setWeeklyReviewTime(weeklyReviewReminderTimeToDate(weeklyReview.hour, weeklyReview.minute));
      setReviewTime(dailyReviewReminderTimeToDate(review.hour, review.minute));
    } catch (e) {
      console.warn('加载频道详情失败', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const applySettings = useCallback(async (next: NotificationCenterSettings) => {
    setSettings(next);
    setBusy(true);
    try {
      await resyncAppNotificationsAfterPreferenceChange(next);
    } catch (e) {
      console.warn('应用通知偏好失败', e);
      Alert.alert('同步失败', '通知偏好已保存，但重新登记提醒时出错，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }, []);

  const onPageToggle = useCallback(
    async (enabled: boolean) => {
      if (!pageId) return;
      setBusy(true);
      try {
        const patch: Partial<NotificationCategoryPrefs> = {};
        for (const id of getCategoriesForPage(pageId)) {
          patch[id] = enabled;
        }
        const next = await patchNotificationCenterSettings({ categories: patch });
        await applySettings(next);
      } catch (e) {
        console.warn('切换页面频道失败', e);
        toast.error(toUserMessage(e, '保存失败，请稍后再试'));
        setBusy(false);
      }
    },
    [applySettings, pageId],
  );

  const onCategoryToggle = useCallback(
    async (id: NotificationCategoryId, enabled: boolean) => {
      setBusy(true);
      try {
        const next = await patchNotificationCenterSettings({
          categories: { [id]: enabled },
        });
        await applySettings(next);
      } catch (e) {
        console.warn('切换通知类别失败', e);
        toast.error(toUserMessage(e, '保存失败，请稍后再试'));
        setBusy(false);
      }
    },
    [applySettings],
  );

  const patchHealth = useCallback(
    async (health: Partial<NotificationCenterSettings['health']>) => {
      setBusy(true);
      try {
        const next = await patchNotificationCenterSettings({ health });
        await applySettings(next);
      } catch (e) {
        console.warn('保存健康提醒偏好失败', e);
        toast.error(toUserMessage(e, '保存失败，请稍后再试'));
        setBusy(false);
      }
    },
    [applySettings],
  );

  const patchFinance = useCallback(
    async (finance: Partial<FinanceReminderPrefs>) => {
      setBusy(true);
      try {
        const next = await patchNotificationCenterSettings({ finance });
        await applySettings(next);
      } catch (e) {
        console.warn('保存财务提醒偏好失败', e);
        toast.error(toUserMessage(e, '保存失败，请稍后再试'));
        setBusy(false);
      }
    },
    [applySettings],
  );

  const patchScheduleAdvance = useCallback(
    async (advanceMinutes: number) => {
      setBusy(true);
      try {
        const next = await patchNotificationCenterSettings({
          schedule: { advanceMinutes },
        });
        await applySettings(next);
      } catch (e) {
        console.warn('保存日程表提醒偏好失败', e);
        toast.error(toUserMessage(e, '保存失败，请稍后再试'));
        setBusy(false);
      }
    },
    [applySettings],
  );

  const patchScheduleAdvanceByKind = useCallback(
    async (kind: ScheduleSlotSubjectKind, minutes: number) => {
      setBusy(true);
      try {
        const next = await patchNotificationCenterSettings({
          schedule: { advanceByKind: { [kind]: minutes } },
        });
        await applySettings(next);
      } catch (e) {
        console.warn('保存分类型提前量失败', e);
        toast.error(toUserMessage(e, '保存失败，请稍后再试'));
        setBusy(false);
      }
    },
    [applySettings],
  );

  const patchSchedulePolicy = useCallback(
    async (patch: Partial<NotificationCenterSettings['schedule']>) => {
      setBusy(true);
      try {
        const next = await patchNotificationCenterSettings({ schedule: patch });
        await applySettings(next);
      } catch (e) {
        console.warn('保存任务提醒策略失败', e);
        toast.error(toUserMessage(e, '保存失败，请稍后再试'));
        setBusy(false);
      }
    },
    [applySettings],
  );

  const persistReview = useCallback(
    async (next: { enabled: boolean; hour: number; minute: number }) => {
      setBusy(true);
      try {
        await setDailyReviewReminderSettings(next);
        setReviewEnabled(next.enabled);
        setReviewTime(dailyReviewReminderTimeToDate(next.hour, next.minute));
        await syncDailyReviewReminderNotification(next);
        await resyncAppNotificationsAfterPreferenceChange();
      } catch (e) {
        console.warn('保存复盘提醒失败', e);
        toast.error(toUserMessage(e, '保存失败，请稍后再试'));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const persistWeeklyReview = useCallback(
    async (next: { enabled: boolean; hour: number; minute: number }) => {
      setBusy(true);
      try {
        await setWeeklyReviewReminderSettings(next);
        setWeeklyReviewEnabled(next.enabled);
        setWeeklyReviewTime(weeklyReviewReminderTimeToDate(next.hour, next.minute));
        await syncWeeklyReviewReminderNotification(next);
        await resyncAppNotificationsAfterPreferenceChange();
      } catch (e) {
        console.warn('保存周复盘提醒失败', e);
        toast.error(toUserMessage(e, '保存失败，请稍后再试'));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const persistHabitReminder = useCallback(
    async (
      habitId: string,
      reminder: { enabled: false } | { enabled: true; hour: number; minute: number },
    ) => {
      setBusy(true);
      try {
        const habit = (await getHabits()).find((h) => h.id === habitId);
        if (!habit) return;
        const extra = mergeHabitReminderIntoExtraData(habit.extra_data, reminder);
        await updateHabit(habitId, { extra_data: extra });
        if (!reminder.enabled) {
          await syncHabitReminderNotification({
            habitId,
            enabled: false,
            hour: 20,
            minute: 0,
            title: habit.name,
            extraData: extra,
          });
        } else {
          await syncHabitReminderNotification({
            habitId,
            enabled: true,
            hour: reminder.hour,
            minute: reminder.minute,
            title: habit.name,
            extraData: extra,
          });
        }
        setHabits((prev) =>
          prev.map((h) =>
            h.id === habitId
              ? {
                  ...h,
                  enabled: reminder.enabled,
                  hour: reminder.enabled ? reminder.hour : h.hour,
                  minute: reminder.enabled ? reminder.minute : h.minute,
                }
              : h,
          ),
        );
        await resyncAppNotificationsAfterPreferenceChange();
      } catch (e) {
        console.warn('保存习惯提醒失败', e);
        toast.error(toUserMessage(e, '保存失败，请稍后再试'));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const openTimePicker = (
    kind: NonNullable<typeof timePicker>['kind'],
    initial: Date,
    habitId?: string,
    mealIndex?: number,
  ) => {
    setDraftTime(initial);
    setTimePicker({ kind, habitId, mealIndex });
  };

  const applyHealthClock = (
    kind: NonNullable<typeof timePicker>['kind'],
    hour: number,
    minute: number,
    mealIndex?: number,
  ) => {
    if (kind === 'health-wrap') {
      void patchHealth({ wrapHour: hour, wrapMinute: minute, fixedHour: hour, fixedMinute: minute });
      return;
    }
    if (kind === 'health-meal' && typeof mealIndex === 'number') {
      const windows = settings?.health.mealWindows;
      if (!windows) return;
      const nextWindows = windows.map((w, i) => (i === mealIndex ? { hour, minute } : w));
      void patchHealth({ mealWindows: nextWindows });
      return;
    }
    if (kind === 'health-quiet-start') {
      void patchHealth({ quietStartHour: hour, quietStartMinute: minute });
      return;
    }
    if (kind === 'health-quiet-end') {
      void patchHealth({ quietEndHour: hour, quietEndMinute: minute });
    }
  };

  const applyFinanceClock = (
    kind: NonNullable<typeof timePicker>['kind'],
    hour: number,
    minute: number,
  ) => {
    if (kind === 'finance-scheduled-wrap') {
      void patchFinance({ scheduledEveningWrapHour: hour, scheduledEveningWrapMinute: minute });
      return;
    }
    if (kind === 'finance-savings') {
      void patchFinance({ savingsNudgeHour: hour, savingsNudgeMinute: minute });
      return;
    }
    if (kind === 'finance-ledger-wrap') {
      void patchFinance({ ledgerWrapHour: hour, ledgerWrapMinute: minute });
    }
  };

  const commitTimePicker = () => {
    if (!timePicker || !settings) {
      setTimePicker(null);
      return;
    }
    const { hour, minute } = readDailyReviewReminderTimeFromDate(draftTime);
    const kind = timePicker.kind;
    const mealIndex = timePicker.mealIndex;
    const habitId = timePicker.habitId;
    setTimePicker(null);
    if (
      kind === 'health-wrap' ||
      kind === 'health-meal' ||
      kind === 'health-quiet-start' ||
      kind === 'health-quiet-end'
    ) {
      applyHealthClock(kind, hour, minute, mealIndex);
    } else if (
      kind === 'finance-scheduled-wrap' ||
      kind === 'finance-savings' ||
      kind === 'finance-ledger-wrap'
    ) {
      applyFinanceClock(kind, hour, minute);
    } else if (kind === 'review') {
      void persistReview({ enabled: reviewEnabled, hour, minute });
    } else if (kind === 'weekly-review') {
      void persistWeeklyReview({ enabled: weeklyReviewEnabled, hour, minute });
    } else if (kind === 'habit' && habitId) {
      void persistHabitReminder(habitId, { enabled: true, hour, minute });
    }
  };

  const onTimeChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      if (event.type === 'dismissed') {
        setTimePicker(null);
        return;
      }
      if (date) {
        setDraftTime(date);
        const { hour, minute } = readDailyReviewReminderTimeFromDate(date);
        const kind = timePicker?.kind;
        const habitId = timePicker?.habitId;
        const mealIndex = timePicker?.mealIndex;
        setTimePicker(null);
        if (
          kind === 'health-wrap' ||
          kind === 'health-meal' ||
          kind === 'health-quiet-start' ||
          kind === 'health-quiet-end'
        ) {
          applyHealthClock(kind, hour, minute, mealIndex);
        } else if (
          kind === 'finance-scheduled-wrap' ||
          kind === 'finance-savings' ||
          kind === 'finance-ledger-wrap'
        ) {
          applyFinanceClock(kind, hour, minute);
        } else if (kind === 'review') void persistReview({ enabled: reviewEnabled, hour, minute });
        else if (kind === 'weekly-review')
          void persistWeeklyReview({ enabled: weeklyReviewEnabled, hour, minute });
        else if (kind === 'habit' && habitId)
          void persistHabitReminder(habitId, { enabled: true, hour, minute });
      }
      return;
    }
    if (date) setDraftTime(date);
  };

  const toggleFocusKey = (key: HealthIntakeFocusKey) => {
    const current = settings?.health;
    if (!current) return;
    const on = current.focusKeys.includes(key);
    if (on && current.focusKeys.length <= 1) {
      toast.info('至少保留一项关注');
      return;
    }
    const next = on ? current.focusKeys.filter((k) => k !== key) : [...current.focusKeys, key];
    void patchHealth({ focusKeys: next });
  };

  const masterOn = settings?.masterEnabled !== false;
  const health = settings?.health;
  const advance = settings?.schedule.advanceMinutes ?? 15;
  const advanceByKind = settings?.schedule.advanceByKind ?? {
    task: advance,
    project: Math.min(advance, 10),
    habit: advance,
  };
  const pageOn = pageId && settings ? isNotificationPageEnabled(pageId, settings.categories) : false;
  const deliveryOn = masterOn && pageOn;
  const scheduleOn = settings?.categories['schedule-slot-reminder'] !== false;
  const deadlineOn = settings?.categories['task-deadline-reminder'] !== false;
  const projectProgressOn = settings?.categories['project-progress-reminder'] !== false;
  const dueSoonWindowDays = settings?.schedule.dueSoonWindowDays ?? 1;
  const projectStaleDays = settings?.schedule.projectStaleDays ?? 3;
  const overdueStickyEnabled = settings?.schedule.overdueStickyEnabled !== false;
  const habitChannelOn = settings?.categories['habit-reminder'] !== false;

  const reviewClock = formatDailyReviewReminderClock(
    readDailyReviewReminderTimeFromDate(reviewTime).hour,
    readDailyReviewReminderTimeFromDate(reviewTime).minute,
  );
  const weeklyReviewClock = formatWeeklyReviewReminderClock(
    readWeeklyReviewReminderTimeFromDate(weeklyReviewTime).hour,
    readWeeklyReviewReminderTimeFromDate(weeklyReviewTime).minute,
  );

  const habitEnabledCount = useMemo(() => habits.filter((h) => h.enabled).length, [habits]);

  const switchTrack = {
    false: fold.trackOff,
    true: fold.pineButton,
  } as const;

  const advanceOptions = [5, 10, 15, 20, 30, 45, 60] as const;

  const renderHealthBody = () => {
    if (!health) return null;
    const meta = getNotificationCategoryMeta('health-intake-reminder');
    const modeOptions: { id: HealthIntakeReminderMode; label: string }[] = [
      { id: 'meal_windows', label: healthReminderModeLabel('meal_windows') },
      { id: 'evening_wrap', label: healthReminderModeLabel('evening_wrap') },
      { id: 'hydration_interval', label: healthReminderModeLabel('hydration_interval') },
    ];
    return (
      <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>我关心</Text>
          <Text style={styles.sectionHint}>只催勾选项</Text>
        </View>
        <View style={styles.tpillRow}>
          {HEALTH_INTAKE_FOCUS_KEYS.map((key) => {
            const on = health.focusKeys.includes(key);
            return (
              <Pressable
                key={key}
                disabled={busy}
                onPress={() => toggleFocusKey(key)}
                style={[
                  styles.tpill,
                  {
                    backgroundColor: on ? '#E7EFE9' : '#F8F4EA',
                    borderColor: on ? '#BFD4C6' : fold.line,
                    opacity: busy ? 0.55 : 1,
                  },
                ]}>
                <Text
                  style={[
                    styles.tpillText,
                    { color: on ? '#3C5C4D' : '#6F7A72', fontWeight: on ? '700' : '600' },
                  ]}>
                  {on ? '✓ ' : ''}
                  {healthFocusKeyLabel(key)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.sectionHead, { marginTop: 12 }]}>
          <Text style={styles.sectionTitle}>提醒时机</Text>
          <Text style={styles.sectionHint}>每日最多 2 条</Text>
        </View>
        <View style={styles.pillRow}>
          {modeOptions.map((opt) => {
            const on = health.mode === opt.id;
            return (
              <Pressable
                key={opt.id}
                disabled={busy}
                onPress={() => void patchHealth({ mode: opt.id })}
                style={({ pressed }) => [
                  styles.pill2,
                  {
                    backgroundColor: on ? fold.pineButton : '#F7F3E9',
                    borderColor: on ? fold.pineButton : fold.line,
                    opacity: busy ? 0.55 : pressed ? 0.92 : 1,
                  },
                ]}>
                <Text
                  style={[
                    styles.pill2Text,
                    { color: on ? fold.onPineButton : fold.muted, fontWeight: on ? '700' : '600' },
                  ]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {health.mode === 'meal_windows' ? (
          <View style={{ gap: 6 }}>
            <Text style={styles.rowHint}>餐次窗口内若仍缺关注项则提醒，傍晚再收口一条</Text>
            <View style={styles.tpillRow}>
              {health.mealWindows.map((w, idx) => (
                <Pressable
                  key={`meal-${idx}`}
                  disabled={busy}
                  onPress={() =>
                    openTimePicker(
                      'health-meal',
                      dailyReviewReminderTimeToDate(w.hour, w.minute),
                      undefined,
                      idx,
                    )
                  }
                  style={({ pressed }) => [
                    styles.tpill,
                    {
                      backgroundColor: '#E7EFE9',
                      borderColor: '#BFD4C6',
                      opacity: busy ? 0.55 : pressed ? 0.88 : 1,
                    },
                  ]}>
                  <Text style={[styles.tpillText, { color: '#3C5C4D', fontFamily: foldFonts.mono }]}>
                    {idx === 0 ? '午 ' : idx === 1 ? '晚 ' : `${idx + 1} `}
                    {pad2(w.hour)}:{pad2(w.minute)}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                disabled={busy}
                onPress={() =>
                  openTimePicker(
                    'health-wrap',
                    dailyReviewReminderTimeToDate(health.wrapHour, health.wrapMinute),
                  )
                }
                style={({ pressed }) => [
                  styles.tpill,
                  {
                    backgroundColor: '#F3E9D8',
                    borderColor: '#D9C4A0',
                    opacity: busy ? 0.55 : pressed ? 0.88 : 1,
                  },
                ]}>
                <Text style={[styles.tpillText, { color: '#6A5436', fontFamily: foldFonts.mono }]}>
                  收口 {pad2(health.wrapHour)}:{pad2(health.wrapMinute)}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {health.mode === 'evening_wrap' ? (
          <Pressable
            disabled={busy}
            onPress={() =>
              openTimePicker(
                'health-wrap',
                dailyReviewReminderTimeToDate(health.wrapHour, health.wrapMinute),
              )
            }
            style={({ pressed }) => [
              styles.tpill,
              {
                backgroundColor: '#E7EFE9',
                borderColor: '#BFD4C6',
                opacity: busy ? 0.55 : pressed ? 0.88 : 1,
              },
            ]}>
            <Text style={[styles.tpillText, { color: '#3C5C4D', fontFamily: foldFonts.mono }]}>
              ✓ {pad2(health.wrapHour)}:{pad2(health.wrapMinute)}
            </Text>
          </Pressable>
        ) : null}

        {health.mode === 'hydration_interval' ? (
          <View style={{ gap: 6 }}>
            <Text style={styles.rowHint}>仅催水分；从最近一次摄入起算间隔</Text>
            <View style={styles.tpillRow}>
              {INTERVAL_OPTIONS.map((mins) => {
                const on = health.intervalMinutes === mins;
                return (
                  <Pressable
                    key={mins}
                    disabled={busy}
                    onPress={() => void patchHealth({ intervalMinutes: mins })}
                    style={[
                      styles.tpill,
                      {
                        backgroundColor: on ? '#E7EFE9' : '#F8F4EA',
                        borderColor: on ? '#BFD4C6' : fold.line,
                        opacity: busy ? 0.55 : 1,
                      },
                    ]}>
                    <Text
                      style={[
                        styles.tpillText,
                        { color: on ? '#3C5C4D' : '#6F7A72', fontWeight: on ? '700' : '600' },
                      ]}>
                      {on ? '✓ ' : ''}
                      {mins} 分
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={[styles.quietRow, { marginTop: 10 }]}>
          <Pressable
            disabled={busy}
            onPress={() =>
              openTimePicker(
                'health-quiet-start',
                dailyReviewReminderTimeToDate(health.quietStartHour, health.quietStartMinute),
              )
            }>
            <Text style={styles.quietText}>
              免打扰 {pad2(health.quietStartHour)}:{pad2(health.quietStartMinute)}
            </Text>
          </Pressable>
          <Text style={styles.quietText}> – </Text>
          <Pressable
            disabled={busy}
            onPress={() =>
              openTimePicker(
                'health-quiet-end',
                dailyReviewReminderTimeToDate(health.quietEndHour, health.quietEndMinute),
              )
            }>
            <Text style={styles.quietText}>
              {pad2(health.quietEndHour)}:{pad2(health.quietEndMinute)}
            </Text>
          </Pressable>
        </View>
        <Text style={[styles.desc, { marginTop: 10 }]}>{meta.description}</Text>
      </View>
    );
  };

  const renderAdvanceKindRow = (
    kind: ScheduleSlotSubjectKind,
    label: string,
    hint: string,
  ) => {
    const value = advanceByKind[kind] ?? 15;
    return (
      <View key={kind} style={{ marginTop: 10 }}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{label}</Text>
          <Text style={styles.sectionHint}>{hint}</Text>
        </View>
        <View style={styles.tpillRow}>
          {advanceOptions.map((mins) => {
            const on = value === mins;
            return (
              <Pressable
                key={`${kind}-${mins}`}
                disabled={busy || !scheduleOn}
                onPress={() => void patchScheduleAdvanceByKind(kind, mins)}
                style={[
                  styles.tpill,
                  {
                    backgroundColor: on ? '#E7EFE9' : '#F8F4EA',
                    borderColor: on ? '#BFD4C6' : fold.line,
                    opacity: busy || !scheduleOn ? 0.55 : 1,
                  },
                ]}>
                <Text
                  style={[
                    styles.tpillText,
                    { color: on ? '#3C5C4D' : '#6F7A72', fontWeight: on ? '700' : '600' },
                  ]}>
                  {on ? '✓ ' : ''}
                  {mins} 分
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };

  const renderScheduleCard = () => (
    <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
      <View style={styles.toggleRow}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={styles.rowTitle}>入格提醒</Text>
          <Text style={styles.rowHint}>已入格占用开始前按类型提前量提醒</Text>
        </View>
        <Switch
          value={scheduleOn}
          disabled={busy}
          onValueChange={(v) => void onCategoryToggle('schedule-slot-reminder', v)}
          trackColor={switchTrack}
          thumbColor="#ffffff"
        />
      </View>
      {renderAdvanceKindRow('task', '待办提前', '该做 xxx')}
      {renderAdvanceKindRow('project', '项目提前', '推进 xxx · 默认可更轻')}
      {renderAdvanceKindRow('habit', '习惯时段', '虚入格时段块')}
      <Pressable
        disabled={busy || !scheduleOn}
        onPress={() => {
          Alert.alert(
            '同步三类提前量',
            `将待办 / 习惯设为 ${advance} 分钟，项目不超过 10 分钟。也可在上方分别微调。`,
            [
              { text: '取消', style: 'cancel' },
              {
                text: '按待办同步',
                onPress: () => void patchScheduleAdvance(advance),
              },
              advance > 5
                ? {
                    text: '待办 -5',
                    onPress: () => void patchScheduleAdvance(Math.max(5, advance - 5)),
                  }
                : undefined,
              advance < 60
                ? {
                    text: '待办 +5',
                    onPress: () => void patchScheduleAdvance(Math.min(60, advance + 5)),
                  }
                : undefined,
            ].filter(Boolean) as { text: string; style?: 'cancel'; onPress?: () => void }[],
          );
        }}
        style={[styles.linkRow, { marginTop: 8, opacity: !scheduleOn ? 0.55 : 1 }]}>
        <Text style={styles.linkLabel}>快捷同步三类</Text>
        <Text style={[styles.linkValue, { color: '#8B6126' }]}>待办 {advance} 分 ›</Text>
      </Pressable>

      <View style={[styles.toggleRow, { marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fold.line, paddingTop: 12 }]}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={styles.rowTitle}>截止提醒</Text>
          <Text style={styles.rowHint}>未入格也可按日程截止日推送</Text>
        </View>
        <Switch
          value={deadlineOn}
          disabled={busy}
          onValueChange={(v) => void onCategoryToggle('task-deadline-reminder', v)}
          trackColor={switchTrack}
          thumbColor="#ffffff"
        />
      </View>
      <Text style={[styles.desc, { marginTop: 6, opacity: deadlineOn ? 1 : 0.55 }]}>
        {getNotificationCategoryMeta('task-deadline-reminder').description}
      </Text>
      <View style={[styles.sectionHead, { marginTop: 10, opacity: deadlineOn ? 1 : 0.55 }]}>
        <Text style={styles.sectionTitle}>临期窗口</Text>
        <Text style={styles.sectionHint}>距截止 ≤ N 天</Text>
      </View>
      <View style={[styles.tpillRow, { opacity: deadlineOn ? 1 : 0.55 }]}>
        {([1, 2, 3] as const).map((days) => {
          const on = dueSoonWindowDays === days;
          return (
            <Pressable
              key={`due-soon-${days}`}
              disabled={busy || !deadlineOn}
              onPress={() => void patchSchedulePolicy({ dueSoonWindowDays: days })}
              style={[
                styles.tpill,
                {
                  backgroundColor: on ? '#E7EFE9' : '#F8F4EA',
                  borderColor: on ? '#BFD4C6' : fold.line,
                },
              ]}>
              <Text
                style={[
                  styles.tpillText,
                  { color: on ? '#3C5C4D' : '#6F7A72', fontWeight: on ? '700' : '600' },
                ]}>
                {on ? '✓ ' : ''}
                {days} 天
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.toggleRow, { marginTop: 8, opacity: deadlineOn ? 1 : 0.55 }]}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={styles.rowTitle}>过期今日滞留</Text>
          <Text style={styles.rowHint}>过期未完成改推「今日滞留」</Text>
        </View>
        <Switch
          value={overdueStickyEnabled}
          disabled={busy || !deadlineOn}
          onValueChange={(v) => void patchSchedulePolicy({ overdueStickyEnabled: v })}
          trackColor={switchTrack}
          thumbColor="#ffffff"
        />
      </View>

      <View style={[styles.toggleRow, { marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fold.line, paddingTop: 12 }]}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={styles.rowTitle}>项目推进</Text>
          <Text style={styles.rowHint}>无入格滞留催「推进」</Text>
        </View>
        <Switch
          value={projectProgressOn}
          disabled={busy}
          onValueChange={(v) => void onCategoryToggle('project-progress-reminder', v)}
          trackColor={switchTrack}
          thumbColor="#ffffff"
        />
      </View>
      <Text style={[styles.desc, { marginTop: 6, opacity: projectProgressOn ? 1 : 0.55 }]}>
        {getNotificationCategoryMeta('project-progress-reminder').description}
      </Text>
      <View style={[styles.sectionHead, { marginTop: 8, opacity: projectProgressOn ? 1 : 0.55 }]}>
        <Text style={styles.sectionTitle}>滞留天数</Text>
        <Text style={styles.sectionHint}>无入格超过 N 天</Text>
      </View>
      <View style={[styles.tpillRow, { opacity: projectProgressOn ? 1 : 0.55 }]}>
        {([2, 3, 5, 7] as const).map((days) => {
          const on = projectStaleDays === days;
          return (
            <Pressable
              key={`stale-${days}`}
              disabled={busy || !projectProgressOn}
              onPress={() => void patchSchedulePolicy({ projectStaleDays: days })}
              style={[
                styles.tpill,
                {
                  backgroundColor: on ? '#E7EFE9' : '#F8F4EA',
                  borderColor: on ? '#BFD4C6' : fold.line,
                },
              ]}>
              <Text
                style={[
                  styles.tpillText,
                  { color: on ? '#3C5C4D' : '#6F7A72', fontWeight: on ? '700' : '600' },
                ]}>
                {on ? '✓ ' : ''}
                {days} 天
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const renderHabitCard = () => (
    <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
      <View style={styles.toggleRow}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={styles.rowTitle}>习惯提醒</Text>
          <Text style={styles.rowHint}>
            {habitEnabledCount > 0 ? `已开 ${habitEnabledCount} 个` : '按习惯单独设时刻'}
          </Text>
        </View>
        <Switch
          value={habitChannelOn}
          disabled={busy}
          onValueChange={(v) => void onCategoryToggle('habit-reminder', v)}
          trackColor={switchTrack}
          thumbColor="#ffffff"
        />
      </View>
      <View style={[styles.habitList, { marginTop: 4, opacity: habitChannelOn ? 1 : 0.55 }]}>
        {habits.length === 0 ? (
          <Text style={styles.rowHint}>暂无习惯</Text>
        ) : (
          habits.map((h) => (
            <View key={h.id} style={styles.habitRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {h.name}
                </Text>
                {h.enabled ? (
                  <Pressable
                    disabled={busy || !habitChannelOn}
                    onPress={() =>
                      openTimePicker(
                        'habit',
                        dailyReviewReminderTimeToDate(h.hour, h.minute),
                        h.id,
                      )
                    }>
                    <Text style={[styles.rowHint, { color: '#8B6126' }]}>
                      每日{' '}
                      {formatHabitReminderClock({
                        enabled: true,
                        hour: h.hour,
                        minute: h.minute,
                      })}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={styles.rowHint}>未开启</Text>
                )}
              </View>
              <Switch
                value={h.enabled}
                disabled={busy || !habitChannelOn}
                onValueChange={(v) => {
                  void persistHabitReminder(
                    h.id,
                    v
                      ? { enabled: true, hour: h.hour, minute: h.minute }
                      : { enabled: false },
                  );
                }}
                trackColor={switchTrack}
                thumbColor="#ffffff"
              />
            </View>
          ))
        )}
      </View>
    </View>
  );

  const renderReviewBody = () => (
    <>
      <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>日复盘提醒</Text>
          <Text style={styles.sectionHint}>{reviewEnabled ? reviewClock : '未开启'}</Text>
        </View>
        <Text style={styles.desc}>
          每日固定时刻提醒填写日复盘；已填写或周复盘日会跳过。
        </Text>
        <View style={[styles.toggleRow, { marginTop: 8 }]}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.rowTitle}>开启提醒</Text>
            <Text style={styles.rowHint}>关闭后不再登记日复盘本地通知</Text>
          </View>
          <Switch
            value={reviewEnabled}
            disabled={busy}
            onValueChange={(v) => {
              const { hour, minute } = readDailyReviewReminderTimeFromDate(reviewTime);
              void persistReview({ enabled: v, hour, minute });
            }}
            trackColor={switchTrack}
            thumbColor="#ffffff"
          />
        </View>
        <Pressable
          disabled={busy || !reviewEnabled}
          onPress={() => openTimePicker('review', reviewTime)}
          style={[styles.linkRow, { opacity: !reviewEnabled ? 0.55 : 1 }]}>
          <Text style={styles.linkLabel}>提醒时刻</Text>
          <Text style={[styles.linkValue, { color: '#8B6126' }]}>{reviewClock} ›</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/review-settings' as never)}
          style={styles.linkRow}>
          <Text style={styles.linkLabel}>前往复盘设置</Text>
          <Text style={[styles.linkValue, { color: '#8B6126' }]}>›</Text>
        </Pressable>
      </View>

      <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>周复盘提醒</Text>
          <Text style={styles.sectionHint}>{weeklyReviewEnabled ? weeklyReviewClock : '未开启'}</Text>
        </View>
        <Text style={styles.desc}>
          在已配置的周复盘日固定时刻催写周刊；已填写则跳过。需先在复盘设置选定复盘日。
        </Text>
        <View style={[styles.toggleRow, { marginTop: 8 }]}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.rowTitle}>开启提醒</Text>
            <Text style={styles.rowHint}>关闭后不再登记周复盘本地通知</Text>
          </View>
          <Switch
            value={weeklyReviewEnabled}
            disabled={busy}
            onValueChange={(v) => {
              const { hour, minute } = readWeeklyReviewReminderTimeFromDate(weeklyReviewTime);
              void persistWeeklyReview({ enabled: v, hour, minute });
            }}
            trackColor={switchTrack}
            thumbColor="#ffffff"
          />
        </View>
        <Pressable
          disabled={busy || !weeklyReviewEnabled}
          onPress={() => openTimePicker('weekly-review', weeklyReviewTime)}
          style={[styles.linkRow, { opacity: !weeklyReviewEnabled ? 0.55 : 1 }]}>
          <Text style={styles.linkLabel}>提醒时刻</Text>
          <Text style={[styles.linkValue, { color: '#8B6126' }]}>{weeklyReviewClock} ›</Text>
        </Pressable>
      </View>
    </>
  );

  const renderFinanceBody = () => {
    if (!settings) return null;
    const finance = settings.finance;
    const cats = settings.categories;
    const scheduledOn = cats['finance-scheduled-expense-reminder'] !== false;
    const budgetOn = cats['finance-budget-threshold-reminder'] !== false;
    const savingsOn = cats['finance-savings-nudge-reminder'] !== false;
    const ledgerOn = cats['finance-ledger-wrap-reminder'] !== false;
    const advanceOpts = [0, 15, 30, 60, 120] as const;
    const weekdayOpts = [
      { id: 0, label: '周日' },
      { id: 1, label: '周一' },
      { id: 2, label: '周二' },
      { id: 3, label: '周三' },
      { id: 4, label: '周四' },
      { id: 5, label: '周五' },
      { id: 6, label: '周六' },
    ] as const;

    return (
      <>
        <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>截图记账通知</Text>
            <Text style={styles.sectionHint}>即时 · 无预约</Text>
          </View>
          <Text style={styles.desc}>{getNotificationCategoryMeta('auto-ledger').description}</Text>
          <View style={[styles.toggleRow, { marginTop: 6 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>允许截图记账通知</Text>
            </View>
            <Switch
              value={cats['auto-ledger'] !== false}
              disabled={busy}
              onValueChange={(v) => void onCategoryToggle('auto-ledger', v)}
              trackColor={switchTrack}
              thumbColor="#ffffff"
            />
          </View>
          <Pressable
            onPress={() => router.push('/auto-ledger' as never)}
            style={styles.linkRow}>
            <Text style={styles.linkLabel}>前往截图记账</Text>
            <Text style={[styles.linkValue, { color: '#8B6126' }]}>›</Text>
          </Pressable>
        </View>

        <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>定时支出提醒</Text>
              <Text style={styles.rowHint}>应记前提醒；未入账可傍晚收口</Text>
            </View>
            <Switch
              value={scheduledOn}
              disabled={busy}
              onValueChange={(v) => void onCategoryToggle('finance-scheduled-expense-reminder', v)}
              trackColor={switchTrack}
              thumbColor="#ffffff"
            />
          </View>
          {scheduledOn ? (
            <>
              <Text style={[styles.sectionHint, { marginTop: 4, marginBottom: 4 }]}>提前量</Text>
              <View style={styles.tpillRow}>
                {advanceOpts.map((mins) => {
                  const on = finance.scheduledAdvanceMinutes === mins;
                  return (
                    <Pressable
                      key={mins}
                      disabled={busy}
                      onPress={() => void patchFinance({ scheduledAdvanceMinutes: mins })}
                      style={[
                        styles.tpill,
                        {
                          borderColor: on ? fold.pineButton : fold.line,
                          backgroundColor: on ? fold.sage2 : fold.paper2,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.tpillText,
                          { color: on ? '#36594D' : fold.muted, fontWeight: on ? '700' : '500' },
                        ]}>
                        {mins === 0 ? '到点' : `${mins} 分`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>傍晚收口</Text>
                  <Text style={styles.rowHint}>应记日仍未入账时再催一次</Text>
                </View>
                <Switch
                  value={finance.scheduledEveningWrapEnabled}
                  disabled={busy}
                  onValueChange={(v) => void patchFinance({ scheduledEveningWrapEnabled: v })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
              {finance.scheduledEveningWrapEnabled ? (
                <Pressable
                  disabled={busy}
                  onPress={() =>
                    openTimePicker(
                      'finance-scheduled-wrap',
                      dailyReviewReminderTimeToDate(
                        finance.scheduledEveningWrapHour,
                        finance.scheduledEveningWrapMinute,
                      ),
                    )
                  }
                  style={styles.linkRow}>
                  <Text style={styles.linkLabel}>收口时刻</Text>
                  <Text style={[styles.linkValue, { color: '#8B6126' }]}>
                    {pad2(finance.scheduledEveningWrapHour)}:
                    {pad2(finance.scheduledEveningWrapMinute)} ›
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => router.push('/scheduled-expenses' as never)}
                style={styles.linkRow}>
                <Text style={styles.linkLabel}>管理定时支出</Text>
                <Text style={[styles.linkValue, { color: '#8B6126' }]}>›</Text>
              </Pressable>
            </>
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>预算阈值提醒</Text>
              <Text style={styles.rowHint}>越过档位时推一次，不每日吵</Text>
            </View>
            <Switch
              value={budgetOn}
              disabled={busy}
              onValueChange={(v) => void onCategoryToggle('finance-budget-threshold-reminder', v)}
              trackColor={switchTrack}
              thumbColor="#ffffff"
            />
          </View>
          {budgetOn ? (
            <View style={[styles.tpillRow, { marginTop: 6 }]}>
              {(
                [
                  { key: 'budgetNotify50' as const, label: '50%' },
                  { key: 'budgetNotify80' as const, label: '80%' },
                  { key: 'budgetNotifyOver' as const, label: '超支' },
                ] as const
              ).map((opt) => {
                const on = finance[opt.key] === true;
                return (
                  <Pressable
                    key={opt.key}
                    disabled={busy}
                    onPress={() => void patchFinance({ [opt.key]: !on })}
                    style={[
                      styles.tpill,
                      {
                        borderColor: on ? fold.pineButton : fold.line,
                        backgroundColor: on ? fold.sage2 : fold.paper2,
                      },
                    ]}>
                    <Text
                      style={[
                        styles.tpillText,
                        { color: on ? '#36594D' : fold.muted, fontWeight: on ? '700' : '500' },
                      ]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>储蓄目标轻催</Text>
              <Text style={styles.rowHint}>每周一次；未设目标则跳过</Text>
            </View>
            <Switch
              value={savingsOn}
              disabled={busy}
              onValueChange={(v) => void onCategoryToggle('finance-savings-nudge-reminder', v)}
              trackColor={switchTrack}
              thumbColor="#ffffff"
            />
          </View>
          {savingsOn ? (
            <>
              <View style={[styles.tpillRow, { marginTop: 6 }]}>
                {weekdayOpts.map((w) => {
                  const on = finance.savingsNudgeWeekday === w.id;
                  return (
                    <Pressable
                      key={w.id}
                      disabled={busy}
                      onPress={() => void patchFinance({ savingsNudgeWeekday: w.id })}
                      style={[
                        styles.tpill,
                        {
                          borderColor: on ? fold.pineButton : fold.line,
                          backgroundColor: on ? fold.sage2 : fold.paper2,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.tpillText,
                          { color: on ? '#36594D' : fold.muted, fontWeight: on ? '700' : '500' },
                        ]}>
                        {w.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                disabled={busy}
                onPress={() =>
                  openTimePicker(
                    'finance-savings',
                    dailyReviewReminderTimeToDate(finance.savingsNudgeHour, finance.savingsNudgeMinute),
                  )
                }
                style={styles.linkRow}>
                <Text style={styles.linkLabel}>轻催时刻</Text>
                <Text style={[styles.linkValue, { color: '#8B6126' }]}>
                  {pad2(finance.savingsNudgeHour)}:{pad2(finance.savingsNudgeMinute)} ›
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>未记账收口</Text>
              <Text style={styles.rowHint}>当日无流水时傍晚提醒</Text>
            </View>
            <Switch
              value={ledgerOn}
              disabled={busy}
              onValueChange={(v) => void onCategoryToggle('finance-ledger-wrap-reminder', v)}
              trackColor={switchTrack}
              thumbColor="#ffffff"
            />
          </View>
          {ledgerOn ? (
            <Pressable
              disabled={busy}
              onPress={() =>
                openTimePicker(
                  'finance-ledger-wrap',
                  dailyReviewReminderTimeToDate(finance.ledgerWrapHour, finance.ledgerWrapMinute),
                )
              }
              style={styles.linkRow}>
              <Text style={styles.linkLabel}>收口时刻</Text>
              <Text style={[styles.linkValue, { color: '#8B6126' }]}>
                {pad2(finance.ledgerWrapHour)}:{pad2(finance.ledgerWrapMinute)} ›
              </Text>
            </Pressable>
          ) : null}
        </View>
      </>
    );
  };

  const renderPageSections = (id: NotificationPageChannelId) => {
    if (id === 'health') return renderHealthBody();
    if (id === 'finance') return renderFinanceBody();
    if (id === 'tasks') {
      return (
        <>
          {renderScheduleCard()}
          {renderHabitCard()}
        </>
      );
    }
    return renderReviewBody();
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: fold.paper }]} edges={['top']}>
      <View style={[styles.appBar, { borderBottomColor: fold.line }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => [
            styles.iconBtn,
            { borderColor: fold.line, backgroundColor: fold.card },
            pressed && { opacity: 0.88 },
          ]}>
          <AppIcon name="arrow-back" size={18} color={fold.ink2} />
        </Pressable>
        <View style={styles.appBarTitle}>
          <Text style={[styles.title, { color: fold.ink }]}>
            {pageMeta ? `${pageMeta.emoji} ${pageMeta.title}` : '频道详情'}
          </Text>
          <Text style={[styles.sub, { color: fold.muted }]}>
            {pageMeta?.hint ?? '具体提醒设置'}
          </Text>
        </View>
        <View
          style={[
            styles.statusTag,
            { backgroundColor: pageOn && masterOn ? fold.sage2 : fold.paper2 },
          ]}>
          <Text
            style={{
              fontSize: 10,
              fontWeight: '700',
              color: pageOn && masterOn ? '#36594D' : fold.muted,
            }}>
            {!masterOn ? '总开关关' : pageOn ? '已开启' : '已关闭'}
          </Text>
        </View>
      </View>

      {!pageId ? (
        <View style={styles.centered}>
          <Text style={styles.rowHint}>未知频道</Text>
        </View>
      ) : loading || !settings ? (
        <View style={styles.centered}>
          <ActivityIndicator color={fold.pine} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <FoldRiseIn animate={motionOn} index={0} staggerMs={45} fromY={12}>
            <View
              style={[
                styles.card,
                { backgroundColor: fold.card, borderColor: fold.line, paddingVertical: 8 },
              ]}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={styles.rowTitle}>启用本页提醒</Text>
                  <Text style={styles.rowHint}>
                    {deliveryOn
                      ? '关闭后本页相关本地通知静默'
                      : masterOn
                        ? '本页已关 · 仍可预配置'
                        : '总开关已关 · 仍可预配置'}
                  </Text>
                </View>
                <Switch
                  value={pageOn}
                  disabled={busy}
                  onValueChange={(v) => void onPageToggle(v)}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
            </View>
          </FoldRiseIn>

          <View style={{ opacity: deliveryOn ? 1 : 0.88, gap: 7 }}>
            <FoldRiseIn animate={motionOn} index={1} staggerMs={45} fromY={12}>
              <View style={{ gap: 7 }}>{renderPageSections(pageId)}</View>
            </FoldRiseIn>
          </View>

          <View style={{ height: 28 }} />
        </ScrollView>
      )}

      {timePicker && Platform.OS === 'ios' ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setTimePicker(null)}>
          <View style={styles.modalRoot}>
            <Pressable style={styles.modalBackdrop} onPress={() => setTimePicker(null)} />
            <View style={[styles.modalCard, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <DateTimePicker value={draftTime} mode="time" display="spinner" onChange={onTimeChange} />
              <View style={styles.modalActions}>
                <Pressable onPress={() => setTimePicker(null)} style={styles.modalBtn}>
                  <Text style={{ color: fold.muted, fontWeight: '700' }}>取消</Text>
                </Pressable>
                <Pressable
                  onPress={commitTimePicker}
                  style={[styles.modalBtn, { backgroundColor: fold.pineButton }]}>
                  <Text style={{ color: fold.onPineButton, fontWeight: '700' }}>确定</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
      {timePicker && Platform.OS === 'android' ? (
        <DateTimePicker value={draftTime} mode="time" display="default" onChange={onTimeChange} />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarTitle: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 10, marginTop: 2 },
  statusTag: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 12, paddingBottom: 16, gap: 7 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 34,
    paddingVertical: 4,
  },
  rowTitle: { fontSize: 12, fontWeight: '700', color: '#3F4C44' },
  rowHint: { fontSize: 10, color: '#9A9F97', marginTop: 1, lineHeight: 14 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#4F5C53' },
  sectionHint: { fontSize: 9, color: '#A0A69D' },
  desc: { fontSize: 10, color: '#8D958D', lineHeight: 15 },
  pillRow: { flexDirection: 'row', gap: 5, marginBottom: 6 },
  pill2: {
    flex: 1,
    height: 30,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill2Text: { fontSize: 11 },
  tpillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tpill: {
    height: 23,
    paddingHorizontal: 8,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  tpillText: { fontSize: 11 },
  quietRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  quietText: { fontSize: 10, color: '#8D958D' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
  },
  linkLabel: { fontSize: 12, color: '#5E6B62' },
  linkValue: { fontSize: 12, fontWeight: '700' },
  habitList: { paddingBottom: 4, gap: 6 },
  habitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(230,221,206,0.65)',
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(24,32,28,0.42)' },
  modalCard: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    paddingBottom: 24,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modalBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
  },
});
