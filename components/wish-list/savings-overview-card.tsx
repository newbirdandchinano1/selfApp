import { AppCard } from '@/components/ui';
import { Radius, Shadows, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { SAVINGS_PLAN_MAX_TARGET_AMOUNT } from '@/lib/repositories/savings-plan/savings-plan';
import {
  loadSavingsOverviewSettings,
  saveSavingsOverviewSettings,
  type SavingsOverviewSettings,
} from '@/lib/savings-overview-settings';
import {
  addCalendarDays,
  formatChineseDate,
  parseIsoDateLocal,
  toIsoDate,
} from '@/lib/wish-savings-form-utils';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React from 'react';
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';
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
import Svg, { Path } from 'react-native-svg';

function formatIntAmount(value: number) {
  return Math.round(Math.abs(value)).toLocaleString('zh-CN');
}

/** 顶部截止时间紧凑展示，避免换行 */
function formatIsoDateCompact(iso: string) {
  const parts = iso.split('-').map(x => parseInt(x, 10));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return '—';
  const yearNow = new Date().getFullYear();
  if (y === yearNow) return `${m}月${d}日`;
  return `${String(y).slice(2)}年${m}月${d}日`;
}

function progressPercent(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.min(100, Math.round((numerator / denominator) * 100));
}

type TopOverviewProgressMode = 'total' | 'deposit';

function ProgressStrip({
  title,
  hint,
  percent,
  trackColor,
  fillColor,
  labelColor,
  onPress,
  style,
}: {
  title: string;
  hint: string;
  percent: number;
  trackColor: string;
  fillColor: string;
  labelColor: string;
  onPress?: () => void;
  style?: object;
}) {
  const body = (
    <>
      <View style={styles.progressStripHead}>
        <Text style={[Typography.caption, { color: labelColor }]}>{title}</Text>
        <Text style={[Typography.caption, { color: labelColor }]}>{percent}%</Text>
      </View>
      <Text style={[Typography.caption, styles.progressStripHint, { color: labelColor }]} numberOfLines={1}>
        {hint}
      </Text>
      <View style={[styles.overallTrack, { backgroundColor: trackColor }]}>
        <View
          style={[styles.overallFill, { width: `${percent}%` as DimensionValue, backgroundColor: fillColor }]}
        />
      </View>
      {onPress ? (
        <Text style={[Typography.caption, styles.progressTapHint, { color: labelColor }]}>点击切换进度视图</Text>
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.progressStrip, style]}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.progressStrip, style, pressed && { opacity: 0.92 }]}
      accessibilityRole="button"
      accessibilityLabel="切换进度条视图"
      accessibilityHint="在总进度与存款进度之间切换">
      {body}
    </Pressable>
  );
}

function OverviewMetricColumn({
  label,
  showLeftBorder,
  borderColor,
  children,
}: {
  label: string;
  showLeftBorder?: boolean;
  borderColor: string;
  children: React.ReactNode;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.overviewCol, showLeftBorder && { borderLeftWidth: 1, borderLeftColor: borderColor }]}>
      <Text style={[Typography.caption, styles.overviewLabel, { color: colors.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[styles.overviewValueWrap, { minHeight: 28 }]}>{children}</View>
    </View>
  );
}

function AmountColumn({
  label,
  amount,
  color,
  showLeftBorder,
  borderColor,
}: {
  label: string;
  amount: number;
  color: string;
  showLeftBorder?: boolean;
  borderColor: string;
}) {
  return (
    <OverviewMetricColumn label={label} showLeftBorder={showLeftBorder} borderColor={borderColor}>
      <View style={styles.amountBaseline}>
        <Text style={[styles.currencySymbol, { color }]}>¥</Text>
        <Text style={[Typography.h3, styles.overviewAmount, { color }]} numberOfLines={1}>
          {formatIntAmount(amount)}
        </Text>
      </View>
    </OverviewMetricColumn>
  );
}

function DeadlineColumn({
  label,
  dateLabel,
  color,
  showLeftBorder,
  borderColor,
}: {
  label: string;
  dateLabel: string;
  color: string;
  showLeftBorder?: boolean;
  borderColor: string;
}) {
  return (
    <OverviewMetricColumn label={label} showLeftBorder={showLeftBorder} borderColor={borderColor}>
      <Text style={[Typography.bodyStrong, styles.deadlineValue, { color }]} numberOfLines={1}>
        {dateLabel}
      </Text>
    </OverviewMetricColumn>
  );
}

function OverviewEditSheet({
  visible,
  onClose,
  insetsBottom,
  savedAmount,
  targetAmount,
  endDateIso,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  insetsBottom: number;
  savedAmount: number;
  targetAmount: number;
  endDateIso: string | null;
  onSave: (payload: { savedAmount: number; targetAmount: number; endDateIso: string }) => Promise<void>;
}) {
  const { colors, isDark } = useAppTheme();
  const [savedText, setSavedText] = React.useState('');
  const [targetText, setTargetText] = React.useState('');
  const [endDate, setEndDate] = React.useState(() => new Date());
  const [showEndDatePicker, setShowEndDatePicker] = React.useState(false);

  React.useEffect(() => {
    if (!visible) return;
    setSavedText(String(Math.max(0, Math.round(savedAmount))));
    setTargetText(String(Math.max(0, Math.round(targetAmount))));
    setEndDate(endDateIso ? parseIsoDateLocal(endDateIso) : addCalendarDays(new Date(), 90));
    setShowEndDatePicker(false);
  }, [visible, savedAmount, targetAmount, endDateIso]);

  const handleEndDateChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowEndDatePicker(false);
    }
    if (event.type === 'dismissed') return;
    if (date) setEndDate(date);
  };

  const handleConfirm = async () => {
    const saved = parseInt(savedText.replace(/\D/g, ''), 10) || 0;
    const target = parseInt(targetText.replace(/\D/g, ''), 10) || 0;
    if (target > SAVINGS_PLAN_MAX_TARGET_AMOUNT) {
      Alert.alert('无法保存', `目标存款不得超过 ${SAVINGS_PLAN_MAX_TARGET_AMOUNT.toLocaleString('zh-CN')}。`);
      return;
    }
    if (saved > SAVINGS_PLAN_MAX_TARGET_AMOUNT) {
      Alert.alert('无法保存', `现有存款不得超过 ${SAVINGS_PLAN_MAX_TARGET_AMOUNT.toLocaleString('zh-CN')}。`);
      return;
    }
    try {
      await onSave({ savedAmount: saved, targetAmount: target, endDateIso: toIsoDate(endDate) });
      onClose();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '请稍后再试');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={sheetStyles.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[sheetStyles.overlay, { backgroundColor: colors.overlay }]}>
          <Pressable
            style={sheetStyles.backdrop}
            onPress={() => {
              Keyboard.dismiss();
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel="关闭"
          />
          <View
            style={[
              sheetStyles.card,
              { backgroundColor: colors.surface, paddingBottom: Math.max(Spacing['7xl'], insetsBottom + 88) },
            ]}>
            <Text style={[Typography.h3, { color: colors.text }]}>编辑总览</Text>
            <Text style={[Typography.caption, { color: colors.textSecondary, marginTop: Spacing.sm }]}>
              总览数据独立于下方心愿条目，修改不会影响各好物进度
            </Text>

            <View
              style={[
                sheetStyles.inputRow,
                sheetStyles.amountRow,
                { marginTop: Spacing['3xl'], backgroundColor: colors.input },
              ]}>
              <Text style={[Typography.body, { color: colors.textSecondary }]}>现有存款</Text>
              <Text style={[sheetStyles.amountYuan, { color: colors.text }]}>¥</Text>
              <TextInput
                style={[sheetStyles.amountInput, { color: colors.text }]}
                value={savedText}
                onChangeText={t => setSavedText(t.replace(/\D/g, '').slice(0, 8))}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
              />
            </View>

            <View style={[sheetStyles.inputRow, sheetStyles.amountRow, { backgroundColor: colors.input }]}>
              <Text style={[Typography.body, { color: colors.textSecondary }]}>目标存款</Text>
              <Text style={[sheetStyles.amountYuan, { color: colors.text }]}>¥</Text>
              <TextInput
                style={[sheetStyles.amountInput, { color: colors.text }]}
                value={targetText}
                onChangeText={t => setTargetText(t.replace(/\D/g, '').slice(0, 8))}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
              />
            </View>

            <Pressable
              style={({ pressed }) => [
                sheetStyles.inputRow,
                sheetStyles.inputRowPress,
                { backgroundColor: colors.input },
                pressed && { opacity: 0.92 },
              ]}
              onPress={() => {
                Keyboard.dismiss();
                setShowEndDatePicker(v => !v);
              }}>
              <Text style={[Typography.body, { color: colors.text }]}>截止时间</Text>
              <Text style={[Typography.bodyStrong, { color: colors.text }]}>{formatChineseDate(endDate)}</Text>
            </Pressable>

            <Pressable
              style={[
                sheetStyles.fab,
                { backgroundColor: colors.primary, bottom: Math.max(Spacing['5xl'], insetsBottom + Spacing.md) },
              ]}
              onPress={() => void handleConfirm()}
              accessibilityRole="button"
              accessibilityLabel="保存总览">
              <MaterialIcons name="check" size={26} color={colors.onPrimary} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {visible &&
        showEndDatePicker &&
        (Platform.OS === 'ios' ? (
          <View style={[StyleSheet.absoluteFill, { zIndex: 999, elevation: 99 }]} pointerEvents="box-none">
            <View style={sheetStyles.dateIosOverlay}>
              <Pressable
                style={[sheetStyles.dateIosScrim, { backgroundColor: colors.overlay }]}
                onPress={() => setShowEndDatePicker(false)}
                accessibilityLabel="关闭日期选择"
              />
              <View
                style={[
                  sheetStyles.dateIosSheet,
                  {
                    backgroundColor: colors.surface,
                    paddingBottom: Math.max(Spacing['3xl'], insetsBottom + Spacing.md),
                  },
                ]}>
                <View style={[sheetStyles.dateIosHeader, { borderBottomColor: colors.outline }]}>
                  <Text style={[Typography.title, { color: colors.text }]}>选择截止时间</Text>
                  <Pressable onPress={() => setShowEndDatePicker(false)} hitSlop={12}>
                    <Text style={[Typography.title, { color: colors.primary }]}>完成</Text>
                  </Pressable>
                </View>
                <DateTimePicker
                  value={endDate}
                  mode="date"
                  display="spinner"
                  themeVariant={isDark ? 'dark' : 'light'}
                  locale="zh_CN"
                  minimumDate={new Date()}
                  onChange={handleEndDateChange}
                />
              </View>
            </View>
          </View>
        ) : (
          <DateTimePicker
            value={endDate}
            mode="date"
            display="default"
            minimumDate={new Date()}
            onChange={handleEndDateChange}
          />
        ))}
    </Modal>
  );
}

export type SavingsOverviewCardProps = {
  /** 心愿/计划已存合计 */
  planSavedTotal: number;
  /** 心愿/计划目标合计 */
  planTargetTotal: number;
  /** 父页刷新时递增，用于重新加载总览设置 */
  refreshKey?: number;
  style?: StyleProp<ViewStyle>;
};

export function SavingsOverviewCard({
  planSavedTotal,
  planTargetTotal,
  refreshKey = 0,
  style,
}: SavingsOverviewCardProps) {
  const insets = useSafeAreaInsets();
  const { colors, shadows } = useAppTheme();
  const [overviewSettings, setOverviewSettings] = React.useState<SavingsOverviewSettings>({
    savedAmount: null,
    targetAmount: null,
    endDate: null,
  });
  const [overviewEditVisible, setOverviewEditVisible] = React.useState(false);
  const [topProgressMode, setTopProgressMode] = React.useState<TopOverviewProgressMode>('total');

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await loadSavingsOverviewSettings();
        if (!cancelled) setOverviewSettings(settings);
      } catch {
        if (!cancelled) {
          setOverviewSettings({ savedAmount: null, targetAmount: null, endDate: null });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const overviewSaved = Math.max(0, overviewSettings.savedAmount ?? 0);
  const overviewTarget = Math.max(0, overviewSettings.targetAmount ?? 0);
  const displayEndDateIso = overviewSettings.endDate;
  const displayEndDateLabel = displayEndDateIso ? formatIsoDateCompact(displayEndDateIso) : '未设置';

  const combinedSavedTotal = overviewSaved + Math.max(0, planSavedTotal);
  const combinedSavingsGoal = overviewTarget + Math.max(0, planTargetTotal);

  const totalProgressPct = progressPercent(combinedSavedTotal, combinedSavingsGoal);
  const depositProgressPct = progressPercent(overviewSaved, overviewTarget);

  const topProgressTitle = topProgressMode === 'total' ? '总进度' : '存款进度';
  const topProgressHint =
    topProgressMode === 'total'
      ? `已存 ¥${formatIntAmount(combinedSavedTotal)} / 总目标 ¥${formatIntAmount(combinedSavingsGoal)}`
      : `现有存款 ¥${formatIntAmount(overviewSaved)} / 目标存款 ¥${formatIntAmount(overviewTarget)}`;
  const topProgressPct = topProgressMode === 'total' ? totalProgressPct : depositProgressPct;

  const saveOverviewEdits = React.useCallback(
    async (payload: { savedAmount: number; targetAmount: number; endDateIso: string }) => {
      const nextSettings: SavingsOverviewSettings = {
        savedAmount: payload.savedAmount,
        targetAmount: payload.targetAmount,
        endDate: payload.endDateIso,
      };
      await saveSavingsOverviewSettings(nextSettings);
      setOverviewSettings(nextSettings);
    },
    [],
  );

  return (
    <>
      <AppCard style={[shadows.card, styles.overviewCard, style]}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width="100%" height="100%" viewBox="0 0 400 200" preserveAspectRatio="none">
            <Path d="M0,100 C100,200 200,0 400,100 L400,200 L0,200 Z" fill={colors.primary} fillOpacity={0.05} />
          </Svg>
        </View>

        <View style={styles.overviewCardHead}>
          <Text style={[Typography.caption, { color: colors.textSecondary }]}>存款总览</Text>
          <Pressable
            onPress={() => setOverviewEditVisible(true)}
            style={({ pressed }) => [
              styles.overviewEditChip,
              { backgroundColor: colors.capsule, borderColor: colors.outline },
              pressed && { opacity: 0.88 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="编辑存款总览">
            <MaterialIcons name="edit" size={15} color={colors.primary} />
            <Text style={[Typography.caption, { color: colors.primary, fontWeight: '700' }]}>编辑</Text>
          </Pressable>
        </View>

        <View style={styles.overviewRow}>
          <AmountColumn
            label="现有存款"
            amount={overviewSaved}
            color={colors.success}
            borderColor={colors.outline}
          />
          <AmountColumn
            label="目标存款"
            amount={overviewTarget}
            color={colors.primary}
            showLeftBorder
            borderColor={colors.outline}
          />
          <DeadlineColumn
            label="截止"
            dateLabel={displayEndDateLabel}
            color={colors.danger}
            showLeftBorder
            borderColor={colors.outline}
          />
        </View>

        <ProgressStrip
          title={topProgressTitle}
          hint={topProgressHint}
          percent={topProgressPct}
          trackColor={colors.progressTrack}
          fillColor={colors.primary}
          labelColor={colors.textSecondary}
          onPress={() => setTopProgressMode(m => (m === 'total' ? 'deposit' : 'total'))}
        />
      </AppCard>

      <OverviewEditSheet
        visible={overviewEditVisible}
        onClose={() => setOverviewEditVisible(false)}
        insetsBottom={insets.bottom}
        savedAmount={overviewSaved}
        targetAmount={overviewTarget}
        endDateIso={displayEndDateIso}
        onSave={saveOverviewEdits}
      />
    </>
  );
}

const sheetStyles = StyleSheet.create({
  kav: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    maxHeight: '92%',
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['5xl'],
    ...Shadows.sheet,
    position: 'relative',
    overflow: 'visible',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing['3xl'],
    paddingVertical: Spacing['2xl'],
    marginBottom: Spacing.xl,
    gap: Spacing.lg,
  },
  inputRowPress: {
    justifyContent: 'space-between',
  },
  dateIosOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  dateIosScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  dateIosSheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    overflow: 'hidden',
  },
  dateIosHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing['5xl'],
    paddingVertical: Spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  amountRow: {
    alignItems: 'center',
  },
  amountYuan: {
    fontSize: 28,
    fontWeight: '800',
    marginRight: 2,
    letterSpacing: -0.5,
  },
  amountInput: {
    flex: 1,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    paddingVertical: Spacing.xs,
    minWidth: 0,
  },
  fab: {
    position: 'absolute',
    right: Spacing['5xl'],
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.composer,
  },
});

const styles = StyleSheet.create({
  overviewCard: {
    overflow: 'hidden',
  },
  overviewCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing['3xl'],
    position: 'relative',
    zIndex: 10,
  },
  overviewEditChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  overviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    position: 'relative',
    zIndex: 10,
  },
  overviewCol: {
    flex: 1,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  amountBaseline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 2,
  },
  currencySymbol: {
    fontSize: 14,
    fontWeight: '600',
  },
  overviewLabel: {
    textAlign: 'center',
  },
  overviewValueWrap: {
    marginTop: 6,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  overviewAmount: {
    flexShrink: 1,
    maxWidth: '100%',
  },
  deadlineValue: {
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 20,
    width: '100%',
  },
  progressStrip: {
    marginTop: Spacing['5xl'],
    position: 'relative',
    zIndex: 10,
  },
  progressStripHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  progressStripHint: {
    marginBottom: 8,
    opacity: 0.92,
  },
  progressTapHint: {
    marginTop: 6,
    textAlign: 'center',
    opacity: 0.75,
  },
  overallTrack: {
    height: 6,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  overallFill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
});
