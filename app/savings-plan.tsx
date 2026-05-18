import { AppCard, ScreenHeader, ScreenHeaderIconAction } from '@/components/ui';
import { Layout, Radius, Shadows, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  createSavingsPlanDeposit,
  getDepositSumsByActivePlanId,
  getTotalDepositsForActivePlans,
} from '@/lib/repositories/savings-plan/savings-plan-deposit';
import {
  createSavingsPlan,
  deleteSavingsPlan,
  getSavingsPlans,
  SAVINGS_PLAN_MAX_TARGET_AMOUNT,
  updateSavingsPlan,
} from '@/lib/repositories/savings-plan/savings-plan';
import type {
  CreateSavingsPlanInput,
  SavingsPlanRow,
  UpdateSavingsPlanInput,
} from '@/lib/repositories/savings-plan/savings-plan.types';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
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

function formatChineseDate(d: Date) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function toIsoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 本地日历解析 YYYY-MM-DD，避免 UTC 偏移导致日期错一天 */
function parseIsoDateLocal(iso: string) {
  const parts = iso.split('-').map((x) => parseInt(x, 10));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

function addCalendarDays(d: Date, days: number) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + days);
  return x;
}

function daysBetweenIso(startIso: string, endIso: string) {
  const s = parseIsoDateLocal(startIso);
  const e = parseIsoDateLocal(endIso);
  const ms = e.getTime() - s.getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

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
  const { colors } = useAppTheme();
  return (
    <View style={[styles.overviewCol, showLeftBorder && { borderLeftWidth: 1, borderLeftColor: borderColor }]}>
      <Text style={[Typography.caption, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.amountBaseline}>
        <Text style={[styles.currencySymbol, { color }]}>¥</Text>
        <Text style={[Typography.h3, { color }]}>{formatIntAmount(amount)}</Text>
      </View>
    </View>
  );
}

function PlanCard({
  row,
  savedTotal,
  onPress,
  onAddDeposit,
  onCompleteGoal,
}: {
  row: SavingsPlanRow;
  savedTotal: number;
  onPress: () => void;
  onAddDeposit: () => void;
  /** 长按加号：一次性补足差额以达成目标 */
  onCompleteGoal: () => void;
}) {
  const { colors, isDark } = useAppTheme();
  const item = savingsPlanRowToPlanItem(row, savedTotal);
  /** 已达或超过目标时仍显示 100%（超额也算完成） */
  const pct = item.target > 0 ? Math.min(100, Math.round((item.saved / item.target) * 100)) : 0;
  const goalCompleted = item.target > 0 && item.saved >= item.target;

  const doneMuted = colors.textMuted;
  const goalDoneSurface = isDark ? colors.surfaceMuted : colors.capsule;

  return (
    <AppCard
      padded={false}
      style={[
        styles.planCard,
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
          <View style={styles.planHeaderBlock}>
            <Text
              style={[
                Typography.title,
                { color: goalCompleted ? doneMuted : colors.text },
                goalCompleted && styles.planTitleGoalDone,
                goalCompleted && Platform.OS === 'android' ? styles.planTitleGoalDoneAndroid : null,
              ]}
              numberOfLines={2}>
              {item.title}
            </Text>
            <View
              style={[
                styles.categoryPill,
                styles.planDatePill,
                { backgroundColor: goalCompleted ? goalDoneSurface : colors.capsule },
              ]}>
              <Text style={[Typography.caption, { color: goalCompleted ? doneMuted : colors.textSecondary }]}>
                {item.category}
              </Text>
            </View>
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
        disabled={goalCompleted}
        onPress={onAddDeposit}
        onLongPress={onCompleteGoal}
        delayLongPress={450}
        style={({ pressed }) => [
          styles.planAddDepositBtn,
          { backgroundColor: goalCompleted ? goalDoneSurface : colors.capsule },
          !goalCompleted && pressed && { opacity: 0.85 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`向 ${item.title} 存入一笔`}
        accessibilityHint={goalCompleted ? '计划已完成，无法继续存入' : '长按可一次性补足差额达成目标'}
        accessibilityState={{ disabled: goalCompleted }}
      >
        <MaterialIcons name="add" size={24} color={goalCompleted ? doneMuted : colors.success} />
      </Pressable>
    </AppCard>
  );
}

function AddDepositSheet({
  visible,
  plan,
  onClose,
  insetsBottom,
  onSubmit,
}: {
  visible: boolean;
  plan: SavingsPlanRow | null;
  onClose: () => void;
  insetsBottom: number;
  onSubmit: (planId: string, amount: number) => Promise<void>;
}) {
  const { colors } = useAppTheme();
  const [amountText, setAmountText] = React.useState('');

  React.useEffect(() => {
    if (visible) {
      setAmountText('');
    }
  }, [visible, plan?.id]);

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
        `单笔存入不得超过 ${SAVINGS_PLAN_MAX_TARGET_AMOUNT.toLocaleString('zh-CN')}（8 位数字）。`,
      );
      return;
    }
    try {
      await onSubmit(plan.id, n);
      onClose();
    } catch (e) {
      console.warn('AddDepositSheet: submit failed', e);
      const raw = e instanceof Error ? e.message : '';
      const msg =
        raw.includes('8 digit') || raw.includes('8 digits')
          ? `单笔存入不得超过 ${SAVINGS_PLAN_MAX_TARGET_AMOUNT.toLocaleString('zh-CN')}。`
          : raw || '请稍后再试';
      Alert.alert('存入失败', msg);
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
            <Text style={[Typography.h3, { color: colors.text }]}>存入一笔</Text>
            <Text style={[Typography.body, { color: colors.textSecondary, marginTop: Spacing.sm }]} numberOfLines={2}>
              {plan?.name ?? ''}
            </Text>
            <View
              style={[
                sheetStyles.inputRow,
                sheetStyles.amountRow,
                { marginTop: Spacing['3xl'], backgroundColor: colors.input },
              ]}>
              <Text style={[sheetStyles.amountYuan, { color: colors.text }]}>¥</Text>
              <TextInput
                style={[sheetStyles.amountInput, { color: colors.text }]}
                value={amountText}
                onChangeText={(t) => setAmountText(t.replace(/\D/g, '').slice(0, 8))}
                placeholder="金额"
                placeholderTextColor={colors.textMuted}
                keyboardType="default"
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
            <Pressable
              style={[
                sheetStyles.fab,
                { backgroundColor: colors.primary, bottom: Math.max(Spacing['5xl'], insetsBottom + Spacing.md) },
              ]}
              onPress={handleConfirm}
              accessibilityRole="button"
              accessibilityLabel="确认存入">
              <MaterialIcons name="check" size={26} color={colors.onPrimary} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DefaultPlanIconSvg() {
  const { colors } = useAppTheme();
  return (
    <Svg width={52} height={52} viewBox="0 0 56 56">
      <Path
        d="M14 22h28c2 0 4 2 4 4v18c0 3-2 5-5 5H15c-3 0-5-2-5-5V26c0-2 2-4 4-4z"
        fill={colors.primary}
      />
      <Path d="M22 22 V14 a6 6 0 0 1 12 0v8" fill={colors.primarySoft} />
      <Circle cx={42} cy={14} r={5.5} fill={colors.primaryRing} />
      <Circle cx={46} cy={20} r={4} fill={colors.primaryMuted} />
    </Svg>
  );
}

function PlanIconButton({
  uri,
  onPickImage,
}: {
  uri: string | null;
  onPickImage: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPickImage}
      style={({ pressed }) => [
        sheetStyles.iconBlock,
        { backgroundColor: colors.surfaceMuted },
        pressed && { opacity: 0.88 },
      ]}
      accessibilityRole="button"
      accessibilityLabel="上传计划图标">
      {uri ? <Image source={{ uri }} style={sheetStyles.iconImage} resizeMode="cover" /> : <DefaultPlanIconSvg />}
      <View style={sheetStyles.iconCameraBadge} pointerEvents="none">
        <MaterialIcons name="photo-camera" size={14} color="#fff" />
      </View>
    </Pressable>
  );
}

function PlanFormSheet({
  visible,
  onClose,
  insetsBottom,
  initialPlan,
  onCreate,
  onUpdate,
}: {
  visible: boolean;
  onClose: () => void;
  insetsBottom: number;
  /** 非 null 时为编辑模式，表单从该记录初始化 */
  initialPlan: SavingsPlanRow | null;
  onCreate: (input: CreateSavingsPlanInput) => Promise<void>;
  onUpdate: (id: string, input: UpdateSavingsPlanInput) => Promise<void>;
}) {
  const { colors, isDark } = useAppTheme();
  const [planName, setPlanName] = React.useState('');
  const [startDate, setStartDate] = React.useState(() => new Date());
  const [endDate, setEndDate] = React.useState(() => addCalendarDays(new Date(), 1));
  const [targetAmount, setTargetAmount] = React.useState('5000');
  const [showStartDatePicker, setShowStartDatePicker] = React.useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = React.useState(false);
  const [planIconUri, setPlanIconUri] = React.useState<string | null>(null);

  const minEndDateForPicker = React.useMemo(() => addCalendarDays(startDate, 1), [startDate]);

  const isEdit = initialPlan != null;

  const pickPlanIcon = React.useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('权限不足', '需要相册权限才能选择图片作为图标');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setPlanIconUri(result.assets[0].uri);
    }
  }, []);

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
      setShowStartDatePicker(false);
      setShowEndDatePicker(false);
    } else {
      const s = new Date();
      setPlanName('');
      setStartDate(s);
      setEndDate(addCalendarDays(s, 1));
      setTargetAmount('5000');
      setShowStartDatePicker(false);
      setShowEndDatePicker(false);
      setPlanIconUri(null);
    }
  }, [visible, initialPlan]);

  React.useEffect(() => {
    if (!visible) {
      setShowStartDatePicker(false);
      setShowEndDatePicker(false);
    }
  }, [visible]);

  const closeDatePickerOverlay = React.useCallback(() => {
    setShowStartDatePicker(false);
    setShowEndDatePicker(false);
  }, []);

  const handleStartDateChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowStartDatePicker(false);
    }
    if (event.type === 'dismissed') return;
    if (!date) return;
    setStartDate(date);
    setEndDate((prev) => {
      const minEnd = addCalendarDays(date, 1);
      return prev.getTime() < minEnd.getTime() ? minEnd : prev;
    });
  };

  const handleEndDateChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowEndDatePicker(false);
    }
    if (event.type === 'dismissed') return;
    if (date) setEndDate(date);
  };

  const handleConfirm = async () => {
    const name = planName.trim() || '存钱计划';
    const amount = parseInt(targetAmount.replace(/\D/g, ''), 10) || 0;

    const start_iso = toIsoDate(startDate);
    const end_iso = toIsoDate(endDate);

    if (daysBetweenIso(start_iso, end_iso) < 1) {
      Alert.alert(
        '无法保存',
        '日期跨度至少为 1 天：请选择结束日期，且结束日须晚于起始日。',
      );
      return;
    }
    if (amount > SAVINGS_PLAN_MAX_TARGET_AMOUNT) {
      Alert.alert('无法保存', `目标金额不得超过 8 位数（最大 ${SAVINGS_PLAN_MAX_TARGET_AMOUNT.toLocaleString('zh-CN')}）。`);
      return;
    }

    try {
      if (initialPlan) {
        await onUpdate(initialPlan.id, {
          name,
          start_date: start_iso,
          end_date: end_iso,
          target_amount: amount,
          avatar_uri: planIconUri,
        });
      } else {
        await onCreate({
          id: `ssp_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          name,
          start_date: start_iso,
          end_date: end_iso,
          target_amount: amount,
          avatar_uri: planIconUri,
        });
      }
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

  const datePickerOverlayOpen = visible && (showStartDatePicker || showEndDatePicker);

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
              <View style={sheetStyles.sheetHead}>
                <PlanIconButton uri={planIconUri} onPickImage={pickPlanIcon} />
                <View style={sheetStyles.sheetTitleWrap}>
                  <Text style={[Typography.h3, { color: colors.text, textAlign: 'center' }]}>
                    {isEdit ? '编辑存钱计划' : '自由存钱计划'}
                  </Text>
                </View>
                <View style={sheetStyles.sheetHeadSpacer} />
              </View>

              <View style={[sheetStyles.inputRow, { backgroundColor: colors.input }]}>
                <TextInput
                  style={[sheetStyles.rowInput, { color: colors.text }]}
                  placeholder="输入你的存钱计划"
                  placeholderTextColor={colors.textMuted}
                  value={planName}
                  onChangeText={setPlanName}
                />
                <Pressable
                  style={({ pressed }) => [
                    sheetStyles.vaultBtn,
                    { backgroundColor: colors.surface, borderColor: colors.outline },
                    pressed && { opacity: 0.85 },
                  ]}>
                  <Text style={[Typography.caption, { color: colors.text }]}>存钱库</Text>
                </Pressable>
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
                  setShowEndDatePicker(false);
                  setShowStartDatePicker((v) => !v);
                }}>
                <Text style={[Typography.body, { color: colors.text }]}>起始日期</Text>
                <Text style={[Typography.bodyStrong, { color: colors.text }]}>{formatChineseDate(startDate)}</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  sheetStyles.inputRow,
                  sheetStyles.inputRowPress,
                  { backgroundColor: colors.input },
                  pressed && { opacity: 0.92 },
                ]}
                onPress={() => {
                  Keyboard.dismiss();
                  setShowStartDatePicker(false);
                  setShowEndDatePicker((v) => !v);
                }}>
                <Text style={[Typography.body, { color: colors.text }]}>结束日期</Text>
                <Text style={[Typography.bodyStrong, { color: colors.text }]}>{formatChineseDate(endDate)}</Text>
              </Pressable>

              <View style={[sheetStyles.inputRow, sheetStyles.amountRow, { backgroundColor: colors.input }]}>
                <Text style={[sheetStyles.amountYuan, { color: colors.text }]}>¥</Text>
                <TextInput
                  style={[sheetStyles.amountInput, { color: colors.text }]}
                  value={targetAmount}
                  onChangeText={(t) => setTargetAmount(t.replace(/\D/g, '').slice(0, 8))}
                  placeholder="5000"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={8}
                />
                <Pressable
                  style={({ pressed }) => [
                    sheetStyles.tagBtn,
                    { backgroundColor: colors.surface, borderColor: colors.outline },
                    pressed && { opacity: 0.88 },
                  ]}>
                  <Text style={[Typography.caption, { color: colors.textMuted }]}>目标金额</Text>
                </Pressable>
              </View>
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

      {datePickerOverlayOpen &&
        (Platform.OS === 'ios' ? (
          <View style={[StyleSheet.absoluteFill, { zIndex: 999, elevation: 99 }]} pointerEvents="box-none">
            <View style={sheetStyles.dateIosOverlay}>
              <Pressable
                style={[sheetStyles.dateIosScrim, { backgroundColor: colors.overlay }]}
                onPress={closeDatePickerOverlay}
                accessibilityLabel="关闭日期选择"
              />
              <View
                style={[
                  sheetStyles.dateIosSheet,
                  { backgroundColor: colors.surface, paddingBottom: Math.max(Spacing['3xl'], insetsBottom + Spacing.md) },
                ]}>
                <View style={[sheetStyles.dateIosHeader, { borderBottomColor: colors.outline }]}>
                  <Text style={[Typography.title, { color: colors.text }]}>
                    {showStartDatePicker ? '选择起始日期' : '选择结束日期'}
                  </Text>
                  <Pressable onPress={closeDatePickerOverlay} hitSlop={12}>
                    <Text style={[Typography.title, { color: colors.primary }]}>完成</Text>
                  </Pressable>
                </View>
                <DateTimePicker
                  value={showStartDatePicker ? startDate : endDate}
                  mode="date"
                  display="spinner"
                  themeVariant={isDark ? 'dark' : 'light'}
                  locale="zh_CN"
                  minimumDate={showEndDatePicker ? minEndDateForPicker : undefined}
                  onChange={showStartDatePicker ? handleStartDateChange : handleEndDateChange}
                />
              </View>
            </View>
          </View>
        ) : (
          <DateTimePicker
            key={showStartDatePicker ? 'plan-date-start' : 'plan-date-end'}
            value={showStartDatePicker ? startDate : endDate}
            mode="date"
            display="default"
            minimumDate={showEndDatePicker ? minEndDateForPicker : undefined}
            onChange={showStartDatePicker ? handleStartDateChange : handleEndDateChange}
          />
        ))}
    </Modal>
  );
}

export default function SavingsPlanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, shadows } = useAppTheme();

  const [planRows, setPlanRows] = React.useState<SavingsPlanRow[]>([]);
  const [depositByPlanId, setDepositByPlanId] = React.useState<Record<string, number>>({});
  const [totalDeposits, setTotalDeposits] = React.useState(0);
  const [planFormVisible, setPlanFormVisible] = React.useState(false);
  const [planFormInitial, setPlanFormInitial] = React.useState<SavingsPlanRow | null>(null);
  const [depositSheetPlan, setDepositSheetPlan] = React.useState<SavingsPlanRow | null>(null);

  const refreshPlansAndDeposits = React.useCallback(async () => {
    try {
      const rows = await getSavingsPlans();
      setPlanRows(rows);
      const [sums, total] = await Promise.all([
        getDepositSumsByActivePlanId(),
        getTotalDepositsForActivePlans(),
      ]);
      setDepositByPlanId(sums);
      setTotalDeposits(total);
    } catch (e) {
      console.warn('SavingsPlan: refresh plans/deposits failed', e);
      setPlanRows([]);
      setDepositByPlanId({});
      setTotalDeposits(0);
    }
  }, []);

  React.useEffect(() => {
    void refreshPlansAndDeposits();
  }, [refreshPlansAndDeposits]);

  useFocusEffect(
    React.useCallback(() => {
      void refreshPlansAndDeposits();
    }, [refreshPlansAndDeposits]),
  );

  /** 与 savings_plans 表一致：所有计划目标金额之和 */
  const totalGoal = React.useMemo(
    () => planRows.reduce((sum, r) => sum + Math.max(0, r.target_amount), 0),
    [planRows],
  );
  /** 所有未删除计划下的存入汇总（savings_plan_deposits） */
  const savedAmount = Math.max(0, totalDeposits);
  const remaining = Math.max(0, totalGoal - savedAmount);
  const progressPct = totalGoal > 0 ? Math.min(100, Math.round((savedAmount / totalGoal) * 100)) : 0;

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
          id: `ssd_${Date.now()}_${Math.random().toString(16).slice(2)}`,
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
      Alert.alert('删除计划', `确定删除「${row.name}」吗？删除后无法恢复。`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
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

            <View style={styles.overviewRow}>
              <AmountColumn
                label="总目标"
                amount={totalGoal}
                color={colors.primary}
                borderColor={colors.outline}
              />
              <AmountColumn
                label="已存款"
                amount={savedAmount}
                color={colors.success}
                showLeftBorder
                borderColor={colors.outline}
              />
              <AmountColumn
                label="剩余"
                amount={remaining}
                color={colors.danger}
                showLeftBorder
                borderColor={colors.outline}
              />
            </View>

            <View style={styles.overallProgress}>
              <View style={styles.overallProgressLabels}>
                <Text style={[Typography.caption, { color: colors.textSecondary }]}>总进度</Text>
                <Text style={[Typography.caption, { color: colors.textSecondary }]}>{progressPct}%</Text>
              </View>
              <View style={[styles.overallTrack, { backgroundColor: colors.progressTrack }]}>
                <View
                  style={[
                    styles.overallFill,
                    { width: `${progressPct}%` as DimensionValue, backgroundColor: colors.primary },
                  ]}
                />
              </View>
            </View>
          </AppCard>
        </View>

        <View style={styles.plansSection}>
          <View style={styles.plansHeader}>
            <Text style={[Typography.h3, { color: colors.text }]}>我的计划</Text>
          </View>

          <View style={styles.planList}>
            {planRows.length === 0 ? (
              <Text style={[Typography.body, styles.emptyPlansHint, { color: colors.textSecondary }]}>
                暂无计划，点击右上角添加
              </Text>
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
                    onPress={() => {
                      setPlanFormInitial(row);
                      setPlanFormVisible(true);
                    }}
                    onAddDeposit={() => setDepositSheetPlan(row)}
                    onCompleteGoal={() => void completePlanGoal(row)}
                  />
                </Swipeable>
              ))
            )}
          </View>
        </View>
      </ScrollView>

      <PlanFormSheet
        visible={planFormVisible}
        onClose={closePlanForm}
        insetsBottom={insets.bottom}
        initialPlan={planFormInitial}
        onCreate={async (input) => {
          await createSavingsPlan(input);
          await refreshPlansAndDeposits();
        }}
        onUpdate={async (id, input) => {
          await updateSavingsPlan(id, input);
          await refreshPlansAndDeposits();
        }}
      />

      <AddDepositSheet
        visible={depositSheetPlan != null}
        plan={depositSheetPlan}
        onClose={() => setDepositSheetPlan(null)}
        insetsBottom={insets.bottom}
        onSubmit={async (planId, amount) => {
          await createSavingsPlanDeposit({
            id: `ssd_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            savings_plan_id: planId,
            amount,
          });
          await refreshPlansAndDeposits();
        }}
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
  },
  overviewCard: {
    overflow: 'hidden',
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
  overallProgress: {
    marginTop: Spacing['5xl'],
    position: 'relative',
    zIndex: 10,
  },
  overallProgressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
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
  plansSection: {
    paddingHorizontal: Spacing['5xl'],
    paddingBottom: Spacing['5xl'],
    paddingTop: Spacing.xs,
  },
  plansHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing['3xl'],
  },
  planList: {
    gap: Spacing['3xl'],
  },
  emptyPlansHint: {
    textAlign: 'center',
    paddingVertical: Spacing['5xl'],
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
    paddingVertical: Spacing.xl,
    paddingLeft: Spacing['3xl'],
    paddingRight: Spacing.lg,
    flexDirection: 'row',
    gap: Spacing.lg,
    alignItems: 'center',
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
    gap: 16,
    alignItems: 'center',
    minWidth: 0,
  },
  planCardPressed: {
    opacity: 0.92,
  },
  planAddDepositBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planThumbWrap: {
    width: 64,
    height: 64,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  planThumb: {
    width: '100%',
    height: '100%',
  },
  planBody: {
    flex: 1,
    minWidth: 0,
  },
  planHeaderBlock: {
    marginBottom: 4,
  },
  categoryPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  planDatePill: {
    marginTop: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: 12,
    paddingVertical: 4,
  },
  planAmountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginBottom: 8,
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
