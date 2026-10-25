import { RecipeCategoryIcon } from '@/components/recipe/recipe-category-icon';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { fetchProfileRecipes } from '@/lib/profile-page-api';
import {
  recipeCategoryIconsByGroup,
  resolveRecipeCategoryIcon,
} from '@/lib/recipe-category-icons';
import {
  forgetRecipeCategoryMeta,
  iconKeyForCategory,
  loadRecipeCategoryMeta,
  registerRecipeCategoryMeta,
  setRecipeCategoryIcon,
  setRecipeCategoryOrder,
  sortCategoriesByMeta,
  type RecipeCategoryMetaStore,
} from '@/lib/recipe-category-meta';
import { recipeSelectionHaptic } from '@/lib/recipe-haptic';
import { getRecipePalette } from '@/lib/recipe-theme';
import {
  CATEGORY_NAME_MAX,
  createRecipeCategory,
  deleteRecipeCategory,
  loadRecipeStore,
  renameRecipeCategory,
  type RecipeCategory,
  type RecipeStore,
} from '@/lib/recipes';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Row = RecipeCategory & { count: number; iconKey: string };

export default function RecipeCategoriesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const p = getRecipePalette(useColorScheme());

  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<RecipeStore>({ version: 2, categories: [], recipes: [] });
  const [meta, setMeta] = useState<RecipeCategoryMetaStore>({ version: 1, order: [], icons: {} });
  const [sorting, setSorting] = useState(false);
  const [saving, setSaving] = useState(false);
  const persistLockRef = useRef(false);

  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [iconDraft, setIconDraft] = useState('cooking');
  const [iconPicked, setIconPicked] = useState(false);
  const [modalSaving, setModalSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      await fetchProfileRecipes({ serverFallback: true }).catch(() => undefined);
      const [s, m] = await Promise.all([loadRecipeStore(), loadRecipeCategoryMeta()]);
      setStore(s);
      setMeta(m);
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

  const rows: Row[] = useMemo(() => {
    const sorted = sortCategoriesByMeta(store.categories, meta);
    return sorted.map(cat => ({
      ...cat,
      count: store.recipes.filter(r => r.category_id === cat.id).length,
      iconKey: iconKeyForCategory(cat.id, cat.name, meta),
    }));
  }, [store, meta]);

  const openCreate = useCallback(() => {
    recipeSelectionHaptic();
    setEditingId(null);
    setNameDraft('');
    setIconDraft('cooking');
    setIconPicked(false);
    setModal('create');
  }, []);

  const openEdit = useCallback((row: Row) => {
    recipeSelectionHaptic();
    setEditingId(row.id);
    setNameDraft(row.name);
    setIconDraft(resolveRecipeCategoryIcon(row.iconKey, row.name).key);
    setIconPicked(true);
    setModal('edit');
  }, []);

  const closeModal = useCallback(() => {
    setModal(null);
    setEditingId(null);
    setNameDraft('');
    setIconDraft('cooking');
    setIconPicked(false);
  }, []);

  const saveModal = useCallback(async () => {
    const name = nameDraft.trim();
    if (!name) {
      Alert.alert('提示', '请输入分类名称');
      return;
    }
    setModalSaving(true);
    try {
      if (modal === 'create') {
        const created = await createRecipeCategory(name);
        const nextMeta = await registerRecipeCategoryMeta(created, iconDraft);
        setMeta(nextMeta);
      } else if (modal === 'edit' && editingId) {
        await renameRecipeCategory(editingId, name);
        const nextMeta = await setRecipeCategoryIcon(editingId, iconDraft);
        setMeta(nextMeta);
      }
      closeModal();
      await reload();
      toast.success('已保存');
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请稍后重试'));
    } finally {
      setModalSaving(false);
    }
  }, [closeModal, editingId, iconDraft, modal, nameDraft, reload]);

  const onDelete = useCallback(
    (row: Row) => {
      Alert.alert(
        '删除分类',
        row.count > 0
          ? `确定删除「${row.name}」？该分类下 ${row.count} 道菜将一并删除。`
          : `确定删除「${row.name}」？`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  await deleteRecipeCategory(row.id);
                  const nextMeta = await forgetRecipeCategoryMeta(row.id);
                  setMeta(nextMeta);
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
    [reload],
  );

  const onRowMenu = useCallback(
    (row: Row) => {
      Alert.alert(row.name, undefined, [
        { text: '编辑', onPress: () => openEdit(row) },
        { text: '删除分类', style: 'destructive', onPress: () => onDelete(row) },
        { text: '取消', style: 'cancel' },
      ]);
    },
    [onDelete, openEdit],
  );

  const persistOrder = useCallback(async (nextRows: Row[]) => {
    if (persistLockRef.current) return;
    persistLockRef.current = true;
    setSaving(true);
    try {
      const nextMeta = await setRecipeCategoryOrder(nextRows.map(r => r.id));
      setMeta(nextMeta);
    } catch (e) {
      toast.error(toUserMessage(e, '排序保存失败'));
    } finally {
      setSaving(false);
      persistLockRef.current = false;
    }
  }, []);

  const iconGroups = useMemo(() => recipeCategoryIconsByGroup(), []);

  const renderSortItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<Row>) => (
      <Pressable
        onLongPress={drag}
        delayLongPress={160}
        disabled={saving}
        style={({ pressed }) => [
          styles.row,
          {
            backgroundColor: p.card,
            borderBottomColor: p.border,
            opacity: isActive ? 0.92 : pressed ? 0.9 : 1,
          },
        ]}>
        <RecipeCategoryIcon iconKey={item.iconKey} name={item.name} size={22} />
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, { color: p.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.rowMeta, { color: p.outlineMuted }]}>{item.count} 道菜谱</Text>
        </View>
        <MaterialIcons name="drag-handle" size={22} color={p.outlineMuted} />
      </Pressable>
    ),
    [p, saving],
  );

  const listFooter = (
    <Text style={[styles.syncHint, { color: p.outlineMuted }]}>
      分类名称、图标和顺序会同步到菜谱首页与分类选择器。
    </Text>
  );

  return (
    <View style={[styles.root, { backgroundColor: p.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backBtn,
            { backgroundColor: p.card, borderColor: p.border, opacity: pressed ? 0.8 : 1 },
          ]}
          accessibilityLabel="返回">
          <MaterialIcons name="arrow-back-ios-new" size={18} color={p.primary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: p.text }]}>菜谱分类</Text>
        <Pressable
          onPress={() => {
            recipeSelectionHaptic();
            setSorting(v => !v);
          }}
          style={({ pressed }) => [
            styles.sortBtn,
            {
              backgroundColor: sorting ? p.primarySoft : p.card,
              borderColor: sorting ? p.primary : p.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          accessibilityLabel={sorting ? '完成排序' : '排序'}>
          <Text style={[styles.sortBtnText, { color: sorting ? p.primary : p.text }]}>
            {sorting ? '完成' : '排序'}
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={p.primary} />
        </View>
      ) : sorting ? (
        <View style={[styles.scrollContent, { flex: 1, paddingBottom: insets.bottom + 24 }]}>
          <View style={[styles.listCard, { backgroundColor: p.card, borderColor: p.border, flexGrow: 0 }]}>
            <DraggableFlatList
              data={rows}
              keyExtractor={item => item.id}
              renderItem={renderSortItem}
              onDragEnd={({ data: next }) => {
                setMeta(prev => ({ ...prev, order: next.map(r => r.id) }));
                void persistOrder(next);
              }}
              activationDistance={8}
              scrollEnabled
              ListEmptyComponent={
                <Text style={[styles.emptyText, { color: p.outlineMuted }]}>
                  暂无分类，先新建一个吧
                </Text>
              }
            />
          </View>
          <Text style={[styles.sortHint, { color: p.outlineMuted }]}>长按拖动调整顺序</Text>
          {listFooter}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 100 },
          ]}
          showsVerticalScrollIndicator={false}>
          <View style={[styles.listCard, { backgroundColor: p.card, borderColor: p.border }]}>
            {rows.length === 0 ? (
              <Text style={[styles.emptyText, { color: p.outlineMuted }]}>暂无分类，先新建一个吧</Text>
            ) : (
              rows.map((row, index) => {
                const isLast = index === rows.length - 1;
                return (
                  <Pressable
                    key={row.id}
                    onPress={() => openEdit(row)}
                    onLongPress={() => onRowMenu(row)}
                    style={({ pressed }) => [
                      styles.row,
                      {
                        borderBottomColor: p.border,
                        borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                        opacity: pressed ? 0.88 : 1,
                      },
                    ]}
                    accessibilityLabel={`${row.name}，${row.count} 道菜谱`}>
                    <RecipeCategoryIcon
                      iconKey={row.iconKey}
                      name={row.name}
                      index={index}
                      size={22}
                    />
                    <View style={styles.rowBody}>
                      <Text style={[styles.rowTitle, { color: p.text }]} numberOfLines={1}>
                        {row.name}
                      </Text>
                      <Text style={[styles.rowMeta, { color: p.outlineMuted }]}>
                        {row.count} 道菜谱
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => onRowMenu(row)}
                      hitSlop={8}
                      style={[styles.moreBtn, { backgroundColor: p.placeholderBg, borderColor: p.border }]}
                      accessibilityLabel={`${row.name} 更多`}>
                      <MaterialIcons name="more-horiz" size={20} color={p.outline} />
                    </Pressable>
                  </Pressable>
                );
              })
            )}
          </View>
          {listFooter}
        </ScrollView>
      )}

      {!sorting ? (
        <View
          style={[
            styles.footer,
            {
              paddingBottom: Math.max(insets.bottom, 12),
              backgroundColor: p.bg,
              borderTopColor: p.border,
            },
          ]}>
          <Pressable
            onPress={openCreate}
            style={({ pressed }) => [
              styles.createBtn,
              { backgroundColor: p.card, borderColor: p.border, opacity: pressed ? 0.9 : 1 },
            ]}
            accessibilityLabel="新建分类">
            <View style={[styles.createPlus, { backgroundColor: p.primary }]}>
              <MaterialIcons name="add" size={20} color="#fff" />
            </View>
            <Text style={[styles.createText, { color: p.text }]}>新建分类</Text>
          </Pressable>
        </View>
      ) : null}

      <Modal visible={modal != null} transparent animationType="fade" onRequestClose={closeModal}>
        <View style={styles.modalRoot}>
          <Pressable style={[styles.modalBackdrop, { backgroundColor: p.overlay }]} onPress={closeModal} />
          <View style={[styles.modalCard, { backgroundColor: p.card, borderColor: p.border }]}>
            <Text style={[styles.modalTitle, { color: p.text }]}>
              {modal === 'create' ? '新建分类' : '编辑分类'}
            </Text>
            <TextInput
              value={nameDraft}
              onChangeText={t => {
                setNameDraft(t);
                if (modal === 'create' && !iconPicked) {
                  setIconDraft(resolveRecipeCategoryIcon(undefined, t).key);
                }
              }}
              placeholder="例如：家常菜、烘焙"
              placeholderTextColor={p.outlineMuted}
              maxLength={CATEGORY_NAME_MAX}
              autoFocus
              style={[
                styles.modalInput,
                { color: p.text, backgroundColor: p.inputBg, borderColor: p.border },
              ]}
            />
            <Text style={[styles.iconLabel, { color: p.textSecondary }]}>图标（食物插图）</Text>
            <ScrollView
              style={styles.iconScroll}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled">
              {iconGroups.map(section => (
                <View key={section.group} style={styles.iconSection}>
                  <Text style={[styles.iconSectionTitle, { color: p.outlineMuted }]}>
                    {section.label}
                  </Text>
                  <View style={styles.iconGrid}>
                    {section.icons.map(opt => {
                      const selected = iconDraft === opt.key;
                      return (
                        <Pressable
                          key={opt.key}
                          onPress={() => {
                            recipeSelectionHaptic();
                            setIconPicked(true);
                            setIconDraft(opt.key);
                          }}
                          style={[
                            styles.iconOption,
                            {
                              backgroundColor: selected ? opt.soft : p.placeholderBg,
                              borderColor: selected ? p.primary : p.border,
                            },
                          ]}
                          accessibilityLabel={opt.label}
                          accessibilityState={{ selected }}>
                          <Text style={styles.iconEmoji}>{opt.emoji}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable
                onPress={closeModal}
                style={[styles.modalBtn, { borderColor: p.border }]}
                disabled={modalSaving}>
                <Text style={[styles.modalBtnText, { color: p.textSecondary }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => void saveModal()}
                style={[styles.modalBtn, styles.modalBtnPrimary, { backgroundColor: p.primary }]}
                disabled={modalSaving}>
                {modalSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: '#fff' }]}>保存</Text>
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
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  backBtn: {
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
  sortBtn: {
    minWidth: 56,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortBtnText: { fontSize: 14, fontWeight: '700' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingHorizontal: 16, paddingTop: 4 },
  listCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '700' },
  rowMeta: { fontSize: 13, fontWeight: '500' },
  moreBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncHint: {
    marginTop: 14,
    marginHorizontal: 20,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    fontWeight: '500',
  },
  sortHint: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyText: {
    paddingVertical: 36,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 52,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
  },
  createPlus: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createText: { fontSize: 16, fontWeight: '800' },
  modalRoot: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  modalCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    gap: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  modalInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
  },
  iconLabel: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  iconScroll: { maxHeight: 280 },
  iconSection: { marginBottom: 10 },
  iconSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconOption: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEmoji: { fontSize: 22, lineHeight: 28 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnPrimary: { borderWidth: 0 },
  modalBtnText: { fontSize: 15, fontWeight: '700' },
});
