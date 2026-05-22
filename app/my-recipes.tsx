import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
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
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Section = { category: RecipeCategory; data: RecipeItem[] };

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export default function MyRecipesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const bg = isDark ? theme.background : '#faf8ff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.85)' : '#5c6370';
  const outlineMuted = isDark ? 'rgba(148,163,184,0.55)' : '#8b92a0';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const accent = isDark ? '#fb923c' : '#ea580c';
  const accentSoft = isDark ? 'rgba(251,146,60,0.18)' : 'rgba(234,88,12,0.1)';
  const borderSoft = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(0,88,190,0.08)';
  const cardBg = isDark ? '#1e293b' : '#ffffff';
  const headerBg = isDark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.96)';
  const inputBg = isDark ? 'rgba(15,23,42,0.55)' : '#f4f6ff';
  const thumbPlaceholderBg = isDark ? 'rgba(251,146,60,0.12)' : accentSoft;

  const [store, setStore] = useState<RecipeStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [categoryModal, setCategoryModal] = useState<'create' | 'rename' | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryNameDraft, setCategoryNameDraft] = useState('');
  const [categorySaving, setCategorySaving] = useState(false);
  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});

  const reload = useCallback(async () => {
    try {
      const s = await loadRecipeStore();
      setStore(s);
    } catch {
      Alert.alert('加载失败', '请稍后重试');
      setStore({ version: 2, categories: [], recipes: [] });
    } finally {
      setLoading(false);
    }
  }, []);

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

  const stats = useMemo(() => {
    const catCount = store?.categories.length ?? 0;
    const recipeCount = store?.recipes.length ?? 0;
    const withPhoto = store?.recipes.filter(r => r.finished_image_uri).length ?? 0;
    return { catCount, recipeCount, withPhoto };
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
              delete swipeableRefs.current[row.id];
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

  const renderRecipeMeta = useCallback(
    (item: RecipeItem) => {
      const chips: string[] = [];
      if (item.ingredients.length > 0) chips.push(`${item.ingredients.length} 食材`);
      if (item.steps.length > 0) chips.push(`${item.steps.length} 步`);
      if (chips.length === 0) return null;
      return (
        <View style={styles.chipRow}>
          {chips.map(label => (
            <View key={label} style={[styles.chip, { backgroundColor: accentSoft, borderColor: borderSoft }]}>
              <Text style={[styles.chipText, { color: accent }]}>{label}</Text>
            </View>
          ))}
        </View>
      );
    },
    [accent, accentSoft, borderSoft],
  );

  const renderRecipeRow = useCallback(
    (item: RecipeItem, index: number, total: number) => {
      const isLast = index === total - 1;
      return (
        <Swipeable
          key={item.id}
          ref={r => {
            swipeableRefs.current[item.id] = r;
          }}
          overshootRight={false}
          rightThreshold={48}
          renderRightActions={() => (
            <Pressable
              onPress={() => onDeleteRecipe(item)}
              style={({ pressed }) => [styles.swipeDeleteAction, pressed && { opacity: 0.92 }]}
            >
              <MaterialIcons name="delete-outline" size={22} color="#fff" />
            </Pressable>
          )}
        >
          <Pressable
            onPress={() => router.push({ pathname: '/recipe-view/[id]', params: { id: item.id } })}
            style={({ pressed }) => [
              styles.rowItem,
              {
                borderBottomColor: isLast ? 'transparent' : borderSoft,
                opacity: pressed ? 0.92 : 1,
              },
            ]}
          >
            {item.finished_image_uri ? (
              <Image source={{ uri: item.finished_image_uri }} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={[styles.thumbPlaceholder, { backgroundColor: thumbPlaceholderBg }]}>
                <MaterialIcons name="restaurant" size={24} color={accent} />
              </View>
            )}
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, { color: text }]} numberOfLines={1}>
                {recipeListPreviewTitle(item)}
              </Text>
              {renderRecipeMeta(item)}
              <Text style={[styles.rowTime, { color: outlineMuted }]}>
                {formatRelativeTime(item.updated_at)}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={outlineMuted} style={styles.rowChevron} />
          </Pressable>
        </Swipeable>
      );
    },
    [accent, borderSoft, onDeleteRecipe, outlineMuted, renderRecipeMeta, router, text, thumbPlaceholderBg],
  );

  const renderSection = useCallback(
    (section: Section, sectionIndex: number) => (
      <View key={section.category.id} style={[styles.sectionWrap, sectionIndex > 0 && styles.sectionWrapGap]}>
        <View style={styles.sectionHead}>
          <MaterialIcons name="folder" size={17} color={accent} />
          <Pressable
            onLongPress={() => openRenameCategory(section.category)}
            style={styles.sectionTitleWrap}
          >
            <Text style={[styles.sectionTitle, { color: text }]}>{section.category.name}</Text>
            <Text style={[styles.sectionCount, { color: outlineMuted }]}>
              {section.data.length > 0 ? `${section.data.length} 道` : '暂无菜谱'}
            </Text>
          </Pressable>
          <View style={styles.sectionActions}>
            <Pressable hitSlop={8} onPress={() => openRenameCategory(section.category)}>
              <MaterialIcons name="edit" size={18} color={outline} />
            </Pressable>
            <Pressable hitSlop={8} onPress={() => onDeleteCategory(section.category)} style={{ marginLeft: 12 }}>
              <MaterialIcons name="delete-outline" size={18} color={isDark ? '#f87171' : '#b91c1c'} />
            </Pressable>
            <Pressable
              hitSlop={8}
              onPress={() => goNewRecipe(section.category.id)}
              accessibilityLabel={`在 ${section.category.name} 中添加菜谱`}
              style={{ marginLeft: 12 }}
            >
              <MaterialIcons name="add" size={22} color={primary} />
            </Pressable>
          </View>
        </View>

        <View style={[styles.recipeGroup, { backgroundColor: cardBg, borderColor: borderSoft }]}>
          {section.data.length === 0 ? (
            <Pressable
              onPress={() => goNewRecipe(section.category.id)}
              style={({ pressed }) => [styles.emptySectionRow, { opacity: pressed ? 0.88 : 1 }]}
            >
              <MaterialIcons name="add" size={18} color={primary} />
              <Text style={{ color: outlineMuted, fontSize: 13 }}>添加菜谱</Text>
            </Pressable>
          ) : (
            section.data.map((item, index) => renderRecipeRow(item, index, section.data.length))
          )}
        </View>
      </View>
    ),
    [
      accent,
      borderSoft,
      cardBg,
      goNewRecipe,
      isDark,
      onDeleteCategory,
      openRenameCategory,
      outline,
      outlineMuted,
      primary,
      renderRecipeRow,
      text,
    ],
  );

  const hasCategories = (store?.categories.length ?? 0) > 0;

  const listHeader = useMemo(
    () => (
      <View style={styles.listHeader}>
        <View style={[styles.statsCard, { backgroundColor: cardBg, borderColor: borderSoft }]}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: text }]}>{stats.catCount}</Text>
            <Text style={[styles.statLabel, { color: outline }]}>分类</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: borderSoft }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: text }]}>{stats.recipeCount}</Text>
            <Text style={[styles.statLabel, { color: outline }]}>菜谱</Text>
          </View>
          {stats.withPhoto > 0 ? (
            <>
              <View style={[styles.statDivider, { backgroundColor: borderSoft }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: accent }]}>{stats.withPhoto}</Text>
                <Text style={[styles.statLabel, { color: outline }]}>有图</Text>
              </View>
            </>
          ) : null}
        </View>
        <Text style={[styles.listHint, { color: outlineMuted }]}>左滑删除 · 长按分类名重命名</Text>
      </View>
    ),
    [borderSoft, cardBg, outline, outlineMuted, stats, text, accent],
  );

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View
        style={[
          styles.topBarWrap,
          { paddingTop: insets.top, backgroundColor: headerBg, borderBottomColor: borderSoft },
        ]}
      >
        <View style={styles.topBar}>
          <Pressable
            style={({ pressed }) => [styles.headerIconBtn, { backgroundColor: isDark ? 'rgba(30,41,59,0.6)' : '#fff', opacity: pressed ? 0.8 : 1 }]}
            onPress={() => router.back()}
          >
            <MaterialIcons name="arrow-back-ios-new" size={18} color={primary} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={[styles.topBarTitle, { color: text }]}>我的菜谱</Text>
            {hasCategories && !loading ? (
              <Text style={[styles.topBarSub, { color: outline }]}>{stats.recipeCount} 道菜 · {stats.catCount} 个分类</Text>
            ) : null}
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.headerIconBtn,
              styles.headerIconBtnPrimary,
              {
                backgroundColor: isDark ? 'rgba(96,165,250,0.2)' : 'rgba(0,88,190,0.1)',
                opacity: pressed ? 0.85 : 1,
              },
            ]}
            onPress={openCreateCategory}
            accessibilityLabel="新建分类"
          >
            <MaterialIcons name="create-new-folder" size={22} color={primary} />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={primary} />
        </View>
      ) : !hasCategories ? (
        <View style={styles.centered}>
          <View style={[styles.emptyIconRing, { backgroundColor: accentSoft, borderColor: borderSoft }]}>
            <MaterialIcons name="menu-book" size={40} color={accent} />
          </View>
          <Text style={[styles.emptyTitle, { color: text }]}>开始你的菜谱本</Text>
          <Text style={[styles.emptyHint, { color: outline }]}>
            先创建分类（如家常菜、烘焙），{'\n'}再在分类里添加拿手菜
          </Text>
          <Pressable
            onPress={openCreateCategory}
            style={({ pressed }) => [
              styles.emptyBtn,
              { backgroundColor: primary, opacity: pressed ? 0.88 : 1 },
            ]}
          >
            <MaterialIcons name="add" size={20} color="#fff" />
            <Text style={styles.emptyBtnText}>新建分类</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: Math.max(insets.bottom, 20) + 16,
          }}
          showsVerticalScrollIndicator={false}
        >
          {listHeader}
          {sections.map((section, index) => renderSection(section, index))}
        </ScrollView>
      )}

      <Modal visible={categoryModal != null} transparent animationType="fade" onRequestClose={closeCategoryModal}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closeCategoryModal} />
          <View style={[styles.modalCard, { backgroundColor: cardBg, borderColor: borderSoft }]}>
            <View style={[styles.modalIconWrap, { backgroundColor: accentSoft }]}>
              <MaterialIcons
                name={categoryModal === 'create' ? 'create-new-folder' : 'drive-file-rename-outline'}
                size={24}
                color={accent}
              />
            </View>
            <Text style={[styles.modalTitle, { color: text }]}>
              {categoryModal === 'create' ? '新建分类' : '重命名分类'}
            </Text>
            <TextInput
              value={categoryNameDraft}
              onChangeText={setCategoryNameDraft}
              placeholder="例如：家常菜、烘焙"
              placeholderTextColor={outlineMuted}
              autoFocus
              style={[styles.modalInput, { color: text, borderColor: borderSoft, backgroundColor: inputBg }]}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={closeCategoryModal}
                disabled={categorySaving}
                style={[styles.modalBtnSecondary, { borderColor: borderSoft }]}
              >
                <Text style={{ color: outline, fontWeight: '700' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => void saveCategoryModal()}
                disabled={categorySaving}
                style={[styles.modalBtnPrimary, { backgroundColor: primary }]}
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
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconBtnPrimary: {},
  headerCenter: { flex: 1, gap: 2 },
  topBarTitle: { fontSize: 20, fontWeight: '900', letterSpacing: 0.2 },
  topBarSub: { fontSize: 12, fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36, gap: 10 },
  emptyIconRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontWeight: '900', marginTop: 4 },
  emptyHint: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 12,
  },
  emptyBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  listHeader: { marginBottom: 6, gap: 10 },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 22, fontWeight: '900' },
  statLabel: { fontSize: 11, fontWeight: '700' },
  statDivider: { width: 1, height: 28 },
  listHint: { fontSize: 11, textAlign: 'center' },
  sectionWrap: { gap: 8 },
  sectionWrapGap: { marginTop: 22 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  sectionTitleWrap: { flex: 1, gap: 1 },
  sectionTitle: { fontSize: 15, fontWeight: '800' },
  sectionCount: { fontSize: 11, fontWeight: '600' },
  sectionActions: { flexDirection: 'row', alignItems: 'center' },
  recipeGroup: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  emptySectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 64, height: 64, borderRadius: 12 },
  thumbPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 6, minWidth: 0 },
  rowTitle: { fontSize: 16, fontWeight: '800' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  chipText: { fontSize: 11, fontWeight: '700' },
  rowTime: { fontSize: 11, fontWeight: '600' },
  rowChevron: { marginRight: 2 },
  swipeDeleteAction: {
    width: 72,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRoot: { flex: 1, justifyContent: 'center', padding: 24 },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalCard: {
    borderRadius: 20,
    padding: 22,
    marginHorizontal: 4,
    zIndex: 1,
    gap: 14,
    borderWidth: 1,
    alignItems: 'stretch',
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
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalBtnSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  modalBtnPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalBtnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
