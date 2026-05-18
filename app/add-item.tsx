import { AppButton, AppCard, AppInput, ScreenHeader } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { addCustomQuickAddItem, type QuickAddMetricType, type QuickAddVolumeUnit } from '@/lib/quick-add-cards';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const ICON_COLUMNS = 5;
const ICON_GAP = Spacing.lg;

const iconOptions: { key: string; icon: React.ComponentProps<typeof MaterialIcons>['name'] }[] = [
  { key: 'water', icon: 'local-drink' },
  { key: 'water-drop', icon: 'water-drop' },
  { key: 'coffee', icon: 'local-cafe' },
  { key: 'coffee-maker', icon: 'coffee-maker' },
  { key: 'tea', icon: 'emoji-food-beverage' },
  { key: 'green-tea', icon: 'spa' },
  { key: 'milk', icon: 'blender' },
  { key: 'juice', icon: 'sports-bar' },
  { key: 'soda', icon: 'local-bar' },
  { key: 'wine', icon: 'wine-bar' },
  { key: 'liquor', icon: 'liquor' },
  { key: 'food', icon: 'restaurant' },
  { key: 'breakfast', icon: 'free-breakfast' },
  { key: 'brunch', icon: 'brunch-dining' },
  { key: 'lunch', icon: 'lunch-dining' },
  { key: 'dinner', icon: 'dinner-dining' },
  { key: 'ramen', icon: 'ramen-dining' },
  { key: 'rice', icon: 'rice-bowl' },
  { key: 'meal', icon: 'set-meal' },
  { key: 'bbq', icon: 'outdoor-grill' },
  { key: 'takeaway', icon: 'takeaway-box' },
  { key: 'bakery', icon: 'bakery-dining' },
  { key: 'pizza', icon: 'local-pizza' },
  { key: 'soup', icon: 'soup-kitchen' },
  { key: 'egg', icon: 'egg' },
  { key: 'kebab', icon: 'kebab-dining' },
  { key: 'icecream', icon: 'icecream' },
  { key: 'cookie', icon: 'cookie' },
  { key: 'cake', icon: 'cake' },
  { key: 'fruit', icon: 'eco' },
  { key: 'plant', icon: 'grass' },
  { key: 'fitness', icon: 'fitness-center' },
  { key: 'protein-shake', icon: 'egg-alt' },
];

const metricOptions: { key: QuickAddMetricType; label: string; unit: QuickAddVolumeUnit; placeholder: string }[] = [
  { key: 'hydration', label: '水分', unit: 'ml', placeholder: '250' },
  { key: 'protein', label: '蛋白质', unit: 'g', placeholder: '20' },
  { key: 'carbohydrate', label: '碳水', unit: 'g', placeholder: '30' },
  { key: 'sodium', label: '钠', unit: 'mg', placeholder: '100' },
];

function SectionLabel({ children }: { children: string }) {
  const { colors } = useAppTheme();
  return <Text style={[Typography.kicker, styles.sectionLabel, { color: colors.textSecondary }]}>{children}</Text>;
}

export default function AddItemScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, shadows } = useAppTheme();

  const [iconGridWidth, setIconGridWidth] = React.useState(0);
  const iconTileSize =
    iconGridWidth > 0
      ? Math.floor((iconGridWidth - ICON_GAP * (ICON_COLUMNS - 1)) / ICON_COLUMNS)
      : 0;

  const [name, setName] = React.useState('');
  const [nameFocused, setNameFocused] = React.useState(false);
  const [metricAmounts, setMetricAmounts] = React.useState<Record<QuickAddMetricType, string>>({
    hydration: '250',
    protein: '',
    carbohydrate: '',
    sodium: '',
  });
  const [selectedIconKey, setSelectedIconKey] = React.useState(iconOptions[0].key);
  const [metricTypes, setMetricTypes] = React.useState<QuickAddMetricType[]>(['hydration']);
  const [saving, setSaving] = React.useState(false);

  const selectedIcon = React.useMemo(
    () => iconOptions.find((item) => item.key === selectedIconKey)?.icon ?? iconOptions[0].icon,
    [selectedIconKey]
  );

  const selectedMetricAmounts = React.useMemo(
    () =>
      metricTypes.reduce<Partial<Record<QuickAddMetricType, number>>>((acc, metric) => {
        const amount = Number(metricAmounts[metric]);
        if (Number.isFinite(amount) && amount > 0) acc[metric] = Math.round(amount);
        return acc;
      }, {}),
    [metricAmounts, metricTypes]
  );

  const canSave =
    name.trim().length > 0 &&
    metricTypes.length > 0 &&
    metricTypes.every((metric) => selectedMetricAmounts[metric] !== undefined) &&
    !saving;

  const onSave = React.useCallback(async () => {
    const finalName = name.trim();
    if (!finalName) {
      Alert.alert('请输入名称', '项目名称不能为空。');
      return;
    }
    if (metricTypes.length === 0) {
      Alert.alert('请选择指标', '至少选择一个指标类型。');
      return;
    }
    if (metricTypes.some((metric) => selectedMetricAmounts[metric] === undefined)) {
      Alert.alert('数值无效', '请为每个已选指标输入大于 0 的数值。');
      return;
    }
    const firstMetric = metricTypes[0];
    const firstAmount = selectedMetricAmounts[firstMetric] ?? 0;
    const displayUnit: QuickAddVolumeUnit =
      metricTypes.length > 1 ? 'g' : firstMetric === 'hydration' ? 'ml' : firstMetric === 'sodium' ? 'mg' : 'g';
    setSaving(true);
    try {
      await addCustomQuickAddItem({
        label: finalName,
        displayAmount: firstAmount,
        displayUnit,
        hydrationMl: firstAmount,
        metricTypes,
        metricAmounts: selectedMetricAmounts,
        icon: selectedIcon,
      });
      router.back();
    } catch {
      Alert.alert('保存失败', '请稍后重试。');
    } finally {
      setSaving(false);
    }
  }, [name, metricTypes, selectedMetricAmounts, selectedIcon, router]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['left', 'right', 'bottom']}>
      <ScreenHeader title="添加项目" onBack={() => router.back()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Spacing['7xl'] + 72 + Math.max(insets.bottom, 0) }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag">
        <View style={styles.content}>
          <View style={styles.section}>
            <SectionLabel>项目名称</SectionLabel>
            <AppInput
              value={name}
              onChangeText={setName}
              onFocus={() => setNameFocused(true)}
              onBlur={() => setNameFocused(false)}
              placeholder="例如：美式咖啡、蛋白粉"
              maxLength={18}
              returnKeyType="done"
              editable={!saving}
              autoCorrect={false}
              hint={`${name.length}/18`}
              inputStyle={[Typography.h2, styles.nameInputText]}
              inputWrapStyle={[
                styles.nameInputWrap,
                nameFocused && {
                  borderColor: colors.primary,
                  borderWidth: 1.5,
                  backgroundColor: colors.surface,
                },
              ]}
            />
          </View>

          <View style={styles.section}>
            <SectionLabel>选择图标</SectionLabel>
            <View
              style={[styles.iconGrid, { gap: ICON_GAP }]}
              onLayout={(event) => {
                const width = event.nativeEvent.layout.width;
                if (width > 0 && width !== iconGridWidth) setIconGridWidth(width);
              }}>
              {iconTileSize > 0
                ? iconOptions.map((item) => {
                    const active = selectedIconKey === item.key;
                    return (
                      <Pressable
                        key={item.key}
                        onPress={() => setSelectedIconKey(item.key)}
                        style={({ pressed }) => [
                          styles.iconTile,
                          {
                            width: iconTileSize,
                            height: iconTileSize,
                            backgroundColor: active ? colors.primaryMuted : colors.input,
                            borderColor: active ? colors.primary : colors.outline,
                          },
                          active && shadows.card,
                          pressed && styles.pressed,
                        ]}>
                        <MaterialIcons
                          name={item.icon}
                          size={28}
                          color={active ? colors.primary : colors.textSecondary}
                        />
                      </Pressable>
                    );
                  })
                : null}
            </View>
          </View>

          <View style={styles.section}>
            <SectionLabel>指标类型</SectionLabel>
            <View style={[styles.segmented, { backgroundColor: colors.capsule }]}>
              {metricOptions.map((item) => {
                const active = metricTypes.includes(item.key);
                return (
                  <Pressable
                    key={item.key}
                    onPress={() =>
                      setMetricTypes((prev) =>
                        prev.includes(item.key) ? prev.filter((v) => v !== item.key) : [...prev, item.key]
                      )
                    }
                    style={({ pressed }) => [
                      styles.segmentItem,
                      active && [styles.segmentItemActive, { backgroundColor: colors.surface }, shadows.card],
                      pressed && styles.pressed,
                    ]}>
                    <Text
                      style={[
                        Typography.bodyStrong,
                        { color: active ? colors.primary : colors.textSecondary, fontSize: 14 },
                      ]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <SectionLabel>指标数值</SectionLabel>
            <View style={styles.amountList}>
              {metricOptions
                .filter((item) => metricTypes.includes(item.key))
                .map((item) => (
                  <AppCard key={item.key} variant="muted" style={styles.amountCard}>
                    <View style={styles.amountRow}>
                      <View style={styles.amountMeta}>
                        <Text style={[Typography.bodyStrong, { color: colors.text }]}>{item.label}</Text>
                        <Text style={[Typography.caption, { color: colors.textSecondary, textTransform: 'uppercase' }]}>
                          {item.unit}
                        </Text>
                      </View>
                      <TextInput
                        value={metricAmounts[item.key]}
                        onChangeText={(text) =>
                          setMetricAmounts((prev) => ({
                            ...prev,
                            [item.key]: text.replace(/[^\d]/g, '').slice(0, 5),
                          }))
                        }
                        placeholder={item.placeholder}
                        placeholderTextColor={colors.textMuted}
                        inputMode="numeric"
                        keyboardType="number-pad"
                        style={[styles.amountInput, Typography.h2, { color: colors.text }]}
                      />
                    </View>
                  </AppCard>
                ))}
            </View>
          </View>
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: Spacing['3xl'] + Math.max(insets.bottom, 0),
            backgroundColor: colors.headerScrim,
            borderTopColor: colors.outline,
          },
        ]}>
        <AppButton
          label={saving ? '保存中...' : '完成并保存'}
          variant="secondary"
          size="lg"
          fullWidth
          loading={saving}
          disabled={!canSave}
          onPress={() => void onSave()}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['3xl'],
    gap: Spacing['6xl'],
  },
  section: { gap: Spacing.xl },
  sectionLabel: { opacity: 0.85 },
  nameInputWrap: {
    minHeight: 56,
    paddingVertical: Spacing.xl,
    borderRadius: Radius['2xl'],
  },
  nameInputText: {
    padding: 0,
    margin: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  iconGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  iconTile: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmented: {
    flexDirection: 'row',
    padding: Spacing.xs,
    borderRadius: Radius.md,
    gap: Spacing.xs,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: Spacing.lg,
    borderRadius: Radius.sm,
    alignItems: 'center',
    minWidth: 0,
  },
  segmentItemActive: {},
  amountList: { gap: Spacing.lg },
  amountCard: { paddingVertical: Spacing['3xl'], paddingHorizontal: Spacing['3xl'] },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.xl,
  },
  amountMeta: { gap: Spacing.xs, flexShrink: 1 },
  amountInput: {
    minWidth: 112,
    padding: 0,
    includeFontPadding: false,
    textAlign: 'right',
    textAlignVertical: 'center',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['3xl'],
  },
  pressed: { opacity: 0.85 },
});
