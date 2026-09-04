import { ReviewNavRow } from '@/components/review/review-ui-parts';
import { loadReviewPeriodSnapshot, WEEKLY_REVIEW_WEEKDAY_LABELS } from '@/components/review/review-utils';
import { AppCard, ScreenHeader } from '@/components/ui';
import { Layout, Radius, Shadows, Spacing, Typography } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import {
  dailyReviewReminderTimeToDate,
  formatDailyReviewReminderClock,
  getDailyReviewReminderSettings,
  readDailyReviewReminderTimeFromDate,
  setDailyReviewReminderSettings,
} from '@/lib/daily-review-reminder-settings';
import { syncDailyReviewReminderNotification } from '@/lib/daily-review-reminder-notifications';
import { setWeeklyReviewConfiguredWeekday } from '@/lib/weekly-review-settings';
import { resetPageApiSession, shouldSkipPageFocusApiRefresh } from '@/lib/page-api-session';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect } from "expo-router/react-navigation";
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'review-settings';

export function ReviewSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark, shadows } = useAppTheme();
  const { logicalTodayYmd: todayYmd } = useDayBoundary();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const [loading, setLoading] = useState(true);
  const [configuredDow, setConfiguredDow] = useState<number | null>(null);
  const [dailyPeriodLabel, setDailyPeriodLabel] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dailyReminderEnabled, setDailyReminderEnabled] = useState(false);
  const [dailyReminderTime, setDailyReminderTime] = useState(() => dailyReviewReminderTimeToDate(21, 0));
  const [dailyReminderTimePickerOpen, setDailyReminderTimePickerOpen] = useState(false);
  const [dailyReminderBusy, setDailyReminderBusy] = useState(false);

  const reload = useCallback(
    async (forceApi = false) => {
      setLoading(true);
      try {
        await wrapLoad(async () => {
          const [snapshot, reminderSettings] = await Promise.all([
            loadReviewPeriodSnapshot(todayYmd),
            getDailyReviewReminderSettings(),
          ]);
          setConfiguredDow(snapshot.configuredDow);
          setDailyPeriodLabel(snapshot.dailyPeriodLabel);
          setDailyReminderEnabled(reminderSettings.enabled);
          setDailyReminderTime(dailyReviewReminderTimeToDate(reminderSettings.hour, reminderSettings.minute));
        }, forceApi);
      } finally {
        setLoading(false);
      }
    },
    [todayYmd, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      if (shouldSkipPageFocusApiRefresh(PAGE_API_KEY)) {
        setLoading(false);
        return;
      }
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    return () => resetPageApiSession(PAGE_API_KEY);
  }, []);

  const persistDailyReminder = useCallback(
    async (next: { enabled: boolean; hour: number; minute: number }) => {
      setDailyReminderBusy(true);
      try {
        await setDailyReviewReminderSettings(next);
        const { permissionDenied, scheduled } = await syncDailyReviewReminderNotification(next);
        if (next.enabled && permissionDenied) {
          Alert.alert(
            '需要通知权限',
            '已保存提醒设置，但系统未授予通知权限，提醒将无法送达。请在系统设置中为本应用开启通知。',
          );
        } else if (next.enabled && !scheduled && Platform.OS !== 'web') {
          Alert.alert('提醒未生效', '请稍后再试，或检查系统通知设置。');
        }
      } catch (e) {
        console.warn('daily review reminder', e);
        Alert.alert('保存失败', '请稍后再试');
      } finally {
        setDailyReminderBusy(false);
      }
    },
    [],
  );

  const onToggleDailyReminder = useCallback(() => {
    const nextEnabled = !dailyReminderEnabled;
    const { hour, minute } = readDailyReviewReminderTimeFromDate(dailyReminderTime);
    setDailyReminderEnabled(nextEnabled);
    void persistDailyReminder({ enabled: nextEnabled, hour, minute });
  }, [dailyReminderEnabled, dailyReminderTime, persistDailyReminder]);

  const onConfirmDailyReminderTime = useCallback(() => {
    const { hour, minute } = readDailyReviewReminderTimeFromDate(dailyReminderTime);
    setDailyReminderTimePickerOpen(false);
    void persistDailyReminder({ enabled: dailyReminderEnabled, hour, minute });
  }, [dailyReminderEnabled, dailyReminderTime, persistDailyReminder]);

  const onDailyReminderTimePickerChange = useCallback(
    (event: DateTimePickerEvent, date?: Date) => {
      if (Platform.OS === 'android') {
        setDailyReminderTimePickerOpen(false);
      }
      if (event.type === 'dismissed') return;
      if (!date) return;
      const { hour, minute } = readDailyReviewReminderTimeFromDate(date);
      const normalized = dailyReviewReminderTimeToDate(hour, minute);
      setDailyReminderTime(normalized);
      if (Platform.OS === 'android') {
        void persistDailyReminder({ enabled: dailyReminderEnabled, hour, minute });
      }
    },
    [dailyReminderEnabled, persistDailyReminder],
  );

  const onPickWeekday = useCallback(
    async (d: number) => {
      try {
        await setWeeklyReviewConfiguredWeekday(d);
        setConfiguredDow(d);
        setPickerOpen(false);
        Alert.alert(
          '已保存',
          `已设定每周「${WEEKLY_REVIEW_WEEKDAY_LABELS[d]}」为复盘日。统计区间为该日当天向前连续 7 个自然日（含当天）。`,
        );
        void reload();
      } catch {
        Alert.alert('失败', '请稍后再试');
      }
    },
    [reload],
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <ScreenHeader title="复盘设置" onBack={() => router.back()} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Spacing['6xl'] + Math.max(insets.bottom, Spacing.xl) },
          ]}>
          <AppCard style={[shadows.card, styles.card]}>
            <Text style={[Typography.label, { color: colors.textMuted }]}>每周复盘日</Text>
            <Text style={[Typography.h3, { color: colors.text }]}>
              {configuredDow === null ? '尚未设置' : `每周${WEEKLY_REVIEW_WEEKDAY_LABELS[configuredDow]}`}
            </Text>
            <Text style={[Typography.caption, { color: colors.textMuted, lineHeight: 18 }]}>
              仅在所选星期的那一天可填写与保存周复盘；统计区间为该日向前连续 7 个自然日（含当天）。
            </Text>
            <Pressable
              onPress={() => setPickerOpen(true)}
              style={({ pressed }) => [
                styles.inlineBtn,
                {
                  borderColor: colors.outline,
                  backgroundColor: colors.primaryMuted,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}>
              <MaterialIcons name="edit-calendar" size={18} color={colors.primary} />
              <Text style={[styles.inlineBtnText, { color: colors.primary }]}>设置复盘日</Text>
            </Pressable>
          </AppCard>

          <AppCard style={[shadows.card, styles.card]}>
            <View style={styles.reminderHead}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[Typography.title, { color: colors.text }]}>每日提醒复盘</Text>
                <Text style={[Typography.caption, { color: colors.textMuted, lineHeight: 18 }]}>
                  在设定时间通过本地通知提醒你完成日复盘
                  {Platform.OS === 'web' ? '（网页版不登记系统提醒）' : ''}
                </Text>
              </View>
              <Pressable
                onPress={onToggleDailyReminder}
                disabled={dailyReminderBusy}
                style={[
                  styles.reminderSwitchTrack,
                  {
                    backgroundColor: dailyReminderEnabled ? colors.success : colors.outline,
                    opacity: dailyReminderBusy ? 0.6 : 1,
                  },
                ]}
                accessibilityRole="switch"
                accessibilityState={{ checked: dailyReminderEnabled }}>
                <View
                  style={[
                    styles.reminderSwitchDot,
                    { backgroundColor: colors.onPrimary },
                    dailyReminderEnabled && styles.reminderSwitchDotOn,
                  ]}
                />
              </Pressable>
            </View>

            {dailyReminderEnabled ? (
              <Pressable
                onPress={() => {
                  if (Platform.OS === 'web') return;
                  setDailyReminderTimePickerOpen(true);
                }}
                style={({ pressed }) => [
                  styles.reminderTimeRow,
                  {
                    borderColor: colors.outline,
                    backgroundColor: colors.surface,
                    opacity: Platform.OS === 'web' ? 0.65 : pressed ? 0.88 : 1,
                  },
                ]}>
                <Text style={[Typography.label, { color: colors.textMuted }]}>提醒时间</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.reminderTimeValue, { color: colors.text }]}>
                    {formatDailyReviewReminderClock(dailyReminderTime.getHours(), dailyReminderTime.getMinutes())}
                  </Text>
                  {Platform.OS !== 'web' ? <MaterialIcons name="schedule" size={20} color={colors.primary} /> : null}
                </View>
              </Pressable>
            ) : null}
          </AppCard>

          <View style={styles.section}>
            <Text style={[Typography.label, { color: colors.textMuted }]}>模板管理</Text>
            <ReviewNavRow
              icon="tune"
              title="日复盘维度与栏目"
              subtitle={dailyPeriodLabel || undefined}
              onPress={() => router.push('/review-template-settings?scope=daily')}
              iconColor={colors.secondary}
              iconBg={colors.primaryMuted}
              textColor={colors.text}
              mutedColor={colors.textMuted}
              borderColor={colors.outline}
              surface={colors.surface}
            />
            <ReviewNavRow
              icon="tune"
              title="周复盘维度与栏目"
              onPress={() => router.push('/review-template-settings?scope=weekly')}
              iconColor={colors.primary}
              iconBg={colors.primaryMuted}
              textColor={colors.text}
              mutedColor={colors.textMuted}
              borderColor={colors.outline}
              surface={colors.surface}
            />
            <ReviewNavRow
              icon="tune"
              title="月复盘维度与栏目"
              onPress={() => router.push('/review-template-settings?scope=monthly')}
              iconColor={colors.primary}
              iconBg={colors.primaryMuted}
              textColor={colors.text}
              mutedColor={colors.textMuted}
              borderColor={colors.outline}
              surface={colors.surface}
            />
            <ReviewNavRow
              icon="tune"
              title="全部复盘模板"
              onPress={() => router.push('/review-template-settings')}
              iconColor={colors.primary}
              iconBg={colors.primaryMuted}
              textColor={colors.text}
              mutedColor={colors.textMuted}
              borderColor={colors.outline}
              surface={colors.surface}
            />
          </View>
        </ScrollView>
      )}

      {dailyReminderTimePickerOpen && Platform.OS === 'android' ? (
        <DateTimePicker
          value={dailyReminderTime}
          mode="time"
          display="default"
          is24Hour
          onChange={onDailyReminderTimePickerChange}
        />
      ) : null}

      <Modal
        visible={dailyReminderTimePickerOpen && Platform.OS === 'ios'}
        transparent
        animationType="fade"
        onRequestClose={() => setDailyReminderTimePickerOpen(false)}>
        <View style={styles.reminderTimeModalRoot}>
          <Pressable
            style={[styles.reminderTimeModalBackdrop, { backgroundColor: colors.overlay }]}
            onPress={() => setDailyReminderTimePickerOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="关闭"
          />
          <View
            style={[
              styles.reminderTimePickerCard,
              shadows.card,
              { backgroundColor: colors.surface, borderColor: colors.outline },
            ]}>
            <Text style={[Typography.h3, { color: colors.text }]}>选择提醒时间</Text>
            <DateTimePicker
              value={dailyReminderTime}
              mode="time"
              display="spinner"
              is24Hour
              themeVariant={isDark ? 'dark' : 'light'}
              locale="zh_CN"
              onChange={onDailyReminderTimePickerChange}
            />
            <View style={styles.reminderPickerActions}>
              <Pressable
                onPress={() => setDailyReminderTimePickerOpen(false)}
                style={({ pressed }) => [
                  styles.reminderPickerBtn,
                  { borderColor: colors.outline, opacity: pressed ? 0.88 : 1 },
                ]}>
                <Text style={[styles.reminderPickerBtnText, { color: colors.textMuted }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={onConfirmDailyReminderTime}
                style={({ pressed }) => [
                  styles.reminderPickerBtn,
                  { backgroundColor: colors.primary, borderColor: colors.primary, opacity: pressed ? 0.88 : 1 },
                ]}>
                <Text style={[styles.reminderPickerBtnText, { color: colors.onPrimary }]}>确定</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <View style={[styles.modalRoot, { backgroundColor: colors.overlay }]}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setPickerOpen(false)} accessibilityLabel="关闭" />
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: colors.surface,
                borderColor: colors.outline,
                paddingBottom: Math.max(insets.bottom, 20),
              },
            ]}>
            <Text style={[Typography.h3, { color: colors.text }]}>选择每周复盘日</Text>
            <Text style={[Typography.body, { color: colors.textMuted, lineHeight: 20 }]}>
              仅在所选星期的那一天可填写与保存；统计区间为该日向前连续 7 个自然日（含当天）。
            </Text>
            <View style={styles.modalList}>
              {WEEKLY_REVIEW_WEEKDAY_LABELS.map((lab, i) => (
                <Pressable
                  key={lab}
                  onPress={() => void onPickWeekday(i)}
                  style={({ pressed }) => [
                    styles.modalRow,
                    {
                      borderColor: colors.outline,
                      opacity: pressed ? 0.88 : 1,
                      backgroundColor: configuredDow === i ? colors.primaryMuted : colors.surfaceMuted,
                    },
                  ]}>
                  <Text style={[styles.modalRowText, { color: colors.text }]}>{lab}</Text>
                  {configuredDow === i ? <MaterialIcons name="check-circle" size={22} color={colors.primary} /> : null}
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.xl,
    gap: Spacing['3xl'],
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  card: {
    gap: Spacing.lg,
  },
  inlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing['3xl'],
    marginTop: Spacing.sm,
  },
  inlineBtnText: { fontSize: 14, fontWeight: '800' },
  reminderHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  reminderSwitchTrack: {
    width: 48,
    height: 28,
    borderRadius: 14,
    padding: 3,
    justifyContent: 'center',
  },
  reminderSwitchDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  reminderSwitchDotOn: { alignSelf: 'flex-end' },
  reminderTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingVertical: Spacing['3xl'],
    paddingHorizontal: Spacing['3xl'],
  },
  reminderTimeValue: { fontSize: 18, fontWeight: '900' },
  section: { gap: Spacing.lg },
  reminderTimeModalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  reminderTimeModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  reminderTimePickerCard: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
    zIndex: 2,
    gap: 8,
    overflow: 'hidden',
  },
  reminderPickerActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  reminderPickerBtn: {
    flex: 1,
    borderRadius: Radius.lg,
    borderWidth: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reminderPickerBtnText: { fontSize: 15, fontWeight: '800' },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 18,
    gap: 12,
  },
  modalList: { gap: 8, marginTop: 4 },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  modalRowText: { fontSize: 16, fontWeight: '800' },
});
