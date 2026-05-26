import { Layout, Radius, Shadows, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  addCalendarDays,
  formatChineseDate,
} from '@/lib/wish-savings-form-utils';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import {
  Alert,
  Image,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

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
  size = 76,
}: {
  uri: string | null;
  onPickImage: () => void;
  size?: number;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPickImage}
      style={({ pressed }) => [
        styles.iconBlock,
        {
          width: size,
          height: size,
          borderRadius: size >= 88 ? Radius['2xl'] : Radius.sheet,
          backgroundColor: colors.surfaceMuted,
        },
        pressed && { opacity: 0.88 },
      ]}
      accessibilityRole="button"
      accessibilityLabel="上传图标">
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="cover" />
      ) : (
        <DefaultPlanIconSvg />
      )}
      <View style={styles.iconCameraBadge} pointerEvents="none">
        <MaterialIcons name="photo-camera" size={14} color="#fff" />
      </View>
    </Pressable>
  );
}

export type WishSavingsCoreFormProps = {
  formTitle: string;
  name: string;
  onNameChange: (value: string) => void;
  namePlaceholder?: string;
  startDate: Date;
  endDate: Date;
  onStartDateChange: (date: Date) => void;
  onEndDateChange: (date: Date) => void;
  targetAmount: string;
  onTargetAmountChange: (value: string) => void;
  iconUri: string | null;
  onIconUriChange: (uri: string | null) => void;
  /** 底部安全区内边距，用于日期选择浮层 */
  insetsBottom?: number;
  /** 好物编辑页：居中封面 + 分区标签 */
  variant?: 'plan' | 'wish';
};

export function WishSavingsCoreForm({
  formTitle,
  name,
  onNameChange,
  namePlaceholder = '输入你的存钱计划',
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  targetAmount,
  onTargetAmountChange,
  iconUri,
  onIconUriChange,
  insetsBottom = 0,
  variant = 'plan',
}: WishSavingsCoreFormProps) {
  const { colors, isDark } = useAppTheme();
  const [showStartDatePicker, setShowStartDatePicker] = React.useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = React.useState(false);

  const minEndDateForPicker = React.useMemo(() => addCalendarDays(startDate, 1), [startDate]);
  const datePickerOverlayOpen = showStartDatePicker || showEndDatePicker;

  const pickIcon = React.useCallback(async () => {
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
      onIconUriChange(result.assets[0].uri);
    }
  }, [onIconUriChange]);

  const closeDatePickerOverlay = React.useCallback(() => {
    setShowStartDatePicker(false);
    setShowEndDatePicker(false);
  }, []);

  const handleStartDateChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowStartDatePicker(false);
    if (event.type === 'dismissed') return;
    if (!date) return;
    onStartDateChange(date);
    const minEnd = addCalendarDays(date, 1);
    if (endDate.getTime() < minEnd.getTime()) {
      onEndDateChange(minEnd);
    }
  };

  const handleEndDateChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowEndDatePicker(false);
    if (event.type === 'dismissed') return;
    if (date) onEndDateChange(date);
  };

  const isWish = variant === 'wish';

  return (
    <>
      {isWish ? (
        <View style={styles.wishHero}>
          <PlanIconButton uri={iconUri} onPickImage={() => void pickIcon()} size={96} />
          <Text style={[Typography.caption, { color: colors.textSecondary, marginTop: Spacing.md }]}>
            点击上传参考图
          </Text>
        </View>
      ) : (
        <View style={styles.sheetHead}>
          <PlanIconButton uri={iconUri} onPickImage={() => void pickIcon()} />
          <View style={styles.sheetTitleWrap}>
            <Text style={[Typography.h3, { color: colors.text, textAlign: 'center' }]}>{formTitle}</Text>
          </View>
          <View style={styles.sheetHeadSpacer} />
        </View>
      )}

      {isWish ? (
        <Text style={[Typography.label, styles.sectionLabel, { color: colors.textSecondary }]}>基本信息</Text>
      ) : null}

      <View style={[styles.inputRow, { backgroundColor: colors.input }]}>
        <TextInput
          style={[styles.rowInput, { color: colors.text }]}
          placeholder={namePlaceholder}
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={onNameChange}
        />
      </View>

      <View style={[styles.inputRow, styles.amountRow, { backgroundColor: colors.input }]}>
        <Text style={[styles.amountYuan, { color: colors.text }]}>¥</Text>
        <TextInput
          style={[styles.amountInput, { color: colors.text }]}
          value={targetAmount}
          onChangeText={(t) => onTargetAmountChange(t.replace(/\D/g, '').slice(0, 8))}
          placeholder="5000"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          maxLength={8}
        />
        <View
          style={[
            styles.tagBtn,
            { backgroundColor: colors.surface, borderColor: colors.outline },
          ]}>
          <Text style={[Typography.caption, { color: colors.textMuted }]}>目标金额</Text>
        </View>
      </View>

      {isWish ? (
        <Text style={[Typography.label, styles.sectionLabel, { color: colors.textSecondary }]}>存钱周期</Text>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.inputRow,
          styles.inputRowPress,
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
          styles.inputRow,
          styles.inputRowPress,
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

      {datePickerOverlayOpen &&
        (Platform.OS === 'ios' ? (
          <View style={[StyleSheet.absoluteFill, { zIndex: 999, elevation: 99 }]} pointerEvents="box-none">
            <View style={styles.dateIosOverlay}>
              <Pressable
                style={[styles.dateIosScrim, { backgroundColor: colors.overlay }]}
                onPress={closeDatePickerOverlay}
                accessibilityLabel="关闭日期选择"
              />
              <View
                style={[
                  styles.dateIosSheet,
                  {
                    backgroundColor: colors.surface,
                    paddingBottom: Math.max(Spacing['3xl'], insetsBottom + Spacing.md),
                  },
                ]}>
                <View style={[styles.dateIosHeader, { borderBottomColor: colors.outline }]}>
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
            key={showStartDatePicker ? 'wish-date-start' : 'wish-date-end'}
            value={showStartDatePicker ? startDate : endDate}
            mode="date"
            display="default"
            minimumDate={showEndDatePicker ? minEndDateForPicker : undefined}
            onChange={showStartDatePicker ? handleStartDateChange : handleEndDateChange}
          />
        ))}
    </>
  );
}

const styles = StyleSheet.create({
  wishHero: {
    alignItems: 'center',
    marginBottom: Spacing['4xl'],
  },
  sectionLabel: {
    marginBottom: Spacing.md,
    marginTop: Spacing.sm,
    alignSelf: 'flex-start',
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
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  inputRowPress: {
    justifyContent: 'space-between',
  },
  rowInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    padding: 0,
  },
  amountRow: {
    gap: 8,
  },
  amountYuan: {
    fontSize: 18,
    fontWeight: '700',
  },
  amountInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '800',
    padding: 0,
  },
  tagBtn: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dateIosOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  dateIosScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  dateIosSheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingTop: Spacing.lg,
  },
  dateIosHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing['3xl'],
    paddingBottom: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
