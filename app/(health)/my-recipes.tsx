import { RecipeMotionPressable } from '@/components/recipe/recipe-motion-pressable';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { fetchProfileRecipes } from '@/lib/profile-page-api';
import {
  createRecipeCategory,
  deleteRecipe,
  deleteRecipeCategory,
  loadRecipeStore,
  recipeListPreviewTitle,
  renameRecipeCategory,
  type RecipeCategory,
  type RecipeItem,
  type RecipeStore,
} from '@/lib/recipes';
import { formatRecipeRelativeTime, getRecipePalette } from '@/lib/recipe-theme';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Section = { category: RecipeCategory; data: RecipeItem[] };

const PAGE_API_KEY = 'my-recipes';
const PAGE_PAD = 16;
const GRID_GAP = 12;

export default function MyRecipesScreen() {
  const router = useRouter();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const p = getRecipePalette(colorScheme);
  const screenW = Dimensions.get('window').width;
  const tileW = (screenW - PAGE_PAD * 2 - GRID_GAP) / 2;

  const [store, setStore] = useState<RecipeStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [categoryModal, setCategoryModal] = useState<'create' | 'rename' | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryNameDraft, setCategoryNameDraft] = useState('');
  const [categorySaving, setCategorySaving] = useState(false);

  const reload = useCallback(
    async (forceApi = false) => {
      try {
        await wrapLoad(async () => {
          await fetchProfileRecipes({ offlineFallback: true });
          const s = await loadRecipeStore();
          setStore(s);
        }, forceApi);
      } catch {
        Alert.alert('加载失败', '请稍后重试');
        setStore({ version: 2, categories: [], recipes: [] });
      } finally {
        setLoading(false);
      }
    },
    [wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const sections = useMemo((): Section[] => {
    if (!store) return [];
    const sortedCats = [...store.categories].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return sortedCats.map(category => ({
      category,
      data: store.recipes
        .filter(r => r.category_id === category.id)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    }));
  }, [store]);

  const recentRecipes = useMemo(() => {
    if (!store) return [];
    return [...store.recipes]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 10);
  }, [store]);

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
        await createRecipeCategory(name);
      } else if (categoryModal === 'rename' && editingCategoryId) {
        await renameRecipeCategory(editingCategoryId, name);
      }
      closeCategoryModal();
      await reload();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '请稍后重试');
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
                  await reload();
                } catch {
                  Alert.alert('删除失败', '请稍后重试');
                }
              })();
            },
          },
        ],
      );
    },
    [reload, store?.recipes],
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
            } catch {
              Alert.alert('删除失败', '请稍后重试');
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

  const renderTile = useCallback(
    (item: RecipeItem, index: number) => {
      const title = recipeListPreviewTitle(item);
      const metaParts: string[] = [];
      if (item.ingredients.length > 0) metaParts.push(`${item.ingredients.length} 食材`);
      if (item.steps.length > 0) metaParts.push(`${item.steps.length} 步`);

      return (
        <RecipeMotionPressable
          key={item.id}
          enterDelay={40 + index * 45}
          onPress={() => goView(item.id)}
          onLongPress={() => onDeleteRecipe(item)}
          accessibilityLabel={title}
          style={[styles.tile, { width: tileW, backgroundColor: p.card, borderColor: p.border }]}
        >
          {item.finished_image_uri ? (
            <Image source={{ uri: item.finished_image_uri }} style={styles.tileImage} contentFit="cover" />
          ) : (
            <View style={[styles.tilePlaceholder, { backgroundColor: p.placeholderBg }]}>
              <MaterialIcons name="restaurant" size={32} color={p.accent} />
            </View>
          )}
          <View style={styles.tileBody}>
            <Text style={[styles.tileTitle, { color: p.text }]} numberOfLines={2}>
              {title}
            </Text>
            {metaParts.length > 0 ? (
              <Text style={[styles.tileMeta, { color: p.outlineMuted }]} numberOfLines={1}>
                {metaParts.join(' · ')}
              </Text>
            ) : (
              <Text style={[styles.tileMeta, { color: p.outlineMuted }]}>
                {formatRecipeRelativeTime(item.updated_at)}
              </Text>
            )}
          </View>
        </RecipeMotionPressable>
      );
    },
    [goView, onDeleteRecipe, p, tileW],
  );

  const hasCategories = (store?.categories.length ?? 0) > 0;
  const recipeCount = store?.recipes.length ?? 0;

  return (
    <View style={[styles.container, { backgroundColor: p.bg }]}>
      <View
        style={[
          styles.topBarWrap,
          { paddingTop: insets.top, backgroundColor: p.header, borderBottomColor: p.border },
        ]}
      >
        <View style={styles.topBar}>
          <Pressable
            style={({ pressed }) => [
              styles.headerIconBtn,
              { backgroundColor: p.card, borderColor: p.border, opacity: pressed ? 0.75 : 1 },
            ]}
            onPress={() => router.back()}
          >
            <MaterialIcons name="arrow-back-ios-new" size={18} color={p.primary} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={[styles.topBarTitle, { color: p.text }]}>我的菜谱</Text>
            {hasCategories && !loading ? (
              <Text style={[styles.topBarSub, { color: p.textSecondary }]}>
                {recipeCount} 道拿手菜
              </Text>
            ) : null}
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.headerIconBtn,
              { backgroundColor: p.primarySoft, borderColor: p.border, opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={openCreateCategory}
            accessibilityLabel="新建分类"
          >
            <MaterialIcons name="create-new-folder" size={22} color={p.primary} />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={p.primary} />
        </View>
      ) : !hasCategories ? (
        <View style={styles.centered}>
          <View style={[styles.emptyRing, { backgroundColor: p.accentSoft, borderColor: p.border }]}>
            <MaterialIcons name="menu-book" size={42} color={p.accent} />
          </View>
          <Text style={[styles.emptyTitle, { color: p.text }]}>打开你的菜谱本</Text>
          <Text style={[styles.emptyHint, { color: p.textSecondary }]}>
            先建一章分类（家常菜、烘焙…），{'\n'}再把拿手菜摆进格子里
          </Text>
          <Pressable
            onPress={openCreateCategory}
            style={({ pressed }) => [
              styles.emptyBtn,
              { backgroundColor: p.primary, opacity: pressed ? 0.88 : 1 },
            ]}
          >
            <MaterialIcons name="add" size={20} color="#fff" />
            <Text style={styles.emptyBtnText}>新建分类</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={{
            paddingBottom: Math.max(insets.bottom, 20) + 20,
          }}
          showsVerticalScrollIndicator={false}
        >
          {recentRecipes.length > 0 ? (
            <View style={styles.recentBlock}>
              <Text style={[styles.recentLabel, { color: p.outline }]}>最近翻过</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.recentRail}
              >
                {recentRecipes.map((item, i) => (
                  <RecipeMotionPressable
                    key={`recent-${item.id}`}
                    enterDelay={30 + i * 35}
                    onPress={() => goView(item.id)}
                    style={[styles.recentCard, { backgroundColor: p.card, borderColor: p.border }]}
                  >
                    {item.finished_image_uri ? (
                      <Image
                        source={{ uri: item.finished_image_uri }}
                        style={styles.recentImage}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={[styles.recentPlaceholder, { backgroundColor: p.placeholderBg }]}>
                        <MaterialIcons name="restaurant" size={22} color={p.accent} />
                      </View>
                    )}
                    <Text style={[styles.recentTitle, { color: p.text }]} numberOfLines={2}>
                      {recipeListPreviewTitle(item)}
                    </Text>
                  </RecipeMotionPressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {sections.map((section, sectionIndex) => (
            <View
              key={section.category.id}
              style={[styles.chapter, sectionIndex === 0 && !recentRecipes.length ? styles.chapterFirst : null]}
            >
              <View style={styles.chapterHead}>
                <View style={styles.chapterTitleCol}>
                  <Text style={[styles.chapterKicker, { color: p.accent }]}>CHAPTER</Text>
                  <Text style={[styles.chapterTitle, { color: p.text }]}>{section.category.name}</Text>
                  <Text style={[styles.chapterCount, { color: p.outlineMuted }]}>
                    {section.data.length > 0 ? `${section.data.length} 道` : '还是空的'}
                  </Text>
                </View>
                <View style={styles.chapterActions}>
                  <Pressable
                    hitSlop={8}
                    onPress={() => onCategoryMenu(section.category)}
                    style={[styles.chapterBtn, { backgroundColor: p.card, borderColor: p.border }]}
                  >
                    <MaterialIcons name="more-horiz" size={20} color={p.outline} />
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    onPress={() => goNewRecipe(section.category.id)}
                    accessibilityLabel={`在 ${section.category.name} 中添加菜谱`}
                    style={[styles.chapterBtn, { backgroundColor: p.primary, borderColor: p.primary }]}
                  >
                    <MaterialIcons name="add" size={22} color="#fff" />
                  </Pressable>
                </View>
              </View>

              {section.data.length === 0 ? (
                <Pressable
                  onPress={() => goNewRecipe(section.category.id)}
                  style={({ pressed }) => [
                    styles.emptyChapter,
                    {
                      borderColor: p.border,
                      backgroundColor: p.card,
                      opacity: pressed ? 0.88 : 1,
                    },
                  ]}
                >
                  <MaterialIcons name="add-circle-outline" size={22} color={p.primary} />
                  <Text style={{ color: p.outlineMuted, fontSize: 14, fontWeight: '600' }}>
                    添加第一道菜
                  </Text>
                </Pressable>
              ) : (
                <View style={styles.grid}>
                  {section.data.map((item, index) => renderTile(item, index))}
                </View>
              )}
            </View>
          ))}

          <Text style={[styles.footerHint, { color: p.outlineMuted }]}>
            长按菜谱可删除 · 分类点「···」管理
          </Text>
        </ScrollView>
      )}

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
                style={[styles.modalBtnSecondary, { borderColor: p.border }]}
              >
                <Text style={{ color: p.outline, fontWeight: '700' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => void saveCategoryModal()}
                disabled={categorySaving}
                style={[styles.modalBtnPrimary, { backgroundColor: p.primary }]}
              >
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
  container: { flex: 1 },
  topBarWrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 10,
  },
  headerIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, gap: 2 },
  topBarTitle: { fontSize: 22, fontWeight: '900', letterSpacing: 0.3 },
  topBarSub: { fontSize: 12, fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36, gap: 10 },
  emptyRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 20, fontWeight: '900', marginTop: 4 },
  emptyHint: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 18,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 14,
  },
  emptyBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  recentBlock: { paddingTop: 16, gap: 10 },
  recentLabel: {
    paddingHorizontal: PAGE_PAD,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  recentRail: { paddingHorizontal: PAGE_PAD, gap: 10 },
  recentCard: {
    width: 108,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  recentImage: { width: '100%', height: 86 },
  recentPlaceholder: {
    width: '100%',
    height: 86,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentTitle: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
    minHeight: 40,
  },
  chapter: { paddingHorizontal: PAGE_PAD, paddingTop: 28, gap: 14 },
  chapterFirst: { paddingTop: 18 },
  chapterHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  chapterTitleCol: { flex: 1, gap: 2 },
  chapterKicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  chapterTitle: { fontSize: 24, fontWeight: '900', letterSpacing: 0.2 },
  chapterCount: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  chapterActions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 2 },
  chapterBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyChapter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 28,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  tile: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tileImage: { width: '100%', aspectRatio: 1 },
  tilePlaceholder: {
    width: '100%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBody: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 12, gap: 4 },
  tileTitle: { fontSize: 14, fontWeight: '800', lineHeight: 19 },
  tileMeta: { fontSize: 11, fontWeight: '600' },
  footerHint: {
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 28,
    paddingHorizontal: 24,
  },
  modalRoot: { flex: 1, justifyContent: 'center', padding: 24 },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
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
