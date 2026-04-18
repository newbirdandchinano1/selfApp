import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { addCustomQuickAddItem, type QuickAddVolumeUnit } from '@/lib/quick-add-cards';
import { MaterialIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const iconOptions: Array<{ key: string; icon: React.ComponentProps<typeof MaterialIcons>['name'] }> = [
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

export default function AddItemScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const [name, setName] = React.useState('');
  const [volume, setVolume] = React.useState('250');
  const [selectedIconKey, setSelectedIconKey] = React.useState(iconOptions[0].key);
  const [unit, setUnit] = React.useState<QuickAddVolumeUnit>('ml');
  const [coefficient, setCoefficient] = React.useState(0.8);
  const [saving, setSaving] = React.useState(false);
  const selectedIcon = React.useMemo(
    () => iconOptions.find((item) => item.key === selectedIconKey)?.icon ?? iconOptions[0].icon,
    [selectedIconKey]
  );

  const canSave =
    name.trim().length > 0 &&
    Number.isFinite(Number(volume)) &&
    Number(volume) > 0 &&
    (unit !== 'ml' || coefficient > 0) &&
    !saving;

  const onSave = React.useCallback(async () => {
    const finalName = name.trim();
    const amount = Math.round(Number(volume));
    if (!finalName) {
      Alert.alert('请输入名称', '项目名称不能为空。');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('容量无效', '请输入大于 0 的默认容量。');
      return;
    }
    let hydrationMl = amount;
    if (unit === 'ml') hydrationMl = Math.round(amount * coefficient);
    if (unit === 'g') hydrationMl = amount;
    if (unit === 'mg') hydrationMl = amount;
    if (!Number.isFinite(hydrationMl) || hydrationMl <= 0) {
      Alert.alert('参数无效', '请检查容量和单位设置。');
      return;
    }
    setSaving(true);
    try {
      await addCustomQuickAddItem({
        label: finalName,
        displayAmount: amount,
        displayUnit: unit,
        hydrationMl,
        icon: selectedIcon,
      });
      router.back();
    } catch {
      Alert.alert('保存失败', '请稍后重试。');
    } finally {
      setSaving(false);
    }
  }, [name, volume, unit, coefficient, selectedIcon, router]);

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
                  <MaterialIcons name={item.icon} size={30} color={active ? '#006c49' : theme.textSecondary} />
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.sectionRow}>
          <View style={styles.halfCol}>
            <Text style={styles.label}>默认容量</Text>
            <TextInput
              value={volume}
              onChangeText={(text) => setVolume(text.replace(/[^\d]/g, '').slice(0, 4))}
              inputMode="text"
              style={[styles.volumeInput, { color: theme.text }]}
            />
            <View style={styles.smallUnderline} />
          </View>
          <View style={styles.halfCol}>
            <Text style={styles.label}>单位</Text>
            <View style={styles.unitWrap}>
              {(['ml', 'g', 'mg'] as const).map((item) => {
                const active = unit === item;
                const label = item === 'mg' ? 'MG' : item;
                return (
                  <Pressable
                    key={item}
                    onPress={() => setUnit(item)}
                    style={({ pressed }) => [styles.unitItem, active && styles.unitActive, pressed && styles.pressed]}
                  >
                    <Text style={active ? styles.unitTextActive : styles.unitText}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {unit === 'ml' ? (
          <View style={styles.coefficientCard}>
            <View style={styles.coefficientHeader}>
              <Text style={styles.label}>含水量系数</Text>
              <Text style={styles.coefficientValue}>{coefficient.toFixed(1)}</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={1}
              step={0.1}
              value={coefficient}
              onValueChange={(value) => setCoefficient(Math.round(value * 10) / 10)}
              minimumTrackTintColor="#006c49"
              maximumTrackTintColor="#e2e7ff"
              thumbTintColor="#006c49"
            />
            <Text style={styles.helperText}>该系数用于计算摄入物对身体水分的贡献度。纯水为 1.0。</Text>
          </View>
        ) : null}
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
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(194, 198, 214, 0.2)' },
  headerInner: { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 },
  headerSafeSpacer: { width: 40 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2, fontFamily: 'Manrope' },
  headerSpacer: { width: 40 },
  content: { paddingHorizontal: 24, gap: 44 },
  section: { gap: 16 },
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
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
  iconTile: {
    width: '22%',
    aspectRatio: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f2f3ff',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  iconTileActive: { backgroundColor: '#6cf8bb', borderColor: '#006c49', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, elevation: 1 },
  sectionRow: { flexDirection: 'row', gap: 24, alignItems: 'flex-end' },
  halfCol: { flex: 1, gap: 16 },
  volumeInput: {
    padding: 0,
    fontSize: 40,
    lineHeight: 42,
    fontWeight: '800',
    fontFamily: 'Manrope',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  smallUnderline: { height: 1, backgroundColor: 'rgba(194, 198, 214, 0.35)' },
  unitWrap: { flexDirection: 'row', padding: 4, borderRadius: 12, gap: 4, backgroundColor: '#f2f3ff' },
  unitItem: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  unitActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 1 },
  unitText: { fontSize: 14, fontWeight: '700', color: '#64748b' },
  unitTextActive: { fontSize: 14, fontWeight: '700', color: '#0058be' },
  coefficientCard: { borderRadius: 18, padding: 24, gap: 16, backgroundColor: '#f2f3ff' },
  coefficientHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  coefficientValue: { fontSize: 22, fontWeight: '800', fontFamily: 'Manrope', color: '#006c49' },
  slider: { width: '100%', height: 28 },
  helperText: { fontSize: 12, lineHeight: 18, color: '#64748b' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(194, 198, 214, 0.2)', paddingHorizontal: 24, paddingTop: 16 },
  saveBtn: { height: 64, borderRadius: 16, backgroundColor: '#006c49', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: '#006c49', shadowOpacity: 0.18, shadowRadius: 12, elevation: 3 },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnPressed: { opacity: 0.92, transform: [{ scale: 0.98 }] },
  saveText: { color: '#fff', fontSize: 18, fontWeight: '800', fontFamily: 'Manrope' },
  pressed: { opacity: 0.85 },
});
