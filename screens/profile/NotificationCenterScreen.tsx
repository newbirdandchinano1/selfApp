/**
 * 消息 · 提醒设置：系统权限、总开关、按页面频道入口、已预约入口。
 * 频道按健康 / 财务 / 任务 / 复盘页分组；详情在 `/notification-channel/[id]`。
 */
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import {
  formatDailyReviewReminderClock,
  getDailyReviewReminderSettings,
} from '@/lib/daily-review-reminder-settings';
import {
  getCategoriesForPage,
  isNotificationPageEnabled,
  NOTIFICATION_PAGE_CHANNELS,
  type NotificationPageChannelId,
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
  type NotificationCategoryPrefs,
  type NotificationCenterSettings,
} from '@/lib/notification-center-settings';
import { getHabits } from '@/lib/repositories/habits/habit';
import {
  formatHabitReminderClock,
  parseHabitReminder,
} from '@/lib/repositories/habits/habit-reminder-meta';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
  const [habitSummary, setHabitSummary] = useState('未开启');
  const [reviewSummary, setReviewSummary] = useState('未开启');
  const [scheduledCount, setScheduledCount] = useState(0);
  const [nextFireLabel, setNextFireLabel] = useState<string | null>(null);

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

      const enabledHabits = habitRows
        .map((h) => {
          const rem = parseHabitReminder(h.extra_data);
          return rem.enabled
            ? { hour: rem.hour, minute: rem.minute }
            : null;
        })
        .filter((x): x is { hour: number; minute: number } => !!x);
      if (enabledHabits.length === 0) {
        setHabitSummary('未开启');
      } else {
        const first = enabledHabits[0]!;
        const clock = formatHabitReminderClock({
          enabled: true,
          hour: first.hour,
          minute: first.minute,
        });
        setHabitSummary(enabledHabits.length === 1 ? clock : `${clock} · ${enabledHabits.length} 个`);
      }

      setReviewSummary(
        review.enabled
          ? formatDailyReviewReminderClock(review.hour, review.minute)
          : '未开启',
      );

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
            if (perm.sandboxDisabled) {
              Alert.alert(
                'Expo Go 沙盒提示',
                '沙盒环境不会展示本地通知，但提醒偏好仍可保存；真机开发构建或正式包才会送达。',
              );
            } else {
              Alert.alert('需要通知权限', '请在系统设置中为本应用开启通知后，再打开总开关。', [
                { text: '取消', style: 'cancel' },
                { text: '打开系统设置', onPress: () => void openSystemNotificationSettings() },
              ]);
              setBusy(false);
              return;
            }
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

  const onPageToggle = useCallback(
    async (pageId: NotificationPageChannelId, enabled: boolean) => {
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
    [applySettings],
  );

  const masterOn = settings?.masterEnabled !== false;
  const health = settings?.health;
  const advance = settings?.schedule.advanceMinutes ?? 15;

  const pageHints = useMemo(() => {
    const healthHint = health
      ? health.mode === 'meal_windows'
        ? `餐次 ${health.mealWindows.length} 窗 · 收口 ${pad2(health.wrapHour)}:${pad2(health.wrapMinute)}`
        : health.mode === 'evening_wrap'
          ? `收口 ${pad2(health.wrapHour)}:${pad2(health.wrapMinute)}`
          : `水分间隔 ${health.intervalMinutes} 分`
      : '摄入提醒';
    return {
      health: healthHint,
      finance: '截图记账通知',
      tasks: `入格提前 ${advance} 分 · 截止/习惯`,
      review: reviewSummary,
    } as Record<NotificationPageChannelId, string>;
  }, [advance, habitSummary, health, reviewSummary]);

  const switchTrack = {
    false: fold.trackOff,
    true: fold.pineButton,
  } as const;

  const openPageDetail = (id: NotificationPageChannelId) => {
    router.push(`/notification-channel/${id}` as never);
  };

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

      {loading || !settings ? (
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
                },
              ]}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>频道</Text>
                <Text style={styles.sectionHint}>
                  {masterOn ? '按页面分组 · 点标题进详情' : '总开关已关 · 仍可进详情预配置'}
                </Text>
              </View>
              {NOTIFICATION_PAGE_CHANNELS.map((page) => {
                const enabled = isNotificationPageEnabled(page.id, settings.categories);
                return (
                  <View
                    key={page.id}
                    style={[styles.toggleRow, !masterOn && { opacity: 0.72 }]}>
                    <Pressable
                      onPress={() => openPageDetail(page.id)}
                      style={({ pressed }) => [
                        styles.channelMain,
                        pressed && { opacity: 0.82 },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`${page.title}详情`}>
                      <Text style={styles.ti}>{page.emoji}</Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={styles.channelTitleRow}>
                          <Text style={styles.rowTitle}>{page.title}</Text>
                          <Text style={styles.chevron}>›</Text>
                        </View>
                        <Text style={styles.rowHint} numberOfLines={1}>
                          {pageHints[page.id]}
                        </Text>
                      </View>
                    </Pressable>
                    <Switch
                      value={enabled}
                      disabled={busy}
                      onValueChange={(v) => void onPageToggle(page.id, v)}
                      trackColor={switchTrack}
                      thumbColor="#ffffff"
                    />
                  </View>
                );
              })}
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={3} staggerMs={45} fromY={12}>
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

          <FoldRiseIn animate={motionOn} index={4} staggerMs={45} fromY={12}>
            <Pressable
              onPress={() => router.push('/widgets-center' as never)}
              style={({ pressed }) => [
                styles.card,
                styles.schedEntry,
                {
                  backgroundColor: fold.card,
                  borderColor: fold.line,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}>
              <AppIcon name="dashboard" size={16} color="#6A786F" />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>桌面与状态栏</Text>
                <Text style={styles.rowHint}>桌面常看摘要请到桌面与状态栏配置</Text>
              </View>
              <Text style={{ color: '#B2B6AD', fontSize: 14 }}>›</Text>
            </Pressable>
          </FoldRiseIn>

          <View style={styles.footNote}>
            <View style={[styles.dot, { backgroundColor: fold.sage }]} />
            <Text style={[styles.footText, { color: fold.muted }]}>
              全部在本地调度 · 可随时一键暂停 · 提醒是推，组件是看
            </Text>
          </View>
          <View style={{ height: 28 }} />
        </ScrollView>
      )}
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
  channelMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  channelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chevron: { fontSize: 13, color: '#B2B6AD', marginTop: -1 },
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
});
