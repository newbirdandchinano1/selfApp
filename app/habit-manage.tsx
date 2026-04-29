import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getHabits, deleteHabit as deleteHabitById } from '@/lib/repositories/habits/habit';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type HabitItem = {
  id: string;
  name: string;
  tag: string | null;
  icon: string;
  tone: string | null;
};

type HabitGroup = {
  category: string;
  items: HabitItem[];
};

const HABIT_CONTEXT_ORDER = ['起床', '晨间', '中午', '午间', '晚间', '睡前', '全天'];

export default function HabitManageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [habitData, setHabitData] = React.useState<HabitGroup[]>([]);

  const [menuVisible, setMenuVisible] = React.useState(false);
  const [menuTarget, setMenuTarget] = React.useState<{ groupCategory: string; item: HabitItem } | null>(null);

  const bg = isDark ? theme.background : '#f8fafc';
  const card = isDark ? 'rgba(15,23,42,0.86)' : '#fff';
  const border = isDark ? 'rgba(148,163,184,0.26)' : 'rgba(148,163,184,0.18)';
  const textSub = theme.textSecondary;

  const deriveToneByContext = React.useCallback((context: string): string => {
    const map: Record<string, string> = {
      起床: '#EFE5E9',
      晨间: '#F4EBE3',
      中午: '#F4EBE3',
      午间: '#EFF5E1',
      晚间: '#EFE1DF',
      睡前: '#E1EFEB',
      全天: '#EFE1DF',
    };
    return map[context] ?? '#EFE1DF';
  }, []);

  const loadHabits = React.useCallback(async () => {
    try {
      const rows = await getHabits();
      const byCtx = new Map<string, HabitItem[]>();

      rows.forEach((r: HabitRow) => {
        const items = byCtx.get(r.context) ?? [];
        items.push({
          id: r.id,
          name: r.name,
          tag: r.tag ?? '每天',
          icon: r.icon,
          tone: r.tone ?? deriveToneByContext(r.context),
        });
        byCtx.set(r.context, items);
      });

      const groups: HabitGroup[] = HABIT_CONTEXT_ORDER.filter((ctx) => (byCtx.get(ctx) ?? []).length > 0).map((ctx) => ({
        category: ctx,
        items: byCtx.get(ctx) ?? [],
      }));

      setHabitData(groups);
    } catch (err) {
      console.warn('加载习惯失败', err);
      setHabitData([]);
    }
  }, [deriveToneByContext]);

  useFocusEffect(
    React.useCallback(() => {
      void loadHabits();
    }, [loadHabits])
  );

  const openItemMenu = (groupCategory: string, item: HabitItem) => {
    setMenuTarget({ groupCategory, item });
    setMenuVisible(true);
  };

  const closeItemMenu = () => {
    setMenuVisible(false);
    setMenuTarget(null);
  };

  const goEditHabit = (groupCategory: string, item: HabitItem) => {
    closeItemMenu();
    router.push({
      pathname: '/add-habit',
      params: {
        mode: 'edit',
        name: item.name,
        icon: item.icon,
        context: groupCategory,
        habitId: item.id,
      },
    });
  };

  const deleteHabit = (groupCategory: string, item: HabitItem) => {
    closeItemMenu();
    Alert.alert('删除习惯', `确认删除「${item.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteHabitById(item.id);
              await loadHabits();
            } catch (err) {
              console.warn('删除习惯失败', err);
            }
          })();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 24 + Math.max(insets.bottom, 8) },
        ]}
        showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.header,
            {
              backgroundColor: card,
              borderBottomColor: border,
            },
          ]}>
          <View style={styles.headerTop}>
            <View style={styles.sideWrap}>
              <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.roundBtn, pressed && { opacity: 0.75 }]}>
                <MaterialIcons name="arrow-back" size={22} color={theme.text} />
              </Pressable>
            </View>

            <View style={styles.headerTitleWrap}>
              <Text style={[styles.headerTitle, { color: theme.text }]}>打卡管理</Text>
              <Text style={[styles.headerSubtitle, { color: textSub }]}>浏览与管理所有的打卡项</Text>
            </View>

            <View style={[styles.sideWrap, { alignItems: 'flex-end' }]}>
              <Pressable onPress={() => router.push('/add-habit')} style={({ pressed }) => [styles.roundBtn, pressed && { opacity: 0.75 }]}>
                <MaterialIcons name="add" size={24} color={theme.text} />
              </Pressable>
            </View>
          </View>

          <View style={styles.filterBarRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabsRow}>
              <View style={styles.activeTab}>
                <Text style={styles.activeTabText}>全部</Text>
              </View>
              {habitData.map((group) => (
                <View key={group.category} style={[styles.passiveTab, { borderColor: border }]}>
                  <Text style={[styles.passiveTabText, { color: textSub }]}>
                    {group.category} ({group.items.length})
                  </Text>
                </View>
              ))}
              <Pressable
                onPress={() => router.push('/habit-context')}
                style={({ pressed }) => [
                  styles.contextFilterBtn,
                  pressed && { opacity: 0.85 },
                  { borderColor: border },
                ]}>
                <MaterialIcons name="tune" size={16} color={textSub} />
                <Text style={[styles.contextFilterText, { color: textSub }]}>情境</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>

        <View style={styles.listWrap}>
          {habitData.map((group) => (
            <View key={group.category} style={styles.groupWrap}>
              <Text style={[styles.groupTitle, { color: textSub }]}>{group.category}</Text>
              <View style={styles.groupItems}>
                {group.items.map((item) => {
                  return (
                    <Pressable
                      key={item.id}
                      onLongPress={() =>
                        router.push({
                          pathname: '/add-habit',
                          params: {
                            mode: 'edit',
                            name: item.name,
                            icon: item.icon,
                            context: group.category,
                            habitId: item.id,
                          },
                        })
                      }
                      delayLongPress={260}
                      style={[
                        styles.itemCard,
                        {
                          backgroundColor: isDark ? card : item.tone ?? card,
                          borderColor: 'transparent',
                        },
                      ]}>
                      <View style={styles.itemMain}>
                        <Text style={styles.itemEmoji}>{item.icon}</Text>
                        <View style={styles.itemTextWrap}>
                          <Text style={[styles.itemTitle, { color: theme.text }]}>{item.name}</Text>
                          <View style={styles.itemTag}>
                            <Text style={[styles.itemTagText, { color: textSub }]}>{item.tag ?? ''}</Text>
                          </View>
                        </View>
                      </View>
                      <Pressable
                        onPress={() => openItemMenu(group.category, item)}
                        style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.75 }]}>
                        <MaterialIcons name="more-vert" size={20} color={textSub} />
                      </Pressable>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={closeItemMenu}>
        <Pressable style={styles.modalRoot} onPress={closeItemMenu} />
        <View style={[styles.menuSheet, { paddingBottom: 12 + Math.max(insets.bottom, 6) }]}>
          <Text style={[styles.menuTitle, { color: theme.text }]}>{menuTarget ? '操作' : ''}</Text>

          <Pressable
            disabled={!menuTarget}
            onPress={() => {
              if (!menuTarget) return;
              goEditHabit(menuTarget.groupCategory, menuTarget.item);
            }}
            style={({ pressed }) => [styles.menuItem, pressed && { opacity: 0.9 }]}>
            <MaterialIcons name="edit" size={18} color={theme.text} />
            <Text style={[styles.menuItemText, { color: theme.text }]}>编辑习惯</Text>
          </Pressable>

          <Pressable
            disabled={!menuTarget}
            onPress={() => {
              if (!menuTarget) return;
              deleteHabit(menuTarget.groupCategory, menuTarget.item);
            }}
            style={({ pressed }) => [styles.menuItem, styles.menuItemDanger, pressed && { opacity: 0.9 }]}>
            <MaterialIcons name="delete" size={18} color={'#E86766'} />
            <Text style={[styles.menuItemText, { color: '#E86766' }]}>删除习惯</Text>
          </Pressable>

          <Pressable onPress={closeItemMenu} style={({ pressed }) => [styles.menuCancel, pressed && { opacity: 0.85 }]}>
            <Text style={[styles.menuCancelText, { color: theme.textSecondary }]}>取消</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: 10 },
  header: {
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  sideWrap: { width: 56, justifyContent: 'center' },
  sideText: { fontSize: 15, fontWeight: '600' },
  roundBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  headerSubtitle: { fontSize: 11, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, marginTop: 10 },
  actionBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  actionBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  modeRow: { paddingHorizontal: 14, marginTop: 8 },
  modeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  filterBarRow: { paddingHorizontal: 14 },
  tabsRow: { paddingTop: 12, paddingBottom: 8, gap: 8, alignItems: 'center', flexDirection: 'row' },
  contextFilterBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  contextFilterText: { fontSize: 13, fontWeight: '600' },
  activeTab: { backgroundColor: '#433B3E', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  activeTabText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  passiveTab: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  passiveTabText: { fontSize: 13, fontWeight: '600' },
  listWrap: { paddingHorizontal: 14, paddingTop: 6, gap: 16 },
  groupWrap: { gap: 10 },
  groupTitle: { fontSize: 13, fontWeight: '600', paddingLeft: 4 },
  groupItems: { gap: 10 },
  itemCard: {
    borderRadius: 20,
    borderWidth: 2,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkWrap: { marginRight: 10 },
  checkedCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#43373B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uncheckedCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.5)' },
  itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemEmoji: { fontSize: 30 },
  itemTextWrap: { gap: 4, flex: 1 },
  itemTitle: { fontSize: 16, fontWeight: '800' },
  itemTag: { alignSelf: 'flex-start', backgroundColor: 'rgba(15,23,42,0.08)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  itemTagText: { fontSize: 11, fontWeight: '600' },
  moreBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },

  modalRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.35)',
  },
  menuSheet: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 0,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    backgroundColor: 'rgba(255,255,255,0.97)',
    gap: 10,
  },
  menuTitle: { fontSize: 14, fontWeight: '800', marginBottom: 2, alignSelf: 'flex-start' },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(148,163,184,0.10)',
  },
  menuItemDanger: {
    backgroundColor: 'rgba(232,103,102,0.12)',
  },
  menuItemText: { fontSize: 15, fontWeight: '800' },
  menuCancel: { paddingVertical: 12, alignItems: 'center' },
  menuCancelText: { fontSize: 15, fontWeight: '700' },
});
