import { Radius, Spacing } from '@/constants/design-tokens';
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
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  Alert,
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
  outlineVariant: string;
  tertiary: string;
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
  outlineVariant,
  tertiary,
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

  const reloadGoal = React.useCallback(async () => {
    const next = await loadFinanceSavingsGoal();
    setGoal(next);
    setLoaded(true);
  }, []);

  React.useEffect(() => {
    void reloadGoal();
  }, [reloadGoal]);

  const progress = React.useMemo(
    () => (goal ? computeFinanceSavingsGoalProgress(goal, currentNetWorth, today) : null),
    [goal, currentNetWorth, today],
  );

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
  }, [goal, today]);

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
      Alert.alert('金额无效', '请输入有效的目标存款金额。');
      return;
    }
    if (amount > FINANCE_SAVINGS_GOAL_MAX_AMOUNT) {
      Alert.alert(
        '金额过大',
        `目标金额不得超过 ${FINANCE_SAVINGS_GOAL_MAX_AMOUNT.toLocaleString('zh-CN')}。`,
      );
      return;
    }
    if (amount <= currentNetWorth) {
      Alert.alert(
        '目标过低',
        `目标存款须大于当前净资产（${formatCurrency(currentNetWorth)}）。`,
      );
      return;
    }

    const tomorrowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const pickStart = new Date(dateDraft.getFullYear(), dateDraft.getMonth(), dateDraft.getDate());
    if (pickStart.getTime() < tomorrowStart.getTime()) {
      Alert.alert('日期无效', '目标日期最早只能选明天。');
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
      closeSheet();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '请稍后重试。');
    } finally {
      setSaving(false);
    }
  }, [amountDraft, currentNetWorth, dateDraft, formatCurrency, today, closeSheet]);

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
              closeSheet();
            } catch {
              Alert.alert('清除失败', '请稍后重试。');
            }
          })();
        },
      },
    ]);
  }, [closeSheet]);

  if (!loaded) return null;

  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const minDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const monthCells = buildMonthCells(calendarMonth);
  const canGoPrevMonth =
    calendarMonth.getFullYear() > minDate.getFullYear() ||
    (calendarMonth.getFullYear() === minDate.getFullYear() &&
      calendarMonth.getMonth() > minDate.getMonth());
  const monthTitle = `${calendarMonth.getFullYear()}年${calendarMonth.getMonth() + 1}月`;

  return (
    <>
      <View style={[styles.divider, { backgroundColor: outlineVariant }]} />

      {!goal || !progress ? (
        <Pressable
          onPress={openSheet}
          style={({ pressed }) => [styles.emptyRow, pressed && { opacity: 0.78 }]}
          accessibilityRole="button"
          accessibilityLabel="设置预期存款目标">
          <View style={styles.emptyLeft}>
            <MaterialIcons name="flag" size={18} color={primary} />
            <View style={styles.emptyTextCol}>
              <Text style={[styles.emptyTitle, { color: text }]}>预期存款目标</Text>
              <Text style={[styles.emptyHint, { color: subtle }]}>设定目标金额与日期，查看每日需存</Text>
            </View>
          </View>
          <MaterialIcons name="add-circle-outline" size={22} color={primary} />
        </Pressable>
      ) : (
        <Pressable
          onPress={openSheet}
          style={({ pressed }) => [styles.goalBlock, pressed && { opacity: 0.82 }]}
          accessibilityRole="button"
          accessibilityLabel="编辑预期存款目标">
          <View style={styles.goalHeader}>
            <View style={styles.goalTitleRow}>
              <Text style={[styles.goalTitle, { color: subtle }]}>预期存款目标</Text>
              <View
                style={[
                  styles.countdownBadge,
                  {
                    backgroundColor: progress.overdue
                      ? isDark
                        ? 'rgba(248,113,113,0.16)'
                        : '#fef2f2'
                      : progress.achieved
                        ? isDark
                          ? 'rgba(74,222,128,0.16)'
                          : '#ecfdf5'
                        : isDark
                          ? 'rgba(96,165,250,0.16)'
                          : '#eef4ff',
                  },
                ]}>
                <Text
                  style={[
                    styles.countdownText,
                    {
                      color: progress.overdue
                        ? isDark
                          ? '#f87171'
                          : '#dc2626'
                        : progress.achieved
                          ? isDark
                            ? '#4ade80'
                            : '#16a34a'
                          : primary,
                    },
                  ]}>
                  {progress.achieved
                    ? '已达成'
                    : formatSavingsGoalCountdownLabel(progress.daysLeft, goal.targetDate, today)}
                </Text>
              </View>
            </View>
            <MaterialIcons name="edit" size={16} color={subtle} />
          </View>

          <View style={styles.goalAmountRow}>
            <Text style={[styles.goalAmount, { color: text }]}>
              {showAmounts ? formatCurrency(goal.targetAmount) : hiddenAmountText}
            </Text>
            <Text style={[styles.goalDeadline, { color: subtle }]}>
              截止 {formatSavingsGoalDateLabel(goal.targetDate)}
            </Text>
          </View>

          <View
            style={[
              styles.dailyCard,
              {
                backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : '#f7f9fd',
                borderColor: outlineVariant,
              },
            ]}>
            <Text style={[styles.dailyLabel, { color: subtle }]}>
              {progress.achieved ? '每日目标' : '每日需存'}
            </Text>
            <Text
              style={[
                styles.dailyValue,
                { color: progress.achieved ? (isDark ? '#4ade80' : '#16a34a') : text },
              ]}>
              {showAmounts
                ? progress.achieved
                  ? '¥0'
                  : formatCurrency(progress.dailyTarget)
                : hiddenAmountText}
            </Text>
            <Text style={[styles.dailyHint, { color: subtle }]}>
              {progress.achieved
                ? '当前净资产已达到或超过目标'
                : `距目标还差 ${showAmounts ? formatCurrency(progress.gap) : hiddenAmountText} · 含今天共 ${progress.daysLeft} 天`}
            </Text>
          </View>
        </Pressable>
      )}

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
  divider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 18,
    marginBottom: 14,
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 2,
  },
  emptyLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  emptyTextCol: {
    flex: 1,
    gap: 2,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  emptyHint: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  goalBlock: {
    gap: 10,
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  goalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  goalTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  countdownBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  countdownText: {
    fontSize: 11,
    fontWeight: '700',
  },
  goalAmountRow: {
    gap: 2,
  },
  goalAmount: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  goalDeadline: {
    fontSize: 12,
    fontWeight: '600',
  },
  dailyCard: {
    marginTop: 2,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  dailyLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  dailyHint: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 15,
    marginTop: 2,
  },
  dailyValue: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
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
