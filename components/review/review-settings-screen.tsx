import { FoldCard, FoldIconButton, FoldSwitch, foldFonts, useFoldTheme } from '@/components/review/fold-ui';
import { FoldReviewFooter, FoldReviewHeader } from '@/components/review/fold-review-chrome';
import {
  countEditableDailyEntries,
  countFilledDailyEntries,
  loadReviewPeriodSnapshot,
  WEEKLY_REVIEW_WEEKDAY_LABELS,
} from '@/components/review/review-utils';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
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
import {
  DEFAULT_REVIEW_POINTS_SETTINGS,
  loadReviewPointsSettings,
  saveReviewPointsSettings,
  type ReviewPointsSettings,
} from '@/lib/review-points-settings';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { formatPoints, normalizeRewardPoints } from '@/lib/reward-points';
import { setWeeklyReviewConfiguredWeekday } from '@/lib/weekly-review-settings';
import { resetPageApiSession, shouldSkipPageFocusApiRefresh } from '@/lib/page-api-session';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'review-settings';

/** 周一优先的星期顺序（Date.getDay 0=周日） */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const WEEK_CN = ['一', '二', '三', '四', '五', '六', '日'] as const;
const WEEK_EN = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

/** 7/14/21/30 天档位对应「七天奖励」的倍数 */
const STREAK_TIERS = [
  { days: 7, factor: 1 },
  { days: 14, factor: 2 },
  { days: 21, factor: 3 },
  { days: 30, factor: 5 },
] as const;

function ymdToDate(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function CardHead({ title, hint }: { title: string; hint?: string }) {
  const { fold } = useFoldTheme();
  return (
    <View style={styles.cardHead}>
      <Text style={[styles.cardTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
        {title}
      </Text>
      {hint ? (
        <Text
          style={[styles.cardHint, { color: fold.faint }]}
          numberOfLines={2}
          maxFontSizeMultiplier={1.2}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

function InfoRow({
  icon,
  title,
  subtitle,
  actionLabel,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  subtitle: string;
  actionLabel: string;
  onPress?: () => void;
}) {
  const { fold, palette } = useFoldTheme();
  const content = (
    <View style={styles.infoRowInner}>
      <View style={[styles.rowIcon, { backgroundColor: fold.paper2 }]}>
        <MaterialIcons name={icon} size={16} color={fold.ink2} />
      </View>
      <View style={styles.infoRowText}>
        <Text style={[styles.rowTitle, { color: fold.ink2 }]} maxFontSizeMultiplier={1.3}>
          {title}
        </Text>
        <Text
          style={[styles.rowSub, { color: fold.muted }]}
          numberOfLines={2}
          maxFontSizeMultiplier={1.3}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.rowAction}>
        <Text style={[styles.rowActionText, { color: palette.sage }]} maxFontSizeMultiplier={1.25}>
          {actionLabel}
        </Text>
        {onPress ? <MaterialIcons name="chevron-right" size={14} color={fold.faint} /> : null}
      </View>
    </View>
  );

  if (!onPress) {
    return (
      <View style={[styles.infoRow, { backgroundColor: fold.card, borderColor: fold.line }]}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}，${actionLabel}`}
      style={({ pressed }) => [
        styles.infoRow,
        { backgroundColor: fold.card, borderColor: fold.line, opacity: pressed ? 0.88 : 1 },
      ]}>
      {content}
    </Pressable>
  );
}

export function ReviewSettingsScreen() {
  const router = useRouter();
  const { isDark } = useAppTheme();
  const { fold, palette } = useFoldTheme();
  const { logicalTodayYmd: todayYmd } = usePageDayBoundary('review');
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const [loading, setLoading] = useState(true);
  const [synced, setSynced] = useState(false);
  const [configuredDow, setConfiguredDow] = useState<number | null>(null);
  const [weekRangeLabel, setWeekRangeLabel] = useState('');
  const [filledCount, setFilledCount] = useState(0);
  const [editableCount, setEditableCount] = useState(0);
  const [weekdayBusy, setWeekdayBusy] = useState(false);
  const [dailyReminderEnabled, setDailyReminderEnabled] = useState(false);
  const [dailyReminderTime, setDailyReminderTime] = useState(() => dailyReviewReminderTimeToDate(21, 0));
  const [dailyReminderTimePickerOpen, setDailyReminderTimePickerOpen] = useState(false);
  const [dailyReminderBusy, setDailyReminderBusy] = useState(false);
  const [pointsSettings, setPointsSettings] = useState<ReviewPointsSettings>(DEFAULT_REVIEW_POINTS_SETTINGS);
  const [dailyRewardText, setDailyRewardText] = useState(
    formatPoints(DEFAULT_REVIEW_POINTS_SETTINGS.dailyRewardPoints),
  );
  const [streak7BonusText, setStreak7BonusText] = useState(
    formatPoints(DEFAULT_REVIEW_POINTS_SETTINGS.streak7BonusPoints),
  );
  const [pointsBusy, setPointsBusy] = useState(false);

  const reload = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      try {
        await wrapLoad(async () => {
          const [snapshot, reminderSettings, reviewPoints] = await Promise.all([
            loadReviewPeriodSnapshot(todayYmd),
            getDailyReviewReminderSettings(),
            loadReviewPointsSettings(),
          ]);
          setConfiguredDow(snapshot.configuredDow);
          setWeekRangeLabel(snapshot.weekRangeLabel);
          setFilledCount(
            countFilledDailyEntries(
              snapshot.dailyEntries,
              snapshot.reviewCycleEndYmd,
              snapshot.configuredDow,
            ),
          );
          setEditableCount(
            countEditableDailyEntries(
              snapshot.dailyEntries,
              snapshot.reviewCycleEndYmd,
              snapshot.configuredDow,
              todayYmd,
            ),
          );
          setDailyReminderEnabled(reminderSettings.enabled);
          setDailyReminderTime(dailyReviewReminderTimeToDate(reminderSettings.hour, reminderSettings.minute));
          setPointsSettings(reviewPoints);
          setDailyRewardText(formatPoints(reviewPoints.dailyRewardPoints));
          setStreak7BonusText(formatPoints(reviewPoints.streak7BonusPoints));
          setSynced(true);
        }, forceRefresh);
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
        toast.error(toUserMessage(e, '保存失败，请稍后重试'));
      } finally {
        setDailyReminderBusy(false);
      }
    },
    [],
  );

  const persistPointsSettings = useCallback(async (next: ReviewPointsSettings) => {
    setPointsBusy(true);
    try {
      const saved = await saveReviewPointsSettings(next);
      setPointsSettings(saved);
      setDailyRewardText(formatPoints(saved.dailyRewardPoints));
      setStreak7BonusText(formatPoints(saved.streak7BonusPoints));
    } catch (e) {
      console.warn('review points settings', e);
      toast.error(toUserMessage(e, '保存失败，请稍后重试'));
    } finally {
      setPointsBusy(false);
    }
  }, []);

  const onTogglePointsEnabled = useCallback(() => {
    const nextEnabled = !pointsSettings.enabled;
    const next: ReviewPointsSettings = {
      ...pointsSettings,
      enabled: nextEnabled,
      dailyRewardPoints: normalizeRewardPoints(dailyRewardText),
      streak7BonusPoints: normalizeRewardPoints(streak7BonusText),
    };
    setPointsSettings(next);
    void persistPointsSettings(next);
  }, [dailyRewardText, persistPointsSettings, pointsSettings, streak7BonusText]);

  const onBlurDailyReward = useCallback(() => {
    const dailyRewardPoints = normalizeRewardPoints(dailyRewardText);
    setDailyRewardText(formatPoints(dailyRewardPoints));
    if (dailyRewardPoints === pointsSettings.dailyRewardPoints) return;
    void persistPointsSettings({ ...pointsSettings, dailyRewardPoints });
  }, [dailyRewardText, persistPointsSettings, pointsSettings]);

  const onBlurStreak7Bonus = useCallback(() => {
    const streak7BonusPoints = normalizeRewardPoints(streak7BonusText);
    setStreak7BonusText(formatPoints(streak7BonusPoints));
    if (streak7BonusPoints === pointsSettings.streak7BonusPoints) return;
    void persistPointsSettings({ ...pointsSettings, streak7BonusPoints });
  }, [persistPointsSettings, pointsSettings, streak7BonusText]);

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
      if (weekdayBusy || configuredDow === d) return;
      setWeekdayBusy(true);
      try {
        await setWeeklyReviewConfiguredWeekday(d);
        setConfiguredDow(d);
        toast.success(`周复盘日已设为每${WEEKLY_REVIEW_WEEKDAY_LABELS[d]}`);
        void reload();
      } catch (e) {
        toast.error(toUserMessage(e, '保存失败，请稍后重试'));
      } finally {
        setWeekdayBusy(false);
      }
    },
    [configuredDow, reload, weekdayBusy],
  );

  const todayDow = useMemo(() => ymdToDate(todayYmd).getDay(), [todayYmd]);
  const todayWeekdayLabel = WEEKLY_REVIEW_WEEKDAY_LABELS[todayDow] ?? '';

  const remainingDays = Math.max(0, editableCount - filledCount);
  const progressRatio = editableCount > 0 ? Math.min(1, filledCount / editableCount) : 0;
  const weekEarned = pointsSettings.enabled
    ? Math.round(filledCount * pointsSettings.dailyRewardPoints)
    : 0;
  const streakReached = pointsSettings.enabled && filledCount >= 7;

  const tierPoints = useMemo(
    () =>
      STREAK_TIERS.map(tier => ({
        days: tier.days,
        points: Math.round(pointsSettings.streak7BonusPoints * tier.factor),
      })),
    [pointsSettings.streak7BonusPoints],
  );

  const systemSettings = useCallback(() => {
    if (Platform.OS === 'web') return;
    void Linking.openSettings().catch(() => {
      toast.error('无法打开系统设置，请手动前往');
    });
  }, []);

  const openHub = useCallback(() => router.navigate('/review'), [router]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
      <FoldReviewHeader
        title="复盘设置"
        subtitle="FOLD SETTINGS · 本机优先"
        onBack={() => router.back()}
        right={
          <>
            <View style={styles.syncPill}>
              <MaterialIcons
                name="check-circle"
                size={12}
                color={synced ? palette.sage : fold.faint}
              />
              <Text
                style={[styles.syncText, { color: synced ? palette.sage : fold.faint }]}
                maxFontSizeMultiplier={1.2}>
                {synced ? '已同步' : '本机'}
              </Text>
            </View>
            <FoldIconButton
              icon="calendar-month"
              variant="soft"
              onPress={() => router.push('/review-calendar')}
              accessibilityLabel="打开复盘日历"
            />
          </>
        }
      />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={fold.pine} />
        </View>
      ) : (
        <ScrollView
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}>
          <FoldCard style={styles.card}>
            <CardHead title="每周复盘日" hint="决定周复盘可写日与 7 天周期" />
            <View style={styles.weekRow}>
              {WEEK_ORDER.map((d, index) => {
                const active = configuredDow === d;
                return (
                  <Pressable
                    key={d}
                    onPress={() => void onPickWeekday(d)}
                    disabled={weekdayBusy}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`每周${WEEKLY_REVIEW_WEEKDAY_LABELS[d]}`}
                    style={({ pressed }) => [
                      styles.weekCell,
                      {
                        backgroundColor: active ? palette.pineSolid : fold.card,
                        borderColor: active ? palette.pineSolid : fold.line,
                        opacity: weekdayBusy ? 0.6 : pressed ? 0.85 : 1,
                      },
                    ]}>
                    <Text
                      style={[styles.weekCellCn, { color: active ? fold.onPineButton : fold.ink2 }]}
                      maxFontSizeMultiplier={1.2}>
                      {WEEK_CN[index]}
                    </Text>
                    <Text
                      style={[
                        styles.weekCellEn,
                        { color: active ? fold.onPineButton : fold.faint },
                      ]}
                      maxFontSizeMultiplier={1.1}>
                      {WEEK_EN[index]}
                    </Text>
                    {active ? <View style={[styles.weekDot, { backgroundColor: fold.amber }]} /> : null}
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.hintLine}>
              <MaterialIcons name="schedule" size={12} color={fold.faint} />
              <Text style={[styles.hintText, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
                {configuredDow === null
                  ? `今天是${todayWeekdayLabel}，点选一周中的某天作为复盘日；未选时暂以今日倒推 7 天。`
                  : `今天是${todayWeekdayLabel}，复盘日设为每${WEEKLY_REVIEW_WEEKDAY_LABELS[configuredDow]}；本期 ${weekRangeLabel || '7 天'}。`}
              </Text>
            </View>
          </FoldCard>

          <FoldCard style={styles.card}>
            <CardHead title="每日提醒" hint="本机通知 · 跳过已填与复盘日" />
            <View style={styles.toggleRow}>
              <View style={[styles.rowIcon, { backgroundColor: fold.sage2 }]}>
                <MaterialIcons name="notifications-none" size={18} color={fold.pine} />
              </View>
              <View style={styles.toggleText}>
                <Text style={[styles.rowTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
                  每天提醒我写日复盘
                </Text>
                <Text style={[styles.rowSub, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
                  仅在当天尚未落笔时送达
                </Text>
              </View>
              <FoldSwitch
                value={dailyReminderEnabled}
                onValueChange={onToggleDailyReminder}
                disabled={dailyReminderBusy}
                accessibilityLabel="每日复盘提醒开关"
              />
            </View>

            <Pressable
              onPress={() => {
                if (Platform.OS === 'web') return;
                if (!dailyReminderEnabled) return;
                setDailyReminderTimePickerOpen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="设置提醒时间"
              style={({ pressed }) => [styles.timeRow, { opacity: pressed ? 0.85 : 1 }]}>
              <Text style={[styles.timeLabel, { color: fold.muted }]} maxFontSizeMultiplier={1.25}>
                提醒时间
              </Text>
              <View style={styles.timeRight}>
                <View
                  style={[
                    styles.timeChip,
                    {
                      backgroundColor: fold.paper2,
                      borderColor: fold.line,
                      opacity: dailyReminderEnabled ? 1 : 0.55,
                    },
                  ]}>
                  <Text style={[styles.timeValue, { color: fold.ink }]} maxFontSizeMultiplier={1.25}>
                    {formatDailyReviewReminderClock(
                      dailyReminderTime.getHours(),
                      dailyReminderTime.getMinutes(),
                    )}
                  </Text>
                </View>
                <Text style={[styles.timeMeta, { color: fold.faint }]} maxFontSizeMultiplier={1.2}>
                  {remainingDays > 0 ? `本期还差 ${remainingDays} 天` : '本期已写满'}
                </Text>
              </View>
            </Pressable>

            <View style={[styles.previewCard, { backgroundColor: fold.paper2, borderColor: fold.line }]}>
              <View style={[styles.previewMark, { backgroundColor: fold.amber2 }]}>
                <Text style={[styles.previewMarkText, { color: palette.amberInk }]} maxFontSizeMultiplier={1.1}>
                  折
                </Text>
              </View>
              <View style={styles.previewBody}>
                <Text style={[styles.previewTitle, { color: fold.ink2 }]} maxFontSizeMultiplier={1.25}>
                  折页 · 今日复盘
                </Text>
                <Text
                  style={[styles.previewText, { color: fold.muted }]}
                  numberOfLines={2}
                  maxFontSizeMultiplier={1.25}>
                  {filledCount >= editableCount && editableCount > 0
                    ? `本期 ${filledCount}/${editableCount} 天都已写完，继续保持。`
                    : `本期已复盘 ${filledCount}/${editableCount || 7}，还差 ${remainingDays} 天，留 3 分钟给今天？`}
                </Text>
              </View>
              <Text style={[styles.previewClock, { color: fold.faint }]} maxFontSizeMultiplier={1.15}>
                {formatDailyReviewReminderClock(
                  dailyReminderTime.getHours(),
                  dailyReminderTime.getMinutes(),
                )}
              </Text>
            </View>

            <View style={styles.hintLine}>
              <MaterialIcons name="notifications-active" size={12} color={palette.sage} />
              <Text style={[styles.hintText, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
                通知权限正常 · 当天若已填写会自动跳过，不打扰。
              </Text>
            </View>
          </FoldCard>

          <FoldCard style={styles.card}>
            <CardHead title="积分奖励" hint="写入自动发放 · 清空自动冲正" />

            <View style={styles.toggleRow}>
              <View style={[styles.rowIcon, { backgroundColor: fold.amber2 }]}>
                <MaterialIcons name="auto-awesome" size={16} color={palette.amberInk} />
              </View>
              <View style={styles.toggleText}>
                <Text style={[styles.rowTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
                  完成每日复盘
                </Text>
                <Text style={[styles.rowSub, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
                  当天完成任意维度即算完成
                </Text>
              </View>
              <View
                style={[
                  styles.amountPill,
                  { backgroundColor: fold.amber2, borderColor: fold.line },
                ]}>
                <Text style={[styles.amountPlus, { color: palette.amberInk }]} maxFontSizeMultiplier={1.2}>
                  +
                </Text>
                <TextInput
                  value={dailyRewardText}
                  onChangeText={setDailyRewardText}
                  onBlur={onBlurDailyReward}
                  onSubmitEditing={onBlurDailyReward}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  editable={!pointsBusy && pointsSettings.enabled}
                  placeholder="5"
                  placeholderTextColor={palette.amberInk}
                  style={[styles.amountInput, { color: palette.amberInk }]}
                  accessibilityLabel="每日复盘奖励积分"
                />
              </View>
              <FoldSwitch
                value={pointsSettings.enabled}
                onValueChange={onTogglePointsEnabled}
                disabled={pointsBusy}
                accessibilityLabel="复盘积分奖励开关"
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={[styles.rowIcon, { backgroundColor: fold.clay2 }]}>
                <MaterialIcons name="local-fire-department" size={16} color={palette.clayInk} />
              </View>
              <View style={styles.toggleText}>
                <Text style={[styles.rowTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
                  七天坚持奖励
                </Text>
                <Text style={[styles.rowSub, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
                  7 / 14 / 21 / 30 天各发放一次
                </Text>
              </View>
              <View
                style={[styles.amountPill, { backgroundColor: fold.clay2, borderColor: fold.line }]}>
                <Text style={[styles.amountPlus, { color: palette.clayInk }]} maxFontSizeMultiplier={1.2}>
                  +
                </Text>
                <TextInput
                  value={streak7BonusText}
                  onChangeText={setStreak7BonusText}
                  onBlur={onBlurStreak7Bonus}
                  onSubmitEditing={onBlurStreak7Bonus}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  editable={!pointsBusy && pointsSettings.enabled}
                  placeholder="20"
                  placeholderTextColor={palette.clayInk}
                  style={[styles.amountInput, { color: palette.clayInk }]}
                  accessibilityLabel="七天坚持复盘奖励积分"
                />
              </View>
            </View>

            <View style={styles.tierRow}>
              {tierPoints.map(tier => {
                const reached = filledCount >= tier.days;
                return (
                  <View
                    key={tier.days}
                    style={[
                      styles.tierCell,
                      {
                        backgroundColor: reached ? fold.sage2 : fold.paper2,
                        borderColor: reached ? fold.sage : fold.line,
                      },
                    ]}>
                    <Text style={[styles.tierDays, { color: fold.muted }]} maxFontSizeMultiplier={1.15}>
                      {tier.days} 天
                    </Text>
                    <Text
                      style={[styles.tierPoints, { color: reached ? fold.pine : fold.ink2 }]}
                      maxFontSizeMultiplier={1.2}>
                      +{formatPoints(tier.points)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </FoldCard>

          <FoldCard style={styles.card}>
            <View style={styles.progressHead}>
              <Text style={[styles.cardTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
                本周奖励进度
              </Text>
              <Text style={[styles.progressCount, { color: fold.muted }]} maxFontSizeMultiplier={1.25}>
                {filledCount} / {editableCount || 7}
              </Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: fold.paper2 }]}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: fold.pine, width: `${Math.round(progressRatio * 100)}%` },
                ]}
              />
            </View>
            <View style={styles.progressFooter}>
              <Text style={[styles.progressHint, { color: fold.muted }]} maxFontSizeMultiplier={1.25}>
                {streakReached
                  ? `已连续写满 7 天，七天奖励已计入。`
                  : remainingDays > 0
                    ? `再写 ${remainingDays} 天，领取 7 天奖励 +${formatPoints(pointsSettings.streak7BonusPoints)}`
                    : '本期已完成'}
              </Text>
              <View style={[styles.earnedPill, { backgroundColor: fold.amber2 }]}>
                <Text style={[styles.earnedText, { color: palette.amberInk }]} maxFontSizeMultiplier={1.2}>
                  本周 +{formatPoints(weekEarned)}
                </Text>
              </View>
            </View>
          </FoldCard>

          <View style={styles.infoGroup}>
            <InfoRow
              icon="notifications-paused"
              title="通知权限与排期失败提示"
              subtitle="权限关闭时显示诊断与修复；失败项可单独重试，不影响复盘保存。"
              actionLabel="去设置"
              onPress={systemSettings}
            />
            <InfoRow
              icon="sync"
              title="同步状态"
              subtitle="页面聚焦、本地变更与脏数据都会触发轻量刷新。"
              actionLabel={synced ? '正常' : '本机优先'}
            />
          </View>

          <Text style={[styles.footnote, { color: fold.faint }]} maxFontSizeMultiplier={1.25}>
            积分仅用于激励记录，不影响复盘内容。关闭奖励不会回收已发放积分；删除或清空当日日复盘时，会按实际完成状态自动冲正。
          </Text>

          <View style={[styles.lockChip, { backgroundColor: fold.paper2 }]}>
            <MaterialIcons name="lock-outline" size={12} color={fold.muted} />
            <Text style={[styles.lockText, { color: fold.muted }]} maxFontSizeMultiplier={1.2}>
              数据仅保存在本机与应用账户
            </Text>
          </View>

          <FoldCard style={styles.templateCard} onPress={() => router.push('/review-template-settings')}>
            <View style={styles.templateIcon}>
              <MaterialIcons name="dashboard-customize" size={17} color={palette.pine} />
            </View>
            <View style={styles.templateBody}>
              <Text style={[styles.rowTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
                复盘模板 · 日 / 周 / 月
              </Text>
              <Text style={[styles.rowSub, { color: fold.muted }]} maxFontSizeMultiplier={1.25}>
                三个 scope 一次管理，内置维度固定置顶
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={18} color={fold.faint} />
          </FoldCard>
        </ScrollView>
      )}

      <FoldReviewFooter
        sibling="calendar"
        onOpenHub={openHub}
        onOpenSibling={() => router.push('/review-calendar')}
      />

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
            style={[styles.reminderTimeModalBackdrop, { backgroundColor: 'rgba(18,26,22,0.35)' }]}
            onPress={() => setDailyReminderTimePickerOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="关闭"
          />
          <View
            style={[
              styles.reminderTimePickerCard,
              { backgroundColor: fold.card, borderColor: fold.line },
            ]}>
            <Text style={[styles.modalTitle, { color: fold.ink }]}>选择提醒时间</Text>
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
                  { borderColor: fold.line, opacity: pressed ? 0.85 : 1 },
                ]}>
                <Text style={[styles.reminderPickerBtnText, { color: fold.muted }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={onConfirmDailyReminderTime}
                style={({ pressed }) => [
                  styles.reminderPickerBtn,
                  {
                    backgroundColor: fold.pine,
                    borderColor: fold.pine,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <Text style={[styles.reminderPickerBtnText, { color: fold.onPineButton }]}>确定</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 20,
    gap: 10,
  },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  syncText: { fontSize: 10.5, fontWeight: '700' },
  card: { gap: 12 },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  cardHint: {
    flexShrink: 1,
    fontSize: 10,
    textAlign: 'right',
    letterSpacing: 0.1,
  },
  weekRow: {
    flexDirection: 'row',
    gap: 5,
  },
  weekCell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    gap: 2,
  },
  weekCellCn: {
    fontSize: 14,
    fontWeight: '800',
  },
  weekCellEn: {
    fontSize: 7.5,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  weekDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 1,
  },
  hintLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  hintText: {
    flex: 1,
    fontSize: 10.5,
    lineHeight: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    fontSize: 13.5,
    fontWeight: '800',
  },
  rowSub: {
    fontSize: 10.5,
    lineHeight: 15,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  timeLabel: { fontSize: 12, fontWeight: '700' },
  timeRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeChip: {
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  timeValue: {
    fontSize: 15,
    fontWeight: '800',
    fontFamily: foldFonts.mono,
    letterSpacing: 0.2,
  },
  timeMeta: { fontSize: 10 },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  previewMark: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewMarkText: { fontSize: 12, fontWeight: '800', fontFamily: foldFonts.serif },
  previewBody: { flex: 1, minWidth: 0, gap: 2 },
  previewTitle: { fontSize: 12, fontWeight: '800' },
  previewText: { fontSize: 10.5, lineHeight: 15 },
  previewClock: { fontSize: 10, fontWeight: '700', fontFamily: foldFonts.mono },
  amountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    height: 28,
    minWidth: 46,
    justifyContent: 'center',
  },
  amountPlus: { fontSize: 12, fontWeight: '800' },
  amountInput: {
    minWidth: 22,
    padding: 0,
    fontSize: 12.5,
    fontWeight: '800',
    textAlign: 'center',
  },
  tierRow: {
    flexDirection: 'row',
    gap: 6,
  },
  tierCell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 7,
    gap: 1,
  },
  tierDays: { fontSize: 9.5, fontWeight: '700' },
  tierPoints: { fontSize: 13, fontWeight: '800' },
  progressHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressCount: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: foldFonts.mono,
  },
  progressTrack: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  progressHint: { flex: 1, fontSize: 10.5, lineHeight: 15 },
  earnedPill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  earnedText: { fontSize: 10.5, fontWeight: '800' },
  infoGroup: { gap: 8 },
  infoRow: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  infoRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  infoRowText: { flex: 1, minWidth: 0, gap: 2 },
  rowAction: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  rowActionText: { fontSize: 11, fontWeight: '700' },
  footnote: {
    fontSize: 9.5,
    lineHeight: 14,
    textAlign: 'center',
    paddingHorizontal: 6,
  },
  lockChip: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  lockText: { fontSize: 9.5, fontWeight: '600' },
  templateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
  },
  templateIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(127,166,149,0.18)',
  },
  templateBody: { flex: 1, minWidth: 0, gap: 2 },
  reminderTimeModalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  reminderTimeModalBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  reminderTimePickerCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
    zIndex: 2,
    gap: 8,
    overflow: 'hidden',
  },
  modalTitle: { fontSize: 15, fontWeight: '800' },
  reminderPickerActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  reminderPickerBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reminderPickerBtnText: { fontSize: 14, fontWeight: '800' },
});
