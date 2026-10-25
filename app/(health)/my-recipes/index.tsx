import { CrudListScreen, ScreenEmptyState } from '@/components/crud';
import { RecipeBasketFab } from '@/components/recipe/recipe-basket-fab';
import { recipeGlassTabBarContentInset } from '@/components/recipe/recipe-glass-tab-bar';
import { RecipeMotionPressable } from '@/components/recipe/recipe-motion-pressable';
import { StoredImage } from '@/components/stored-image';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { fetchProfileRecipes } from '@/lib/profile-page-api';
import {
  addRecipeToBasket,
  loadRecipeBasketStore,
} from '@/lib/recipe-basket';
import { recipeSelectionHaptic } from '@/lib/recipe-haptic';
import { formatRecipeRelativeTime, getRecipePalette } from '@/lib/recipe-theme';
import { resolveRecipeCategoryIcon } from '@/lib/recipe-category-icons';
import {
  forgetRecipeCategoryMeta,
  iconKeyForCategory,
  loadRecipeCategoryMeta,
  registerRecipeCategoryMeta,
  sortCategoriesByMeta,
  type RecipeCategoryMetaStore,
} from '@/lib/recipe-category-meta';
import {
  createRecipeCategory,
  deleteRecipe,
  deleteRecipeCategory,
  loadRecipeStore,
  recipeListPreviewSubtitle,
  recipeListPreviewTitle,
  renameRecipeCategory,
  type RecipeCategory,
  type RecipeItem,
  type RecipeStore,
} from '@/lib/recipes';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'my-recipes';
const ALL_CATEGORY = '__all__';
const SIDEBAR_W = 76;

type SortKey = 'added' | 'edited' | 'cooked' | 'most' | 'name';
type FilterKey = 'all' | 'photo' | 'steps' | 'ingredients';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'added', label: '最近添加' },
  { key: 'edited', label: '最近编辑' },
  { key: 'cooked', label: '最近制作' },
  { key: 'most', label: '做过最多' },
  { key: 'name', label: '按名称排序' },
];

export default function MyRecipesScreen() {
  const router = useRouter();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const p = getRecipePalette(colorScheme);
  const pageBg = p.bg;

  const [store, setStore] = useState<RecipeStore | null>(null);
  const [categoryMeta, setCategoryMeta] = useState<RecipeCategoryMetaStore>({
    version: 1,
    order: [],
    icons: {},
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState(ALL_CATEGORY);
  const [sortKey, setSortKey] = useState<SortKey>('edited');
  const [filterKey, setFilterKey] = useState<FilterKey>('all');
  const [editMode, setEditMode] = useState(false);
  const [basketCount, setBasketCount] = useState(0);
  const [basketIds, setBasketIds] = useState<Set<string>>(() => new Set());
  const [basketBusyId, setBasketBusyId] = useState<string | null>(null);

  const [categoryModal, setCategoryModal] = useState<'create' | 'rename' | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryNameDraft, setCategoryNameDraft] = useState('');
  const [categorySaving, setCategorySaving] = useState(false);

  const reloadBasket = useCallback(async () => {
    try {
      const basket = await loadRecipeBasketStore();
      setBasketCount(basket.items.length);
      setBasketIds(new Set(basket.items.map(i => i.recipeId)));
    } catch {
      /* ignore — 列表仍可用 */
    }
  }, []);

  const reload = useCallback(
    async (forceRefresh = false) => {
      try {
        await wrapLoad(async () => {
          await fetchProfileRecipes({ serverFallback: true });
          const [s, meta] = await Promise.all([loadRecipeStore(), loadRecipeCategoryMeta()]);
          setStore(s);
          setCategoryMeta(meta);
        }, forceRefresh);
        await reloadBasket();
      } catch {
        Alert.alert('加载失败', '请稍后重试');
        setStore({ version: 2, categories: [], recipes: [] });
      } finally {
        setLoading(false);
      }
    },
    [reloadBasket, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      void reload();
      void reloadBasket();
    }, [reload, reloadBasket]),
  );

  const categories = useMemo(() => {
    if (!store) return [];
    return sortCategoriesByMeta(store.categories, categoryMeta);
  }, [store, categoryMeta]);

  const filteredRecipes = useMemo(() => {
    if (!store) return [];
    const q = search.trim().toLowerCase();
    let list = store.recipes.filter(r => {
      if (selectedCategoryId !== ALL_CATEGORY && r.category_id !== selectedCategoryId) return false;
      if (filterKey === 'photo' && !r.finished_image_uri) return false;
      if (filterKey === 'steps' && r.steps.length === 0) return false;
      if (filterKey === 'ingredients' && r.ingredients.length === 0) return false;
      if (!q) return true;
      if (r.title.toLowerCase().includes(q)) return true;
      if ((r.notes ?? '').toLowerCase().includes(q)) return true;
      if (r.ingredients.some(ing => `${ing.name} ${ing.amount} ${ing.remark ?? ''}`.toLowerCase().includes(q))) {
        return true;
      }
      if (r.steps.some(s => s.toLowerCase().includes(q))) return true;
      return false;
    });

    list = [...list].sort((a, b) => {
      if (sortKey === 'name') {
        return recipeListPreviewTitle(a).localeCompare(recipeListPreviewTitle(b), 'zh-CN');
      }
      if (sortKey === 'added') {
        return b.created_at.localeCompare(a.created_at);
      }
      if (sortKey === 'cooked') {
        const la = a.last_cooked_at ?? '';
        const lb = b.last_cooked_at ?? '';
        if (la !== lb) return lb.localeCompare(la);
        return (b.times_cooked ?? 0) - (a.times_cooked ?? 0);
      }
      if (sortKey === 'most') {
        const diff = (b.times_cooked ?? 0) - (a.times_cooked ?? 0);
        if (diff !== 0) return diff;
        const la = a.last_cooked_at ?? '';
        const lb = b.last_cooked_at ?? '';
        if (la !== lb) return lb.localeCompare(la);
        return b.updated_at.localeCompare(a.updated_at);
      }
      // edited — 最近编辑
      return b.updated_at.localeCompare(a.updated_at);
    });
    return list;
  }, [store, search, selectedCategoryId, sortKey, filterKey]);

  const openCreateCategory = useCallback(() => {
    setEditingCategoryId(null);
    setCategoryNameDraft('');
    setCategoryModal('create');
  }, []);

  const openRenameCategory = useCallback((cat: RecipeCategory) => {
    setEditingCategoryId(cat.id);
    setCategoryNameDraft(cat.name);
    setCategoryModal('rename');
  }, []);

  const closeCategoryModal = useCallback(() => {
    setCategoryModal(null);
    setEditingCategoryId(null);
    setCategoryNameDraft('');
  }, []);

  const saveCategoryModal = useCallback(async () => {
    const name = categoryNameDraft.trim();
    if (!name) {
      Alert.alert('提示', '请输入分类名称');
      return;
    }
    setCategorySaving(true);
    try {
      if (categoryModal === 'create') {
        const created = await createRecipeCategory(name);
        await registerRecipeCategoryMeta(created);
      } else if (categoryModal === 'rename' && editingCategoryId) {
        await renameRecipeCategory(editingCategoryId, name);
      }
      closeCategoryModal();
      await reload();
      toast.success('已保存');
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请稍后重试'));
    } finally {
      setCategorySaving(false);
    }
  }, [categoryModal, categoryNameDraft, closeCategoryModal, editingCategoryId, reload]);

  const onDeleteCategory = useCallback(
    (cat: RecipeCategory) => {
      const count = store?.recipes.filter(r => r.category_id === cat.id).length ?? 0;
      Alert.alert(
        '删除分类',
        count > 0
          ? `确定删除「${cat.name}」？该分类下 ${count} 道菜将一并删除。`
          : `确定删除「${cat.name}」？`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  await deleteRecipeCategory(cat.id);
                  await forgetRecipeCategoryMeta(cat.id);
                  if (selectedCategoryId === cat.id) setSelectedCategoryId(ALL_CATEGORY);
                  await reload();
                  toast.success('已删除');
                } catch (e) {
                  toast.error(toUserMessage(e, '删除失败，请稍后重试'));
                }
              })();
            },
          },
        ],
      );
    },
    [reload, selectedCategoryId, store?.recipes],
  );

  const onCategoryMenu = useCallback(
    (cat: RecipeCategory) => {
      Alert.alert(cat.name, undefined, [
        { text: '重命名', onPress: () => openRenameCategory(cat) },
        { text: '删除分类', style: 'destructive', onPress: () => onDeleteCategory(cat) },
        { text: '取消', style: 'cancel' },
      ]);
    },
    [onDeleteCategory, openRenameCategory],
  );

  const onDeleteRecipe = useCallback((row: RecipeItem) => {
    const title = recipeListPreviewTitle(row);
    Alert.alert('删除菜谱', `确定删除「${title}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteRecipe(row.id);
              setStore(prev => {
                if (!prev) return prev;
                return { ...prev, recipes: prev.recipes.filter(i => i.id !== row.id) };
              });
              toast.success('已删除');
            } catch (e) {
              toast.error(toUserMessage(e, '删除失败，请稍后重试'));
            }
          })();
        },
      },
    ]);
  }, []);

  const goNewRecipe = useCallback(
    (categoryId: string) => {
      router.push({ pathname: '/recipe-edit/[id]', params: { id: 'new', categoryId } });
    },
    [router],
  );

  const goView = useCallback(
    (recipeId: string) => {
      router.push({ pathname: '/recipe-view/[id]', params: { id: recipeId } });
    },
    [router],
  );

  const goBasket = useCallback(() => {
    router.push('/recipe-basket');
  }, [router]);

  const onAddToBasket = useCallback(
    (row: RecipeItem) => {
      if (basketBusyId) return;
      const title = recipeListPreviewTitle(row);
      const categoryName =
        store?.categories.find(c => c.id === row.category_id)?.name ?? '';
      setBasketBusyId(row.id);
      recipeSelectionHaptic();
      void (async () => {
        try {
          const { store: basket, alreadyAdded } = await addRecipeToBasket({
            recipeId: row.id,
            recipeTitle: title,
            categoryName,
          });
          setBasketCount(basket.items.length);
          setBasketIds(new Set(basket.items.map(i => i.recipeId)));
          toast.success(alreadyAdded ? '已在菜单篮中' : '已加入菜单篮');
        } catch (e) {
          toast.error(toUserMessage(e, '加入失败'));
        } finally {
          setBasketBusyId(null);
        }
      })();
    },
    [basketBusyId, store?.categories],
  );

  const onPressNew = useCallback(() => {
    if (categories.length === 0) {
      Alert.alert('先建分类', '新建菜谱前请先创建一个分类。', [
        { text: '取消', style: 'cancel' },
        { text: '新建分类', onPress: openCreateCategory },
      ]);
      return;
    }
    if (selectedCategoryId !== ALL_CATEGORY) {
      goNewRecipe(selectedCategoryId);
      return;
    }
    if (categories.length === 1) {
      goNewRecipe(categories[0].id);
      return;
    }
    Alert.alert(
      '选择分类',
      undefined,
      [
        ...categories.map(cat => ({
          text: cat.name,
          onPress: () => goNewRecipe(cat.id),
        })),
        { text: '取消', style: 'cancel' as const },
      ],
    );
  }, [categories, goNewRecipe, openCreateCategory, selectedCategoryId]);

  const onPressSort = useCallback(() => {
    Alert.alert('排序', undefined, [
      ...SORT_OPTIONS.map(opt => ({
        text: sortKey === opt.key ? `✓ ${opt.label}` : opt.label,
        onPress: () => setSortKey(opt.key),
      })),
      { text: '取消', style: 'cancel' },
    ]);
  }, [sortKey]);

  const onPressFilter = useCallback(() => {
    Alert.alert('筛选', undefined, [
      {
        text: filterKey === 'all' ? '✓ 全部' : '全部',
        onPress: () => setFilterKey('all'),
      },
      {
        text: filterKey === 'photo' ? '✓ 有成品图' : '有成品图',
        onPress: () => setFilterKey('photo'),
      },
      {
        text: filterKey === 'steps' ? '✓ 有步骤' : '有步骤',
        onPress: () => setFilterKey('steps'),
      },
      {
        text: filterKey === 'ingredients' ? '✓ 有食材' : '有食材',
        onPress: () => setFilterKey('ingredients'),
      },
      { text: '取消', style: 'cancel' },
    ]);
  }, [filterKey]);

  const hasCategories = categories.length > 0;
  const recipeCount = store?.recipes.length ?? 0;
  const showEmpty = !loading && !hasCategories;
  const filterActive = filterKey !== 'all';
  const sortLabel = SORT_OPTIONS.find(o => o.key === sortKey)?.label ?? '最近编辑';
  const tabBarInset = recipeGlassTabBarContentInset(insets.bottom);

  // 顶栏（返回 / 标题）在 layout 共享；此处只挂菜谱页的搜索与工具栏
  const recipeHeader = !showEmpty ? (
    <View style={[styles.toolsWrap, { backgroundColor: pageBg }]}>
      <View style={[styles.searchBar, { backgroundColor: p.card, borderColor: p.border }]}>
        <MaterialIcons name="search" size={20} color={p.outlineMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="搜索菜名、食材、步骤"
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

      <View style={styles.toolbar}>
        <Pressable
          onPress={onPressSort}
          style={({ pressed }) => [
            styles.toolBtn,
            { backgroundColor: p.card, borderColor: p.border, opacity: pressed ? 0.85 : 1 },
          ]}>
          <MaterialIcons name="swap-vert" size={16} color={p.text} />
          <Text style={[styles.toolBtnText, { color: p.text }]}>排序</Text>
        </Pressable>
        <Pressable
          onPress={onPressFilter}
          style={({ pressed }) => [
            styles.toolBtn,
            {
              backgroundColor: filterActive ? p.primarySoft : p.card,
              borderColor: filterActive ? p.primary : p.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <MaterialIcons name="tune" size={16} color={filterActive ? p.primary : p.text} />
          <Text style={[styles.toolBtnText, { color: filterActive ? p.primary : p.text }]}>筛选</Text>
        </Pressable>
        <Pressable
          onPress={() => setEditMode(v => !v)}
          style={({ pressed }) => [
            styles.toolBtn,
            {
              backgroundColor: editMode ? p.primarySoft : p.card,
              borderColor: editMode ? p.primary : p.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <MaterialIcons name="edit-note" size={16} color={editMode ? p.primary : p.text} />
          <Text style={[styles.toolBtnText, { color: editMode ? p.primary : p.text }]}>
            {editMode ? '完成' : '编辑'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onPressNew}
          style={({ pressed }) => [
            styles.toolBtnPrimary,
            { backgroundColor: p.primary, opacity: pressed ? 0.88 : 1 },
          ]}
          accessibilityLabel="新建菜谱">
          <MaterialIcons name="add" size={18} color="#fff" />
          <Text style={styles.toolBtnPrimaryText}>新建</Text>
        </Pressable>
      </View>

      {editMode ? (
        <View style={styles.editRow}>
          <Pressable
            style={({ pressed }) => [
              styles.editCatBtn,
              { backgroundColor: p.primarySoft, borderColor: p.border, opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={openCreateCategory}
            accessibilityLabel="新建分类">
            <MaterialIcons name="create-new-folder" size={18} color={p.primary} />
            <Text style={[styles.editCatBtnText, { color: p.primary }]}>新建分类</Text>
          </Pressable>
          {hasCategories && !loading ? (
            <Text style={[styles.editHint, { color: p.textSecondary }]}>{recipeCount} 道拿手菜</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  ) : null;

  const renderCategoryTab = (cat: RecipeCategory | null, index: number) => {
    const isAll = cat == null;
    const id = isAll ? ALL_CATEGORY : cat.id;
    const active = selectedCategoryId === id;
    const label = isAll ? '全部' : cat.name;
    const iconOpt = isAll
      ? null
      : resolveRecipeCategoryIcon(iconKeyForCategory(cat.id, cat.name, categoryMeta), cat.name, index);

    return (
      <Pressable
        key={id}
        onPress={() => setSelectedCategoryId(id)}
        onLongPress={isAll || !editMode ? undefined : () => onCategoryMenu(cat)}
        style={({ pressed }) => [
          styles.catTab,
          {
            backgroundColor: active ? p.primary : p.card,
            borderColor: active ? p.primary : p.border,
            opacity: pressed ? 0.9 : 1,
          },
        ]}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}>
        {isAll ? (
          <MaterialIcons name="apps" size={22} color={active ? '#fff' : p.accent} />
        ) : (
          <Text style={{ fontSize: 22, lineHeight: 28 }}>{iconOpt!.emoji}</Text>
        )}
        <Text
          style={[styles.catTabText, { color: active ? '#fff' : p.outline }]}
          numberOfLines={2}>
          {label}
        </Text>
      </Pressable>
    );
  };

  const renderRecipeRow = useCallback(
    ({ item, index }: { item: RecipeItem; index: number }) => {
      const title = recipeListPreviewTitle(item);
      const subtitle = recipeListPreviewSubtitle(item) || formatRecipeRelativeTime(item.updated_at);
      const inBasket = basketIds.has(item.id);

      return (
        <RecipeMotionPressable
          enterDelay={Math.min(index, 8) * 35}
          onPress={() => goView(item.id)}
          onLongPress={() => onDeleteRecipe(item)}
          accessibilityLabel={title}
          style={[styles.recipeCard, { backgroundColor: p.card, borderColor: p.border }]}>
          {item.finished_image_uri ? (
            <StoredImage uri={item.finished_image_uri} style={styles.recipeThumb} />
          ) : (
            <View style={[styles.recipeThumbPlaceholder, { backgroundColor: p.placeholderBg }]}>
              <MaterialIcons name="restaurant" size={22} color={p.accent} />
            </View>
          )}
          <View style={styles.recipeBody}>
            <Text style={[styles.recipeTitle, { color: p.text }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[styles.recipeMeta, { color: p.outlineMuted }]} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
          {editMode ? (
            <Pressable
              onPress={() => onDeleteRecipe(item)}
              hitSlop={6}
              style={[styles.recipeActionBtn, { backgroundColor: p.placeholderBg, borderColor: p.border }]}
              accessibilityLabel={`删除 ${title}`}>
              <MaterialIcons name="delete-outline" size={18} color={p.danger} />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => onAddToBasket(item)}
              hitSlop={6}
              disabled={basketBusyId === item.id}
              style={[
                styles.recipeActionBtn,
                {
                  backgroundColor: inBasket ? p.primarySoft : p.placeholderBg,
                  borderColor: inBasket ? p.primary : p.border,
                  opacity: basketBusyId === item.id ? 0.55 : 1,
                },
              ]}
              accessibilityLabel={inBasket ? `${title} 已在菜单篮` : `加入菜单篮 ${title}`}>
              <MaterialIcons
                name={inBasket ? 'check' : 'add'}
                size={20}
                color={inBasket ? p.primary : p.outline}
              />
            </Pressable>
          )}
        </RecipeMotionPressable>
      );
    },
    [basketBusyId, basketIds, editMode, goView, onAddToBasket, onDeleteRecipe, p],
  );

  const listEmpty = !loading && hasCategories && filteredRecipes.length === 0;

  return (
    <View style={styles.screenRoot}>
      <CrudListScreen
        header={recipeHeader}
        loading={loading}
        loadingHint="加载菜谱…"
        style={{ backgroundColor: pageBg }}>
        {showEmpty ? (
          <View style={[styles.emptyWrap, { paddingBottom: tabBarInset }]}>
            <ScreenEmptyState
              icon="menu-book"
              title="打开你的菜谱本"
              subtitle="先建一章分类（家常菜、烘焙…），再把拿手菜写进去"
              actionLabel="新建分类"
              onAction={openCreateCategory}
            />
          </View>
        ) : (
          <View style={styles.bodyRow}>
            <ScrollView
              style={[styles.sidebar, { width: SIDEBAR_W }]}
              contentContainerStyle={[
                styles.sidebarContent,
                { paddingBottom: tabBarInset },
              ]}
              showsVerticalScrollIndicator={false}>
              {renderCategoryTab(null, -1)}
              {categories.map((cat, i) => renderCategoryTab(cat, i))}
              {editMode ? (
                <Pressable
                  onPress={openCreateCategory}
                  style={({ pressed }) => [
                    styles.catTab,
                    styles.catTabAdd,
                    {
                      borderColor: p.border,
                      backgroundColor: p.card,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                  accessibilityLabel="新建分类">
                  <MaterialIcons name="add" size={22} color={p.primary} />
                  <Text style={[styles.catTabText, { color: p.primary }]}>分类</Text>
                </Pressable>
              ) : null}
            </ScrollView>

            <FlatList
              data={filteredRecipes}
              keyExtractor={item => item.id}
              renderItem={renderRecipeRow}
              style={styles.list}
              refreshControl={refreshControl}
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: tabBarInset },
                listEmpty ? styles.listEmptyPad : null,
              ]}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                search || filterActive || sortKey !== 'edited' ? (
                  <Text style={[styles.listHint, { color: p.outlineMuted }]}>
                    {[
                      search ? `「${search.trim()}」` : null,
                      filterActive
                        ? filterKey === 'photo'
                          ? '有成品图'
                          : filterKey === 'steps'
                            ? '有步骤'
                            : '有食材'
                        : null,
                      sortLabel,
                      `${filteredRecipes.length} 道`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                ) : null
              }
              ListEmptyComponent={
                listEmpty ? (
                  <View style={styles.listEmptyInner}>
                    <MaterialIcons name="search-off" size={36} color={p.outlineMuted} />
                    <Text style={[styles.listEmptyTitle, { color: p.text }]}>没有匹配的菜谱</Text>
                    <Text style={[styles.listEmptySub, { color: p.outlineMuted }]}>
                      {search || filterActive
                        ? '试试换个关键词或筛选条件'
                        : '点上方「新建」写进第一道菜'}
                    </Text>
                    {!search && !filterActive ? (
                      <Pressable
                        onPress={onPressNew}
                        style={[styles.emptyNewBtn, { backgroundColor: p.primary }]}>
                        <MaterialIcons name="add" size={18} color="#fff" />
                        <Text style={styles.emptyNewBtnText}>新建菜谱</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null
              }
            />
          </View>
        )}
      </CrudListScreen>

      {!showEmpty ? (
        <RecipeBasketFab count={basketCount} bottomInset={tabBarInset} onPress={goBasket} />
      ) : null}

      <Modal visible={categoryModal != null} transparent animationType="fade" onRequestClose={closeCategoryModal}>
        <View style={styles.modalRoot}>
          <Pressable style={[styles.modalBackdrop, { backgroundColor: p.overlay }]} onPress={closeCategoryModal} />
          <View style={[styles.modalCard, { backgroundColor: p.card, borderColor: p.border }]}>
            <View style={[styles.modalIconWrap, { backgroundColor: p.accentSoft }]}>
              <MaterialIcons
                name={categoryModal === 'create' ? 'create-new-folder' : 'drive-file-rename-outline'}
                size={24}
                color={p.accent}
              />
            </View>
            <Text style={[styles.modalTitle, { color: p.text }]}>
              {categoryModal === 'create' ? '新建分类' : '重命名分类'}
            </Text>
            <TextInput
              value={categoryNameDraft}
              onChangeText={setCategoryNameDraft}
              placeholder="例如：家常菜、烘焙"
              placeholderTextColor={p.outlineMuted}
              autoFocus
              style={[
                styles.modalInput,
                { color: p.text, borderColor: p.border, backgroundColor: p.inputBg },
              ]}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={closeCategoryModal}
                disabled={categorySaving}
                style={[styles.modalBtnSecondary, { borderColor: p.border }]}>
                <Text style={{ color: p.outline, fontWeight: '700' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => void saveCategoryModal()}
                disabled={categorySaving}
                style={[styles.modalBtnPrimary, { backgroundColor: p.primary }]}>
                {categorySaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>保存</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: { flex: 1 },
  toolsWrap: {
    paddingBottom: 10,
    gap: 10,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 12,
  },
  editCatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  editCatBtnText: { fontSize: 13, fontWeight: '700' },
  editHint: { fontSize: 12, fontWeight: '600' },
  searchBar: {
    marginHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 0,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 8,
  },
  toolBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toolBtnText: { fontSize: 13, fontWeight: '700' },
  toolBtnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 10,
    borderRadius: 14,
  },
  toolBtnPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  bodyRow: { flex: 1, flexDirection: 'row' },
  sidebar: { flexGrow: 0, flexShrink: 0 },
  sidebarContent: {
    paddingLeft: 10,
    paddingRight: 8,
    paddingTop: 4,
    gap: 8,
  },
  catTab: {
    width: SIDEBAR_W - 18,
    minHeight: 68,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 10,
    gap: 6,
  },
  catTabAdd: {
    borderStyle: 'dashed',
  },
  catTabText: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 14,
  },
  list: { flex: 1 },
  listContent: {
    flexGrow: 1,
    paddingRight: 14,
    paddingLeft: 4,
    gap: 10,
  },
  listEmptyPad: { justifyContent: 'center' },
  listHint: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
    marginTop: 2,
  },
  recipeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 10,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  recipeThumb: {
    width: 56,
    height: 56,
    borderRadius: 14,
  },
  recipeThumbPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipeBody: { flex: 1, gap: 4, minWidth: 0 },
  recipeTitle: { fontSize: 16, fontWeight: '800', letterSpacing: 0.1 },
  recipeMeta: { fontSize: 12, fontWeight: '600' },
  recipeActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listEmptyInner: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
    gap: 8,
  },
  listEmptyTitle: { fontSize: 16, fontWeight: '800', marginTop: 4 },
  listEmptySub: { fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 18 },
  emptyNewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
  },
  emptyNewBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  emptyWrap: { flex: 1, justifyContent: 'center' },
  modalRoot: { flex: 1, justifyContent: 'center', padding: 24 },
  modalBackdrop: { ...StyleSheet.absoluteFill },
  modalCard: {
    borderRadius: 22,
    padding: 22,
    marginHorizontal: 4,
    zIndex: 1,
    gap: 14,
    borderWidth: 1,
  },
  modalIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  modalTitle: { fontSize: 18, fontWeight: '900', textAlign: 'center' },
  modalInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalBtnSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  modalBtnPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
  },
  modalBtnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
