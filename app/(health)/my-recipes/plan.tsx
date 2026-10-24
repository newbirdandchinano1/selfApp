import { recipeGlassTabBarContentInset } from '@/components/recipe/recipe-glass-tab-bar';
import { RecipeMotionPressable } from '@/components/recipe/recipe-motion-pressable';
import { StoredImage } from '@/components/stored-image';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { fetchProfileRecipes } from '@/lib/profile-page-api';
import {
  addRecipePlanEntry,
  daySlotMark,
  entriesForDate,
  formatLocalYmd,
  loadRecipePlanStore,
  MEAL_SLOTS,
  mealSlotLabel,
  plannedDatesInMonth,
  removeRecipePlanEntry,
  type RecipePlanEntry,
  type RecipePlanStore,
} from '@/lib/recipe-plan';
import { getRecipePalette } from '@/lib/recipe-theme';
import {
  loadRecipeStore,
  recipeListPreviewTitle,
  type RecipeCategory,
  type RecipeItem,
  type RecipeStore,
} from '@/lib/recipes';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

type CalCell = { key: string; day: number | null; ymd: string | null };

function buildMonthGrid(year: number, monthIndex: number): CalCell[] {
  const first = new Date(year, monthIndex, 1);
  // JS: 0=Sun … 6=Sat → 周一为首：Mon=0 … Sun=6
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: CalCell[] = [];
  for (let i = 0; i < startPad; i += 1) {
    cells.push({ key: `pad-${i}`, day: null, ymd: null });
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    const ymd = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ key: ymd, day: d, ymd });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: `tail-${cells.length}`, day: null, ymd: null });
  }
  return cells;
}

function categoryNameOf(
  store: RecipeStore | null,
  recipe: RecipeItem,
): string {
  if (!store) return '菜谱';
  return store.categories.find(c => c.id === recipe.category_id)?.name ?? '菜谱';
}

export default function RecipePlanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const p = getRecipePalette(colorScheme);
  const tabBarInset = recipeGlassTabBarContentInset(insets.bottom);

  const today = useMemo(() => formatLocalYmd(new Date()), []);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [selectedYmd, setSelectedYmd] = useState(today);

  const [recipeStore, setRecipeStore] = useState<RecipeStore | null>(null);
  const [planStore, setPlanStore] = useState<RecipePlanStore>({ version: 1, entries: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      await fetchProfileRecipes({ serverFallback: true });
      const [recipes, plan] = await Promise.all([loadRecipeStore(), loadRecipePlanStore()]);
      setRecipeStore(recipes);
      setPlanStore(plan);
    } catch {
      toast.error('加载失败，请稍后重试');
      setRecipeStore({ version: 2, categories: [], recipes: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const monthLabel = `${viewYear}年 ${viewMonth + 1}月`;
  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const plannedSet = useMemo(
    () => plannedDatesInMonth(planStore, viewYear, viewMonth),
    [planStore, viewYear, viewMonth],
  );

  const dayEntries = useMemo(
    () => entriesForDate(planStore, selectedYmd),
    [planStore, selectedYmd],
  );

  const categoryById = useMemo(() => {
    const map = new Map<string, RecipeCategory>();
    for (const c of recipeStore?.categories ?? []) map.set(c.id, c);
    return map;
  }, [recipeStore]);

  const searchHits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !recipeStore) return [];
    return recipeStore.recipes
      .filter(r => {
        const title = recipeListPreviewTitle(r).toLowerCase();
        if (title.includes(q)) return true;
        return r.ingredients.some(ing => ing.name.toLowerCase().includes(q));
      })
      .slice(0, 8);
  }, [recipeStore, search]);

  const recommendations = useMemo(() => {
    if (!recipeStore) return [];
    const plannedIds = new Set(dayEntries.map(e => e.recipeId));
    return [...recipeStore.recipes]
      .filter(r => !plannedIds.has(r.id))
      .sort((a, b) => {
        const la = a.last_cooked_at ?? '';
        const lb = b.last_cooked_at ?? '';
        if (la !== lb) return lb.localeCompare(la);
        return b.updated_at.localeCompare(a.updated_at);
      })
      .slice(0, 12);
  }, [recipeStore, dayEntries]);

  const shiftMonth = useCallback((delta: number) => {
    setViewMonth(m => {
      const next = new Date(viewYear, m + delta, 1);
      setViewYear(next.getFullYear());
      return next.getMonth();
    });
  }, [viewYear]);

  const pickSlotAndAdd = useCallback(
    (recipe: RecipeItem) => {
      const title = recipeListPreviewTitle(recipe);
      Alert.alert(
        `加入计划 · ${title}`,
        selectedYmd === today ? '安排到今天哪一餐？' : `安排到 ${selectedYmd} 哪一餐？`,
        [
          ...MEAL_SLOTS.map(s => ({
            text: s.label,
            onPress: () => {
              void (async () => {
                setBusyId(recipe.id);
                try {
                  await addRecipePlanEntry({
                    date: selectedYmd,
                    slot: s.key,
                    recipeId: recipe.id,
                    recipeTitle: title,
                  });
                  const plan = await loadRecipePlanStore();
                  setPlanStore(plan);
                  setSearch('');
                  toast.success(`已加入${s.label}`);
                } catch (e) {
                  toast.error(toUserMessage(e, '添加失败，请稍后重试'));
                } finally {
                  setBusyId(null);
                }
              })();
            },
          })),
          { text: '取消', style: 'cancel' },
        ],
      );
    },
    [selectedYmd, today],
  );

  const onDeleteEntry = useCallback((entry: RecipePlanEntry) => {
    Alert.alert('移除安排', `从菜单中移除「${entry.recipeTitle}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusyId(entry.id);
            try {
              await removeRecipePlanEntry(entry.id);
              setPlanStore(await loadRecipePlanStore());
              toast.success('已移除');
            } catch (e) {
              toast.error(toUserMessage(e, '移除失败，请稍后重试'));
            } finally {
              setBusyId(null);
            }
          })();
        },
      },
    ]);
  }, []);

  const menuTitle =
    selectedYmd === today ? '今日菜单' : `${selectedYmd.slice(5).replace('-', '/')} 菜单`;

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarInset + 16 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.pageHead}>
          <Text style={[styles.pageTitle, { color: p.text }]}>计划</Text>
          <Text style={[styles.pageSub, { color: p.outlineMuted }]}>提前安排，轻松开饭。</Text>
        </View>

        {/* 日历 */}
        <View style={[styles.calCard, { backgroundColor: p.card, borderColor: p.border }]}>
          <View style={styles.calNav}>
            <Pressable
              onPress={() => shiftMonth(-1)}
              hitSlop={10}
              style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
              accessibilityLabel="上个月">
              <MaterialIcons name="chevron-left" size={26} color={p.outlineMuted} />
            </Pressable>
            <Text style={[styles.calMonth, { color: p.text }]}>{monthLabel}</Text>
            <Pressable
              onPress={() => shiftMonth(1)}
              hitSlop={10}
              style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
              accessibilityLabel="下个月">
              <MaterialIcons name="chevron-right" size={26} color={p.outlineMuted} />
            </Pressable>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAYS.map(w => (
              <Text key={w} style={[styles.weekLabel, { color: p.outlineMuted }]}>
                {w}
              </Text>
            ))}
          </View>

          <View style={styles.dayGrid}>
            {grid.map(cell => {
              if (cell.day == null || !cell.ymd) {
                return <View key={cell.key} style={styles.dayCell} />;
              }
              const selected = cell.ymd === selectedYmd;
              const mark = daySlotMark(planStore, cell.ymd);
              const hasPlan = plannedSet.has(cell.ymd);
              return (
                <Pressable
                  key={cell.key}
                  onPress={() => setSelectedYmd(cell.ymd!)}
                  style={styles.dayCell}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${cell.day}日${mark ? `，${mark}` : ''}`}>
                  <View
                    style={[
                      styles.dayInner,
                      selected
                        ? { backgroundColor: p.primarySoft }
                        : hasPlan
                          ? { backgroundColor: p.accentSoft }
                          : null,
                    ]}>
                    <Text
                      style={[
                        styles.dayNum,
                        {
                          color: selected ? p.primary : p.outline,
                          fontWeight: selected || cell.ymd === today ? '800' : '600',
                        },
                      ]}>
                      {cell.day}
                    </Text>
                    {selected && mark ? (
                      <Text style={[styles.dayMark, { color: p.primary }]}>{mark}</Text>
                    ) : hasPlan && !selected ? (
                      <View style={[styles.dayDot, { backgroundColor: p.primary }]} />
                    ) : (
                      <View style={styles.dayMarkSpacer} />
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 搜索添加 */}
        <View style={[styles.searchBar, { backgroundColor: p.card, borderColor: p.border }]}>
          <MaterialIcons name="search" size={20} color={p.outlineMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="搜索添加菜谱"
            placeholderTextColor={p.outlineMuted}
            style={[styles.searchInput, { color: p.text }]}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="清除搜索">
              <MaterialIcons name="close" size={18} color={p.outlineMuted} />
            </Pressable>
          ) : null}
        </View>

        {search.trim().length > 0 ? (
          <View style={[styles.searchPanel, { backgroundColor: p.card, borderColor: p.border }]}>
            {loading ? (
              <ActivityIndicator color={p.primary} style={{ marginVertical: 16 }} />
            ) : searchHits.length === 0 ? (
              <Text style={[styles.searchEmpty, { color: p.outlineMuted }]}>没有匹配的菜谱</Text>
            ) : (
              searchHits.map(r => {
                const title = recipeListPreviewTitle(r);
                return (
                  <Pressable
                    key={r.id}
                    onPress={() => pickSlotAndAdd(r)}
                    disabled={busyId === r.id}
                    style={({ pressed }) => [
                      styles.searchHit,
                      { borderBottomColor: p.border, opacity: pressed ? 0.75 : 1 },
                    ]}>
                    <Text style={[styles.searchHitTitle, { color: p.text }]} numberOfLines={1}>
                      {title}
                    </Text>
                    <MaterialIcons name="add-circle-outline" size={20} color={p.primary} />
                  </Pressable>
                );
              })
            )}
          </View>
        ) : null}

        {/* 当日菜单 */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: p.text }]}>
            {menuTitle}{' '}
            <Text style={[styles.sectionCount, { color: p.outlineMuted }]}>
              {dayEntries.length}项
            </Text>
          </Text>

          {dayEntries.length === 0 ? (
            <View style={[styles.emptyMenu, { backgroundColor: p.card, borderColor: p.border }]}>
              <Text style={[styles.emptyMenuText, { color: p.outlineMuted }]}>
                还没有安排，搜索或从下方推荐添加
              </Text>
            </View>
          ) : (
            dayEntries.map(entry => (
              <View
                key={entry.id}
                style={[styles.menuCard, { backgroundColor: p.card, borderColor: p.border }]}>
                <Pressable
                  style={styles.menuMain}
                  onPress={() =>
                    router.push({ pathname: '/recipe-view/[id]', params: { id: entry.recipeId } })
                  }>
                  <Text style={[styles.menuSlot, { color: p.outlineMuted }]}>
                    {mealSlotLabel(entry.slot)} ›
                  </Text>
                  <Text style={[styles.menuName, { color: p.text }]} numberOfLines={1}>
                    {entry.recipeTitle} ›
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onDeleteEntry(entry)}
                  disabled={busyId === entry.id}
                  hitSlop={8}
                  accessibilityLabel={`移除 ${entry.recipeTitle}`}
                  style={({ pressed }) => [{ opacity: pressed ? 0.55 : 1 }]}>
                  <MaterialIcons name="delete-outline" size={22} color={p.primary} />
                </Pressable>
              </View>
            ))
          )}
        </View>

        {/* 推荐 */}
        <View style={styles.section}>
          <View style={styles.recoHead}>
            <View style={[styles.recoBar, { backgroundColor: p.primary }]} />
            <Text style={[styles.sectionTitle, { color: p.text }]}>今日推荐</Text>
          </View>

          {loading && recommendations.length === 0 ? (
            <ActivityIndicator color={p.primary} style={{ marginTop: 20 }} />
          ) : recommendations.length === 0 ? (
            <Text style={[styles.recoEmpty, { color: p.outlineMuted }]}>
              {(recipeStore?.recipes.length ?? 0) === 0
                ? '先去「菜谱」写几道拿手菜吧'
                : '今天的菜都安排上了'}
            </Text>
          ) : (
            recommendations.map((recipe, index) => {
              const title = recipeListPreviewTitle(recipe);
              const cat = categoryById.get(recipe.category_id)?.name ?? categoryNameOf(recipeStore, recipe);
              return (
                <RecipeMotionPressable
                  key={recipe.id}
                  enterDelay={Math.min(index, 6) * 30}
                  onPress={() =>
                    router.push({ pathname: '/recipe-view/[id]', params: { id: recipe.id } })
                  }
                  style={styles.recoRow}>
                  {recipe.finished_image_uri ? (
                    <StoredImage uri={recipe.finished_image_uri} style={styles.recoThumb} />
                  ) : (
                    <View style={[styles.recoThumbPh, { backgroundColor: p.placeholderBg }]}>
                      <MaterialIcons name="restaurant" size={20} color={p.accent} />
                    </View>
                  )}
                  <View style={styles.recoBody}>
                    <Text style={[styles.recoTitle, { color: p.text }]} numberOfLines={1}>
                      {title}
                    </Text>
                    <Text style={[styles.recoCat, { color: p.outlineMuted }]} numberOfLines={1}>
                      {cat}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => pickSlotAndAdd(recipe)}
                    disabled={busyId === recipe.id}
                    hitSlop={8}
                    accessibilityLabel={`添加 ${title} 到计划`}
                    style={({ pressed }) => [
                      styles.recoAdd,
                      {
                        backgroundColor: p.primarySoft,
                        opacity: pressed ? 0.75 : 1,
                      },
                    ]}>
                    <MaterialIcons name="event-available" size={20} color={p.primary} />
                  </Pressable>
                </RecipeMotionPressable>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 14,
  },
  pageHead: { gap: 4, marginBottom: 2 },
  pageTitle: { fontSize: 28, fontWeight: '900', letterSpacing: 0.2 },
  pageSub: { fontSize: 13, fontWeight: '600' },

  calCard: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 12,
  },
  calNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  calMonth: { fontSize: 17, fontWeight: '800' },
  weekRow: { flexDirection: 'row', marginBottom: 6 },
  weekLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
  },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  dayInner: {
    width: '88%',
    height: '88%',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  dayNum: { fontSize: 15, lineHeight: 18 },
  dayMark: { fontSize: 10, fontWeight: '800', lineHeight: 12 },
  dayMarkSpacer: { height: 12 },
  dayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 2,
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 0,
  },
  searchPanel: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginTop: -6,
  },
  searchEmpty: {
    textAlign: 'center',
    paddingVertical: 18,
    fontSize: 13,
    fontWeight: '600',
  },
  searchHit: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  searchHitTitle: { flex: 1, fontSize: 15, fontWeight: '700' },

  section: { gap: 10, marginTop: 2 },
  sectionTitle: { fontSize: 17, fontWeight: '800' },
  sectionCount: { fontSize: 14, fontWeight: '600' },

  emptyMenu: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  emptyMenuText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },

  menuCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  menuMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  menuSlot: { fontSize: 14, fontWeight: '600' },
  menuName: { flex: 1, fontSize: 15, fontWeight: '800' },

  recoHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recoBar: {
    width: 4,
    height: 16,
    borderRadius: 2,
  },
  recoEmpty: {
    fontSize: 13,
    fontWeight: '600',
    paddingVertical: 8,
    paddingLeft: 12,
  },
  recoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  recoThumb: {
    width: 52,
    height: 52,
    borderRadius: 12,
  },
  recoThumbPh: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recoBody: { flex: 1, gap: 3, minWidth: 0 },
  recoTitle: { fontSize: 15, fontWeight: '800' },
  recoCat: { fontSize: 12, fontWeight: '600' },
  recoAdd: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
