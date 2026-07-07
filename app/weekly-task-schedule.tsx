import { AppButton, AppInput, ScreenHeader } from '@/components/ui';
import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import { getCurrentWeekRange } from '@/lib/repositories/insights/weekly-review';
import {
  canMergeWeeklyTaskScheduleSlot,
  canSplitWeeklyTaskScheduleSlot,
  getWeeklyTaskScheduleCell,
  loadWeeklyTaskSchedule,
  mergeWeeklyTaskScheduleSlotWithNext,
  splitWeeklyTaskScheduleSlot,
  upsertWeeklyTaskScheduleCell,
  WEEKLY_TASK_SCHEDULE_DAYS,
  type WeeklyTaskScheduleData,
  type WeeklyTaskScheduleSlot,
} from '@/lib/weekly-task-schedule';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TIME_COL_WIDTH = 54;
const DAY_COL_MIN_WIDTH = 52;
const ROW_MIN_HEIGHT = 44;
const HEADER_ROW_HEIGHT = 40;

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map((x) => Number(x));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatWeekRangeLabel(startYmd: string, endYmd: string): string {
  const [sy, sm, sd] = startYmd.split('-').map((x) => Number(x));
  const [ey, em, ed] = endYmd.split('-').map((x) => Number(x));
  if (sy === ey) return `${sy}年${sm}月${sd}日 – ${em}月${ed}日`;
  return `${sy}年${sm}月${sd}日 – ${ey}年${em}月${ed}日`;
}

function slotRowHeight(slot: WeeklyTaskScheduleSlot): number {
  const hours = Math.max(1, slot.endHour - slot.startHour);
  return ROW_MIN_HEIGHT * hours + Math.max(0, hours - 1) * Spacing.xs;
}

type EditTarget = {
  slotId: string;
  dayIndex: number;
  dayLabel: string;
  timeLabel: string;
};

const PAGE_API_KEY = 'weekly-task-schedule';

export default function WeeklyTaskScheduleScreen() {
  const router = useRouter();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { colors, isDark, shadows } = useAppTheme();
  const { logicalTodayYmd } = useDayBoundary();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [slotMutating, setSlotMutating] = React.useState(false);
  const [schedule, setSchedule] = React.useState<WeeklyTaskScheduleData | null>(null);
  const [editTarget, setEditTarget] = React.useState<EditTarget | null>(null);
  const [editText, setEditText] = React.useState('');

  const weekRange = React.useMemo(() => {
    const anchor = new Date();
    const [y, m, d] = logicalTodayYmd.split('-').map((x) => Number(x));
    if (y && m && d) anchor.setFullYear(y, m - 1, d);
    return getCurrentWeekRange(anchor);
  }, [logicalTodayYmd]);

  const dayColWidth = React.useMemo(() => {
    const horizontalPadding = Spacing['5xl'] * 2;
    const available = windowWidth - horizontalPadding - TIME_COL_WIDTH;
    return Math.max(DAY_COL_MIN_WIDTH, Math.floor(available / 7));
  }, [windowWidth]);

  const gridWidth = TIME_COL_WIDTH + dayColWidth * 7;

  const reload = React.useCallback(async () => {
    setLoading(true);
    await wrapLoad(async () => {
      try {
        const data = await loadWeeklyTaskSchedule();
        setSchedule(data);
      } catch (e) {
        console.warn('Failed to load weekly task schedule:', e);
      } finally {
        setLoading(false);
      }
    });
  }, [wrapLoad]);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload]),
  );

  const openEditor = React.useCallback(
    (slot: WeeklyTaskScheduleSlot, dayIndex: number) => {
      if (!schedule) return;
      const ymd = addDaysYmd(weekRange.startYmd, dayIndex);
      const [, , dayNum] = ymd.split('-');
      setEditTarget({
        slotId: slot.id,
        dayIndex,
        dayLabel: `${WEEKLY_TASK_SCHEDULE_DAYS[dayIndex]} ${Number(dayNum)}日`,
        timeLabel: slot.label,
      });
      setEditText(getWeeklyTaskScheduleCell(schedule, slot.id, dayIndex));
    },
    [schedule, weekRange.startYmd],
  );

  const closeEditor = React.useCallback(() => {
    setEditTarget(null);
    setEditText('');
  }, []);

  const confirmEditor = React.useCallback(async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      const next = await upsertWeeklyTaskScheduleCell(editTarget.slotId, editTarget.dayIndex, editText);
      setSchedule(next);
      closeEditor();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [closeEditor, editTarget, editText]);

  const handleSlotStructurePress = React.useCallback(
    (slot: WeeklyTaskScheduleSlot) => {
      if (!schedule || slotMutating) return;
      const canMerge = canMergeWeeklyTaskScheduleSlot(schedule, slot.id);
      const canSplit = canSplitWeeklyTaskScheduleSlot(schedule, slot.id);
      if (!canMerge && !canSplit) return;

      const buttons: Array<{ text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }> = [];
      if (canMerge) {
        buttons.push({
          text: '与下一时段合并',
          onPress: () => {
            setSlotMutating(true);
            void mergeWeeklyTaskScheduleSlotWithNext(slot.id)
              .then((next) => setSchedule(next))
              .catch((e) => {
                Alert.alert('合并失败', e instanceof Error ? e.message : '请稍后重试');
              })
              .finally(() => setSlotMutating(false));
          },
        });
      }
      if (canSplit) {
        buttons.push({
          text: '拆出首小时',
          onPress: () => {
            setSlotMutating(true);
            void splitWeeklyTaskScheduleSlot(slot.id)
              .then((next) => setSchedule(next))
              .catch((e) => {
                Alert.alert('拆分失败', e instanceof Error ? e.message : '请稍后重试');
              })
              .finally(() => setSlotMutating(false));
          },
        });
      }
      buttons.push({ text: '取消', style: 'cancel' });

      Alert.alert(`调整时段 · ${slot.label}`, '合并或拆分后，格子内容会尽量保留在较早时段', buttons);
    },
    [schedule, slotMutating],
  );

  const todayDayIndex = React.useMemo(() => {
    if (logicalTodayYmd < weekRange.startYmd || logicalTodayYmd > weekRange.endYmd) return -1;
    const start = new Date(
      Number(weekRange.startYmd.slice(0, 4)),
      Number(weekRange.startYmd.slice(5, 7)) - 1,
      Number(weekRange.startYmd.slice(8, 10)),
    );
    const today = new Date(
      Number(logicalTodayYmd.slice(0, 4)),
      Number(logicalTodayYmd.slice(5, 7)) - 1,
      Number(logicalTodayYmd.slice(8, 10)),
    );
    const diff = Math.round((today.getTime() - start.getTime()) / 86_400_000);
    return diff >= 0 && diff < 7 ? diff : -1;
  }, [logicalTodayYmd, weekRange.endYmd, weekRange.startYmd]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="本周任务表"
        subtitle={formatWeekRangeLabel(weekRange.startYmd, weekRange.endYmd)}
        onBack={() => router.back()}
      />

      {loading || !schedule ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <View style={styles.body}>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            内容按星期几保存，每周自动复用；点击格子编辑，点击左侧时段可合并或拆分（最小 1 小时）
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.gridHorizontalScroll}
            contentContainerStyle={[
              styles.gridScrollContent,
              { paddingHorizontal: Spacing['5xl'], paddingBottom: insets.bottom + Spacing['4xl'] },
            ]}>
            <View style={{ width: gridWidth }}>
              <View style={[styles.headerRow, { height: HEADER_ROW_HEIGHT }]}>
                <View style={[styles.timeCol, { width: TIME_COL_WIDTH }]} />
                {WEEKLY_TASK_SCHEDULE_DAYS.map((label, dayIndex) => {
                  const ymd = addDaysYmd(weekRange.startYmd, dayIndex);
                  const dayNum = Number(ymd.slice(8, 10));
                  const isToday = dayIndex === todayDayIndex;
                  return (
                    <View
                      key={label}
                      style={[
                        styles.dayHeader,
                        { width: dayColWidth },
                        isToday && {
                          backgroundColor: isDark ? 'rgba(59,130,246,0.18)' : 'rgba(59,130,246,0.1)',
                          borderRadius: Radius.md,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.dayHeaderWeek,
                          { color: isToday ? colors.primary : colors.textSecondary },
                        ]}>
                        {label}
                      </Text>
                      <Text
                        style={[
                          styles.dayHeaderDate,
                          { color: isToday ? colors.primary : colors.text },
                        ]}>
                        {dayNum}
                      </Text>
                    </View>
                  );
                })}
              </View>

              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator
                contentContainerStyle={{ paddingBottom: Spacing.xl }}>
                {schedule.slots.map((slot) => {
                  const rowHeight = slotRowHeight(slot);
                  const canAdjust =
                    canMergeWeeklyTaskScheduleSlot(schedule, slot.id) ||
                    canSplitWeeklyTaskScheduleSlot(schedule, slot.id);
                  return (
                    <View key={slot.id} style={styles.slotRow}>
                      <Pressable
                        disabled={!canAdjust || slotMutating}
                        onPress={() => handleSlotStructurePress(slot)}
                        accessibilityRole="button"
                        accessibilityLabel={`${slot.label}，点击调整时段`}
                        style={({ pressed }) => [
                          styles.timeCol,
                          styles.timeColPressable,
                          {
                            width: TIME_COL_WIDTH,
                            minHeight: rowHeight,
                            opacity: !canAdjust ? 0.72 : pressed ? 0.82 : 1,
                          },
                        ]}>
                        <Text style={[styles.timeLabel, { color: colors.textMuted }]} numberOfLines={4}>
                          {slot.label}
                        </Text>
                        {canAdjust ? (
                          <MaterialIcons name="unfold-more" size={12} color={colors.textMuted} style={styles.timeAdjustIcon} />
                        ) : null}
                      </Pressable>
                      {WEEKLY_TASK_SCHEDULE_DAYS.map((_, dayIndex) => {
                        const content = getWeeklyTaskScheduleCell(schedule, slot.id, dayIndex);
                        const isToday = dayIndex === todayDayIndex;
                        const hasContent = Boolean(content);
                        return (
                          <Pressable
                            key={`${slot.id}-${dayIndex}`}
                            onPress={() => openEditor(slot, dayIndex)}
                            accessibilityRole="button"
                            accessibilityLabel={`${WEEKLY_TASK_SCHEDULE_DAYS[dayIndex]} ${slot.label}${content ? `，${content}` : '，空白'}`}
                            style={({ pressed }) => [
                              styles.cell,
                              {
                                width: dayColWidth,
                                minHeight: rowHeight,
                                borderColor: colors.outline,
                                backgroundColor: hasContent
                                  ? isDark
                                    ? 'rgba(59,130,246,0.14)'
                                    : 'rgba(59,130,246,0.08)'
                                  : isToday
                                    ? isDark
                                      ? 'rgba(51,65,85,0.45)'
                                      : 'rgba(248,250,252,0.9)'
                                    : colors.surface,
                              },
                              pressed && { opacity: 0.82 },
                            ]}>
                            {hasContent ? (
                              <Text style={[styles.cellText, { color: colors.text }]} numberOfLines={6}>
                                {content}
                              </Text>
                            ) : (
                              <MaterialIcons name="add" size={14} color={colors.textMuted} style={styles.cellAddIcon} />
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          </ScrollView>
        </View>
      )}

      <Modal visible={editTarget != null} transparent animationType="fade" onRequestClose={closeEditor}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closeEditor} accessibilityLabel="关闭" />
          <View
            style={[
              styles.modalCard,
              shadows.md,
              {
                backgroundColor: colors.surface,
                borderColor: colors.outline,
                marginBottom: insets.bottom + Spacing.xl,
              },
            ]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {editTarget ? `${editTarget.dayLabel} · ${editTarget.timeLabel}` : ''}
            </Text>
            <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
              此处填写的是每周{editTarget ? WEEKLY_TASK_SCHEDULE_DAYS[editTarget.dayIndex] : ''}的固定安排
            </Text>
            <AppInput
              value={editText}
              onChangeText={setEditText}
              placeholder="写一下这个时段要做什么…"
              multiline
              autoFocus
              textAlignVertical="top"
              inputWrapStyle={styles.modalInputWrap}
              inputStyle={styles.modalInput}
            />
            <View style={styles.modalActions}>
              <AppButton variant="ghost" label="取消" onPress={closeEditor} disabled={saving} />
              <AppButton label="保存" onPress={() => void confirmEditor()} loading={saving} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: {
    ...Typography.caption,
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  gridHorizontalScroll: { flex: 1 },
  gridScrollContent: {
    paddingTop: Spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: Spacing.sm,
  },
  timeCol: {
    justifyContent: 'center',
    paddingRight: Spacing.sm,
  },
  timeColPressable: {
    alignItems: 'flex-end',
    gap: 2,
  },
  timeLabel: {
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 12,
    textAlign: 'right',
  },
  timeAdjustIcon: {
    opacity: 0.55,
  },
  dayHeader: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: Spacing.xs,
  },
  dayHeaderWeek: {
    fontSize: 10,
    fontWeight: '700',
  },
  dayHeaderDate: {
    fontSize: 14,
    fontWeight: '900',
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: Spacing.xs,
  },
  cell: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    marginRight: Spacing.xs,
    justifyContent: 'center',
  },
  cellText: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
  },
  cellAddIcon: {
    alignSelf: 'center',
    opacity: 0.45,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalCard: {
    marginHorizontal: Spacing['4xl'],
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['3xl'],
    gap: Spacing.xl,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  modalSubtitle: {
    ...Typography.caption,
    marginTop: -Spacing.md,
  },
  modalInputWrap: {
    minHeight: 120,
    alignItems: 'flex-start',
  },
  modalInput: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.md,
  },
});
