import { WishSavingsCoreForm } from '@/components/wish-savings/wish-savings-core-form';
import {
  defaultWishExtrasFormValue,
  wishExtrasFromRow,
  wishExtrasToSavePayload,
  WishSavingsWishExtrasFields,
  type WishExtrasFormValue,
} from '@/components/wish-savings/wish-savings-wish-extras-fields';
import { AppCard, ScreenHeader, ScreenHeaderIconAction } from '@/components/ui';
import { Layout, Radius, Shadows, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { makeTimestampEntityId } from '@/lib/entity-id';
import {
  addCalendarDays,
  formatChineseDate,
  parseIsoDateLocal,
  toIsoDate,
  validateWishSavingsForm,
} from '@/lib/wish-savings-form-utils';
import { consumeSavingsPlanLaunchIntent } from '@/lib/savings-plan-launch-intent';
import {
  createSavingsPlanWithLinkedWish,
  deleteLinkedWishForPlan,
  loadWishItemsByPlanId,
  repairWishSavingsLinks,
  updateSavingsPlanWithLinkedWish,
} from '@/lib/wish-savings-link';
import {
  clampWishDesireLevel,
  formatWishCategoryLabel,
  formatWishDesireLevelShort,
  wishReasonPreviewOrNull,
} from '@/lib/wish-list-present';
import type { WishItemRow } from '@/lib/repositories/wish-list/wish-list.types';
import {
  loadSavingsOverviewSettings,
  saveSavingsOverviewSettings,
  type SavingsOverviewSettings,
} from '@/lib/savings-overview-settings';
import {
  createSavingsPlanDeposit,
  getDepositSumsByActivePlanId,
  getTotalDepositsForActivePlans,
} from '@/lib/repositories/savings-plan/savings-plan-deposit';
import {
  deleteSavingsPlan,
  getSavingsPlans,
  SAVINGS_PLAN_MAX_TARGET_AMOUNT,
} from '@/lib/repositories/savings-plan/savings-plan';
import type { SavingsPlanRow } from '@/lib/repositories/savings-plan/savings-plan.types';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React from 'react';
import type { DimensionValue } from 'react-native';
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import Svg, { Circle, Path } from 'react-native-svg';

/** 表内存 ISO 日期（YYYY-MM-DD）展示为「YYYY年M月D日」；omitYearIf 与年份一致时省略年（用于同年区间后半段） */
function formatIsoDateChinese(iso: string, ctx?: { omitYearIf?: number }) {
  const parts = iso.split('-').map((x) => parseInt(x, 10));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return iso;
  if (ctx?.omitYearIf != null && y === ctx.omitYearIf) {
    return `${m}月${d}日`;
  }
  return `${y}年${m}月${d}日`;
}

/** 区间连接符两侧加零宽空格，便于窄屏在起止日期之间换行 */
const DATE_RANGE_SEP = '\u200B–\u200B';

function formatPlanDateRangeFromRow(row: SavingsPlanRow) {
  if (row.start_date === row.end_date) {
    return formatIsoDateChinese(row.start_date);
  }
  const ys = parseIsoDateLocal(row.start_date).getFullYear();
  const ye = parseIsoDateLocal(row.end_date).getFullYear();
  if (ys === ye) {
    return `${formatIsoDateChinese(row.start_date)}${DATE_RANGE_SEP}${formatIsoDateChinese(row.end_date, { omitYearIf: ys })}`;
  }
  return `${formatIsoDateChinese(row.start_date)}${DATE_RANGE_SEP}${formatIsoDateChinese(row.end_date)}`;
}

function formatIntAmount(value: number) {
  return Math.round(Math.abs(value)).toLocaleString('zh-CN');
}

/** 顶部截止时间紧凑展示，避免换行 */
function formatIsoDateCompact(iso: string) {
  const parts = iso.split('-').map((x) => parseInt(x, 10));
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

type PlanItem = {
  id: string;
  title: string;
  category: string;
  imageUri: string;
  saved: number;
  target: number;
};

/** 无自定义头像时的列表占位图 */
const FALLBACK_PLAN_IMAGE =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuBZh3IbumYj1NZF7mM9txvD3OOHRKxfFZYrvQEwMS1e-hQtY3iWH2FCFXDET16ODsrslPc_1G1uC8F-sGOc7XsbrIzukwCvUKp6Wxlg8nRiWiH_sLRasxgHUh3YaY4tzvOuX_UiIe5VcXSHAgcF_mT63qvQar64QN7lGhmEFB4XmKhqkQzbm2ZYhjM2CK6GQN1C6kHjQt0bzD1gCjHK1Sd8wcKbMGNd1skc6u4hZi823unUv9MRBdcAhF_Mqw2hjshvBxACmrQtuz7x';

function savingsPlanRowToPlanItem(row: SavingsPlanRow, savedTotal: number): PlanItem {
  return {
    id: row.id,
    title: row.name,
    category: formatPlanDateRangeFromRow(row),
    imageUri: row.avatar_uri || FALLBACK_PLAN_IMAGE,
    saved: savedTotal,
    target: row.target_amount,
  };
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
              总览数据独立于下方「我的计划」，修改不会影响各计划条目
            </Text>

            <View style={[sheetStyles.inputRow, sheetStyles.amountRow, { marginTop: Spacing['3xl'], backgroundColor: colors.input }]}>
              <Text style={[Typography.body, { color: colors.textSecondary }]}>现有存款</Text>
              <Text style={[sheetStyles.amountYuan, { color: colors.text }]}>¥</Text>
              <TextInput
                style={[sheetStyles.amountInput, { color: colors.text }]}
                value={savedText}
                onChangeText={(t) => setSavedText(t.replace(/\D/g, '').slice(0, 8))}
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
                onChangeText={(t) => setTargetText(t.replace(/\D/g, '').slice(0, 8))}
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
                setShowEndDatePicker((v) => !v);
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

      {visible && showEndDatePicker &&
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
                  { backgroundColor: colors.surface, paddingBottom: Math.max(Spacing['3xl'], insetsBottom + Spacing.md) },
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

function PlanDesireStars({
  level,
  activeColor,
  inactiveColor,
}: {
  level: number;
  activeColor: string;
  inactiveColor: string;
}) {
  const lv = clampWishDesireLevel(level);
  return (
    <View style={styles.planDesireStars} accessibilityLabel={`心动等级 ${lv} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <MaterialIcons
          key={i}
          name={i <= lv ? 'star' : 'star-border'}
          size={13}
          color={i <= lv ? activeColor : inactiveColor}
        />
      ))}
    </View>
  );
}

function PlanCard({
  row,
  savedTotal,
  linkedWish,
  onPress,
  onEditDeposit,
  onCompleteGoal,
}: {
  row: SavingsPlanRow;
  savedTotal: number;
  linkedWish?: WishItemRow | null;
  onPress: () => void;
  onEditDeposit: () => void;
  /** 长按编辑：一次性补足差额以达成目标 */
  onCompleteGoal: () => void;
}) {
  const { colors, isDark } = useAppTheme();
  const item = savingsPlanRowToPlanItem(row, savedTotal);
  /** 已达或超过目标时仍显示 100%（超额也算完成） */
  const pct = item.target > 0 ? Math.min(100, Math.round((item.saved / item.target) * 100)) : 0;
  const goalCompleted = item.target > 0 && item.saved >= item.target;

  const doneMuted = colors.textMuted;
  const goalDoneSurface = isDark ? colors.surfaceMuted : colors.capsule;
  const metaMuted = goalCompleted ? doneMuted : colors.textSecondary;
  const metaAccent = goalCompleted ? doneMuted : colors.primary;
  const starInactive = goalCompleted ? doneMuted : isDark ? 'rgba(148,163,184,0.35)' : 'rgba(148,163,184,0.55)';
  const categoryText = formatWishCategoryLabel(linkedWish?.category_label);
  const desireLevel = linkedWish ? linkedWish.desire_level : 3;
  const reasonPreview = wishReasonPreviewOrNull(linkedWish?.reason);
  const desireHighlight = !goalCompleted && clampWishDesireLevel(desireLevel) >= 4;

  return (
    <AppCard
      padded={false}
      style={[
        styles.planCard,
        desireHighlight && !goalCompleted && { borderLeftWidth: 3, borderLeftColor: colors.primary },
        goalCompleted && { backgroundColor: goalDoneSurface, opacity: 0.88, borderColor: colors.outline },
      ]}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.planCardTap, pressed && styles.planCardPressed]}
        accessibilityRole="button"
        accessibilityLabel={`编辑计划 ${item.title}`}>
        <View style={[styles.planThumbWrap, { backgroundColor: colors.capsule }, goalCompleted && { opacity: 0.65 }]}>
          <Image source={{ uri: item.imageUri }} style={styles.planThumb} resizeMode="cover" />
        </View>
        <View style={styles.planBody}>
          <Text
            style={[
              Typography.title,
              styles.planTitle,
              { color: goalCompleted ? doneMuted : colors.text },
              goalCompleted && styles.planTitleGoalDone,
              goalCompleted && Platform.OS === 'android' ? styles.planTitleGoalDoneAndroid : null,
            ]}
            numberOfLines={2}>
            {item.title}
          </Text>

          <View style={styles.planDateRow}>
            <MaterialIcons name="event" size={13} color={metaMuted} />
            <Text style={[Typography.caption, styles.planDateText, { color: metaMuted }]} numberOfLines={1}>
              {item.category}
            </Text>
          </View>

          <View
            style={[
              styles.planWishStrip,
              {
                backgroundColor: goalCompleted ? goalDoneSurface : isDark ? 'rgba(30,41,59,0.45)' : 'rgba(99,102,241,0.06)',
                borderColor: goalCompleted ? colors.outline : isDark ? 'rgba(148,163,184,0.12)' : 'rgba(99,102,241,0.12)',
              },
            ]}>
            <View style={styles.planWishStripMain}>
              <Text style={[styles.planWishCategory, { color: metaMuted }]} numberOfLines={1}>
                {categoryText}
              </Text>
              <View style={styles.planWishDot} />
              <PlanDesireStars level={desireLevel} activeColor={metaAccent} inactiveColor={starInactive} />
              <Text style={[styles.planWishLevelHint, { color: metaMuted }]}>
                {formatWishDesireLevelShort(desireLevel)}
              </Text>
            </View>
            {reasonPreview ? (
              <Text style={[styles.planWishReason, { color: metaMuted }]} numberOfLines={1}>
                {reasonPreview}
              </Text>
            ) : (
              <Text style={[styles.planWishReasonEmpty, { color: metaMuted }]} numberOfLines={1}>
                暂未填写心动理由
              </Text>
            )}
          </View>

          <View style={styles.planAmountRow}>
            <Text style={[Typography.caption, { color: goalCompleted ? doneMuted : colors.primary }]}>
              ¥{formatIntAmount(item.saved)}
            </Text>
            <Text style={[styles.planTargetHint, { color: goalCompleted ? doneMuted : colors.textSecondary }]}>
              / ¥{formatIntAmount(item.target)}
            </Text>
          </View>
          <View style={styles.planProgressCol}>
            <View style={[styles.planTrack, { backgroundColor: goalCompleted ? goalDoneSurface : colors.progressTrack }]}>
              <View
                style={[
                  styles.planFill,
                  { width: `${pct}%` as DimensionValue, backgroundColor: colors.primary },
                ]}
              />
            </View>
            <View style={styles.planPctRow}>
              <Text style={[styles.planPctBelow, { color: goalCompleted ? doneMuted : colors.textSecondary }]}>
                {pct}%
              </Text>
            </View>
          </View>
        </View>
      </Pressable>
      <Pressable
        onPress={onEditDeposit}
        onLongPress={goalCompleted ? undefined : onCompleteGoal}
        delayLongPress={450}
        style={({ pressed }) => [
          styles.planEditDepositBtn,
          { backgroundColor: colors.capsule, borderColor: colors.outline },
          pressed && { opacity: 0.88 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`编辑 ${item.title} 已存金额`}
        accessibilityHint={
          goalCompleted
            ? '可调整已存金额；长按不可用'
            : '点按调整存入或取出；长按可一次性补足差额达成目标'
        }>
        <MaterialIcons name="edit" size={22} color={colors.primary} />
      </Pressable>
    </AppCard>
  );
}

type PlanDepositSheetMode = 'deposit' | 'withdraw';

function PlanDepositSheet({
  visible,
  plan,
  savedTotal,
  targetAmount,
  goalCompleted,
  onClose,
  insetsBottom,
  onSubmit,
}: {
  visible: boolean;
  plan: SavingsPlanRow | null;
  savedTotal: number;
  targetAmount: number;
  goalCompleted: boolean;
  onClose: () => void;
  insetsBottom: number;
  /** 存入为正数，取出为负数 */
  onSubmit: (planId: string, signedAmount: number) => Promise<void>;
}) {
  const { colors } = useAppTheme();
  const [amountText, setAmountText] = React.useState('');
  const [mode, setMode] = React.useState<PlanDepositSheetMode>('deposit');
  const isWithdraw = mode === 'withdraw';
  const maxDepositAllowed =
    targetAmount > 0 ? Math.max(0, Math.round(targetAmount) - savedTotal) : SAVINGS_PLAN_MAX_TARGET_AMOUNT;

  React.useEffect(() => {
    if (!visible) return;
    setAmountText('');
    if (goalCompleted && savedTotal > 0) {
      setMode('withdraw');
    } else {
      setMode('deposit');
    }
  }, [visible, plan?.id, goalCompleted, savedTotal]);

  const handleConfirm = async () => {
    if (!plan) return;
    const n = parseInt(amountText.replace(/\D/g, ''), 10) || 0;
    if (n <= 0) {
      Alert.alert('提示', '请输入大于 0 的金额');
      return;
    }
    if (n > SAVINGS_PLAN_MAX_TARGET_AMOUNT) {
      Alert.alert(
        '提示',
        `单笔金额不得超过 ${SAVINGS_PLAN_MAX_TARGET_AMOUNT.toLocaleString('zh-CN')}（8 位数字）。`,
      );
      return;
    }
    if (isWithdraw && n > savedTotal) {
      Alert.alert('提示', `取出金额不能超过当前已存 ¥${formatIntAmount(savedTotal)}`);
      return;
    }
    if (!isWithdraw && targetAmount > 0 && n > maxDepositAllowed) {
      Alert.alert(
        '提示',
        maxDepositAllowed <= 0
          ? `已达到目标 ¥${formatIntAmount(targetAmount)}，无法继续存入`
          : `存入后不能超过目标 ¥${formatIntAmount(targetAmount)}，最多可再存 ¥${formatIntAmount(maxDepositAllowed)}`,
      );
      return;
    }
    const signed = isWithdraw ? -n : n;
    try {
      await onSubmit(plan.id, signed);
      onClose();
    } catch (e) {
      console.warn('PlanDepositSheet: submit failed', e);
      const raw = e instanceof Error ? e.message : '';
      let msg = raw || '请稍后再试';
      if (raw.includes('8 digit') || raw.includes('8 digits')) {
        msg = `单笔金额不得超过 ${SAVINGS_PLAN_MAX_TARGET_AMOUNT.toLocaleString('zh-CN')}。`;
      } else if (raw.includes('withdrawal exceeds') || raw.includes('exceeds saved')) {
        msg = '取出金额不能超过当前已存金额';
      } else if (raw.includes('deposit exceeds plan target')) {
        msg =
          targetAmount > 0
            ? `存入后不能超过目标 ¥${formatIntAmount(targetAmount)}`
            : '存入金额超过计划目标';
      }
      Alert.alert(isWithdraw ? '取出失败' : '存入失败', msg);
    }
  };

  const open = visible && plan != null;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
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
            <Text style={[Typography.h3, { color: colors.text }]}>调整已存</Text>
            <Text style={[Typography.body, { color: colors.textSecondary, marginTop: Spacing.sm }]} numberOfLines={2}>
              {plan?.name ?? ''}
            </Text>
            <Text style={[Typography.caption, { color: colors.textMuted, marginTop: Spacing.sm }]}>
              当前已存 ¥{formatIntAmount(savedTotal)}
              {targetAmount > 0 ? ` / 目标 ¥${formatIntAmount(targetAmount)}` : ''}
            </Text>
            {!isWithdraw && targetAmount > 0 && maxDepositAllowed > 0 ? (
              <Text style={[Typography.caption, { color: colors.primary, marginTop: 4 }]}>
                最多可再存 ¥{formatIntAmount(maxDepositAllowed)}
              </Text>
            ) : null}

            <View
              style={[
                sheetStyles.depositModeRow,
                { backgroundColor: colors.input, borderColor: colors.outline },
              ]}>
              <Pressable
                disabled={goalCompleted || maxDepositAllowed <= 0}
                onPress={() => setMode('deposit')}
                style={[
                  sheetStyles.depositModeChip,
                  mode === 'deposit' && { backgroundColor: colors.primary },
                  (goalCompleted || maxDepositAllowed <= 0) && { opacity: 0.45 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === 'deposit' }}>
                <Text
                  style={[
                    Typography.bodyStrong,
                    { color: mode === 'deposit' ? colors.onPrimary : colors.text },
                  ]}>
                  存入
                </Text>
              </Pressable>
              <Pressable
                disabled={savedTotal <= 0}
                onPress={() => setMode('withdraw')}
                style={[
                  sheetStyles.depositModeChip,
                  mode === 'withdraw' && { backgroundColor: colors.danger },
                  savedTotal <= 0 && { opacity: 0.45 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === 'withdraw' }}>
                <Text
                  style={[
                    Typography.bodyStrong,
                    { color: mode === 'withdraw' ? colors.onPrimary : colors.text },
                  ]}>
                  取出
                </Text>
              </Pressable>
            </View>
            <View
              style={[
                sheetStyles.inputRow,
                sheetStyles.amountRow,
                { marginTop: Spacing['3xl'], backgroundColor: colors.input },
              ]}>
              <Text style={[sheetStyles.amountYuan, { color: isWithdraw ? colors.danger : colors.text }]}>¥</Text>
              <TextInput
                style={[sheetStyles.amountInput, { color: colors.text }]}
                value={amountText}
                onChangeText={(t) => setAmountText(t.replace(/\D/g, '').slice(0, 8))}
                placeholder="金额"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
            <Pressable
              style={[
                sheetStyles.fab,
                {
                  backgroundColor: isWithdraw ? colors.danger : colors.primary,
                  bottom: Math.max(Spacing['5xl'], insetsBottom + Spacing.md),
                },
              ]}
              onPress={handleConfirm}
              accessibilityRole="button"
              accessibilityLabel={isWithdraw ? '确认取出' : '确认存入'}>
              <MaterialIcons name="check" size={26} color={colors.onPrimary} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PlanFormSheet({
  visible,
  onClose,
  insetsBottom,
  initialPlan,
  initialLinkedWish,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  insetsBottom: number;
  initialPlan: SavingsPlanRow | null;
  initialLinkedWish?: WishItemRow | null;
  onSaved: () => Promise<void>;
}) {
  const { colors } = useAppTheme();
  const [planName, setPlanName] = React.useState('');
  const [startDate, setStartDate] = React.useState(() => new Date());
  const [endDate, setEndDate] = React.useState(() => addCalendarDays(new Date(), 1));
  const [targetAmount, setTargetAmount] = React.useState('5000');
  const [planIconUri, setPlanIconUri] = React.useState<string | null>(null);
  const [wishExtras, setWishExtras] = React.useState<WishExtrasFormValue>(defaultWishExtrasFormValue);
  const initialIconUriRef = React.useRef<string | null | undefined>(undefined);

  const isEdit = initialPlan != null;

  React.useEffect(() => {
    if (!visible) return;
    if (initialPlan) {
      setPlanName(initialPlan.name);
      const s0 = parseIsoDateLocal(initialPlan.start_date);
      const e0 = parseIsoDateLocal(initialPlan.end_date);
      const minEnd0 = addCalendarDays(s0, 1);
      setStartDate(s0);
      setEndDate(e0.getTime() < minEnd0.getTime() ? minEnd0 : e0);
      setTargetAmount(String(Math.max(0, Math.round(initialPlan.target_amount))));
      setPlanIconUri(initialPlan.avatar_uri);
      initialIconUriRef.current = initialPlan.avatar_uri;
    } else {
      const s = new Date();
      setPlanName('');
      setStartDate(s);
      setEndDate(addCalendarDays(s, 1));
      setTargetAmount('5000');
      setPlanIconUri(null);
      initialIconUriRef.current = undefined;
    }
    setWishExtras(initialLinkedWish ? wishExtrasFromRow(initialLinkedWish) : defaultWishExtrasFormValue());
  }, [visible, initialPlan, initialLinkedWish]);

  const handleConfirm = async () => {
    const validated = validateWishSavingsForm(planName, startDate, endDate, targetAmount);
    if (!validated.ok) {
      Alert.alert('无法保存', validated.message);
      return;
    }

    const { name, start_date, end_date, target_amount } = validated.value;
    const wishPayload = wishExtrasToSavePayload(wishExtras);
    const linkedInput = {
      name,
      start_date,
      end_date,
      target_amount,
      avatar_uri: planIconUri,
      ...wishPayload,
    };

    try {
      if (initialPlan) {
        await updateSavingsPlanWithLinkedWish(initialPlan.id, linkedInput, {
          avatarChanged: planIconUri !== initialIconUriRef.current,
        });
      } else {
        await createSavingsPlanWithLinkedWish(
          {
            id: makeTimestampEntityId('ssp_', 8),
            name,
            start_date,
            end_date,
            target_amount,
            avatar_uri: planIconUri,
          },
          wishPayload,
        );
      }
      await onSaved();
      onClose();
    } catch (e) {
      console.warn('PlanFormSheet: submit failed', e);
      const raw = e instanceof Error ? e.message : '';
      const msg =
        raw.includes('8 digit') || raw.includes('8 digits')
          ? `目标金额不得超过 8 位数（最大 ${SAVINGS_PLAN_MAX_TARGET_AMOUNT.toLocaleString('zh-CN')}）。`
          : raw.includes('at least 1 day') || raw.includes('date span')
            ? '日期跨度至少为 1 天。'
            : raw || '请稍后再试';
      Alert.alert(isEdit ? '保存失败' : '创建失败', msg);
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
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={sheetStyles.cardScroll}>
              <WishSavingsCoreForm
                formTitle={isEdit ? '编辑存钱计划' : '自由存钱计划'}
                name={planName}
                onNameChange={setPlanName}
                namePlaceholder="输入你的存钱计划"
                startDate={startDate}
                endDate={endDate}
                onStartDateChange={setStartDate}
                onEndDateChange={setEndDate}
                targetAmount={targetAmount}
                onTargetAmountChange={setTargetAmount}
                iconUri={planIconUri}
                onIconUriChange={setPlanIconUri}
                insetsBottom={insetsBottom}
              />
              <WishSavingsWishExtrasFields
                value={wishExtras}
                onChange={setWishExtras}
                collapsible={false}
                sectionTitle="心愿信息"
              />
            </ScrollView>

            <Pressable
              style={[
                sheetStyles.fab,
                { backgroundColor: colors.primary, bottom: Math.max(Spacing['5xl'], insetsBottom + Spacing.md) },
              ]}
              onPress={handleConfirm}
              accessibilityRole="button"
              accessibilityLabel={isEdit ? '保存' : '确认创建'}>
              <MaterialIcons name="check" size={26} color={colors.onPrimary} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const PAGE_API_KEY = 'savings-plan';

export default function SavingsPlanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, shadows } = useAppTheme();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const [planRows, setPlanRows] = React.useState<SavingsPlanRow[]>([]);
  const [depositByPlanId, setDepositByPlanId] = React.useState<Record<string, number>>({});
  const [wishByPlanId, setWishByPlanId] = React.useState<Record<string, WishItemRow>>({});
  const [totalDeposits, setTotalDeposits] = React.useState(0);
  const [planFormVisible, setPlanFormVisible] = React.useState(false);
  const [planFormInitial, setPlanFormInitial] = React.useState<SavingsPlanRow | null>(null);
  const [depositSheetPlan, setDepositSheetPlan] = React.useState<SavingsPlanRow | null>(null);
  const [overviewSettings, setOverviewSettings] = React.useState<SavingsOverviewSettings>({
    savedAmount: null,
    targetAmount: null,
    endDate: null,
  });
  const [overviewEditVisible, setOverviewEditVisible] = React.useState(false);
  const [topProgressMode, setTopProgressMode] = React.useState<TopOverviewProgressMode>('total');

  const refreshPlansAndDeposits = React.useCallback(async () => {
    await wrapLoad(async () => {
    try {
      const [rows, settings] = await Promise.all([getSavingsPlans(), loadSavingsOverviewSettings()]);
      setPlanRows(rows);
      setOverviewSettings(settings);
      const [sums, total, wishesByPlan] = await Promise.all([
        getDepositSumsByActivePlanId(),
        getTotalDepositsForActivePlans(),
        loadWishItemsByPlanId(),
      ]);
      setDepositByPlanId(sums);
      setTotalDeposits(total);
      setWishByPlanId(wishesByPlan);
    } catch (e) {
      console.warn('SavingsPlan: refresh plans/deposits failed', e);
      setPlanRows([]);
      setDepositByPlanId({});
      setWishByPlanId({});
      setTotalDeposits(0);
    }
    });
  }, [wrapLoad]);

  React.useEffect(() => {
    void refreshPlansAndDeposits();
  }, [refreshPlansAndDeposits]);

  useFocusEffect(
    React.useCallback(() => {
      void (async () => {
        await repairWishSavingsLinks();
        await refreshPlansAndDeposits();
      })();
      const intent = consumeSavingsPlanLaunchIntent();
      if (intent?.openAddPlan) {
        setPlanFormInitial(null);
        setPlanFormVisible(true);
      }
    }, [refreshPlansAndDeposits]),
  );

  /** 与 savings_plans 表一致：所有计划目标金额之和 */
  const plansTargetTotal = React.useMemo(
    () => planRows.reduce((sum, r) => sum + Math.max(0, r.target_amount), 0),
    [planRows],
  );
  /** 顶部总览存款/目标，与各计划数据隔离 */
  const overviewSaved = Math.max(0, overviewSettings.savedAmount ?? 0);
  const overviewTarget = Math.max(0, overviewSettings.targetAmount ?? 0);
  /** 各计划存入与目标之和 */
  const planSavedTotal = Math.max(0, totalDeposits);
  const planTargetTotal = plansTargetTotal;

  const displayEndDateIso = overviewSettings.endDate;
  const displayEndDateLabel = displayEndDateIso ? formatIsoDateCompact(displayEndDateIso) : '未设置';

  /** 总进度：已存 = 现有存款 + 计划已存；目标 = 目标存款 + 计划目标之和 */
  const combinedSavedTotal = overviewSaved + planSavedTotal;
  const combinedSavingsGoal = overviewTarget + planTargetTotal;

  const totalProgressPct = progressPercent(combinedSavedTotal, combinedSavingsGoal);
  const depositProgressPct = progressPercent(overviewSaved, overviewTarget);
  const plansProgressPct = progressPercent(planSavedTotal, planTargetTotal);

  const topProgressTitle = topProgressMode === 'total' ? '总进度' : '存款进度';
  const topProgressHint =
    topProgressMode === 'total'
      ? `已存 ¥${formatIntAmount(combinedSavedTotal)} / 总目标 ¥${formatIntAmount(combinedSavingsGoal)}`
      : `现有存款 ¥${formatIntAmount(overviewSaved)} / 目标存款 ¥${formatIntAmount(overviewTarget)}`;
  const topProgressPct = topProgressMode === 'total' ? totalProgressPct : depositProgressPct;

  const toggleTopProgressMode = () => {
    setTopProgressMode((m) => (m === 'total' ? 'deposit' : 'total'));
  };

  /** 未完成在前、已完成置底；组内均按截止时间 end_date 升序（最近截止的在前） */
  const sortedPlanRowsForList = React.useMemo(() => {
    const incomplete: SavingsPlanRow[] = [];
    const completed: SavingsPlanRow[] = [];
    for (const row of planRows) {
      const saved = depositByPlanId[row.id] ?? 0;
      const done = row.target_amount > 0 && saved >= row.target_amount;
      if (done) completed.push(row);
      else incomplete.push(row);
    }
    const byDeadlineAsc = (a: SavingsPlanRow, b: SavingsPlanRow) => {
      if (a.end_date < b.end_date) return -1;
      if (a.end_date > b.end_date) return 1;
      return 0;
    };
    incomplete.sort(byDeadlineAsc);
    completed.sort(byDeadlineAsc);
    return [...incomplete, ...completed];
  }, [planRows, depositByPlanId]);

  const onAddPlan = () => {
    setPlanFormInitial(null);
    setPlanFormVisible(true);
  };

  const openOverviewEdit = () => setOverviewEditVisible(true);

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

  const closePlanForm = () => {
    setPlanFormVisible(false);
    setPlanFormInitial(null);
  };

  /** 长按加号：按当前已存与目标差额存入一笔，使进度达成 100%（受单笔上限约束） */
  const completePlanGoal = React.useCallback(
    async (row: SavingsPlanRow) => {
      const saved = depositByPlanId[row.id] ?? 0;
      const target = row.target_amount;
      const gap = Math.max(0, Math.ceil(target - saved));
      if (gap <= 0) {
        Alert.alert('提示', '已达到或超过目标金额。');
        return;
      }
      if (gap > SAVINGS_PLAN_MAX_TARGET_AMOUNT) {
        Alert.alert(
          '无法一次完成',
          `距目标还差 ¥${formatIntAmount(gap)}，超过单笔存入上限，请点加号分多次存入。`,
        );
        return;
      }
      try {
        await createSavingsPlanDeposit({
          id: makeTimestampEntityId('ssd_', 8),
          savings_plan_id: row.id,
          amount: gap,
        });
        await refreshPlansAndDeposits();
      } catch (e) {
        console.warn('SavingsPlan: complete goal deposit failed', e);
        Alert.alert('存入失败', e instanceof Error ? e.message : '请稍后再试');
      }
    },
    [depositByPlanId, refreshPlansAndDeposits],
  );

  const confirmDeletePlan = React.useCallback(
    (row: SavingsPlanRow) => {
      Alert.alert('删除计划', `确定删除「${row.name}」？关联的心愿条目将一并删除，删除后无法恢复。`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteLinkedWishForPlan(row);
              await deleteSavingsPlan(row.id);
              if (planFormInitial?.id === row.id) {
                closePlanForm();
              }
              await refreshPlansAndDeposits();
            } catch (e) {
              console.warn('SavingsPlan: delete plan failed', e);
              Alert.alert('删除失败', e instanceof Error ? e.message : '请稍后再试');
            }
          },
        },
      ]);
    },
    [planFormInitial, closePlanForm, refreshPlansAndDeposits],
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <ScreenHeader
        title="存钱计划"
        onBack={() => router.back()}
        right={
          <ScreenHeaderIconAction icon="add" onPress={onAddPlan} accessibilityLabel="添加存款计划" />
        }
      />

      <ScrollView
        style={styles.mainScroll}
        contentContainerStyle={[
          styles.mainContent,
          {
            paddingBottom: Spacing['6xl'] + insets.bottom,
            maxWidth: Layout.contentMaxWidth,
            alignSelf: 'center',
            width: '100%',
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <View style={styles.sectionPad}>
          <AppCard style={[shadows.card, styles.overviewCard]}>
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <Svg width="100%" height="100%" viewBox="0 0 400 200" preserveAspectRatio="none">
                <Path d="M0,100 C100,200 200,0 400,100 L400,200 L0,200 Z" fill={colors.primary} fillOpacity={0.05} />
              </Svg>
            </View>

            <View style={styles.overviewCardHead}>
              <Text style={[Typography.caption, { color: colors.textSecondary }]}>存款总览</Text>
              <Pressable
                onPress={openOverviewEdit}
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
              onPress={toggleTopProgressMode}
            />
          </AppCard>
        </View>

        <View style={styles.plansSectionWrap}>
          <AppCard style={[shadows.card, styles.plansCard]}>
            <View style={styles.plansCardHeader}>
              <View style={[styles.plansSectionAccent, { backgroundColor: colors.primary }]} />
              <View style={styles.plansTitleBlock}>
                <Text style={[Typography.h3, { color: colors.text }]}>我的计划</Text>
                <Text style={[Typography.caption, { color: colors.textSecondary, marginTop: 4 }]}>
                  {planRows.length > 0
                    ? `共 ${planRows.length} 项 · 与心愿单目标好物一一对应`
                    : '添加具体目标并跟踪存入，同步至「我的」心愿单'}
                </Text>
              </View>
            </View>

            <View style={[styles.plansCardDivider, { backgroundColor: colors.outline }]} />

            <ProgressStrip
              title="计划进度"
              hint={`计划已存 ¥${formatIntAmount(planSavedTotal)} / 计划目标 ¥${formatIntAmount(planTargetTotal)}`}
              percent={plansProgressPct}
              trackColor={colors.progressTrack}
              fillColor={colors.success}
              labelColor={colors.textSecondary}
              style={styles.plansProgressStrip}
            />

            <View style={styles.planList}>
              {planRows.length === 0 ? (
                <View style={[styles.emptyPlansBox, { backgroundColor: colors.surfaceMuted, borderColor: colors.outline }]}>
                  <MaterialIcons name="playlist-add" size={32} color={colors.textMuted} />
                  <Text style={[Typography.body, styles.emptyPlansHint, { color: colors.textSecondary }]}>
                    暂无计划，点击右上角添加
                  </Text>
                </View>
              ) : (
                sortedPlanRowsForList.map((row) => (
                  <Swipeable
                    key={row.id}
                    overshootRight={false}
                    rightThreshold={44}
                    renderRightActions={() => (
                      <Pressable
                        onPress={() => confirmDeletePlan(row)}
                        style={[styles.swipeDeleteAction, { backgroundColor: colors.danger }]}
                        accessibilityRole="button"
                        accessibilityLabel={`删除计划 ${row.name}`}>
                        <MaterialIcons name="delete" size={22} color={colors.onPrimary} />
                        <Text style={[styles.swipeDeleteText, { color: colors.onPrimary }]}>删除</Text>
                      </Pressable>
                    )}>
                    <PlanCard
                      row={row}
                      savedTotal={depositByPlanId[row.id] ?? 0}
                      linkedWish={wishByPlanId[row.id] ?? null}
                      onPress={() => {
                        setPlanFormInitial(row);
                        setPlanFormVisible(true);
                      }}
                    onEditDeposit={() => setDepositSheetPlan(row)}
                    onCompleteGoal={() => void completePlanGoal(row)}
                    />
                  </Swipeable>
                ))
              )}
            </View>
          </AppCard>
        </View>
      </ScrollView>

      <PlanFormSheet
        visible={planFormVisible}
        onClose={closePlanForm}
        insetsBottom={insets.bottom}
        initialPlan={planFormInitial}
        initialLinkedWish={planFormInitial ? (wishByPlanId[planFormInitial.id] ?? null) : null}
        onSaved={refreshPlansAndDeposits}
      />

      <PlanDepositSheet
        visible={depositSheetPlan != null}
        plan={depositSheetPlan}
        savedTotal={depositSheetPlan ? (depositByPlanId[depositSheetPlan.id] ?? 0) : 0}
        targetAmount={depositSheetPlan?.target_amount ?? 0}
        goalCompleted={
          depositSheetPlan
            ? depositSheetPlan.target_amount > 0 &&
              (depositByPlanId[depositSheetPlan.id] ?? 0) >= depositSheetPlan.target_amount
            : false
        }
        onClose={() => setDepositSheetPlan(null)}
        insetsBottom={insets.bottom}
        onSubmit={async (planId, signedAmount) => {
          await createSavingsPlanDeposit({
            id: makeTimestampEntityId('ssd_', 8),
            savings_plan_id: planId,
            amount: signedAmount,
            note: signedAmount < 0 ? '取出' : null,
          });
          await refreshPlansAndDeposits();
        }}
      />

      <OverviewEditSheet
        visible={overviewEditVisible}
        onClose={() => setOverviewEditVisible(false)}
        insetsBottom={insets.bottom}
        savedAmount={overviewSaved}
        targetAmount={overviewTarget}
        endDateIso={displayEndDateIso}
        onSave={saveOverviewEdits}
      />
    </SafeAreaView>
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
  cardScroll: {
    paddingBottom: 8,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 22,
  },
  sheetTitleWrap: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 76,
    paddingHorizontal: 8,
  },
  sheetHeadSpacer: {
    width: 76,
  },
  iconBlock: {
    width: 76,
    height: 76,
    borderRadius: Radius.sheet,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...Shadows.card,
  },
  iconImage: {
    width: '100%',
    height: '100%',
  },
  iconCameraBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
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
  rowInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    paddingVertical: Platform.OS === 'android' ? 8 : 6,
    minHeight: Platform.OS === 'android' ? 40 : 36,
    fontWeight: '500',
    lineHeight: 22,
    ...Platform.select({
      android: { textAlignVertical: 'center' as const },
    }),
  },
  rowInputRight: {
    fontSize: 14,
    paddingVertical: 0,
    minWidth: 96,
  },
  vaultBtn: {
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
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
  depositModeRow: {
    flexDirection: 'row',
    marginTop: Spacing['3xl'],
    marginBottom: Spacing.xl,
    padding: 4,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  depositModeChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.lg,
    borderRadius: Radius.pill,
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
  tagBtn: {
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing.lg,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
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
  safe: {
    flex: 1,
  },
  mainScroll: {
    flex: 1,
  },
  mainContent: {
    flexGrow: 1,
  },
  sectionPad: {
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['5xl'],
    paddingBottom: Spacing.md,
  },
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
  plansSectionWrap: {
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['4xl'],
    paddingBottom: Spacing['5xl'],
  },
  plansCard: {
    overflow: 'hidden',
  },
  plansCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  plansSectionAccent: {
    width: 3,
    height: 24,
    borderRadius: Radius.sm,
    marginRight: Spacing.lg,
    marginTop: 4,
  },
  plansTitleBlock: {
    flex: 1,
  },
  plansCardDivider: {
    height: StyleSheet.hairlineWidth,
    marginTop: Spacing['3xl'],
    marginBottom: Spacing['3xl'],
    opacity: 0.65,
  },
  plansProgressStrip: {
    marginTop: 0,
    marginBottom: Spacing['4xl'],
  },
  planList: {
    gap: Spacing['3xl'],
  },
  emptyPlansBox: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
    paddingVertical: Spacing['5xl'],
    paddingHorizontal: Spacing['3xl'],
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyPlansHint: {
    textAlign: 'center',
  },
  swipeDeleteAction: {
    width: 86,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.xl,
    marginLeft: Spacing.xl,
    marginVertical: 2,
    gap: Spacing.xs,
  },
  swipeDeleteText: {
    fontSize: 12,
    fontWeight: '800',
  },
  planCard: {
    paddingVertical: Spacing.lg,
    paddingLeft: Spacing['3xl'],
    paddingRight: Spacing.lg,
    flexDirection: 'row',
    gap: Spacing.lg,
    alignItems: 'stretch',
  },
  planTitleGoalDone: {
    textDecorationLine: 'line-through',
    textDecorationStyle: 'solid',
    lineHeight: 20,
    paddingVertical: 0,
  },
  planTitleGoalDoneAndroid: {
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  planCardTap: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.lg,
    alignItems: 'flex-start',
    minWidth: 0,
  },
  planCardPressed: {
    opacity: 0.92,
  },
  planEditDepositBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    marginLeft: Spacing.sm,
    alignSelf: 'center',
  },
  planThumbWrap: {
    width: 72,
    height: 72,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    marginTop: 2,
  },
  planThumb: {
    width: '100%',
    height: '100%',
  },
  planBody: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  planTitle: {
    lineHeight: 22,
  },
  planDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  planDateText: {
    flex: 1,
    fontSize: 11,
  },
  planWishStrip: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 4,
    marginTop: 2,
  },
  planWishStripMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  planWishCategory: {
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
  },
  planWishDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(148,163,184,0.55)',
  },
  planDesireStars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  planWishLevelHint: {
    fontSize: 10,
    fontWeight: '600',
  },
  planWishReason: {
    fontSize: 11,
    lineHeight: 16,
    fontStyle: 'italic',
  },
  planWishReasonEmpty: {
    fontSize: 10,
    lineHeight: 14,
    opacity: 0.75,
  },
  planAmountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginTop: 4,
    marginBottom: 6,
  },
  planTargetHint: {
    fontSize: 10,
  },
  planProgressCol: {
    width: '100%',
  },
  planTrack: {
    width: '100%',
    height: 6,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  planFill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
  planPctRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  planPctBelow: {
    fontSize: 10,
    fontWeight: '600',
  },
});
