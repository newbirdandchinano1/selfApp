import { ScreenHeader, ScreenHeaderIconAction } from '@/components/ui/screen-header';
import { Layout, Radius, Shadows, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import { getHabitCheckInListStats } from '@/lib/repositories/habits/habit-check-in';
import { getHabitContexts } from '@/lib/repositories/habits/habit-context';
import { cancelScheduledHabitReminder } from '@/lib/habit-reminder-notifications';
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
  achievedDays: number;
  todayCount: number;
};

type HabitGroup = {
  category: string;
  items: HabitItem[];
};

type ContextTab = { id: string; name: string; count: number };

const PAGE_API_KEY = 'habit-manage';

export default function HabitManageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark, shadows } = useAppTheme();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const [habitData, setHabitData] = React.useState<HabitGroup[]>([]);
  const [contextTabs, setContextTabs] = React.useState<ContextTab[]>([]);
  const [selectedContext, setSelectedContext] = React.useState<string | null>(null);

  const [menuVisible, setMenuVisible] = React.useState(false);
  const [menuTarget, setMenuTarget] = React.useState<{ groupCategory: string; item: HabitItem } | null>(null);

  const loadHabits = React.useCallback(async () => {
    await wrapLoad(async () => {
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
    });
  }, [wrapLoad]);

  useFocusEffect(
    React.useCallback(() => {
      void loadHabits();
    }, [loadHabits]),
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
              void cancelScheduledHabitReminder(item.id);
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

  const renderFilterPill = (key: string, label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterPill,
        {
          backgroundColor: active ? colors.primary : isDark ? colors.surfaceMuted : colors.capsule,
          borderColor: active ? colors.primary : colors.outline,
        },
        pressed && { opacity: 0.88 },
      ]}>
      <Text
        style={[
          styles.filterPillText,
          { color: active ? colors.onPrimary : colors.textSecondary },
        ]}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['left', 'right', 'bottom']}>
      <ScreenHeader
        title="打卡管理"
        subtitle="浏览与管理所有的打卡项"
        onBack={() => router.back()}
        right={
          <ScreenHeaderIconAction
            icon="add"
            onPress={() => router.push('/add-habit')}
            accessibilityLabel="新建习惯"
          />
        }
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Spacing['6xl'] + Math.max(insets.bottom, Spacing.md) },
        ]}
        showsVerticalScrollIndicator={false}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsRow}>
          {renderFilterPill('all', '全部', selectedContext === null, () => setSelectedContext(null))}
          {contextTabs.map((tab) =>
            renderFilterPill(
              tab.id,
              `${tab.name} (${tab.count})`,
              selectedContext === tab.id,
              () => setSelectedContext(tab.id),
            ),
          )}
          <Pressable
            onPress={() => router.push('/habit-context')}
            style={({ pressed }) => [
              styles.contextFilterBtn,
              { borderColor: colors.outline, backgroundColor: isDark ? colors.surfaceMuted : colors.capsule },
              pressed && { opacity: 0.88 },
            ]}>
            <MaterialIcons name="tune" size={16} color={colors.textSecondary} />
            <Text style={[styles.contextFilterText, { color: colors.textSecondary }]}>情境</Text>
          </Pressable>
        </ScrollView>

        <View style={styles.listWrap}>
          {visibleGroups.length === 0 ? (
            <View style={[styles.emptyWrap, shadows.card, { borderColor: colors.outline, backgroundColor: colors.surfaceSubtle }]}>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>暂无打卡项</Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                {selectedContext ? `「${selectedContext}」情境下还没有打卡项` : '先去添加一个打卡项吧'}
              </Text>
            </View>
          ) : null}

          {visibleGroups.map((group) => (
            <View key={group.category} style={styles.groupWrap}>
              <Text style={[Typography.kicker, styles.groupTitle, { color: colors.textSecondary }]}>{group.category}</Text>
              <View style={styles.groupItems}>
                {group.items.map((item) => (
                  <View
                    key={item.id}
                    style={[
                      styles.itemCard,
                      shadows.card,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.outline,
                        borderLeftColor: colors.primary,
                      },
                    ]}>
                    <Pressable
                      onPress={() => goEditHabit(group.category, item)}
                      style={({ pressed }) => [styles.itemMainPressable, pressed && { opacity: 0.92 }]}>
                      <View style={styles.itemMain}>
                        <Text style={styles.itemEmoji}>{item.icon}</Text>
                        <View style={styles.itemTextWrap}>
                          <Text style={[styles.itemTitle, { color: colors.text }]}>{item.name}</Text>
                          <View style={[styles.itemTag, { backgroundColor: colors.surfaceMuted }]}>
                            <Text style={[styles.itemTagText, { color: colors.textSecondary }]}>{item.tag ?? ''}</Text>
                          </View>
                          {item.achievedDays > 0 || item.todayCount > 0 ? (
                            <Text style={[styles.itemStats, { color: colors.textSecondary }]}>
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
                      <MaterialIcons name="more-vert" size={20} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={closeItemMenu}>
        <Pressable style={[styles.modalRoot, { backgroundColor: colors.overlay }]} onPress={closeItemMenu} />
        <View
          style={[
            styles.menuSheet,
            shadows.sheet,
            {
              paddingBottom: Spacing.xl + Math.max(insets.bottom, Spacing.sm),
              backgroundColor: colors.surface,
              borderColor: colors.outline,
            },
          ]}>
          <Text style={[styles.menuTitle, { color: colors.text }]}>{menuTarget ? '操作' : ''}</Text>

          <Pressable
            disabled={!menuTarget}
            onPress={() => {
              if (!menuTarget) return;
              goEditHabit(menuTarget.groupCategory, menuTarget.item);
            }}
            style={({ pressed }) => [
              styles.menuItem,
              { backgroundColor: colors.surfaceMuted },
              pressed && { opacity: 0.9 },
            ]}>
            <MaterialIcons name="edit" size={18} color={colors.text} />
            <Text style={[styles.menuItemText, { color: colors.text }]}>编辑习惯</Text>
          </Pressable>

          <Pressable
            disabled={!menuTarget}
            onPress={() => {
              if (!menuTarget) return;
              deleteHabit(menuTarget.groupCategory, menuTarget.item);
            }}
            style={({ pressed }) => [
              styles.menuItem,
              { backgroundColor: isDark ? 'rgba(220,38,38,0.2)' : 'rgba(220,38,38,0.1)' },
              pressed && { opacity: 0.9 },
            ]}>
            <MaterialIcons name="delete" size={18} color={colors.danger} />
            <Text style={[styles.menuItemText, { color: colors.danger }]}>删除习惯</Text>
          </Pressable>

          <Pressable onPress={closeItemMenu} style={({ pressed }) => [styles.menuCancel, pressed && { opacity: 0.85 }]}>
            <Text style={[styles.menuCancelText, { color: colors.textSecondary }]}>取消</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['3xl'],
    gap: Spacing['4xl'],
  },
  tabsRow: {
    gap: Spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    paddingBottom: Spacing.sm,
  },
  filterPill: {
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  contextFilterBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  contextFilterText: { fontSize: 13, fontWeight: '600' },
  listWrap: { gap: Spacing['3xl'] },
  emptyWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius['2xl'],
    paddingHorizontal: Spacing['4xl'],
    paddingVertical: Spacing['4xl'],
  },
  emptyTitle: { ...Typography.title },
  emptySub: { marginTop: Spacing.xs, ...Typography.caption },
  groupWrap: { gap: Spacing.lg },
  groupTitle: { paddingLeft: Spacing.xs },
  groupItems: { gap: Spacing.lg },
  itemCard: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    paddingHorizontal: Spacing['4xl'],
    paddingVertical: Spacing['4xl'],
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemMainPressable: { flex: 1, minWidth: 0 },
  itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  itemEmoji: { fontSize: 30 },
  itemTextWrap: { gap: Spacing.xs, flex: 1 },
  itemTitle: { fontSize: 16, fontWeight: '800' },
  itemTag: {
    alignSelf: 'flex-start',
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 2,
  },
  itemTagText: { fontSize: 11, fontWeight: '600' },
  itemStats: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  moreBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRoot: { ...StyleSheet.absoluteFillObject },
  menuSheet: {
    position: 'absolute',
    left: Spacing['5xl'],
    right: Spacing['5xl'],
    bottom: 0,
    borderRadius: Radius.sheet,
    paddingHorizontal: Spacing['4xl'],
    paddingTop: Spacing.xl,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.lg,
  },
  menuTitle: { fontSize: 14, fontWeight: '800', marginBottom: 2, alignSelf: 'flex-start' },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.lg,
  },
  menuItemText: { fontSize: 15, fontWeight: '800' },
  menuCancel: { paddingVertical: Spacing.xl, alignItems: 'center' },
  menuCancelText: { fontSize: 15, fontWeight: '700' },
});
