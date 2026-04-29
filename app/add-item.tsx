import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { addCustomQuickAddItem, type QuickAddMetricType, type QuickAddVolumeUnit } from '@/lib/quick-add-cards';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const iconOptions: { key: string; icon: React.ComponentProps<typeof MaterialIcons>['name'] }[] = [
  { key: 'water', icon: 'local-drink' },
  { key: 'coffee', icon: 'local-cafe' },
  { key: 'tea', icon: 'emoji-food-beverage' },
  { key: 'food', icon: 'restaurant' },
  { key: 'juice', icon: 'sports-bar' },
  { key: 'plant', icon: 'spa' },
  { key: 'wine', icon: 'wine-bar' },
  { key: 'icecream', icon: 'icecream' },
  { key: 'soup', icon: 'soup-kitchen' },
  { key: 'fruit', icon: 'local-pizza' },
  { key: 'breakfast', icon: 'free-breakfast' },
  { key: 'fitness', icon: 'fitness-center' },
];

const metricOptions: { key: QuickAddMetricType; label: string; unit: QuickAddVolumeUnit; placeholder: string }[] = [
  { key: 'hydration', label: '水分', unit: 'ml', placeholder: '250' },
  { key: 'protein', label: '蛋白质', unit: 'g', placeholder: '20' },
  { key: 'carbohydrate', label: '碳水', unit: 'g', placeholder: '30' },
  { key: 'sodium', label: '钠', unit: 'mg', placeholder: '100' },
];

export default function AddItemScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const themeKey = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = Colors[themeKey];
  const isDark = themeKey === 'dark';
  const [name, setName] = React.useState('');
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
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['left', 'right', 'bottom']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top,
            height: 64 + insets.top,
            backgroundColor: isDark ? 'rgba(15, 23, 42, 0.8)' : 'rgba(255, 255, 255, 0.8)',
          },
        ]}
      >
        <View style={styles.headerInner}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
            <MaterialIcons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: theme.text }]}>添加项目</Text>
          <View style={styles.headerRightSpacer} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingTop: 96 + insets.top, paddingBottom: 132 + Math.max(insets.bottom, 12) }]} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={styles.label}>项目名称</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="输入项目名称..."
            placeholderTextColor={theme.textSecondary}
            maxLength={18}
            style={[styles.nameInput, { color: theme.text }]}
          />
          <View style={styles.underline}>
            <View style={styles.underlineActive} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>选择图标</Text>
          <View style={styles.iconGrid}>
            {iconOptions.map((item) => {
              const active = selectedIconKey === item.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setSelectedIconKey(item.key)}
                  style={({ pressed }) => [styles.iconTile, active && styles.iconTileActive, pressed && styles.pressed]}
                >
                  <View style={styles.iconGlyphWrap}>
                    <MaterialIcons name={item.icon} size={30} color={active ? '#006c49' : theme.textSecondary} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>指标类型</Text>
          <View style={styles.unitWrap}>
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
                  style={({ pressed }) => [styles.metricTypeItem, active && styles.unitActive, pressed && styles.pressed]}
                >
                  <Text style={active ? styles.unitTextActive : styles.unitText}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>指标数值</Text>
          <View style={styles.amountList}>
            {metricOptions
              .filter((item) => metricTypes.includes(item.key))
              .map((item) => (
                <View key={item.key} style={[styles.amountRow, { borderColor: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.35)' }]}>
                  <View style={styles.amountMeta}>
                    <Text style={[styles.amountLabel, { color: theme.text }]}>{item.label}</Text>
                    <Text style={styles.amountUnit}>{item.unit}</Text>
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
                    placeholderTextColor={theme.textSecondary}
                    inputMode="numeric"
                    keyboardType="number-pad"
                    style={[styles.amountInput, { color: theme.text }]}
                  />
                </View>
              ))}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: 16 + Math.max(insets.bottom, 0), backgroundColor: isDark ? 'rgba(15, 23, 42, 0.8)' : 'rgba(255, 255, 255, 0.8)' }]}>
        <Pressable onPress={() => void onSave()} disabled={!canSave} style={({ pressed }) => [styles.saveBtn, !canSave && styles.saveBtnDisabled, pressed && styles.saveBtnPressed]}>
          <Text style={styles.saveText}>{saving ? '保存中...' : '完成并保存'}</Text>
          <MaterialIcons name="check-circle" size={22} color="#fff" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 },
  headerInner: { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 },
  headerSafeSpacer: { width: 40 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2, fontFamily: 'Manrope' },
  headerSpacer: { width: 40 },
  headerRightSpacer: { width: 40 },
  content: { paddingHorizontal: 24, gap: 20 },
  section: { gap: 12 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, color: 'rgba(71, 85, 105, 0.62)', textTransform: 'uppercase' },
  nameInput: {
    padding: 0,
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '800',
    fontFamily: 'Manrope',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  underline: { height: 2, borderRadius: 999, overflow: 'hidden', backgroundColor: '#e2e7ff' },
  underlineActive: { width: '33%', height: '100%', backgroundColor: '#10b981' },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  iconTile: {
    width: '22%',
    aspectRatio: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f2f3ff',
    borderWidth: 2,
    borderColor: 'transparent',
    padding: 0,
  },
  iconTileActive: { backgroundColor: '#6cf8bb', borderColor: '#006c49', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, elevation: 1 },
  iconGlyphWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeInput: {
    padding: 0,
    fontSize: 40,
    lineHeight: 42,
    fontWeight: '800',
    fontFamily: 'Manrope',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  amountList: { gap: 10 },
  amountRow: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(242,243,255,0.62)',
  },
  amountMeta: { gap: 3 },
  amountLabel: { fontSize: 15, fontWeight: '800', fontFamily: 'Manrope' },
  amountUnit: { fontSize: 12, fontWeight: '800', color: '#64748b', textTransform: 'uppercase' },
  amountInput: {
    minWidth: 112,
    padding: 0,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
    fontFamily: 'Manrope',
    includeFontPadding: false,
    textAlign: 'right',
    textAlignVertical: 'center',
  },
  smallUnderline: { height: 1, backgroundColor: 'rgba(194, 198, 214, 0.35)' },
  unitWrap: { flexDirection: 'row', padding: 4, borderRadius: 12, gap: 4, backgroundColor: '#f2f3ff' },
  metricTypeItem: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', minWidth: 0 },
  unitActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 1 },
  unitText: { fontSize: 14, fontWeight: '700', color: '#64748b' },
  unitTextActive: { fontSize: 14, fontWeight: '700', color: '#0058be' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(194, 198, 214, 0.2)', paddingHorizontal: 24, paddingTop: 16 },
  saveBtn: { height: 64, borderRadius: 16, backgroundColor: '#006c49', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: '#006c49', shadowOpacity: 0.18, shadowRadius: 12, elevation: 3 },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnPressed: { opacity: 0.92, transform: [{ scale: 0.98 }] },
  saveText: { color: '#fff', fontSize: 18, fontWeight: '800', fontFamily: 'Manrope' },
  pressed: { opacity: 0.85 },
});
