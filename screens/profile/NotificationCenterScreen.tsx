/**
 * 消息 · 提醒设置：系统权限、总开关、频道、健康模式、时间摘要、已预约入口。
 * 对齐设计稿 09；嵌入消息壳时无自有顶栏。
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
import { syncHabitReminderNotification } from '@/lib/habit-reminder-notifications';
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategoryId,
} from '@/lib/notification-catalog';
import {
  getNotificationPermissionSnapshot,
  listScheduledAppNotifications,
  openSystemNotificationSettings,
  requestAppNotificationPermission,
  resyncAppNotificationsAfterPreferenceChange,
  type NotificationPermissionSnapshot,
} from '@/lib/notification-center';
import {
  getNotificationCenterSettings,
  patchNotificationCenterSettings,
  type HealthIntakeIntervalMinutes,
  type HealthIntakeReminderMode,
  type NotificationCategoryPrefs,
  type NotificationCenterSettings,
} from '@/lib/notification-center-settings';
import { getHabits, updateHabit } from '@/lib/repositories/habits/habit';
import {
  formatHabitReminderClock,
  mergeHabitReminderIntoExtraData,
  parseHabitReminder,
} from '@/lib/repositories/habits/habit-reminder-meta';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

const CHANNEL_UI: Record<
  NotificationCategoryId,
  { emoji: string; title: string; hint: string }
> = {
  'health-intake-reminder': { emoji: '💧', title: '健康摄入', hint: '喝水、记录、达标' },
  'schedule-slot-reminder': { emoji: '📅', title: '日程', hint: '训练、专注、约会' },
  'habit-reminder': { emoji: '✅', title: '习惯', hint: '每日打卡提醒' },
  'daily-review-reminder': { emoji: '📖', title: '日复盘', hint: '睡前提醒填写' },
  'auto-ledger': { emoji: '🖼️', title: '截图记账', hint: '识别到账单截图时' },
};

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function permLabel(permission: NotificationPermissionSnapshot | null): string {
  if (!permission) return '检测中…';
  if (permission.sandboxDisabled) return 'Expo Go 沙盒不会展示本地通知';
  if (permission.status === 'granted') return '已允许通知、声音与角标';
  if (permission.status === 'denied') return '已拒绝 · 请到系统设置开启';
  if (Platform.OS === 'web') return 'Web 端不支持本地推送';
  return '尚未决定 · 可请求授权';
}

export type NotificationCenterScreenProps = {
  /** 嵌入消息模块时隐藏自有顶栏 */
  embedded?: boolean;
  onMasterEnabledChange?: (enabled: boolean) => void;
};

export function NotificationCenterScreen({
  embedded = false,
  onMasterEnabledChange,
}: NotificationCenterScreenProps) {
  const router = useRouter();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<NotificationCenterSettings | null>(null);
  const [permission, setPermission] = useState<NotificationPermissionSnapshot | null>(null);
  const [habits, setHabits] = useState<HabitRowUi[]>([]);
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [reviewTime, setReviewTime] = useState(() => dailyReviewReminderTimeToDate(21, 0));
  const [scheduledCount, setScheduledCount] = useState(0);
  const [nextFireLabel, setNextFireLabel] = useState<string | null>(null);
  const [showHabits, setShowHabits] = useState(false);
  const [timePicker, setTimePicker] = useState<
    | null
    | {
        kind: 'health-fixed' | 'health-quiet-start' | 'health-quiet-end' | 'review' | 'habit';
        habitId?: string;
      }
  >(null);
  const [draftTime, setDraftTime] = useState(() => dailyReviewReminderTimeToDate(20, 0));

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSettings, nextPerm, habitRows, review, scheduled] = await Promise.all([
        getNotificationCenterSettings(),
        getNotificationPermissionSnapshot(),
        getHabits().catch(() => []),
        getDailyReviewReminderSettings(),
        listScheduledAppNotifications().catch(() => []),
      ]);
      setSettings(nextSettings);
      setPermission(nextPerm);
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
      setReviewTime(dailyReviewReminderTimeToDate(review.hour, review.minute));
      setScheduledCount(scheduled.length);
      const next = scheduled.find((s) => s.status === 'active' && s.fireAtLabel);
      setNextFireLabel(next?.fireAtLabel ?? null);
      onMasterEnabledChange?.(nextSettings.masterEnabled !== false);
    } catch (e) {
      console.warn('加载通知管理失败', e);
    } finally {
      setLoading(false);
    }
  }, [onMasterEnabledChange]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    if (settings) onMasterEnabledChange?.(settings.masterEnabled !== false);
  }, [onMasterEnabledChange, settings]);

  const applySettings = useCallback(async (next: NotificationCenterSettings) => {
    setSettings(next);
    onMasterEnabledChange?.(next.masterEnabled !== false);
    setBusy(true);
    try {
      await resyncAppNotificationsAfterPreferenceChange(next);
    } catch (e) {
      console.warn('应用通知偏好失败', e);
      Alert.alert('同步失败', '通知偏好已保存，但重新登记提醒时出错，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }, [onMasterEnabledChange]);

  const onMasterToggle = useCallback(
    async (enabled: boolean) => {
      if (!settings) return;
      setBusy(true);
      try {
        if (enabled && Platform.OS !== 'web' && permission?.status !== 'granted') {
          const perm = await requestAppNotificationPermission();
          setPermission(perm);
          if (perm.status !== 'granted') {
            Alert.alert(
              '需要通知权限',
              perm.sandboxDisabled
                ? 'Expo Go 沙盒环境不会展示本地通知。请使用开发构建或正式包。'
                : '请在系统设置中为本应用开启通知后，再打开总开关。',
              perm.sandboxDisabled
                ? [{ text: '知道了' }]
                : [
                    { text: '取消', style: 'cancel' },
                    { text: '打开系统设置', onPress: () => void openSystemNotificationSettings() },
                  ],
            );
            setBusy(false);
            return;
          }
        }
        const next = await patchNotificationCenterSettings({ masterEnabled: enabled });
        await applySettings(next);
      } catch (e) {
        console.warn('切换通知总开关失败', e);
        toast.error(toUserMessage(e, '保存失败，请稍后再试'));
        setBusy(false);
      }
    },
    [applySettings, permission?.status, settings],
  );

  const onCategoryToggle = useCallback(
    async (id: NotificationCategoryId, enabled: boolean) => {
      setBusy(true);
      try {
        const categoryPatch = { [id]: enabled } as Partial<NotificationCategoryPrefs>;
        const next = await patchNotificationCenterSettings({ categories: categoryPatch });
        await applySettings(next);
      } catch (e) {
        console.warn('切换通知频道失败', e);
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
  ) => {
    setDraftTime(initial);
    setTimePicker({ kind, habitId });
  };

  const commitTimePicker = () => {
    if (!timePicker || !settings) {
      setTimePicker(null);
      return;
    }
    const { hour, minute } = readDailyReviewReminderTimeFromDate(draftTime);
    const kind = timePicker.kind;
    setTimePicker(null);
    if (kind === 'health-fixed') {
      void patchHealth({ fixedHour: hour, fixedMinute: minute });
    } else if (kind === 'health-quiet-start') {
      void patchHealth({ quietStartHour: hour, quietStartMinute: minute });
    } else if (kind === 'health-quiet-end') {
      void patchHealth({ quietEndHour: hour, quietEndMinute: minute });
    } else if (kind === 'review') {
      void persistReview({ enabled: reviewEnabled, hour, minute });
    } else if (kind === 'habit' && timePicker.habitId) {
      void persistHabitReminder(timePicker.habitId, { enabled: true, hour, minute });
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
        setTimePicker(null);
        if (kind === 'health-fixed') void patchHealth({ fixedHour: hour, fixedMinute: minute });
        else if (kind === 'health-quiet-start')
          void patchHealth({ quietStartHour: hour, quietStartMinute: minute });
        else if (kind === 'health-quiet-end')
          void patchHealth({ quietEndHour: hour, quietEndMinute: minute });
        else if (kind === 'review') void persistReview({ enabled: reviewEnabled, hour, minute });
        else if (kind === 'habit' && habitId)
          void persistHabitReminder(habitId, { enabled: true, hour, minute });
      }
      return;
    }
    if (date) setDraftTime(date);
  };

  const masterOn = settings?.masterEnabled !== false;
  const health = settings?.health;
  const advance = settings?.schedule.advanceMinutes ?? 15;
  const healthChannelOn = settings?.categories['health-intake-reminder'] !== false;

  const habitSummary = useMemo(() => {
    const enabled = habits.filter((h) => h.enabled);
    if (enabled.length === 0) return '未开启';
    const first = enabled[0]!;
    const clock = formatHabitReminderClock({
      enabled: true,
      hour: first.hour,
      minute: first.minute,
    });
    return enabled.length === 1 ? clock : `${clock} · ${enabled.length} 个`;
  }, [habits]);

  const reviewClock = formatDailyReviewReminderClock(
    readDailyReviewReminderTimeFromDate(reviewTime).hour,
    readDailyReviewReminderTimeFromDate(reviewTime).minute,
  );

  const switchTrack = {
    false: fold.trackOff,
    true: fold.pineButton,
  } as const;

  const body = (
    <>
      {!embedded ? (
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
            <Text style={[styles.title, { color: fold.ink }]}>提醒设置</Text>
            <Text style={[styles.sub, { color: fold.muted }]}>本地调度 · 不上传服务器</Text>
          </View>
          <View
            style={[
              styles.statusTag,
              { backgroundColor: masterOn ? fold.sage2 : fold.paper2 },
            ]}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: masterOn ? '#36594D' : fold.muted }}>
              {masterOn ? '已开启' : '已关闭'}
            </Text>
          </View>
        </View>
      ) : null}

      {loading || !settings || !health ? (
        <View style={styles.centered}>
          <ActivityIndicator color={fold.pine} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <FoldRiseIn animate={motionOn} index={0} staggerMs={45} fromY={12}>
            <View style={[styles.card, styles.permCard, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <View style={[styles.permIcon, { backgroundColor: '#E3EFE6' }]}>
                <AppIcon name="notifications" size={14} color="#3C614F" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowTitle}>系统通知权限</Text>
                <Text style={styles.rowHint}>{permLabel(permission)}</Text>
              </View>
              <Pressable
                onPress={() => {
                  void (async () => {
                    if (permission?.status !== 'granted') {
                      const perm = await requestAppNotificationPermission();
                      setPermission(perm);
                      if (perm.status !== 'granted') await openSystemNotificationSettings();
                    } else {
                      await openSystemNotificationSettings();
                    }
                  })();
                }}
                style={({ pressed }) => [
                  styles.pillBtn,
                  {
                    borderColor: fold.line2,
                    backgroundColor: 'rgba(255,252,245,0.66)',
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <Text style={[styles.pillLabel, { color: fold.ink2 }]}>去设置 ›</Text>
              </Pressable>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={1} staggerMs={45} fromY={12}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line, paddingVertical: 8 }]}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={styles.rowTitle}>允许折页提醒我</Text>
                  <Text style={styles.rowHint}>关闭后所有本地通知静默，不删除已预约</Text>
                </View>
                <Switch
                  value={masterOn}
                  disabled={busy || Platform.OS === 'web'}
                  onValueChange={(v) => void onMasterToggle(v)}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                  style={motionOn ? undefined : undefined}
                />
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={2} staggerMs={45} fromY={12}>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: fold.card,
                  borderColor: fold.line,
                  opacity: masterOn ? 1 : 0.55,
                },
              ]}
              pointerEvents={masterOn ? 'auto' : 'none'}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>频道</Text>
                <Text style={styles.sectionHint}>逐项可控</Text>
              </View>
              {NOTIFICATION_CATEGORIES.map((cat) => {
                const ui = CHANNEL_UI[cat.id];
                const enabled = settings.categories[cat.id] !== false;
                return (
                  <View key={cat.id} style={styles.toggleRow}>
                    <Text style={styles.ti}>{ui.emoji}</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.rowTitle}>{ui.title}</Text>
                      <Text style={styles.rowHint}>{ui.hint}</Text>
                    </View>
                    <Switch
                      value={enabled}
                      disabled={busy}
                      onValueChange={(v) => void onCategoryToggle(cat.id, v)}
                      trackColor={switchTrack}
                      thumbColor="#ffffff"
                    />
                  </View>
                );
              })}
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={3} staggerMs={45} fromY={12}>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: fold.card,
                  borderColor: fold.line,
                  opacity: masterOn && healthChannelOn ? 1 : 0.55,
                },
              ]}
              pointerEvents={masterOn && healthChannelOn ? 'auto' : 'none'}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>健康提醒模式</Text>
                <View
                  style={[
                    styles.statusTag,
                    { backgroundColor: healthChannelOn ? fold.sage2 : fold.paper2 },
                  ]}>
                  <Text
                    style={{
                      fontSize: 9,
                      fontWeight: '700',
                      color: healthChannelOn ? '#36594D' : fold.muted,
                    }}>
                    {healthChannelOn ? '已开启' : '已关闭'}
                  </Text>
                </View>
              </View>
              <View style={styles.pillRow}>
                {(
                  [
                    { id: 'fixed' as HealthIntakeReminderMode, label: '固定时刻' },
                    { id: 'interval' as HealthIntakeReminderMode, label: '间隔提醒' },
                  ] as const
                ).map((opt) => {
                  const on = health.mode === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => void patchHealth({ mode: opt.id })}
                      style={({ pressed }) => [
                        styles.pill2,
                        {
                          backgroundColor: on ? fold.pineButton : '#F7F3E9',
                          borderColor: on ? fold.pineButton : fold.line,
                        },
                        pressed && { transform: [{ scale: 0.96 }] },
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

              {health.mode === 'fixed' ? (
                <Pressable
                  onPress={() =>
                    openTimePicker(
                      'health-fixed',
                      dailyReviewReminderTimeToDate(health.fixedHour, health.fixedMinute),
                    )
                  }
                  style={({ pressed }) => [
                    styles.tpill,
                    {
                      backgroundColor: '#E7EFE9',
                      borderColor: '#BFD4C6',
                      opacity: pressed ? 0.88 : 1,
                    },
                  ]}>
                  <Text style={[styles.tpillText, { color: '#3C5C4D', fontFamily: foldFonts.mono }]}>
                    ✓ {pad2(health.fixedHour)}:{pad2(health.fixedMinute)}
                  </Text>
                </Pressable>
              ) : (
                <View style={styles.tpillRow}>
                  {INTERVAL_OPTIONS.map((mins) => {
                    const on = health.intervalMinutes === mins;
                    return (
                      <Pressable
                        key={mins}
                        onPress={() => void patchHealth({ intervalMinutes: mins })}
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
                          {mins} 分
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <View style={[styles.quietRow, { marginTop: 8 }]}>
                <Pressable
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
                <Text style={[styles.quietText, { marginLeft: 'auto' as never, color: '#A0A69D' }]}>
                  每日最多 2 条
                </Text>
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={4} staggerMs={45} fromY={12}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line, paddingVertical: 8 }]}>
              <Pressable
                onPress={() => {
                  Alert.alert(
                    '日程提前',
                    `当前提前 ${advance} 分钟提醒`,
                    [
                      { text: '取消', style: 'cancel' },
                      advance > 5
                        ? { text: '-5 分钟', onPress: () => void patchScheduleAdvance(advance - 5) }
                        : undefined,
                      advance < 60
                        ? { text: '+5 分钟', onPress: () => void patchScheduleAdvance(advance + 5) }
                        : undefined,
                    ].filter(Boolean) as { text: string; style?: 'cancel'; onPress?: () => void }[],
                  );
                }}
                style={styles.linkRow}>
                <Text style={styles.linkLabel}>日程提前</Text>
                <Text style={[styles.linkValue, { color: '#8B6126' }]}>{advance} 分钟 ›</Text>
              </Pressable>
              <Pressable onPress={() => setShowHabits((v) => !v)} style={styles.linkRow}>
                <Text style={styles.linkLabel}>习惯提醒</Text>
                <Text style={[styles.linkValue, { color: '#8B6126' }]}>{habitSummary} ›</Text>
              </Pressable>
              {showHabits ? (
                <View style={styles.habitList}>
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
                          disabled={busy}
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
              ) : null}
              <Pressable
                onPress={() => {
                  if (!reviewEnabled) {
                    const { hour, minute } = readDailyReviewReminderTimeFromDate(reviewTime);
                    void persistReview({ enabled: true, hour, minute });
                  }
                  openTimePicker('review', reviewTime);
                }}
                style={styles.linkRow}>
                <Text style={styles.linkLabel}>日复盘提醒</Text>
                <Text style={[styles.linkValue, { color: '#8B6126' }]}>
                  {reviewEnabled ? `${reviewClock} ›` : '未开启 ›'}
                </Text>
              </Pressable>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={5} staggerMs={45} fromY={12}>
            <Pressable
              onPress={() => router.push('/notification-center-scheduled' as never)}
              style={({ pressed }) => [
                styles.card,
                styles.schedEntry,
                {
                  backgroundColor: fold.card,
                  borderColor: fold.line,
                  opacity: pressed ? 0.9 : 1,
                  transform: [{ scale: pressed ? 0.985 : 1 }],
                },
              ]}>
              <AppIcon name="access-time" size={16} color="#6A786F" />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>已预约通知</Text>
                <Text style={styles.rowHint}>
                  {scheduledCount > 0
                    ? `${scheduledCount} 条${nextFireLabel ? ` · 最近 ${nextFireLabel}` : ''}`
                    : '暂无预约 · 开启频道后自动登记'}
                </Text>
              </View>
              <Text style={{ color: '#B2B6AD', fontSize: 14 }}>›</Text>
            </Pressable>
          </FoldRiseIn>

          <View style={styles.footNote}>
            <View style={[styles.dot, { backgroundColor: fold.sage }]} />
            <Text style={[styles.footText, { color: fold.muted }]}>
              全部在本地调度 · 可随时一键暂停
            </Text>
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
    </>
  );

  if (embedded) {
    return <View style={styles.root}>{body}</View>;
  }
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: fold.paper }]} edges={['top']}>
      {body}
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
  scroll: { paddingBottom: 16, gap: 7 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  permCard: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  permIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillBtn: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLabel: { fontSize: 10, fontWeight: '650' as never },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 34,
    paddingVertical: 4,
  },
  ti: { fontSize: 14, width: 22, textAlign: 'center' },
  rowTitle: { fontSize: 12, fontWeight: '700', color: '#3F4C44' },
  rowHint: { fontSize: 10, color: '#9A9F97', marginTop: 1, lineHeight: 14 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#4F5C53' },
  sectionHint: { fontSize: 9, color: '#A0A69D' },
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
  schedEntry: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  footText: { fontSize: 10 },
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
