import { Radius, Spacing } from '@/constants/design-tokens';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { apiGetFinancePredictedSavings } from '@/lib/api/endpoints/finance';
import type { FinanceSavingsGoalCoachJson } from '@/lib/ai-types';
import {
  clearFinanceSavingsGoal,
  computeFinanceSavingsGoalProgress,
  defaultFinanceSavingsGoalDate,
  FINANCE_SAVINGS_GOAL_MAX_AMOUNT,
  financeSavingsGoalParseIsoDate,
  financeSavingsGoalToIsoDate,
  formatSavingsGoalCountdownLabel,
  formatSavingsGoalDateLabel,
  loadFinanceSavingsGoal,
  persistFinanceSavingsGoal,
  type FinanceSavingsGoal,
} from '@/lib/finance-savings-goal';
import { analyzeFinanceSavingsGoalCoach } from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const WEEKDAY_HEADERS = ['日', '一', '二', '三', '四', '五', '六'] as const;

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildMonthCells(month: Date): Array<Date | null> {
  const first = startOfMonth(month);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = first.getDay();
  const cells: Array<Date | null> = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(first.getFullYear(), first.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export type FinanceSavingsGoalBlockProps = {
  currentNetWorth: number;
  today: Date;
  showAmounts: boolean;
  hiddenAmountText?: string;
  formatCurrency: (value: number) => string;
  isDark: boolean;
  text: string;
  subtle: string;
  primary: string;
  surface: string;
  surfaceMuted?: string;
  primaryMuted?: string;
  danger?: string;
  secondary?: string;
  outlineVariant: string;
  tertiary: string;
  /** 到目标日预计定时支出合计，抬高每日需存 */
  scheduledDrainUntilTarget?: number;
  /** 本周期定时支出预扣合计（展示用：仅未支付且未过点） */
  scheduledBudgetDeduction?: number;
  /** 逻辑今日 YYYY-MM-DD，供预测存款接口 */
  logicalTodayYmd?: string;
  dayBoundaryHour?: number;
  dayBoundaryMinute?: number;
  onGoalChange?: (goal: FinanceSavingsGoal | null) => void;
  /** 打开编辑 Sheet 时回调（用于确认储蓄提醒已读） */
  onOpenEditor?: () => void;
  /** 近若干月净储蓄（从旧到新），供 AI 教练 */
  recentMonthlyNetSavings?: number[];
};

export function FinanceSavingsGoalBlock({
  currentNetWorth,
  today,
  showAmounts,
  hiddenAmountText = '****',
  formatCurrency,
  isDark,
  text,
  subtle,
  primary,
  surface,
  surfaceMuted,
  primaryMuted,
  danger,
  secondary,
  outlineVariant,
  tertiary,
  scheduledDrainUntilTarget = 0,
  scheduledBudgetDeduction = 0,
  logicalTodayYmd,
  dayBoundaryHour,
  dayBoundaryMinute,
  onOpenEditor,
  onGoalChange,
  recentMonthlyNetSavings = [],
}: FinanceSavingsGoalBlockProps) {
  const insets = useSafeAreaInsets();
  const [goal, setGoal] = React.useState<FinanceSavingsGoal | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [sheetVisible, setSheetVisible] = React.useState(false);
  const [amountDraft, setAmountDraft] = React.useState('');
  const [dateDraft, setDateDraft] = React.useState(() => defaultFinanceSavingsGoalDate(today));
  const [showDatePicker, setShowDatePicker] = React.useState(false);
  const [calendarMonth, setCalendarMonth] = React.useState(() => startOfMonth(defaultFinanceSavingsGoalDate(today)));
  const [saving, setSaving] = React.useState(false);
  const [predictedDeposit, setPredictedDeposit] = React.useState<number | null>(null);
  const [predictedLoading, setPredictedLoading] = React.useState(false);
  const [coachLoading, setCoachLoading] = React.useState(false);
  const [coachResult, setCoachResult] = React.useState<FinanceSavingsGoalCoachJson | null>(null);

  const reloadGoal = React.useCallback(async () => {
    const next = await loadFinanceSavingsGoal();
    setGoal(next);
    setLoaded(true);
  }, []);

  React.useEffect(() => {
    void reloadGoal();
  }, [reloadGoal]);

  React.useEffect(() => {
    setCoachResult(null);
  }, [goal?.targetAmount, goal?.targetDate]);

  const progress = React.useMemo(
    () =>
      goal
        ? computeFinanceSavingsGoalProgress(goal, currentNetWorth, today, scheduledDrainUntilTarget)
        : null,
    [goal, currentNetWorth, today, scheduledDrainUntilTarget],
  );

  React.useEffect(() => {
    if (!goal?.targetDate) {
      setPredictedDeposit(null);
      setPredictedLoading(false);
      return;
    }
    const ac = new AbortController();
    setPredictedLoading(true);
    void apiGetFinancePredictedSavings({
      targetDate: goal.targetDate,
      logicalToday: logicalTodayYmd,
      dayBoundaryHour,
      dayBoundaryMinute,
      signal: ac.signal,
    })
      .then((payload) => {
        if (ac.signal.aborted) return;
        const value = Number(payload.predictedDeposit);
        setPredictedDeposit(Number.isFinite(value) ? value : null);
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setPredictedDeposit(null);
      })
      .finally(() => {
        if (!ac.signal.aborted) setPredictedLoading(false);
      });
    return () => ac.abort();
  }, [goal?.targetDate, logicalTodayYmd, dayBoundaryHour, dayBoundaryMinute]);

  const openSheet = React.useCallback(() => {
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    if (goal) {
      setAmountDraft(String(Math.round(goal.targetAmount * 100) / 100));
      const parsed = financeSavingsGoalParseIsoDate(goal.targetDate);
      const safeDate = parsed.getTime() < tomorrow.getTime() ? tomorrow : parsed;
      setDateDraft(safeDate);
      setCalendarMonth(startOfMonth(safeDate));
    } else {
      setAmountDraft('');
      const fallback = defaultFinanceSavingsGoalDate(today);
      const safeDate = fallback.getTime() < tomorrow.getTime() ? tomorrow : fallback;
      setDateDraft(safeDate);
      setCalendarMonth(startOfMonth(safeDate));
    }
    setShowDatePicker(false);
    setSheetVisible(true);
    onOpenEditor?.();
  }, [goal, onOpenEditor, today]);

  const closeSheet = React.useCallback(() => {
    Keyboard.dismiss();
    setSheetVisible(false);
    setShowDatePicker(false);
  }, []);

  const openDatePicker = React.useCallback(() => {
    Keyboard.dismiss();
    setCalendarMonth(startOfMonth(dateDraft));
    setShowDatePicker(true);
  }, [dateDraft]);

  const closeDatePicker = React.useCallback(() => {
    setShowDatePicker(false);
  }, []);

  const selectCalendarDay = React.useCallback(
    (day: Date) => {
      const minSelectable = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      if (day.getTime() < minSelectable.getTime()) return;
      setDateDraft(day);
    },
    [today],
  );

  const shiftCalendarMonth = React.useCallback(
    (delta: number) => {
      setCalendarMonth((prev) => {
        const next = new Date(prev.getFullYear(), prev.getMonth() + delta, 1);
        const minMonth = startOfMonth(
          new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1),
        );
        return next.getTime() < minMonth.getTime() ? minMonth : next;
      });
    },
    [today],
  );

  const handleSave = React.useCallback(async () => {
    const normalized = amountDraft.trim().replace(/,/g, '');
    const amount = parseFloat(normalized);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.warn('请输入有效的目标存款金额。');
      return;
    }
    if (amount > FINANCE_SAVINGS_GOAL_MAX_AMOUNT) {
      toast.warn(`目标金额不得超过 ${FINANCE_SAVINGS_GOAL_MAX_AMOUNT.toLocaleString('zh-CN')}。`);
      return;
    }
    if (amount <= currentNetWorth) {
      toast.warn(`目标存款须大于当前净资产（${formatCurrency(currentNetWorth)}）。`);
      return;
    }

    const tomorrowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const pickStart = new Date(dateDraft.getFullYear(), dateDraft.getMonth(), dateDraft.getDate());
    if (pickStart.getTime() < tomorrowStart.getTime()) {
      toast.warn('目标日期最早只能选明天。');
      return;
    }

    setSaving(true);
    try {
      const next: FinanceSavingsGoal = {
        targetAmount: Math.round(amount * 100) / 100,
        targetDate: financeSavingsGoalToIsoDate(pickStart),
      };
      await persistFinanceSavingsGoal(next);
      setGoal(next);
      onGoalChange?.(next);
      toast.success('已保存');
      closeSheet();
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请稍后重试。'));
    } finally {
      setSaving(false);
    }
  }, [amountDraft, currentNetWorth, dateDraft, formatCurrency, today, closeSheet, onGoalChange]);

  const handleClear = React.useCallback(() => {
    Alert.alert('清除存款目标', '确定清除当前预期存款目标吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '清除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await clearFinanceSavingsGoal();
              setGoal(null);
              setCoachResult(null);
              onGoalChange?.(null);
              toast.success('已清除');
              closeSheet();
            } catch (e) {
              toast.error(toUserMessage(e, '清除失败，请稍后重试。'));
            }
          })();
        },
      },
    ]);
  }, [closeSheet, onGoalChange]);

  const handleCoach = React.useCallback(async () => {
    if (!goal || !progress || coachLoading) return;
    setCoachLoading(true);
    try {
      const nets =
        recentMonthlyNetSavings.length > 0
          ? recentMonthlyNetSavings.map((n) => Math.round(n)).join(', ')
          : '未知';
      const summary = [
        `目标金额：¥${goal.targetAmount.toFixed(2)}`,
        `目标日期：${goal.targetDate}`,
        `当前净资产：¥${currentNetWorth.toFixed(2)}`,
        `缺口（含定时预扣抬高）：¥${progress.gap.toFixed(2)}`,
        `剩余天数（含今天）：${progress.daysLeft}`,
        `日均需存：¥${progress.dailyTarget.toFixed(2)}`,
        `到目标日定时支出预扣：¥${scheduledDrainUntilTarget.toFixed(2)}`,
        `近月净储蓄（旧→新）：${nets}`,
        progress.achieved ? '状态：已达成' : progress.overdue ? '状态：已过期未达成' : '状态：进行中',
      ].join('\n');
      const result = await analyzeFinanceSavingsGoalCoach({ summaryText: summary });
      if (!result.ok) {
        toast.warn(result.error || 'AI 教练失败，请稍后重试');
        return;
      }
      setCoachResult(result.data);
    } catch (e) {
      toast.error(toUserMessage(e, 'AI 教练失败，请稍后重试'));
    } finally {
      setCoachLoading(false);
    }
  }, [
    coachLoading,
    currentNetWorth,
    goal,
    progress,
    recentMonthlyNetSavings,
    scheduledDrainUntilTarget,
  ]);

  const applyCoachOption = React.useCallback(
    (opt: NonNullable<FinanceSavingsGoalCoachJson['adjust_options']>[number]) => {
      const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      if (opt.kind === 'extend_days' && opt.days && goal) {
        const base = financeSavingsGoalParseIsoDate(goal.targetDate);
        const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + opt.days);
        const safe = next.getTime() < tomorrow.getTime() ? tomorrow : next;
        setAmountDraft(String(Math.round(goal.targetAmount * 100) / 100));
        setDateDraft(safe);
        setCalendarMonth(startOfMonth(safe));
        setShowDatePicker(false);
        setSheetVisible(true);
        onOpenEditor?.();
        toast.success('已预填建议日期，请确认后保存');
        return;
      }
      if (opt.kind === 'lower_target' && opt.amount != null && opt.amount > 0) {
        const amount = Math.round(opt.amount * 100) / 100;
        setAmountDraft(String(amount));
        if (goal) {
          const parsed = financeSavingsGoalParseIsoDate(goal.targetDate);
          const safe = parsed.getTime() < tomorrow.getTime() ? tomorrow : parsed;
          setDateDraft(safe);
          setCalendarMonth(startOfMonth(safe));
        } else {
          const fallback = defaultFinanceSavingsGoalDate(today);
          setDateDraft(fallback);
          setCalendarMonth(startOfMonth(fallback));
        }
        setShowDatePicker(false);
        setSheetVisible(true);
        onOpenEditor?.();
        toast.success('已预填建议目标额，请确认后保存');
      }
    },
    [goal, onOpenEditor, today],
  );

  if (!loaded) return null;

  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const minDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const monthCells = buildMonthCells(calendarMonth);
  const canGoPrevMonth =
    calendarMonth.getFullYear() > minDate.getFullYear() ||
    (calendarMonth.getFullYear() === minDate.getFullYear() &&
      calendarMonth.getMonth() > minDate.getMonth());
  const monthTitle = `${calendarMonth.getFullYear()}年${calendarMonth.getMonth() + 1}月`;
  const hasScheduledHint = scheduledBudgetDeduction > 0 || scheduledDrainUntilTarget > 0;

  const dangerColor = danger ?? (isDark ? '#f87171' : '#dc2626');
  const successColor = secondary ?? (isDark ? '#4ade80' : '#16a34a');
  const iconBg = isDark ? 'rgba(134,167,149,0.18)' : '#E9EFE8';
  const iconFg = isDark ? primary : '#456856';
  const trackBg = isDark ? 'rgba(230,221,206,0.14)' : '#E7E2D6';
  const fillFrom = secondary ?? '#86A795';
  const progressRatio =
    goal && goal.targetAmount > 0
      ? Math.min(1, Math.max(0, currentNetWorth / goal.targetAmount))
      : 0;
  const progressPct = Math.round(progressRatio * 100);
  const leftSub =
    scheduledBudgetDeduction > 0
      ? `定时预扣 ${showAmounts ? formatCurrency(scheduledBudgetDeduction) : hiddenAmountText}`
      : hasScheduledHint
        ? '定时预扣已结清'
        : '点此设置储蓄目标';
  const rightSub = goal
    ? progress?.achieved
      ? '已达成'
      : progress
        ? formatSavingsGoalCountdownLabel(progress.daysLeft, goal.targetDate, today)
        : ''
    : '设定金额与日期';
  const progressLeftSub = goal
    ? showAmounts
      ? `${formatCurrency(Math.min(currentNetWorth, goal.targetAmount))} / ${formatCurrency(goal.targetAmount)}`
      : hiddenAmountText
    : leftSub;
  const predictLabel =
    goal && showAmounts
      ? predictedLoading && predictedDeposit == null
        ? '预测可存 …'
        : predictedDeposit != null
          ? `预测可存 ${formatCurrency(predictedDeposit)}`
          : null
      : null;

  return (
    <>
      <View style={styles.goalStack}>
      <Pressable
        onPress={openSheet}
        style={({ pressed }) => [
          styles.goalCard,
          {
            backgroundColor: surface,
            borderColor: outlineVariant,
            opacity: pressed ? 0.92 : 1,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={goal ? '编辑储蓄目标' : '设置储蓄目标'}>
        <View style={[styles.goalIc, { backgroundColor: iconBg }]}>
          <MaterialIcons name="flag" size={16} color={iconFg} />
        </View>
        <View style={styles.goalMain}>
          <View style={styles.goalTop}>
            <Text style={[styles.goalTitle, { color: text }]} numberOfLines={1}>
              {goal ? '储蓄目标' : '设置储蓄目标'}
            </Text>
            <Text
              style={[
                styles.goalAmount,
                { color: progress?.achieved ? successColor : primary },
              ]}
              numberOfLines={1}>
              {!goal
                ? '去设置'
                : progress?.achieved
                  ? '已达成'
                  : showAmounts
                    ? `${formatCurrency(progress?.dailyTarget ?? 0)} / 日`
                    : hiddenAmountText}
            </Text>
          </View>
          <View style={[styles.goalTrack, { backgroundColor: trackBg }]}>
            <View
              style={[
                styles.goalFill,
                {
                  width: `${goal ? progressPct : 0}%`,
                  backgroundColor: progress?.achieved ? successColor : fillFrom,
                },
              ]}
            />
          </View>
          <View style={styles.goalSub}>
            <Text style={[styles.goalSubText, { color: subtle }]} numberOfLines={1}>
              {progressLeftSub}
            </Text>
            <Text
              style={[
                styles.goalSubText,
                { color: progress?.overdue ? dangerColor : subtle },
              ]}
              numberOfLines={1}>
              {rightSub}
            </Text>
          </View>
          {predictLabel ? (
            <Text style={[styles.goalPredict, { color: subtle }]} numberOfLines={1}>
              {predictLabel}
            </Text>
          ) : null}
        </View>
        <MaterialIcons name="chevron-right" size={18} color={subtle} />
      </Pressable>

      {goal && progress && !progress.achieved ? (
        <View
          style={[
            styles.coachCard,
            {
              backgroundColor: surfaceMuted ?? surface,
              borderColor: outlineVariant,
            },
          ]}>
          <View style={styles.coachHead}>
            <MaterialIcons name="auto-awesome" size={14} color={primary} />
            <Text style={[styles.coachTitle, { color: text }]}>能不能做到</Text>
            <Pressable
              onPress={() => void handleCoach()}
              disabled={coachLoading}
              style={({ pressed }) => [
                styles.coachBtn,
                {
                  backgroundColor: primary,
                  opacity: coachLoading ? 0.7 : pressed ? 0.88 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="AI 储蓄目标教练">
              {coachLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.coachBtnText}>{coachResult ? '再问一次' : 'AI 教练'}</Text>
              )}
            </Pressable>
          </View>
          {coachResult ? (
            <>
              <Text
                style={[
                  styles.coachBadge,
                  { color: coachResult.feasible ? successColor : dangerColor },
                ]}>
                {coachResult.feasible ? '粗判：大致可行' : '粗判：偏紧，建议调整'}
              </Text>
              <Text style={[styles.coachBody, { color: subtle }]}>{coachResult.pace_comment}</Text>
              {(coachResult.adjust_options ?? []).length > 0 ? (
                <View style={styles.coachOpts}>
                  {(coachResult.adjust_options ?? []).map((opt, idx) => (
                    <Pressable
                      key={`${opt.kind}-${idx}`}
                      onPress={() => applyCoachOption(opt)}
                      style={({ pressed }) => [
                        styles.coachOpt,
                        {
                          borderColor: outlineVariant,
                          backgroundColor: surface,
                          opacity: pressed ? 0.88 : 1,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={opt.label}>
                      <Text style={[styles.coachOptText, { color: text }]} numberOfLines={2}>
                        {opt.label}
                      </Text>
                      {(opt.kind === 'extend_days' || opt.kind === 'lower_target') &&
                      (opt.days || opt.amount != null) ? (
                        <Text style={[styles.coachOptApply, { color: primary }]}>应用</Text>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <Text style={[styles.coachBody, { color: subtle }]}>
              结合缺口、日均需存与近月净储蓄，粗判节奏是否跟得上。不会自动改目标。
            </Text>
          )}
        </View>
      ) : null}
      </View>

      <Modal visible={sheetVisible} animationType="slide" transparent onRequestClose={closeSheet}>
        <KeyboardAvoidingView
          style={styles.kav}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.overlayInner}>
            <Pressable style={styles.backdrop} onPress={closeSheet} />
            <View
              style={[
                styles.sheet,
                { backgroundColor: surface, paddingBottom: Math.max(24, insets.bottom) },
              ]}>
              <View style={styles.sheetHeader}>
                <Text style={[styles.sheetTitle, { color: text }]}>
                  {goal ? '编辑存款目标' : '设置存款目标'}
                </Text>
                {goal ? (
                  <Pressable
                    onPress={handleClear}
                    style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.85 }]}
                    accessibilityRole="button"
                    accessibilityLabel="清除存款目标">
                    <MaterialIcons name="delete-outline" size={16} color="#ef4444" />
                    <Text style={styles.clearBtnText}>清除</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={closeSheet}
                    style={({ pressed }) => [pressed && { opacity: 0.75 }]}
                    accessibilityRole="button"
                    accessibilityLabel="关闭">
                    <MaterialIcons name="close" size={22} color={subtle} />
                  </Pressable>
                )}
              </View>

              <Text style={[styles.sheetHint, { color: subtle }]}>
                目标金额须大于当前净资产 {showAmounts ? formatCurrency(currentNetWorth) : hiddenAmountText}
                ，并选择希望达成的日期。
              </Text>

              <View
                style={[
                  styles.inputRow,
                  { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#f9fafb' },
                ]}>
                <Text style={[styles.inputLabel, { color: subtle }]}>目标金额</Text>
                <Text style={[styles.yuan, { color: text }]}>¥</Text>
                <TextInput
                  value={amountDraft}
                  onChangeText={(t) => setAmountDraft(t.replace(/[^\d.]/g, '').slice(0, 12))}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={subtle}
                  style={[styles.amountInput, { color: text }]}
                  selectTextOnFocus
                />
              </View>

              <Pressable
                onPress={openDatePicker}
                style={({ pressed }) => [
                  styles.inputRow,
                  styles.dateRow,
                  { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#f9fafb' },
                  pressed && { opacity: 0.92 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="选择目标日期">
                <Text style={[styles.inputLabel, { color: subtle }]}>目标日期</Text>
                <Text style={[styles.dateValue, { color: text }]}>
                  {formatSavingsGoalDateLabel(financeSavingsGoalToIsoDate(dateDraft))}
                  {financeSavingsGoalToIsoDate(dateDraft) === financeSavingsGoalToIsoDate(minDate)
                    ? ' · 明天'
                    : ''}
                </Text>
                <MaterialIcons name="event" size={18} color={subtle} />
              </Pressable>

              <Pressable
                onPress={() => void handleSave()}
                disabled={saving}
                style={({ pressed }) => [
                  styles.saveBtn,
                  { backgroundColor: tertiary, opacity: saving ? 0.7 : pressed ? 0.92 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="保存存款目标">
                <Text style={styles.saveBtnText}>{saving ? '保存中…' : '完成'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>

        {sheetVisible && showDatePicker ? (
          <View style={[StyleSheet.absoluteFill, styles.dateOverlayRoot]} pointerEvents="box-none">
            <View style={styles.dateOverlay}>
              <Pressable
                style={styles.dateScrim}
                onPress={closeDatePicker}
                accessibilityRole="button"
                accessibilityLabel="关闭日期选择"
              />
              <View
                style={[
                  styles.dateSheet,
                  {
                    backgroundColor: surface,
                    paddingBottom: Math.max(20, insets.bottom + 8),
                  },
                ]}>
                <View style={[styles.dateSheetHeader, { borderBottomColor: outlineVariant }]}>
                  <Text style={[styles.dateSheetTitle, { color: text }]}>选择目标日期</Text>
                  <Pressable onPress={closeDatePicker} hitSlop={12} accessibilityRole="button">
                    <Text style={[styles.dateSheetDone, { color: primary }]}>完成</Text>
                  </Pressable>
                </View>

                <Text style={[styles.datePreview, { color: text }]}>
                  {formatSavingsGoalDateLabel(financeSavingsGoalToIsoDate(dateDraft))}
                </Text>

                <View style={styles.monthNav}>
                  <Pressable
                    onPress={() => shiftCalendarMonth(-1)}
                    disabled={!canGoPrevMonth}
                    style={({ pressed }) => [
                      styles.monthNavBtn,
                      { opacity: !canGoPrevMonth ? 0.35 : pressed ? 0.7 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="上一月">
                    <MaterialIcons name="chevron-left" size={26} color={text} />
                  </Pressable>
                  <Text style={[styles.monthTitle, { color: text }]}>{monthTitle}</Text>
                  <Pressable
                    onPress={() => shiftCalendarMonth(1)}
                    style={({ pressed }) => [styles.monthNavBtn, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel="下一月">
                    <MaterialIcons name="chevron-right" size={26} color={text} />
                  </Pressable>
                </View>

                <View style={styles.weekdayRow}>
                  {WEEKDAY_HEADERS.map((label) => (
                    <Text key={label} style={[styles.weekdayCell, { color: subtle }]}>
                      {label}
                    </Text>
                  ))}
                </View>

                <View style={styles.monthGrid}>
                  {monthCells.map((day, index) => {
                    if (!day) {
                      return <View key={`empty-${index}`} style={styles.dayCell} />;
                    }
                    const disabled = day.getTime() < minDate.getTime();
                    const selected = sameDay(day, dateDraft);
                    const isToday = sameDay(day, todayDate);
                    return (
                      <Pressable
                        key={financeSavingsGoalToIsoDate(day)}
                        disabled={disabled}
                        onPress={() => selectCalendarDay(day)}
                        style={({ pressed }) => [
                          styles.dayCell,
                          pressed && !disabled && !selected && { opacity: 0.72 },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`${day.getMonth() + 1}月${day.getDate()}日 周${WEEKDAY_HEADERS[day.getDay()]}`}
                        accessibilityState={{ selected, disabled }}>
                        <View
                          style={[
                            styles.dayHit,
                            {
                              backgroundColor: selected ? primary : 'transparent',
                              borderColor: selected
                                ? primary
                                : isToday
                                  ? primary
                                  : 'transparent',
                            },
                          ]}>
                          <Text
                            style={[
                              styles.dayCellText,
                              {
                                color: disabled
                                  ? isDark
                                    ? 'rgba(148,163,184,0.35)'
                                    : '#cbd5e1'
                                  : selected
                                    ? '#ffffff'
                                    : text,
                              },
                            ]}>
                            {day.getDate()}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
          </View>
        ) : null}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  goalStack: {
    gap: 8,
  },
  goalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 10,
    paddingHorizontal: 11,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  coachCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  coachHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  coachTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  coachBtn: {
    minWidth: 72,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  coachBadge: {
    fontSize: 12,
    fontWeight: '700',
  },
  coachBody: {
    fontSize: 12,
    lineHeight: 18,
  },
  coachOpts: {
    gap: 6,
    marginTop: 2,
  },
  coachOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  coachOptText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  coachOptApply: {
    fontSize: 11,
    fontWeight: '700',
  },
  goalIc: {
    width: 31,
    height: 31,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalMain: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  goalTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 6,
  },
  goalTitle: {
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  goalAmount: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  goalTrack: {
    height: 3,
    borderRadius: 4,
    overflow: 'hidden',
  },
  goalFill: {
    height: '100%',
    borderRadius: 4,
  },
  goalSub: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  goalSubText: {
    fontSize: 10,
    fontWeight: '500',
    flexShrink: 1,
  },
  goalPredict: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: 1,
  },
  mergedKicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  mergedHint: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
    marginTop: 1,
  },
  mergedValue: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginTop: 2,
  },
  kav: {
    flex: 1,
  },
  overlayInner: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 18,
    gap: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  clearBtnText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '700',
  },
  sheetHint: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    marginBottom: 4,
  },
  inputRow: {
    borderRadius: Radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateRow: {
    justifyContent: 'space-between',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    minWidth: 72,
  },
  yuan: {
    fontSize: 18,
    fontWeight: '800',
  },
  amountInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    padding: 0,
  },
  dateValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 16,
    fontWeight: '700',
  },
  dateOverlayRoot: {
    zIndex: 999,
    elevation: 99,
  },
  dateOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  dateScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
  },
  dateSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  dateSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dateSheetTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  dateSheetDone: {
    fontSize: 16,
    fontWeight: '700',
  },
  datePreview: {
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginTop: 14,
    marginBottom: 6,
    paddingHorizontal: 20,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  monthNavBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  weekdayRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  weekdayCell: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayHit: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellText: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  saveBtn: {
    marginTop: Spacing.md,
    borderRadius: Radius.xl,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
});
