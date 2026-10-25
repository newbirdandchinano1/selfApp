import { useColorScheme } from '@/hooks/use-color-scheme';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import {
  clearRecipeBasket,
  loadRecipeBasketStore,
  removeRecipeFromBasket,
  removeRecipesFromBasket,
  type RecipeBasketItem,
  type RecipeBasketStore,
} from '@/lib/recipe-basket';
import {
  addRecipePlanEntry,
  formatLocalYmd,
  MEAL_SLOTS,
  mealSlotLabel,
  type MealSlot,
} from '@/lib/recipe-plan';
import { addRecipeToShop } from '@/lib/recipe-shop';
import { getRecipePalette } from '@/lib/recipe-theme';
import { loadRecipeStore, recipeListPreviewTitle } from '@/lib/recipes';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
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

export default function RecipeBasketScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const p = getRecipePalette(useColorScheme());

  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<RecipeBasketStore>({ version: 1, items: [] });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [basket, recipes] = await Promise.all([loadRecipeBasketStore(), loadRecipeStore()]);
      const catMap: Record<string, string> = {};
      for (const c of recipes.categories) catMap[c.id] = c.name;
      const titleById = new Map(recipes.recipes.map(r => [r.id, recipeListPreviewTitle(r)]));
      const catIdByRecipe = new Map(recipes.recipes.map(r => [r.id, r.category_id]));
      // 用当前菜谱库刷新标题/分类；已删菜谱保留冗余字段
      const items = basket.items.map(it => {
        const liveTitle = titleById.get(it.recipeId);
        const catId = catIdByRecipe.get(it.recipeId);
        const liveCat = catId ? catMap[catId] : undefined;
        return {
          ...it,
          recipeTitle: liveTitle ?? it.recipeTitle,
          categoryName: liveCat ?? it.categoryName,
        };
      });
      setStore({ version: 1, items });
      setSelected(prev => {
        const ids = new Set(items.map(i => i.recipeId));
        const next = new Set<string>();
        for (const id of prev) if (ids.has(id)) next.add(id);
        return next;
      });
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

  const items = store.items;
  const selectedCount = selected.size;
  const hasSelection = selectedCount > 0;
  const selectedItems = useMemo(
    () => items.filter(i => selected.has(i.recipeId)),
    [items, selected],
  );

  const toggleSelect = useCallback((recipeId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(recipeId)) next.delete(recipeId);
      else next.add(recipeId);
      return next;
    });
  }, []);

  const onDeleteOne = useCallback((item: RecipeBasketItem) => {
    Alert.alert('移出菜单篮', `将「${item.recipeTitle}」移出菜单篮？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移出',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              const next = await removeRecipeFromBasket(item.recipeId);
              setStore(next);
              setSelected(prev => {
                const s = new Set(prev);
                s.delete(item.recipeId);
                return s;
              });
              toast.success('已移出');
            } catch (e) {
              toast.error(toUserMessage(e, '移出失败'));
            }
          })();
        },
      },
    ]);
  }, []);

  const onMore = useCallback(() => {
    const buttons: {
      text: string;
      style?: 'cancel' | 'destructive';
      onPress?: () => void;
    }[] = [];
    if (items.length > 0) {
      buttons.push({
        text: '全选',
        onPress: () => setSelected(new Set(items.map(i => i.recipeId))),
      });
      buttons.push({
        text: '清空菜单篮',
        style: 'destructive',
        onPress: () => {
          Alert.alert('清空菜单篮', '确定移出全部已选菜谱？', [
            { text: '取消', style: 'cancel' },
            {
              text: '清空',
              style: 'destructive',
              onPress: () => {
                void (async () => {
                  try {
                    setStore(await clearRecipeBasket());
                    setSelected(new Set());
                    toast.success('已清空');
                  } catch (e) {
                    toast.error(toUserMessage(e, '清空失败'));
                  }
                })();
              },
            },
          ]);
        },
      });
    }
    buttons.push({ text: '取消', style: 'cancel' });
    Alert.alert('菜单篮', items.length === 0 ? '还没有菜谱' : undefined, buttons);
  }, [items]);

  const onGenerateShop = useCallback(() => {
    if (!hasSelection || busy) return;
    void (async () => {
      setBusy(true);
      try {
        let added = 0;
        let skipped = 0;
        for (const it of selectedItems) {
          const { alreadyAdded } = await addRecipeToShop({
            recipeId: it.recipeId,
            recipeTitle: it.recipeTitle,
          });
          if (alreadyAdded) skipped += 1;
          else added += 1;
        }
        const ids = selectedItems.map(i => i.recipeId);
        setStore(await removeRecipesFromBasket(ids));
        setSelected(new Set());
        if (added > 0 && skipped > 0) {
          toast.success(`已生成采购：新增 ${added}，已有 ${skipped}`);
        } else if (alreadyAllSkipped(added, skipped)) {
          toast.success('已在采购清单中');
        } else {
          toast.success(`已生成采购清单（${added} 道）`);
        }
        router.push('/my-recipes/shop');
      } catch (e) {
        toast.error(toUserMessage(e, '生成失败'));
      } finally {
        setBusy(false);
      }
    })();
  }, [busy, hasSelection, router, selectedItems]);

  const arrangeToSlot = useCallback(
    (slot: MealSlot) => {
      void (async () => {
        setBusy(true);
        try {
          const date = formatLocalYmd(new Date());
          for (const it of selectedItems) {
            await addRecipePlanEntry({
              date,
              slot,
              recipeId: it.recipeId,
              recipeTitle: it.recipeTitle,
            });
          }
          const ids = selectedItems.map(i => i.recipeId);
          setStore(await removeRecipesFromBasket(ids));
          setSelected(new Set());
          toast.success(`已安排到今日${mealSlotLabel(slot)}`);
          router.push('/my-recipes/plan');
        } catch (e) {
          toast.error(toUserMessage(e, '安排失败'));
        } finally {
          setBusy(false);
        }
      })();
    },
    [router, selectedItems],
  );

  const onArrangePlan = useCallback(() => {
    if (!hasSelection || busy) return;
    Alert.alert(`安排到计划 · 今日`, `将 ${selectedCount} 道菜安排到哪一餐？`, [
      ...MEAL_SLOTS.map(s => ({
        text: s.label,
        onPress: () => arrangeToSlot(s.key),
      })),
      { text: '取消', style: 'cancel' as const },
    ]);
  }, [arrangeToSlot, busy, hasSelection, selectedCount]);

  const subtitleFor = (item: RecipeBasketItem) => {
    const cat = item.categoryName.trim() || '未分类';
    return `${cat} · 待整理`;
  };

  return (
    <View style={[styles.root, { backgroundColor: p.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.headerBtn,
            { backgroundColor: p.card, borderColor: p.border, opacity: pressed ? 0.75 : 1 },
          ]}
          accessibilityLabel="返回">
          <MaterialIcons name="arrow-back-ios-new" size={18} color={p.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: p.text }]}>菜单篮</Text>
        <Pressable
          onPress={onMore}
          style={({ pressed }) => [
            styles.headerBtn,
            { backgroundColor: p.card, borderColor: p.border, opacity: pressed ? 0.75 : 1 },
          ]}
          accessibilityLabel="更多">
          <MaterialIcons name="more-horiz" size={22} color={p.text} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={p.primary} />
          <Text style={[styles.loadingHint, { color: p.outlineMuted }]}>加载菜单篮…</Text>
        </View>
      ) : (
        <>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: Math.max(insets.bottom, 16) + 88 },
            ]}
            showsVerticalScrollIndicator={false}>
            <Text style={[styles.sectionLabel, { color: p.outlineMuted }]}>
              已选菜谱 ({items.length})
            </Text>

            {items.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: p.card }]}>
                <MaterialIcons name="shopping-basket" size={36} color={p.outlineMuted} />
                <Text style={[styles.emptyTitle, { color: p.text }]}>菜单篮是空的</Text>
                <Text style={[styles.emptySub, { color: p.outlineMuted }]}>
                  在菜谱列表点加号，把想吃的菜先收进来
                </Text>
              </View>
            ) : (
              <View style={[styles.listCard, { backgroundColor: p.card }]}>
                {items.map((item, index) => {
                  const isOn = selected.has(item.recipeId);
                  return (
                    <View key={item.recipeId}>
                      {index > 0 ? (
                        <View style={[styles.divider, { backgroundColor: p.border }]} />
                      ) : null}
                      <View style={styles.row}>
                        <Pressable
                          onPress={() => toggleSelect(item.recipeId)}
                          hitSlop={8}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: isOn }}
                          accessibilityLabel={`选择 ${item.recipeTitle}`}
                          style={styles.checkHit}>
                          <MaterialIcons
                            name={isOn ? 'check-circle' : 'radio-button-unchecked'}
                            size={24}
                            color={isOn ? p.primary : p.outlineMuted}
                          />
                        </Pressable>
                        <Pressable
                          onPress={() => toggleSelect(item.recipeId)}
                          style={styles.rowBody}
                          accessibilityRole="button">
                          <Text style={[styles.rowTitle, { color: p.text }]} numberOfLines={1}>
                            {item.recipeTitle}
                          </Text>
                          <Text style={[styles.rowMeta, { color: p.outlineMuted }]} numberOfLines={1}>
                            {subtitleFor(item)}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => onDeleteOne(item)}
                          hitSlop={8}
                          accessibilityLabel={`移出 ${item.recipeTitle}`}
                          style={styles.deleteHit}>
                          <MaterialIcons name="delete-outline" size={22} color={p.danger} />
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>

          <View
            style={[
              styles.footer,
              {
                paddingBottom: Math.max(insets.bottom, 14),
                backgroundColor: p.bg,
                borderTopColor: p.border,
              },
            ]}>
            <Pressable
              onPress={onGenerateShop}
              disabled={!hasSelection || busy}
              style={({ pressed }) => [
                styles.footerBtn,
                {
                  backgroundColor: hasSelection ? p.card : p.placeholderBg,
                  opacity: !hasSelection || busy ? 0.55 : pressed ? 0.85 : 1,
                },
              ]}
              accessibilityLabel="生成采购清单"
              accessibilityState={{ disabled: !hasSelection || busy }}>
              {busy && hasSelection ? (
                <ActivityIndicator size="small" color={p.text} />
              ) : (
                <Text style={[styles.footerBtnText, { color: p.text }]}>生成采购清单</Text>
              )}
            </Pressable>
            <Pressable
              onPress={onArrangePlan}
              disabled={!hasSelection || busy}
              style={({ pressed }) => [
                styles.footerBtn,
                {
                  backgroundColor: hasSelection ? p.card : p.placeholderBg,
                  opacity: !hasSelection || busy ? 0.55 : pressed ? 0.85 : 1,
                },
              ]}
              accessibilityLabel="安排到计划"
              accessibilityState={{ disabled: !hasSelection || busy }}>
              <Text style={[styles.footerBtnText, { color: p.text }]}>安排到计划</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function alreadyAllSkipped(added: number, skipped: number): boolean {
  return added === 0 && skipped > 0;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingHint: { fontSize: 13, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  sectionLabel: { fontSize: 14, fontWeight: '600', marginLeft: 4 },
  listCard: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  checkHit: { paddingVertical: 4 },
  rowBody: { flex: 1, gap: 4, minWidth: 0 },
  rowTitle: { fontSize: 16, fontWeight: '800' },
  rowMeta: { fontSize: 13, fontWeight: '600' },
  deleteHit: { padding: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 50 },
  emptyCard: {
    borderRadius: 18,
    paddingVertical: 40,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginTop: 4 },
  emptySub: { fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 18 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 999,
    minHeight: 48,
  },
  footerBtnText: { fontSize: 15, fontWeight: '700' },
});
