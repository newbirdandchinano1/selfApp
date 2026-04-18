import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const iconOptions: Array<{ key: string; icon: React.ComponentProps<typeof MaterialIcons>['name']; active?: boolean }> = [
  { key: 'water', icon: 'local-drink', active: true },
  { key: 'coffee', icon: 'coffee' },
  { key: 'food', icon: 'restaurant' },
  { key: 'wine', icon: 'wine-bar' },
  { key: 'soup', icon: 'soup-kitchen' },
  { key: 'icecream', icon: 'icecream' },
  { key: 'plant', icon: 'grass' },
  { key: 'add', icon: 'add' },
];

export default function AddItemScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

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
          <TextInput placeholder="输入项目名称..." placeholderTextColor={theme.textSecondary} style={[styles.nameInput, { color: theme.text }]} />
          <View style={styles.underline}>
            <View style={styles.underlineActive} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>选择图标</Text>
          <View style={styles.iconGrid}>
            {iconOptions.map((item) => {
              const active = item.active;
              return (
                <Pressable key={item.key} style={({ pressed }) => [styles.iconTile, active && styles.iconTileActive, pressed && styles.pressed]}>
                  <MaterialIcons name={item.icon} size={30} color={active ? '#006c49' : theme.textSecondary} />
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.sectionRow}>
          <View style={styles.halfCol}>
            <Text style={styles.label}>默认容量</Text>
            <TextInput keyboardType="numeric" defaultValue="250" style={[styles.volumeInput, { color: theme.text }]} />
            <View style={styles.smallUnderline} />
          </View>
          <View style={styles.halfCol}>
            <Text style={styles.label}>单位</Text>
            <View style={styles.unitWrap}>
              <View style={styles.unitActive}><Text style={styles.unitTextActive}>ml</Text></View>
              <View style={styles.unitItem}><Text style={styles.unitText}>g</Text></View>
              <View style={styles.unitItem}><Text style={styles.unitText}>oz</Text></View>
            </View>
          </View>
        </View>

        <View style={styles.coefficientCard}>
          <View style={styles.coefficientHeader}>
            <Text style={styles.label}>含水量系数</Text>
            <Text style={styles.coefficientValue}>0.8</Text>
          </View>
          <View style={styles.sliderTrack}>
            <View style={styles.sliderFill} />
            <View style={styles.sliderThumb} />
          </View>
          <Text style={styles.helperText}>该系数用于计算摄入物对身体水分的贡献度。纯水为 1.0。</Text>
        </View>

        <View style={styles.heroCard}>
          <Image source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCi3LJjA39Nsvp6GY8XbK-GNLL_SvV8IHb-GY-QbilK1RLdu2wwkc7fsPmfbGJ7r9RGjDDo4m9UUqhlZ2KF7L1gC4VKPT1r_frL0VYD8AehPlzjKSarnsj50SvDpZvsP4djZUa5-FwfySjD_bLukrJjT_RGQu1P0zS3rKM41jmb627Hysw1trgyhenMPvftCAB3t0QCPe3IrCq0vD3Q0CWpagRJn1j_M8saTGat5SBQOjtCJBCLquVx6jeE7NY9VpqUvlOGa7XCjV3L' }} style={styles.heroImage} />
          <View style={styles.heroOverlay} />
          <View style={styles.heroTextWrap}>
            <Text style={styles.heroTitle}>保持水润</Text>
            <Text style={styles.heroSub}>记录每一步的健康进程</Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: 16 + Math.max(insets.bottom, 0), backgroundColor: isDark ? 'rgba(15, 23, 42, 0.8)' : 'rgba(255, 255, 255, 0.8)' }]}>
        <Pressable style={({ pressed }) => [styles.saveBtn, pressed && styles.saveBtnPressed]}>
          <Text style={styles.saveText}>完成并保存</Text>
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
  nameInput: { padding: 0, fontSize: 32, fontWeight: '800', fontFamily: 'Manrope' },
  underline: { height: 2, borderRadius: 999, overflow: 'hidden', backgroundColor: '#e2e7ff' },
  underlineActive: { width: '33%', height: '100%', backgroundColor: '#10b981' },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
  iconTile: { width: '22%', aspectRatio: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f2f3ff' },
  iconTileActive: { backgroundColor: '#6cf8bb', borderWidth: 2, borderColor: '#006c49', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, elevation: 1 },
  sectionRow: { flexDirection: 'row', gap: 24, alignItems: 'flex-end' },
  halfCol: { flex: 1, gap: 16 },
  volumeInput: { padding: 0, fontSize: 40, fontWeight: '800', fontFamily: 'Manrope' },
  smallUnderline: { height: 1, backgroundColor: 'rgba(194, 198, 214, 0.35)' },
  unitWrap: { flexDirection: 'row', padding: 4, borderRadius: 12, gap: 4, backgroundColor: '#f2f3ff' },
  unitItem: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  unitActive: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 1 },
  unitText: { fontSize: 14, fontWeight: '700', color: '#64748b' },
  unitTextActive: { fontSize: 14, fontWeight: '700', color: '#0058be' },
  coefficientCard: { borderRadius: 18, padding: 24, gap: 16, backgroundColor: '#f2f3ff' },
  coefficientHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  coefficientValue: { fontSize: 22, fontWeight: '800', fontFamily: 'Manrope', color: '#006c49' },
  sliderTrack: { height: 6, borderRadius: 999, backgroundColor: '#e2e7ff', justifyContent: 'center' },
  sliderFill: { height: 6, borderRadius: 999, width: '80%', backgroundColor: '#006c49' },
  sliderThumb: { position: 'absolute', left: '78%', width: 24, height: 24, borderRadius: 12, borderWidth: 4, borderColor: '#fff', marginLeft: -12, backgroundColor: '#006c49', shadowColor: '#006c49', shadowOpacity: 0.2, shadowRadius: 8, elevation: 2 },
  helperText: { fontSize: 12, lineHeight: 18, color: '#64748b' },
  heroCard: { height: 160, borderRadius: 16, overflow: 'hidden', position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(19,27,46,0.45)' },
  heroTextWrap: { position: 'absolute', left: 24, right: 24, bottom: 24 },
  heroTitle: { color: '#fff', fontSize: 18, fontWeight: '800', fontFamily: 'Manrope' },
  heroSub: { color: 'rgba(255,255,255,0.82)', fontSize: 12, marginTop: 4 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(194, 198, 214, 0.2)', paddingHorizontal: 24, paddingTop: 16 },
  saveBtn: { height: 64, borderRadius: 16, backgroundColor: '#006c49', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: '#006c49', shadowOpacity: 0.18, shadowRadius: 12, elevation: 3 },
  saveBtnPressed: { opacity: 0.92, transform: [{ scale: 0.98 }] },
  saveText: { color: '#fff', fontSize: 18, fontWeight: '800', fontFamily: 'Manrope' },
  pressed: { opacity: 0.85 },
});
