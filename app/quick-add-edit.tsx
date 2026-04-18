import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  deleteCustomQuickAddItem,
  formatQuickAddAmount,
  getDefaultQuickAddItems,
  isBuiltInQuickAddItem,
  loadAllQuickAddItems,
  loadSelectedQuickAddItems,
  saveSelectedQuickAddKeys,
  type QuickAddCardItem,
} from '@/lib/quick-add-cards';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type QuickAddItem = QuickAddCardItem & { icon: keyof typeof MaterialIcons.glyphMap };

const MAX_HOME_ITEMS = 3;

export default function QuickAddEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const surfaceHigh = isDark ? 'rgba(51,65,85,0.9)' : '#e2e7ff';
  const surfaceLowest = isDark ? 'rgba(15,23,42,0.72)' : '#ffffff';
  const outline = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.35)';
  const [homeItems, setHomeItems] = React.useState<QuickAddItem[]>(() =>
    getDefaultQuickAddItems().map((item) => ({
      ...item,
      icon: item.icon as keyof typeof MaterialIcons.glyphMap,
    }))
  );
  const [allItems, setAllItems] = React.useState<QuickAddItem[]>([]);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      const run = async () => {
        try {
          const [selected, all] = await Promise.all([loadSelectedQuickAddItems(), loadAllQuickAddItems()]);
          if (cancelled) return;
          setHomeItems(
            selected.map((item) => ({
              ...item,
              icon: item.icon as keyof typeof MaterialIcons.glyphMap,
            }))
          );
          setAllItems(
            all.map((item) => ({
              ...item,
              icon: item.icon as keyof typeof MaterialIcons.glyphMap,
            }))
          );
        } catch {
          if (!cancelled) {
            setHomeItems(
              getDefaultQuickAddItems().map((item) => ({
                ...item,
                icon: item.icon as keyof typeof MaterialIcons.glyphMap,
              }))
            );
            setAllItems([]);
          }
        }
      };
      void run();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const availableItems = React.useMemo(() => {
    const selectedKeys = new Set(homeItems.map((item) => item.key));
    return allItems.filter((item) => !selectedKeys.has(item.key)).map((item) => ({
      ...item,
      icon: item.icon as keyof typeof MaterialIcons.glyphMap,
    }));
  }, [allItems, homeItems]);

  const onRemove = React.useCallback((key: string) => {
    setHomeItems((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const reloadItems = React.useCallback(async () => {
    const [selected, all] = await Promise.all([loadSelectedQuickAddItems(), loadAllQuickAddItems()]);
    setHomeItems(
      selected.map((item) => ({
        ...item,
        icon: item.icon as keyof typeof MaterialIcons.glyphMap,
      }))
    );
    setAllItems(
      all.map((item) => ({
        ...item,
        icon: item.icon as keyof typeof MaterialIcons.glyphMap,
      }))
    );
  }, []);

  const onLongPressDelete = React.useCallback(
    (item: QuickAddItem) => {
      if (isBuiltInQuickAddItem(item.key)) {
        Alert.alert('系统项目不可删除', '内置快捷项目不支持删除。');
        return;
      }
      Alert.alert('删除项目', `确定删除「${item.label}」吗？`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteCustomQuickAddItem(item.key);
                await reloadItems();
              } catch {
                Alert.alert('删除失败', '请稍后重试。');
              }
            })();
          },
        },
      ]);
    },
    [reloadItems]
  );

  const onAdd = React.useCallback((item: QuickAddItem) => {
    setHomeItems((prev) => {
      if (prev.some((v) => v.key === item.key)) return prev;
      if (prev.length >= MAX_HOME_ITEMS) {
        Alert.alert('最多3个', '首页快捷卡片最多展示 3 个，请先移除一个再添加。');
        return prev;
      }
      return [...prev, item];
    });
  }, []);

  const onSave = React.useCallback(async () => {
    if (homeItems.length === 0) {
      Alert.alert('请至少保留1个', '至少保留一个快捷卡片，方便快速记录。');
      return;
    }
    try {
      await saveSelectedQuickAddKeys(homeItems.map((item) => item.key));
      router.back();
    } catch {
      Alert.alert('保存失败', '请稍后重试。');
    }
  }, [homeItems, router]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.8)' : 'rgba(250,248,255,0.85)' }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>编辑快捷卡片</Text>
        <Pressable onPress={() => void onSave()} style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.75 }]}>
          <Text style={[styles.saveText, { color: theme.primary }]}>保存</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 28 + Math.max(insets.bottom, 12) }]} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>首页展示 (最多3个)</Text>
          <View style={styles.cardList}>
            {homeItems.map((item) => (
              <Pressable
                key={item.key}
                onLongPress={() => onLongPressDelete(item)}
                delayLongPress={280}
                style={[styles.cardRow, { backgroundColor: surfaceLowest, borderColor: outline }]}
              >
                <View style={[styles.iconWrap, { backgroundColor: surfaceHigh }]}>
                  <MaterialIcons name={item.icon} size={28} color={theme.primary} />
                </View>
                <View style={styles.cardBody}>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>{item.label}</Text>
                  <Text style={[styles.cardSub, { color: theme.textSecondary }]}>{formatQuickAddAmount(item)}</Text>
                </View>
                <Pressable onPress={() => onRemove(item.key)} style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.8 }]}>
                  <MaterialIcons name="remove" size={18} color="#ba1a1a" />
                </Pressable>
              </Pressable>
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
              <Pressable
                key={item.key}
                onLongPress={() => onLongPressDelete(item)}
                delayLongPress={280}
                style={[styles.cardRow, styles.availableRow, { backgroundColor: surfaceLowest, borderColor: outline }]}
              >
                <View style={[styles.availableAccent, { backgroundColor: `${theme.primary}33` }]} />
                <View style={[styles.iconWrap, { backgroundColor: surfaceHigh }]}>
                  <MaterialIcons name={item.icon} size={28} color={theme.text} />
                </View>
                <View style={styles.cardBody}>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>{item.label}</Text>
                  <Text style={[styles.cardSub, { color: theme.textSecondary }]}>{formatQuickAddAmount(item)}</Text>
                </View>
                <Pressable onPress={() => onAdd(item)} style={({ pressed }) => [styles.addBtn, { backgroundColor: `${theme.primary}14` }, pressed && { opacity: 0.8 }]}>
                  <MaterialIcons name="add" size={22} color={theme.primary} />
                </Pressable>
              </Pressable>
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
