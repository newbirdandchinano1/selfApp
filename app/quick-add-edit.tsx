import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type QuickAddItem = {
  key: string;
  label: string;
  amount: string;
  icon: keyof typeof MaterialIcons.glyphMap;
};

const homeItems: QuickAddItem[] = [
  { key: 'water', label: '水', amount: '250ml', icon: 'water-drop' },
  { key: 'coffee', label: '咖啡', amount: '150ml', icon: 'local-cafe' },
  { key: 'milk', label: '牛奶', amount: '200ml', icon: 'emoji-food-beverage' },
];

const availableItems: QuickAddItem[] = [
  { key: 'black-tea', label: '红茶', amount: '200ml', icon: 'emoji-food-beverage' },
  { key: 'juice', label: '果汁', amount: '300ml', icon: 'local-drink' },
  { key: 'green-tea', label: '绿茶', amount: '250ml', icon: 'spa' },
];

export default function QuickAddEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const surfaceHigh = isDark ? 'rgba(51,65,85,0.9)' : '#e2e7ff';
  const surfaceLowest = isDark ? 'rgba(15,23,42,0.72)' : '#ffffff';
  const outline = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.35)';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.8)' : 'rgba(250,248,255,0.85)' }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>编辑快捷卡片</Text>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.75 }]}>
          <Text style={[styles.saveText, { color: theme.primary }]}>保存</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 28 + Math.max(insets.bottom, 12) }]} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>首页展示 (最多3个)</Text>
          <View style={styles.cardList}>
            {homeItems.map((item) => (
              <View key={item.key} style={[styles.cardRow, { backgroundColor: surfaceLowest, borderColor: outline }]}>
                <View style={[styles.iconWrap, { backgroundColor: surfaceHigh }]}>
                  <MaterialIcons name={item.icon} size={28} color={theme.primary} />
                </View>
                <View style={styles.cardBody}>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>{item.label}</Text>
                  <Text style={[styles.cardSub, { color: theme.textSecondary }]}>{item.amount}</Text>
                </View>
                <Pressable style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.8 }]}>
                  <MaterialIcons name="remove" size={18} color="#ba1a1a" />
                </Pressable>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>可添加项目</Text>
            <Pressable onPress={() => router.push('/add-item')} style={({ pressed }) => [styles.addProjectBtn, pressed && { opacity: 0.8 }]}>
              <MaterialIcons name="add" size={18} color={theme.primary} />
              <Text style={[styles.addProjectText, { color: theme.primary }]}>添加项目</Text>
            </Pressable>
          </View>

          <View style={styles.cardList}>
            {availableItems.map((item) => (
              <View key={item.key} style={[styles.cardRow, styles.availableRow, { backgroundColor: surfaceLowest, borderColor: outline }]}>
                <View style={[styles.availableAccent, { backgroundColor: `${theme.primary}33` }]} />
                <View style={[styles.iconWrap, { backgroundColor: surfaceHigh }]}>
                  <MaterialIcons name={item.icon} size={28} color={theme.text} />
                </View>
                <View style={styles.cardBody}>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>{item.label}</Text>
                  <Text style={[styles.cardSub, { color: theme.textSecondary }]}>{item.amount}</Text>
                </View>
                <Pressable style={({ pressed }) => [styles.addBtn, { backgroundColor: `${theme.primary}14` }, pressed && { opacity: 0.8 }]}>
                  <MaterialIcons name="add" size={22} color={theme.primary} />
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.14)',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  saveBtn: { minWidth: 40, alignItems: 'flex-end' },
  saveText: { fontSize: 16, fontWeight: '800' },
  content: { paddingHorizontal: 20, paddingTop: 16 },
  section: { marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginBottom: 14 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  addProjectBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addProjectText: { fontSize: 13, fontWeight: '800' },
  cardList: { gap: 12 },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 2,
  },
  availableRow: { overflow: 'hidden' },
  availableAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  cardSub: { fontSize: 13, fontWeight: '600' },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffdad6',
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
