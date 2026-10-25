import { recipeGlassTabBarContentInset } from '@/components/recipe/recipe-glass-tab-bar';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { fetchProfileRecipes } from '@/lib/profile-page-api';
import { loadRecipePlanStore, type RecipePlanStore } from '@/lib/recipe-plan';
import {
  buildShopList,
  clearRecipeShopState,
  formatShopSources,
  loadRecipeShopState,
  setShopItemStatus,
  setShopItemsStatus,
  SHOP_STATUS_META,
  type RecipeShopState,
  type ShopItemStatus,
  type ShopListItem,
} from '@/lib/recipe-shop';
import { getRecipePalette } from '@/lib/recipe-theme';
import { loadRecipeStore, type RecipeStore } from '@/lib/recipes';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ViewMode = 'recipe' | 'status';

export default function RecipeShopScreen() {
  const insets = useSafeAreaInsets();
  const p = getRecipePalette(useColorScheme());
  const tabBarInset = recipeGlassTabBarContentInset(insets.bottom);

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<RecipePlanStore>({ version: 1, entries: [] });
  const [recipes, setRecipes] = useState<RecipeStore>({ version: 2, categories: [], recipes: [] });
  const [shopState, setShopState] = useState<RecipeShopState>({
    version: 1,
    overrides: {},
    addedRecipes: [],
  });

  const [viewMode, setViewMode] = useState<ViewMode>('status');
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      await fetchProfileRecipes({ serverFallback: true });
      const [planStore, recipeStore, state] = await Promise.all([
        loadRecipePlanStore(),
        loadRecipeStore(),
        loadRecipeShopState(),
      ]);
      setPlan(planStore);
      setRecipes(recipeStore);
      setShopState(state);
    } catch {
      toast.error('加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const items = useMemo(
    () => buildShopList(plan, recipes, shopState),
    [plan, recipes, shopState],
  );

  const byStatus = useMemo(() => {
    const map: Record<ShopItemStatus, ShopListItem[]> = {
      todo: [],
      stock: [],
      bought: [],
    };
    for (const it of items) map[it.status].push(it);
    return map;
  }, [items]);

  const byRecipe = useMemo(() => {
    const map = new Map<string, { title: string; items: ShopListItem[] }>();
    for (const it of items) {
      if (it.recipeTitles.length === 0) {
        const key = '__unknown__';
        let g = map.get(key);
        if (!g) {
          g = { title: '未关联菜谱', items: [] };
          map.set(key, g);
        }
        g.items.push(it);
        continue;
      }
      // 按首个来源菜谱分组；跨菜合并项会出现在第一道菜下
      const title = it.recipeTitles[0];
      const key = it.recipeIds[0] ?? title;
      let g = map.get(key);
      if (!g) {
        g = { title, items: [] };
        map.set(key, g);
      }
      g.items.push(it);
    }
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  }, [items]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const toggleSelect = useCallback((key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const exitBatch = useCallback(() => {
    setBatchMode(false);
    setSelected(new Set());
  }, []);

  const onToggleItem = useCallback(
    async (item: ShopListItem) => {
      if (batchMode) {
        toggleSelect(item.key);
        return;
      }
      // 待采购 → 已采购；已采购 / 库存 → 待采购（点圆圈勾选）
      const next: ShopItemStatus =
        item.status === 'todo' ? 'bought' : item.status === 'bought' ? 'todo' : 'todo';
      setBusy(true);
      try {
        const state = await setShopItemStatus(item.key, next);
        setShopState(state);
      } catch (e) {
        toast.error(toUserMessage(e, '更新失败'));
      } finally {
        setBusy(false);
      }
    },
    [batchMode, toggleSelect],
  );

  const onLongPressItem = useCallback((item: ShopListItem) => {
    Alert.alert(item.name, undefined, [
      {
        text: '标为待采购',
        onPress: () => {
          void setShopItemStatus(item.key, 'todo').then(setShopState).catch(e => {
            toast.error(toUserMessage(e, '更新失败'));
          });
        },
      },
      {
        text: '标为已有库存',
        onPress: () => {
          void setShopItemStatus(item.key, 'stock').then(setShopState).catch(e => {
            toast.error(toUserMessage(e, '更新失败'));
          });
        },
      },
      {
        text: '标为已采购',
        onPress: () => {
          void setShopItemStatus(item.key, 'bought').then(setShopState).catch(e => {
            toast.error(toUserMessage(e, '更新失败'));
          });
        },
      },
      { text: '取消', style: 'cancel' },
    ]);
  }, []);

  const applyBatchStatus = useCallback(
    (status: ShopItemStatus) => {
      const keys = [...selected];
      if (keys.length === 0) {
        toast.info('请先勾选项目');
        return;
      }
      void (async () => {
        setBusy(true);
        try {
          const state = await setShopItemsStatus(keys, status);
          setShopState(state);
          exitBatch();
          toast.success('已更新');
        } catch (e) {
          toast.error(toUserMessage(e, '更新失败'));
        } finally {
          setBusy(false);
        }
      })();
    },
    [exitBatch, selected],
  );

  const onClear = useCallback(() => {
    if (items.length === 0) {
      toast.info('清单为空');
      return;
    }
    Alert.alert(
      '清空采购',
      '将移除详情页「加入采购」的菜谱，并恢复默认状态。计划中的菜仍会留在清单里。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清空',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                setShopState(await clearRecipeShopState());
                exitBatch();
                toast.success('已清空');
              } catch (e) {
                toast.error(toUserMessage(e, '清空失败'));
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [exitBatch, items.length]);

  const renderItemRow = (item: ShopListItem, isLast: boolean) => {
    const checked = item.status === 'bought';
    const isSelected = selected.has(item.key);
    return (
      <Pressable
        key={item.key}
        onPress={() => void onToggleItem(item)}
        onLongPress={() => onLongPressItem(item)}
        disabled={busy}
        style={({ pressed }) => [
          styles.itemRow,
          !isLast ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.border } : null,
          { opacity: pressed ? 0.72 : 1 },
        ]}>
        <View style={styles.itemMain}>
          <Text style={[styles.itemName, { color: p.text }, checked && styles.itemStruck]} numberOfLines={1}>
            {item.name}
          </Text>
          {viewMode === 'status' ? (
            <Text style={[styles.itemFrom, { color: p.outlineMuted }]} numberOfLines={1}>
              {formatShopSources(item)}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.itemAmount, { color: p.outlineMuted }]} numberOfLines={1}>
          {item.amount}
        </Text>
        {batchMode ? (
          <View
            style={[
              styles.checkOuter,
              {
                borderColor: isSelected ? p.primary : p.outlineMuted,
                backgroundColor: isSelected ? p.primary : 'transparent',
              },
            ]}>
            {isSelected ? <MaterialIcons name="check" size={14} color="#fff" /> : null}
          </View>
        ) : (
          <View
            style={[
              styles.checkOuter,
              {
                borderColor: checked ? p.primary : p.outlineMuted,
                backgroundColor: checked ? p.primarySoft : 'transparent',
              },
            ]}>
            {checked ? <MaterialIcons name="check" size={14} color={p.primary} /> : null}
          </View>
        )}
      </Pressable>
    );
  };

  const renderSection = (id: string, title: string, sectionItems: ShopListItem[]) => {
    const isCollapsed = collapsed[id] === true;
    return (
      <View key={id} style={styles.section}>
        <Pressable
          onPress={() => toggleCollapse(id)}
          style={styles.sectionHead}
          accessibilityRole="button"
          accessibilityState={{ expanded: !isCollapsed }}>
          <MaterialIcons
            name={isCollapsed ? 'chevron-right' : 'keyboard-arrow-down'}
            size={22}
            color={p.text}
          />
          <Text style={[styles.sectionTitle, { color: p.text }]}>{title}</Text>
          {sectionItems.length > 0 ? (
            <Text style={[styles.sectionCount, { color: p.outlineMuted }]}>{sectionItems.length}</Text>
          ) : null}
        </Pressable>
        {!isCollapsed ? (
          sectionItems.length === 0 ? (
            <Text style={[styles.emptyHint, { color: p.outlineMuted }]}>暂无项目</Text>
          ) : (
            <View style={styles.sectionBody}>{sectionItems.map((it, i) => renderItemRow(it, i === sectionItems.length - 1))}</View>
          )
        ) : null}
      </View>
    );
  };

  const hasSources = plan.entries.length > 0 || shopState.addedRecipes.length > 0;

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarInset + (batchMode ? 72 : 16) }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.pageHead}>
          <View style={styles.headRow}>
            <Text style={[styles.pageTitle, { color: p.text }]}>采购</Text>
            <View style={styles.headActions}>
              <Pressable
                onPress={() => {
                  if (batchMode) exitBatch();
                  else setBatchMode(true);
                }}
                style={({ pressed }) => [
                  styles.btnPrimary,
                  { backgroundColor: p.primary, opacity: pressed ? 0.85 : 1 },
                ]}>
                <Text style={styles.btnPrimaryText}>{batchMode ? '完成' : '批量操作'}</Text>
              </Pressable>
              <Pressable
                onPress={onClear}
                style={({ pressed }) => [
                  styles.btnGhost,
                  { borderColor: p.border, backgroundColor: p.card, opacity: pressed ? 0.85 : 1 },
                ]}>
                <Text style={[styles.btnGhostText, { color: p.danger }]}>清空</Text>
              </Pressable>
            </View>
          </View>
          <Text style={[styles.pageSub, { color: p.outlineMuted }]}>
            按菜单或菜谱详情「加入采购」生成清单。{'\n'}
            常见调料默认视为已有库存，仅特殊调料会加入采购。
          </Text>
        </View>

        {/* 视图切换 */}
        <View style={[styles.segment, { backgroundColor: p.isDark ? 'rgba(148,163,184,0.12)' : 'rgba(0,0,0,0.05)' }]}>
          <Pressable
            onPress={() => setViewMode('recipe')}
            style={[
              styles.segmentBtn,
              viewMode === 'recipe' ? { backgroundColor: p.card } : null,
            ]}>
            <Text
              style={[
                styles.segmentText,
                { color: viewMode === 'recipe' ? p.text : p.outlineMuted },
              ]}>
              按菜谱
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setViewMode('status')}
            style={[
              styles.segmentBtn,
              viewMode === 'status' ? { backgroundColor: p.card } : null,
            ]}>
            <Text
              style={[
                styles.segmentText,
                { color: viewMode === 'status' ? p.text : p.outlineMuted },
              ]}>
              按采购状态
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={p.primary} style={{ marginTop: 40 }} />
        ) : !hasSources ? (
          <View style={[styles.emptyCard, { backgroundColor: p.card, borderColor: p.border }]}>
            <MaterialIcons name="shopping-cart" size={36} color={p.outlineMuted} />
            <Text style={[styles.emptyTitle, { color: p.text }]}>采购清单还是空的</Text>
            <Text style={[styles.emptySub, { color: p.outlineMuted }]}>
              在「计划」里安排菜，或到菜谱详情点「加入采购」
            </Text>
          </View>
        ) : items.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: p.card, borderColor: p.border }]}>
            <Text style={[styles.emptyTitle, { color: p.text }]}>还没有可采购的食材</Text>
            <Text style={[styles.emptySub, { color: p.outlineMuted }]}>
              给相关菜谱补上食材后，这里会自动出现采购项
            </Text>
          </View>
        ) : viewMode === 'status' ? (
          SHOP_STATUS_META.map(meta =>
            renderSection(meta.key, meta.label, byStatus[meta.key]),
          )
        ) : (
          byRecipe.map(g => renderSection(`recipe-${g.title}`, g.title, g.items))
        )}
      </ScrollView>

      {batchMode ? (
        <View
          style={[
            styles.batchBar,
            {
              backgroundColor: p.card,
              borderColor: p.border,
              bottom: tabBarInset - 4,
            },
          ]}>
          <Text style={[styles.batchHint, { color: p.outlineMuted }]}>
            已选 {selected.size} 项
          </Text>
          <View style={styles.batchActions}>
            <Pressable
              onPress={() => applyBatchStatus('todo')}
              style={[styles.batchChip, { borderColor: p.border }]}>
              <Text style={{ color: p.text, fontWeight: '700', fontSize: 13 }}>待采购</Text>
            </Pressable>
            <Pressable
              onPress={() => applyBatchStatus('stock')}
              style={[styles.batchChip, { borderColor: p.border }]}>
              <Text style={{ color: p.text, fontWeight: '700', fontSize: 13 }}>库存</Text>
            </Pressable>
            <Pressable
              onPress={() => applyBatchStatus('bought')}
              style={[styles.batchChip, { backgroundColor: p.primary, borderColor: p.primary }]}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>已采购</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 16,
  },
  pageHead: { gap: 8 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  pageTitle: { fontSize: 28, fontWeight: '900', letterSpacing: 0.2 },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  btnPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  btnGhost: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  btnGhostText: { fontSize: 13, fontWeight: '700' },
  pageSub: { fontSize: 12, fontWeight: '600', lineHeight: 18 },

  segment: {
    flexDirection: 'row',
    alignSelf: 'center',
    borderRadius: 999,
    padding: 4,
    gap: 2,
  },
  segmentBtn: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 999,
  },
  segmentText: { fontSize: 14, fontWeight: '700' },

  section: { gap: 4 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', flex: 1 },
  sectionCount: { fontSize: 13, fontWeight: '600', marginRight: 4 },
  sectionBody: { paddingLeft: 4 },
  emptyHint: {
    fontSize: 13,
    fontWeight: '600',
    paddingLeft: 26,
    paddingVertical: 8,
  },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 10,
  },
  itemMain: { flex: 1, gap: 3, minWidth: 0 },
  itemName: { fontSize: 16, fontWeight: '800' },
  itemStruck: { textDecorationLine: 'line-through', opacity: 0.55 },
  itemFrom: { fontSize: 12, fontWeight: '600' },
  itemAmount: { fontSize: 13, fontWeight: '600', maxWidth: 72, textAlign: 'right' },
  checkOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyCard: {
    marginTop: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 36,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginTop: 4 },
  emptySub: { fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 20 },

  batchBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 10,
  },
  batchHint: { fontSize: 12, fontWeight: '600' },
  batchActions: { flexDirection: 'row', gap: 8 },
  batchChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
