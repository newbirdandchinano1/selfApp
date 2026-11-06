import { AppButton, AppCard, AppInput, ScreenHeader } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { addCustomQuickAddItem, type QuickAddMetricType, type QuickAddVolumeUnit } from '@/lib/quick-add-cards';
import { parseQuickAddFromText } from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
  { key: 'calories', label: '热量', unit: 'kcal', placeholder: '500' },
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
    calories: '',
  });
  const [selectedIconKey, setSelectedIconKey] = React.useState(iconOptions[0].key);
  const [metricTypes, setMetricTypes] = React.useState<QuickAddMetricType[]>(['hydration']);
  const [saving, setSaving] = React.useState(false);
  const [aiModalOpen, setAiModalOpen] = React.useState(false);
  const [aiText, setAiText] = React.useState('');
  const [aiBusy, setAiBusy] = React.useState(false);

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
      metricTypes.length > 1 ? 'g' : firstMetric === 'hydration' ? 'ml' : firstMetric === 'calories' ? 'kcal' : 'g';
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
      toast.success('已保存');
      router.back();
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请稍后重试'));
    } finally {
      setSaving(false);
    }
  }, [name, metricTypes, selectedMetricAmounts, selectedIcon, router]);

  const onAiFill = React.useCallback(async () => {
    const text = aiText.trim();
    if (!text || aiBusy) return;
    setAiBusy(true);
    try {
      const r = await parseQuickAddFromText(text);
      if (!r.ok) {
        toast.error(r.error || 'AI 解析失败');
        return;
      }
      const d = r.data;
      const nextTypes: QuickAddMetricType[] = [];
      const nextAmounts: Record<QuickAddMetricType, string> = {
        hydration: '',
        protein: '',
        carbohydrate: '',
        calories: '',
      };
      if (d.hydration_ml > 0) {
        nextTypes.push('hydration');
        nextAmounts.hydration = String(Math.round(d.hydration_ml));
      }
      if (d.protein_g > 0) {
        nextTypes.push('protein');
        nextAmounts.protein = String(Math.round(d.protein_g));
      }
      if (d.carbohydrate_g > 0) {
        nextTypes.push('carbohydrate');
        nextAmounts.carbohydrate = String(Math.round(d.carbohydrate_g));
      }
      if (d.calories_kcal > 0) {
        nextTypes.push('calories');
        nextAmounts.calories = String(Math.round(d.calories_kcal));
      }
      if (nextTypes.length === 0) {
        toast.warn('未识别到有效营养，请改写描述');
        return;
      }
      setName(d.name.slice(0, 18));
      setMetricTypes(nextTypes);
      setMetricAmounts(nextAmounts);
      if (d.hydration_ml > 0 && d.protein_g + d.carbohydrate_g + d.calories_kcal === 0) {
        setSelectedIconKey('water');
      } else if (d.protein_g >= d.carbohydrate_g && d.protein_g >= d.calories_kcal) {
        setSelectedIconKey('egg');
      } else if (d.calories_kcal > 0) {
        setSelectedIconKey('food');
      }
      setAiModalOpen(false);
      setAiText('');
      toast.success('已预填，请确认后保存');
    } catch (e) {
      toast.error(toUserMessage(e, 'AI 解析失败'));
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, aiText]);

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
          <Pressable
            onPress={() => setAiModalOpen(true)}
            disabled={saving}
            style={({ pressed }) => [
              styles.aiFillBtn,
              {
                backgroundColor: colors.primaryMuted,
                borderColor: colors.primary,
                opacity: saving ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}>
            <MaterialIcons name="auto-awesome" size={18} color={colors.primary} />
            <Text style={[Typography.bodyStrong, { color: colors.primary }]}>AI 一句话填入</Text>
          </Pressable>

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

      <Modal
        transparent
        visible={aiModalOpen}
        animationType="fade"
        onRequestClose={() => {
          if (!aiBusy) setAiModalOpen(false);
        }}>
        <View style={styles.aiModalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => {
              if (!aiBusy) setAiModalOpen(false);
            }}
          />
          <View style={[styles.aiModalCard, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
            <Text style={[Typography.h3, { color: colors.text }]}>AI 一句话填入</Text>
            <Text style={[Typography.caption, { color: colors.textSecondary, marginTop: 4 }]}>
              例如「一杯无糖美式」· 预填表单，需你确认保存
            </Text>
            <TextInput
              value={aiText}
              onChangeText={setAiText}
              placeholder="描述这张快捷卡…"
              placeholderTextColor={colors.textMuted}
              multiline
              editable={!aiBusy}
              style={[
                styles.aiModalInput,
                Typography.body,
                { color: colors.text, borderColor: colors.outline, backgroundColor: colors.input },
              ]}
            />
            <View style={styles.aiModalActions}>
              <Pressable
                onPress={() => {
                  if (!aiBusy) setAiModalOpen(false);
                }}
                style={[styles.aiModalGhost, { borderColor: colors.outline }]}>
                <Text style={[Typography.bodyStrong, { color: colors.textSecondary }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => void onAiFill()}
                disabled={aiBusy || !aiText.trim()}
                style={[
                  styles.aiModalPrimary,
                  {
                    backgroundColor: colors.primary,
                    opacity: aiBusy || !aiText.trim() ? 0.5 : 1,
                  },
                ]}>
                {aiBusy ? (
                  <ActivityIndicator color={colors.onPrimary ?? '#fff'} />
                ) : (
                  <Text style={[Typography.bodyStrong, { color: colors.onPrimary ?? '#fff' }]}>解析并填入</Text>
                )}
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
  aiFillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    borderRadius: Radius.xl,
    borderWidth: 1,
    paddingVertical: Spacing.xl,
  },
  aiModalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'rgba(20,28,22,0.45)',
    paddingHorizontal: Spacing['5xl'],
  },
  aiModalCard: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['4xl'],
    gap: Spacing.lg,
  },
  aiModalInput: {
    minHeight: 88,
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    textAlignVertical: 'top',
  },
  aiModalActions: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.sm },
  aiModalGhost: {
    flex: 1,
    borderRadius: Radius.xl,
    borderWidth: 1,
    paddingVertical: Spacing.xl,
    alignItems: 'center',
  },
  aiModalPrimary: {
    flex: 1,
    borderRadius: Radius.xl,
    paddingVertical: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
