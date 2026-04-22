import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function CategorySortScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [categories] = React.useState(['工作', '个人', '学习', '收件箱']);

  const bg = isDark ? theme.background : '#faf8ff';
  const surface = isDark ? 'rgba(30, 41, 59, 0.7)' : '#ffffff';
  const outline = isDark ? 'rgba(148,163,184,0.6)' : '#727785';
  const border = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.55)';
  const primary = isDark ? '#60a5fa' : '#0058be';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: border, backgroundColor: isDark ? 'rgba(15,23,42,0.7)' : 'rgba(255,255,255,0.8)' }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
          <MaterialIcons name="arrow-back" size={22} color={primary} />
        </Pressable>

        <Text style={[styles.title, { color: primary }]}>分类排序</Text>

        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.doneBtn, pressed && styles.pressed]}>
          <Text style={[styles.doneText, { color: primary }]}>完成</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        <Text style={[styles.hint, { color: outline }]}>长按拖动以重新排序分类</Text>

        <View style={styles.listWrap}>
          {categories.map((item) => (
            <Pressable key={item} style={({ pressed }) => [styles.item, { backgroundColor: surface, borderColor: border }, pressed && styles.itemPressed]}>
              <Text style={[styles.itemText, { color: theme.text }]}>{item}</Text>
              <MaterialIcons name="drag-handle" size={22} color={outline} />
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 58,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  doneBtn: {
    minWidth: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 6,
  },
  doneText: {
    fontSize: 14,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 20,
  },
  hint: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  listWrap: {
    gap: 10,
  },
  item: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemPressed: {
    opacity: 0.82,
  },
  itemText: {
    fontSize: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.75,
  },
});
