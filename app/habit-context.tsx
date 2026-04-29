import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getHabits } from '@/lib/repositories/habits/habit';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type ContextRow = { id: string; name: string; count: number | null; isDefault?: boolean };

const HABIT_CONTEXT_ORDER = ['起床', '晨间', '中午', '午间', '晚间', '睡前', '全天'];

export default function HabitContextScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const bg = isDark ? theme.background : '#ffffff';
  const card = isDark ? 'rgba(15,23,42,0.86)' : '#F7F7F9';
  const textSub = theme.textSecondary;
  const headerBg = isDark ? 'rgba(15,23,42,0.88)' : 'rgba(255,255,255,0.92)';

  const [contextData, setContextData] = React.useState<ContextRow[]>(() =>
    HABIT_CONTEXT_ORDER.map((ctx) => ({ id: ctx, name: ctx, count: null, isDefault: ctx === '全天' }))
  );

  const loadContextCounts = React.useCallback(async () => {
    try {
      const rows = await getHabits();
      const countByContext = new Map<string, number>();
      rows.forEach((r) => {
        const prev = countByContext.get(r.context) ?? 0;
        countByContext.set(r.context, prev + 1);
      });
      const next = HABIT_CONTEXT_ORDER.map((ctx) => {
        const cnt = countByContext.get(ctx) ?? 0;
        return { id: ctx, name: ctx, count: cnt > 0 ? cnt : null, isDefault: ctx === '全天' };
      });
      setContextData(next);
    } catch (err) {
      console.warn('加载习惯情境失败', err);
      setContextData((prev) => prev);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      void loadContextCounts();
    }, [loadContextCounts])
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['top']}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: headerBg,
            borderBottomColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(226,232,240,0.85)',
          },
        ]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.closeBtn}>
          <MaterialIcons name="close" size={24} color={theme.text} />
        </Pressable>

        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: theme.text }]}>习惯情境</Text>
        </View>

        <View style={styles.headerRight}>
          <Pressable>
            <Text style={[styles.selectText, { color: textSub }]}>选择</Text>
          </Pressable>
          <Pressable onPress={() => {}} hitSlop={10}>
            <MaterialIcons name="add" size={24} color={theme.text} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.list}>
          {contextData.map((item) => (
            <Pressable
              key={item.id}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: card },
                pressed && { opacity: 0.92 },
              ]}>
              <View style={styles.rowLeft}>
                <MaterialIcons name="drag-indicator" size={20} color={textSub} />
                <Text style={[styles.rowText, { color: theme.text }]}>
                  {item.name}
                  {item.isDefault ? (
                    <Text style={{ color: textSub, fontWeight: '500' }}> (系统默认)</Text>
                  ) : null}
                </Text>
              </View>

              {item.count !== null ? <Text style={[styles.countText, { color: textSub }]}>{item.count}</Text> : null}
            </Pressable>
          ))}
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
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  selectText: { fontSize: 14, fontWeight: '600' },
  content: { paddingHorizontal: 18, paddingBottom: 18 },
  list: { gap: 10 },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 16,
    borderRadius: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { fontSize: 15, fontWeight: '800' },
  countText: { fontSize: 15, fontWeight: '700' },
});

