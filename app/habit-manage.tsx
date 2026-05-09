import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getHabitCheckInListStats } from '@/lib/repositories/habits/habit-check-in';
import { getHabitContexts } from '@/lib/repositories/habits/habit-context';
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
  /** habit_check_ins：有打卡记录的天数 */
  achievedDays: number;
  /** 今日该习惯打卡次数合计 */
  todayCount: number;
};

type HabitGroup = {
  category: string;
  items: HabitItem[];
};

type ContextTab = { id: string; name: string; count: number };

export default function HabitManageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as keyof typeof Colors;
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const [habitData, setHabitData] = React.useState<HabitGroup[]>([]);
  const [contextTabs, setContextTabs] = React.useState<ContextTab[]>([]);
  const [selectedContext, setSelectedContext] = React.useState<string | null>(null);

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
      const [rows, checkStats] = await Promise.all([getHabits(), getHabitCheckInListStats()]);
      const byCtx = new Map<string, HabitItem[]>();

      rows.forEach((r: HabitRow) => {
        const items = byCtx.get(r.context) ?? [];
        const st = checkStats.get(r.id);
        items.push({
          id: r.id,
          name: r.name,
          tag: r.tag ?? '每天',
          icon: r.icon,
          tone: r.tone ?? deriveToneByContext(r.context),
          achievedDays: st?.achievedDays ?? 0,
          todayCount: st?.todayCount ?? 0,
        });
        byCtx.set(r.context, items);
      });

      const contextRows = await getHabitContexts();
      const orderedContexts = contextRows.map((r) => r.name);
      const known = new Set(orderedContexts);
      const legacyContexts = Array.from(byCtx.keys())
        .filter((ctx) => !known.has(ctx))
        .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
      const allContexts = [...orderedContexts, ...legacyContexts];

      const groups: HabitGroup[] = allContexts
        .filter((ctx) => (byCtx.get(ctx) ?? []).length > 0)
        .map((ctx) => ({
          category: ctx,
          items: byCtx.get(ctx) ?? [],
        }));

      const tabs: ContextTab[] = allContexts.map((ctx) => ({
        id: ctx,
        name: ctx,
        count: (byCtx.get(ctx) ?? []).length,
      }));

      setHabitData(groups);
      setContextTabs(tabs);
    } catch (err) {
      console.warn('加载习惯失败', err);
      setHabitData([]);
      setContextTabs([]);
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

  const visibleGroups = React.useMemo(() => {
    if (!selectedContext) return habitData;
    return habitData.filter((g) => g.category === selectedContext);
  }, [habitData, selectedContext]);

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
              <Pressable
                onPress={() => setSelectedContext(null)}
                style={({ pressed }) => [
                  selectedContext === null ? styles.activeTab : [styles.passiveTab, { borderColor: border }],
                  pressed && { opacity: 0.85 },
                ]}>
                <Text style={selectedContext === null ? styles.activeTabText : [styles.passiveTabText, { color: textSub }]}>全部</Text>
              </Pressable>

              {contextTabs.map((tab) => {
                const isActive = selectedContext === tab.id;
                return (
                  <Pressable
                    key={tab.id}
                    onPress={() => setSelectedContext(tab.id)}
                    style={({ pressed }) => [
                      isActive ? styles.activeTab : [styles.passiveTab, { borderColor: border }],
                      pressed && { opacity: 0.85 },
                    ]}>
                    <Text style={isActive ? styles.activeTabText : [styles.passiveTabText, { color: textSub }]}>
                      {tab.name} ({tab.count})
                    </Text>
                  </Pressable>
                );
              })}
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
          {visibleGroups.length === 0 ? (
            <View style={[styles.emptyWrap, { borderColor: border }]}>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>暂无打卡项</Text>
              <Text style={[styles.emptySub, { color: textSub }]}>
                {selectedContext ? `「${selectedContext}」情境下还没有打卡项` : '先去添加一个打卡项吧'}
              </Text>
            </View>
          ) : null}

          {visibleGroups.map((group) => (
            <View key={group.category} style={styles.groupWrap}>
              <Text style={[styles.groupTitle, { color: textSub }]}>{group.category}</Text>
              <View style={styles.groupItems}>
                {group.items.map((item) => {
                  return (
                    <View
                      key={item.id}
                      style={[
                        styles.itemCard,
                        {
                          backgroundColor: isDark ? card : item.tone ?? card,
                          borderColor: 'transparent',
                        },
                      ]}>
                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname: '/habit-detail',
                            params: { habitId: item.id },
                          })
                        }
                        style={({ pressed }) => [styles.itemMainPressable, pressed && { opacity: 0.92 }]}>
                        <View style={styles.itemMain}>
                          <Text style={styles.itemEmoji}>{item.icon}</Text>
                          <View style={styles.itemTextWrap}>
                            <Text style={[styles.itemTitle, { color: theme.text }]}>{item.name}</Text>
                            <View style={styles.itemTag}>
                              <Text style={[styles.itemTagText, { color: textSub }]}>{item.tag ?? ''}</Text>
                            </View>
                            {item.achievedDays > 0 || item.todayCount > 0 ? (
                              <Text style={[styles.itemStats, { color: textSub }]}>
                                {item.todayCount > 0 ? `今日 ${item.todayCount} 次` : null}
                                {item.todayCount > 0 && item.achievedDays > 0 ? ' · ' : null}
                                {item.achievedDays > 0 ? `累计 ${item.achievedDays} 天` : null}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      </Pressable>
                      <Pressable
                        onPress={() => openItemMenu(group.category, item)}
                        style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.75 }]}>
                        <MaterialIcons name="more-vert" size={20} color={textSub} />
                      </Pressable>
                    </View>
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
  emptyWrap: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: 'rgba(148,163,184,0.06)',
  },
  emptyTitle: { fontSize: 15, fontWeight: '800' },
  emptySub: { marginTop: 4, fontSize: 12, fontWeight: '600' },
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
  itemMainPressable: { flex: 1, minWidth: 0 },
  itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemEmoji: { fontSize: 30 },
  itemTextWrap: { gap: 4, flex: 1 },
  itemTitle: { fontSize: 16, fontWeight: '800' },
  itemTag: { alignSelf: 'flex-start', backgroundColor: 'rgba(15,23,42,0.08)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  itemTagText: { fontSize: 11, fontWeight: '600' },
  itemStats: { fontSize: 11, fontWeight: '600', marginTop: 2 },
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
