import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategoryId,
} from '@/lib/notification-catalog';
import {
  getNotificationPermissionSnapshot,
  requestAppNotificationPermission,
  openSystemNotificationSettings,
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
import {
  dailyReviewReminderTimeToDate,
  formatDailyReviewReminderClock,
  getDailyReviewReminderSettings,
  readDailyReviewReminderTimeFromDate,
  setDailyReviewReminderSettings,
} from '@/lib/daily-review-reminder-settings';
import { syncDailyReviewReminderNotification } from '@/lib/daily-review-reminder-notifications';
import { getHabits, updateHabit } from '@/lib/repositories/habits/habit';
import {
  formatHabitReminderClock,
  mergeHabitReminderIntoExtraData,
  parseHabitReminder,
} from '@/lib/repositories/habits/habit-reminder-meta';
import { syncHabitReminderNotification } from '@/lib/habit-reminder-notifications';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

export default function NotificationCenterScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[colorScheme ?? 'light'];
  const text = theme.text;
  const outline = isDark ? 'rgba(148,163,184,0.8)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.35)';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const cardBg = isDark ? 'rgba(30,41,59,0.55)' : '#ffffff';
  const cardBorder = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(0,88,190,0.12)';
  const pageBg = theme.background;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<NotificationCenterSettings | null>(null);
  const [permission, setPermission] = useState<NotificationPermissionSnapshot | null>(null);
  const [habits, setHabits] = useState<HabitRowUi[]>([]);
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [reviewTime, setReviewTime] = useState(() => dailyReviewReminderTimeToDate(21, 0));
  const [timePicker, setTimePicker] = useState<
    | null
    | { kind: 'health-fixed' | 'health-quiet-start' | 'health-quiet-end' | 'review' | 'habit'; habitId?: string }
  >(null);
  const [draftTime, setDraftTime] = useState(() => dailyReviewReminderTimeToDate(20, 0));

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSettings, nextPerm, habitRows, review] = await Promise.all([
        getNotificationCenterSettings(),
        getNotificationPermissionSnapshot(),
        getHabits().catch(() => []),
        getDailyReviewReminderSettings(),
      ]);
      setSettings(nextSettings);
      setPermission(nextPerm);
      setHabits(
        habitRows.map(h => {
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
    } catch (e) {
      console.warn('加载通知管理失败', e);
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
        Alert.alert('保存失败', '请稍后再试');
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
        Alert.alert('保存失败', '请稍后再试');
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
        Alert.alert('保存失败', '请稍后再试');
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
        console.warn('保存课程表提醒偏好失败', e);
        Alert.alert('保存失败', '请稍后再试');
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
        Alert.alert('保存失败', '请稍后再试');
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
        const habit = (await getHabits()).find(h => h.id === habitId);
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
        setHabits(prev =>
          prev.map(h =>
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
        Alert.alert('保存失败', '请稍后再试');
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
        // Android 选完即提交
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

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: pageBg }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: cardBorder }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerIcon}>
          <MaterialIcons name="arrow-back" size={22} color={text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: text }]}>通知管理</Text>
        <View style={styles.headerIcon} />
      </View>

      {loading || !settings || !health ? (
        <View style={styles.centered}>
          <ActivityIndicator color={primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder, gap: 12 }]}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.rowTitle, { color: text }]}>启用通知</Text>
                <Text style={[styles.rowHint, { color: outline, marginTop: 4 }]}>
                  关闭后将取消全部本地预约提醒，并停止新的推送登记。
                </Text>
                {permission ? (
                  <Text style={[styles.rowHint, { color: outline, marginTop: 6, fontSize: 11 }]}>
                    {permission.sandboxDisabled
                      ? '当前为 Expo Go：系统不会展示本地通知。'
                      : permission.status === 'granted'
                        ? '系统通知权限：已授权'
                        : permission.status === 'denied'
                          ? '系统通知权限：已拒绝'
                          : Platform.OS === 'web'
                            ? 'Web 端不支持本地推送'
                            : '系统通知权限：未决定'}
                  </Text>
                ) : null}
              </View>
              <Switch
                value={masterOn}
                disabled={busy || Platform.OS === 'web'}
                onValueChange={v => void onMasterToggle(v)}
                trackColor={{ false: outlineVariant, true: primary }}
                thumbColor="#ffffff"
              />
            </View>
          </View>

          <View
            style={[
              styles.card,
              {
                backgroundColor: cardBg,
                borderColor: cardBorder,
                gap: 10,
                opacity: masterOn ? 1 : 0.55,
              },
            ]}
            pointerEvents={masterOn ? 'auto' : 'none'}>
            <Text style={[styles.rowTitle, { color: text }]}>推送频道</Text>
            {NOTIFICATION_CATEGORIES.map(cat => {
              const enabled = settings.categories[cat.id] !== false;
              return (
                <View key={cat.id} style={styles.categoryBlock}>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={[styles.categoryTitle, { color: text }]}>{cat.title}</Text>
                      <Text style={[styles.rowHint, { color: outline, marginTop: 2 }]}>
                        {cat.description}
                      </Text>
                    </View>
                    <Switch
                      value={enabled}
                      disabled={busy}
                      onValueChange={v => void onCategoryToggle(cat.id, v)}
                      trackColor={{ false: outlineVariant, true: primary }}
                      thumbColor="#ffffff"
                    />
                  </View>
                </View>
              );
            })}
          </View>

          {/* 健康偏好 */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: cardBg,
                borderColor: cardBorder,
                gap: 10,
                opacity: masterOn && settings.categories['health-intake-reminder'] !== false ? 1 : 0.55,
              },
            ]}
            pointerEvents={
              masterOn && settings.categories['health-intake-reminder'] !== false ? 'auto' : 'none'
            }>
            <Text style={[styles.rowTitle, { color: text }]}>健康摄入提醒</Text>
            <Text style={[styles.rowHint, { color: outline }]}>
              今日（健康逻辑日）水/蛋白/碳/热量任一未达目标时推送；达标后停止。每日最多 2 条。
            </Text>
            <Text style={[styles.subLabel, { color: text }]}>模式</Text>
            <View style={styles.chipRow}>
              {(
                [
                  { id: 'fixed' as HealthIntakeReminderMode, label: '固定时刻' },
                  { id: 'interval' as HealthIntakeReminderMode, label: '间隔检查' },
                ] as const
              ).map(opt => {
                const selected = health.mode === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => void patchHealth({ mode: opt.id })}
                    style={[
                      styles.chip,
                      {
                        borderColor: selected ? primary : outlineVariant,
                        backgroundColor: selected
                          ? isDark
                            ? 'rgba(96,165,250,0.15)'
                            : 'rgba(0,88,190,0.08)'
                          : 'transparent',
                      },
                    ]}>
                    <Text style={[styles.chipText, { color: text }]}>{opt.label}</Text>
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
                style={[styles.timeRow, { borderColor: cardBorder }]}>
                <Text style={[styles.rowHint, { color: outline }]}>固定时刻</Text>
                <Text style={[styles.timeValue, { color: text }]}>
                  {pad2(health.fixedHour)}:{pad2(health.fixedMinute)}
                </Text>
              </Pressable>
            ) : (
              <View style={styles.chipRow}>
                {INTERVAL_OPTIONS.map(mins => {
                  const selected = health.intervalMinutes === mins;
                  return (
                    <Pressable
                      key={mins}
                      onPress={() => void patchHealth({ intervalMinutes: mins })}
                      style={[
                        styles.chip,
                        {
                          borderColor: selected ? primary : outlineVariant,
                          backgroundColor: selected
                            ? isDark
                              ? 'rgba(96,165,250,0.15)'
                              : 'rgba(0,88,190,0.08)'
                            : 'transparent',
                        },
                      ]}>
                      <Text style={[styles.chipText, { color: text }]}>{mins} 分钟</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            <Text style={[styles.subLabel, { color: text }]}>免打扰</Text>
            <Pressable
              onPress={() =>
                openTimePicker(
                  'health-quiet-start',
                  dailyReviewReminderTimeToDate(health.quietStartHour, health.quietStartMinute),
                )
              }
              style={[styles.timeRow, { borderColor: cardBorder }]}>
              <Text style={[styles.rowHint, { color: outline }]}>开始</Text>
              <Text style={[styles.timeValue, { color: text }]}>
                {pad2(health.quietStartHour)}:{pad2(health.quietStartMinute)}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                openTimePicker(
                  'health-quiet-end',
                  dailyReviewReminderTimeToDate(health.quietEndHour, health.quietEndMinute),
                )
              }
              style={[styles.timeRow, { borderColor: cardBorder }]}>
              <Text style={[styles.rowHint, { color: outline }]}>结束</Text>
              <Text style={[styles.timeValue, { color: text }]}>
                {pad2(health.quietEndHour)}:{pad2(health.quietEndMinute)}
              </Text>
            </Pressable>
            <Text style={[styles.rowHint, { color: outline, fontSize: 11 }]}>
              免打扰内本应发出的提醒会延后到结束时刻，仍计入每日 2 条上限。
            </Text>
          </View>

          {/* 课程表 */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: cardBg,
                borderColor: cardBorder,
                gap: 10,
                opacity:
                  masterOn && settings.categories['schedule-slot-reminder'] !== false ? 1 : 0.55,
              },
            ]}
            pointerEvents={
              masterOn && settings.categories['schedule-slot-reminder'] !== false ? 'auto' : 'none'
            }>
            <Text style={[styles.rowTitle, { color: text }]}>课程表提醒</Text>
            <Text style={[styles.rowHint, { color: outline }]}>
              已入格占用在开始前推送；未入格任务不提醒。提前 {advance} 分钟（5–60）。
            </Text>
            <View style={styles.stepperRow}>
              <Pressable
                onPress={() => void patchScheduleAdvance(advance - 5)}
                disabled={busy || advance <= 5}
                style={[styles.stepperBtn, { borderColor: cardBorder, opacity: advance <= 5 ? 0.4 : 1 }]}>
                <MaterialIcons name="remove" size={20} color={text} />
              </Pressable>
              <Text style={[styles.timeValue, { color: text }]}>{advance} 分钟</Text>
              <Pressable
                onPress={() => void patchScheduleAdvance(advance + 5)}
                disabled={busy || advance >= 60}
                style={[
                  styles.stepperBtn,
                  { borderColor: cardBorder, opacity: advance >= 60 ? 0.4 : 1 },
                ]}>
                <MaterialIcons name="add" size={20} color={text} />
              </Pressable>
            </View>
          </View>

          {/* 习惯 */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: cardBg,
                borderColor: cardBorder,
                gap: 10,
                opacity: masterOn && settings.categories['habit-reminder'] !== false ? 1 : 0.55,
              },
            ]}
            pointerEvents={
              masterOn && settings.categories['habit-reminder'] !== false ? 'auto' : 'none'
            }>
            <Text style={[styles.rowTitle, { color: text }]}>习惯打卡提醒</Text>
            <Text style={[styles.rowHint, { color: outline }]}>
              与习惯详情同源；关闭或改时间后立刻重同步。
            </Text>
            {habits.length === 0 ? (
              <Text style={[styles.rowHint, { color: outline }]}>暂无习惯</Text>
            ) : (
              habits.map(h => (
                <View key={h.id} style={[styles.habitRow, { borderColor: cardBorder }]}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={[styles.categoryTitle, { color: text }]} numberOfLines={1}>
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
                        <Text style={[styles.rowHint, { color: primary }]}>
                          每日 {formatHabitReminderClock({ enabled: true, hour: h.hour, minute: h.minute })}
                        </Text>
                      </Pressable>
                    ) : (
                      <Text style={[styles.rowHint, { color: outline }]}>未开启</Text>
                    )}
                  </View>
                  <Switch
                    value={h.enabled}
                    disabled={busy}
                    onValueChange={v => {
                      void persistHabitReminder(
                        h.id,
                        v ? { enabled: true, hour: h.hour, minute: h.minute } : { enabled: false },
                      );
                    }}
                    trackColor={{ false: outlineVariant, true: primary }}
                    thumbColor="#ffffff"
                  />
                </View>
              ))
            )}
          </View>

          {/* 复盘 */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: cardBg,
                borderColor: cardBorder,
                gap: 10,
                opacity:
                  masterOn && settings.categories['daily-review-reminder'] !== false ? 1 : 0.55,
              },
            ]}
            pointerEvents={
              masterOn && settings.categories['daily-review-reminder'] !== false ? 'auto' : 'none'
            }>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.rowTitle, { color: text }]}>每日复盘提醒</Text>
                <Text style={[styles.rowHint, { color: outline, marginTop: 4 }]}>
                  与复盘设置同源；已填写日复盘或周复盘日会跳过。
                </Text>
              </View>
              <Switch
                value={reviewEnabled}
                disabled={busy}
                onValueChange={v => {
                  const { hour, minute } = readDailyReviewReminderTimeFromDate(reviewTime);
                  void persistReview({ enabled: v, hour, minute });
                }}
                trackColor={{ false: outlineVariant, true: primary }}
                thumbColor="#ffffff"
              />
            </View>
            {reviewEnabled ? (
              <Pressable
                onPress={() => openTimePicker('review', reviewTime)}
                style={[styles.timeRow, { borderColor: cardBorder }]}>
                <Text style={[styles.rowHint, { color: outline }]}>提醒时间</Text>
                <Text style={[styles.timeValue, { color: text }]}>
                  {formatDailyReviewReminderClock(
                    readDailyReviewReminderTimeFromDate(reviewTime).hour,
                    readDailyReviewReminderTimeFromDate(reviewTime).minute,
                  )}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Pressable
            onPress={() => router.push('/notification-center-scheduled' as never)}
            style={({ pressed }) => [
              styles.card,
              styles.actionCard,
              { backgroundColor: cardBg, borderColor: cardBorder, opacity: pressed ? 0.88 : 1 },
            ]}>
            <MaterialIcons name="event-note" size={24} color={primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: text }]}>已预约与权限</Text>
              <Text style={[styles.rowHint, { color: outline, marginTop: 4 }]}>
                系统权限引导、预约列表、单条删除/静音
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={outline} />
          </Pressable>

          <View style={{ height: 28 }} />
        </ScrollView>
      )}

      {timePicker && Platform.OS === 'ios' ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setTimePicker(null)}>
          <View style={styles.modalRoot}>
            <Pressable style={styles.modalBackdrop} onPress={() => setTimePicker(null)} />
            <View style={[styles.modalCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              <DateTimePicker
                value={draftTime}
                mode="time"
                display="spinner"
                onChange={onTimeChange}
              />
              <View style={styles.modalActions}>
                <Pressable onPress={() => setTimePicker(null)} style={styles.modalBtn}>
                  <Text style={{ color: outline, fontWeight: '700' }}>取消</Text>
                </Pressable>
                <Pressable
                  onPress={commitTimePicker}
                  style={[styles.modalBtn, { backgroundColor: primary }]}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>确定</Text>
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
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 12 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  actionCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowHint: { fontSize: 12, lineHeight: 17 },
  categoryTitle: { fontSize: 14, fontWeight: '700' },
  categoryBlock: { gap: 4, paddingTop: 4 },
  subLabel: { fontSize: 13, fontWeight: '700', marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  timeValue: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingVertical: 4,
  },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  modalCard: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
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
