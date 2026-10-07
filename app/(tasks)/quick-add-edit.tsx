import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  deleteQuickAddItem,
  getDefaultQuickAddItems,
  getQuickAddMetricAmount,
  getQuickAddMetricTypes,
  loadAllQuickAddItems,
  loadSelectedQuickAddItems,
  saveSelectedQuickAddKeys,
  type QuickAddCardItem,
} from '@/lib/quick-add-cards';
import { MaterialIcons } from '@expo/vector-icons';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { notifyPageDataChanged } from '@/lib/page-api-session';
import { useFocusEffect, useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type QuickAddItem = QuickAddCardItem & { icon: keyof typeof MaterialIcons.glyphMap };

const metricMetaMap = {
  hydration: { label: '水分', unit: 'ml' },
  protein: { label: '蛋白质', unit: 'g' },
  carbohydrate: { label: '碳水', unit: 'g' },
  calories: { label: '热量', unit: 'kcal' },
} satisfies Record<NonNullable<QuickAddCardItem['metricTypes']>[number], { label: string; unit: string }>;

function getMetricLabels(item: QuickAddCardItem): string[] {
  return getQuickAddMetricTypes(item).map((metric) => {
    const meta = metricMetaMap[metric];
    return `${meta.label} ${Math.round(getQuickAddMetricAmount(item, metric))}${meta.unit}`;
  });
}

const PAGE_API_KEY = 'quick-add-edit';

function toIconItems(items: QuickAddCardItem[]): QuickAddItem[] {
  return items.map((item) => ({
    ...item,
    icon: item.icon as keyof typeof MaterialIcons.glyphMap,
  }));
}

export default function QuickAddEditScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const themeKey = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = Colors[themeKey];
  const isDark = themeKey === 'dark';

  const surfaceHigh = isDark ? 'rgba(51,65,85,0.9)' : '#e2e7ff';
  const surfaceLowest = isDark ? 'rgba(15,23,42,0.72)' : '#ffffff';
  const outline = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.35)';
  const [homeItems, setHomeItems] = React.useState<QuickAddItem[]>(() => toIconItems(getDefaultQuickAddItems()));
  const [allItems, setAllItems] = React.useState<QuickAddItem[]>([]);
  const [itemsLoading, setItemsLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const applyLoaded = React.useCallback((selected: QuickAddCardItem[], all: QuickAddCardItem[]) => {
    setHomeItems(toIconItems(selected));
    setAllItems(toIconItems(all));
  }, []);

  const reload = React.useCallback(
    async (forceRefresh = false) => {
      setItemsLoading(true);
      try {
        await wrapLoad(async () => {
          try {
            const [selected, all] = await Promise.all([loadSelectedQuickAddItems(), loadAllQuickAddItems()]);
            applyLoaded(selected, all);
          } catch (e) {
            console.warn('加载快捷卡片失败', e);
          }
        }, forceRefresh);
      } finally {
        setItemsLoading(false);
      }
    },
    [applyLoaded, wrapLoad]
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload])
  );

  const availableItems = React.useMemo(() => {
    const selectedKeys = new Set(homeItems.map((item) => item.key));
    return allItems.filter((item) => !selectedKeys.has(item.key));
  }, [allItems, homeItems]);

  const onRemove = React.useCallback((key: string) => {
    setHomeItems((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const reloadItems = React.useCallback(async () => {
    const [selected, all] = await Promise.all([loadSelectedQuickAddItems(), loadAllQuickAddItems()]);
    applyLoaded(selected, all);
  }, [applyLoaded]);

  const onLongPressDelete = React.useCallback(
    (item: QuickAddItem) => {
      Alert.alert('删除项目', `确定删除「${item.label}」吗？删除后可在「添加项目」中重新创建。`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteQuickAddItem(item.key);
                await reloadItems();
                notifyPageDataChanged(PAGE_API_KEY);
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
      return [...prev, item];
    });
  }, []);

  const onSave = React.useCallback(async () => {
    if (itemsLoading || saving) return;
    setSaving(true);
    try {
      await saveSelectedQuickAddKeys(homeItems.map((item) => item.key));
      notifyPageDataChanged(PAGE_API_KEY);
      router.back();
    } catch {
      Alert.alert('保存失败', '请稍后重试。');
    } finally {
      setSaving(false);
    }
  }, [homeItems, itemsLoading, router, saving]);

  const saveDisabled = itemsLoading || saving;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.8)' : 'rgba(250,248,255,0.85)' }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>编辑快捷卡片</Text>
        <Pressable
          onPress={() => void onSave()}
          disabled={saveDisabled}
          style={({ pressed }) => [styles.saveBtn, (pressed || saveDisabled) && { opacity: 0.75 }]}
        >
          <Text style={[styles.saveText, { color: saveDisabled ? theme.textSecondary : theme.primary }]}>
            {itemsLoading ? '加载中' : saving ? '保存中' : '保存'}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={[styles.content, { paddingBottom: 28 + Math.max(insets.bottom, 12) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>首页展示</Text>
          <View style={styles.cardList}>
            {homeItems.length === 0 ? (
              <View style={[styles.emptyBox, { backgroundColor: surfaceLowest, borderColor: outline }]}>
                <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                  首页快速添加栏为空。可从下方添加，或保存后保持空栏。
                </Text>
              </View>
            ) : (
              homeItems.map((item) => (
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
                    <View style={styles.metricTagWrap}>
                      {getMetricLabels(item).map((label) => (
                        <View key={label} style={[styles.metricTag, { backgroundColor: `${theme.primary}14` }]}>
                          <Text style={[styles.metricTagText, { color: theme.primary }]}>{label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  <Pressable onPress={() => onRemove(item.key)} style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.8 }]}>
                    <MaterialIcons name="remove" size={18} color="#ba1a1a" />
                  </Pressable>
                </Pressable>
              ))
            )}
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
            {availableItems.length === 0 ? (
              <View style={[styles.emptyBox, { backgroundColor: surfaceLowest, borderColor: outline }]}>
                <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                  暂无可添加项目。点右上角「添加项目」创建新卡片。
                </Text>
              </View>
            ) : (
              availableItems.map((item) => (
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
                    <View style={styles.metricTagWrap}>
                      {getMetricLabels(item).map((label) => (
                        <View key={label} style={[styles.metricTag, { backgroundColor: `${theme.primary}14` }]}>
                          <Text style={[styles.metricTagText, { color: theme.primary }]}>{label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  <Pressable onPress={() => onAdd(item)} style={({ pressed }) => [styles.addBtn, { backgroundColor: `${theme.primary}14` }, pressed && { opacity: 0.8 }]}>
                    <MaterialIcons name="add" size={22} color={theme.primary} />
                  </Pressable>
                </Pressable>
              ))
            )}
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
  emptyBox: {
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 20,
  },
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
  cardTitle: { fontSize: 16, fontWeight: '800' },
  metricTagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  metricTag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  metricTagText: { fontSize: 11, fontWeight: '800' },
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
