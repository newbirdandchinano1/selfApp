import { Layout, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  createCustomCategoryId,
  DEFAULT_WISH_CATEGORIES,
  findDuplicateCategoryName,
  isBuiltinWishCategoryId,
  loadCustomWishCategories,
  loadDefaultNameOverrides,
  loadDefaultPriorityOverrides,
  loadHiddenDefaultCategoryIds,
  mergeWishCategories,
  saveCustomWishCategories,
  saveDefaultNameOverrides,
  saveDefaultPriorityOverrides,
  saveHiddenDefaultCategoryIds,
  type WishCategoryDef,
} from '@/lib/wish-categories';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

export type WishExtrasFormValue = {
  categoryId: string;
  categoryLabel: string | null;
  desireLevel: number;
  reason: string;
};

export const defaultWishExtrasFormValue = (): WishExtrasFormValue => ({
  categoryId: '',
  categoryLabel: null,
  desireLevel: 3,
  reason: '',
});

export function wishExtrasFromRow(row: {
  category_id: string | null;
  category_label: string | null;
  desire_level: number;
  reason: string | null;
}): WishExtrasFormValue {
  return {
    categoryId: row.category_id ?? '',
    categoryLabel: row.category_label?.trim() || null,
    desireLevel: Math.min(5, Math.max(1, Math.round(row.desire_level))),
    reason: row.reason ?? '',
  };
}

export function wishExtrasToSavePayload(value: WishExtrasFormValue) {
  const label = value.categoryLabel?.trim() || null;
  return {
    category_id: value.categoryId || null,
    category_label: label,
    desire_level: value.desireLevel,
    reason: value.reason.trim() || null,
  };
}

type WishSavingsWishExtrasFieldsProps = {
  value: WishExtrasFormValue;
  onChange: (next: WishExtrasFormValue) => void;
  /** 全屏页可折叠；存钱计划表单内直接展示 */
  collapsible?: boolean;
  defaultExpanded?: boolean;
  sectionTitle?: string;
  /** 好物编辑页：更轻量的分区样式 */
  variant?: 'default' | 'wish';
};

export function WishSavingsWishExtrasFields({
  value,
  onChange,
  collapsible = false,
  defaultExpanded = true,
  sectionTitle = '心愿信息',
  variant = 'default',
}: WishSavingsWishExtrasFieldsProps) {
  const { colors } = useAppTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [customCategories, setCustomCategories] = useState<WishCategoryDef[]>([]);
  const [defaultPriorityOverrides, setDefaultPriorityOverrides] = useState<Record<string, number>>({});
  const [defaultNameOverrides, setDefaultNameOverrides] = useState<Record<string, string>>({});
  const [hiddenDefaultCategoryIds, setHiddenDefaultCategoryIds] = useState<string[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [categoryModalMode, setCategoryModalMode] = useState<'create' | 'edit'>('create');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryPriority, setNewCategoryPriority] = useState('50');
  const [categorySaveError, setCategorySaveError] = useState<string | null>(null);

  const categoryOptions = useMemo(
    () =>
      mergeWishCategories(
        customCategories,
        defaultPriorityOverrides,
        defaultNameOverrides,
        hiddenDefaultCategoryIds,
      ),
    [customCategories, defaultPriorityOverrides, defaultNameOverrides, hiddenDefaultCategoryIds],
  );

  const categoryTriggerLabel = useMemo(() => {
    const hit = categoryOptions.find((c) => c.id === value.categoryId);
    return hit?.name ?? value.categoryLabel ?? '';
  }, [categoryOptions, value.categoryId, value.categoryLabel]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [list, priorityOv, nameOv, hiddenDefaults] = await Promise.all([
          loadCustomWishCategories(),
          loadDefaultPriorityOverrides(),
          loadDefaultNameOverrides(),
          loadHiddenDefaultCategoryIds(),
        ]);
        if (alive) {
          setCustomCategories(list);
          setDefaultPriorityOverrides(priorityOv);
          setDefaultNameOverrides(nameOv);
          setHiddenDefaultCategoryIds(hiddenDefaults);
        }
      } finally {
        if (alive) setCategoriesLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const patch = useCallback(
    (partial: Partial<WishExtrasFormValue>) => onChange({ ...value, ...partial }),
    [onChange, value],
  );

  const selectCategory = useCallback(
    (item: WishCategoryDef) => {
      onChange({
        ...value,
        categoryId: item.id,
        categoryLabel: item.name,
      });
      setCategoryMenuOpen(false);
    },
    [onChange, value],
  );

  const closeCategoryModal = useCallback(() => {
    setCategoryModalVisible(false);
    setCategoryModalMode('create');
    setEditingCategoryId(null);
    setCategorySaveError(null);
  }, []);

  const openAddCategoryModal = useCallback(() => {
    setCategorySaveError(null);
    setCategoryModalMode('create');
    setEditingCategoryId(null);
    setNewCategoryName('');
    setNewCategoryPriority('50');
    setCategoryModalVisible(true);
  }, []);

  const openEditCategoryModal = useCallback((item: WishCategoryDef) => {
    setCategorySaveError(null);
    setCategoryModalMode('edit');
    setEditingCategoryId(item.id);
    setNewCategoryName(item.name);
    setNewCategoryPriority(String(item.priority));
    setCategoryModalVisible(true);
  }, []);

  const commitCategoryModal = useCallback(async () => {
    const pr = Number.parseInt(newCategoryPriority.replace(/\D/g, ''), 10);
    const priority = Number.isFinite(pr) ? Math.min(9999, Math.max(0, pr)) : 50;

    if (categoryModalMode === 'create') {
      const trimmed = newCategoryName.trim();
      const dupMsg = findDuplicateCategoryName(trimmed, categoryOptions);
      if (dupMsg) {
        setCategorySaveError(dupMsg);
        return;
      }
      const nextCat: WishCategoryDef = {
        id: createCustomCategoryId(),
        name: trimmed,
        priority,
      };
      try {
        await saveCustomWishCategories([...customCategories, nextCat]);
        setCustomCategories((prev) => [...prev, nextCat]);
        selectCategory(nextCat);
        closeCategoryModal();
      } catch {
        setCategorySaveError('保存失败，请稍后重试');
      }
      return;
    }

    if (!editingCategoryId) {
      setCategorySaveError('无法保存');
      return;
    }

    if (isBuiltinWishCategoryId(editingCategoryId)) {
      const trimmed = newCategoryName.trim();
      const dupMsg = findDuplicateCategoryName(trimmed, categoryOptions, editingCategoryId);
      if (dupMsg) {
        setCategorySaveError(dupMsg);
        return;
      }
      const base = DEFAULT_WISH_CATEGORIES.find((d) => d.id === editingCategoryId);
      if (!base) {
        setCategorySaveError('无法保存');
        return;
      }
      const nextNames = { ...defaultNameOverrides };
      if (trimmed === base.name) delete nextNames[editingCategoryId];
      else nextNames[editingCategoryId] = trimmed;
      const nextPriorities = { ...defaultPriorityOverrides };
      if (priority === base.priority) delete nextPriorities[editingCategoryId];
      else nextPriorities[editingCategoryId] = priority;
      try {
        await Promise.all([
          saveDefaultNameOverrides(nextNames),
          saveDefaultPriorityOverrides(nextPriorities),
        ]);
        setDefaultNameOverrides(nextNames);
        setDefaultPriorityOverrides(nextPriorities);
        setCategoryMenuOpen(false);
        closeCategoryModal();
      } catch {
        setCategorySaveError('保存失败，请稍后重试');
      }
      return;
    }

    const trimmed = newCategoryName.trim();
    const dupMsg = findDuplicateCategoryName(trimmed, categoryOptions, editingCategoryId);
    if (dupMsg) {
      setCategorySaveError(dupMsg);
      return;
    }
    const next = customCategories.map((c) =>
      c.id === editingCategoryId ? { ...c, name: trimmed, priority } : c,
    );
    try {
      await saveCustomWishCategories(next);
      setCustomCategories(next);
      if (value.categoryId === editingCategoryId) {
        patch({ categoryLabel: trimmed });
      }
      setCategoryMenuOpen(false);
      closeCategoryModal();
    } catch {
      setCategorySaveError('保存失败，请稍后重试');
    }
  }, [
    categoryModalMode,
    categoryOptions,
    closeCategoryModal,
    customCategories,
    defaultNameOverrides,
    defaultPriorityOverrides,
    editingCategoryId,
    newCategoryName,
    newCategoryPriority,
    patch,
    selectCategory,
    value.categoryId,
  ]);

  const editingIsBuiltin =
    categoryModalMode === 'edit' && editingCategoryId
      ? isBuiltinWishCategoryId(editingCategoryId)
      : false;

  const deleteEditingCategory = useCallback(async () => {
    if (!editingCategoryId) return;
    if (categoryOptions.length <= 1) {
      Alert.alert('无法删除', '至少需要保留 1 个类别。');
      return;
    }

    if (isBuiltinWishCategoryId(editingCategoryId)) {
      const nextHidden = [...new Set([...hiddenDefaultCategoryIds, editingCategoryId])];
      const nextNames = { ...defaultNameOverrides };
      delete nextNames[editingCategoryId];
      const nextPriorities = { ...defaultPriorityOverrides };
      delete nextPriorities[editingCategoryId];
      try {
        await Promise.all([
          saveHiddenDefaultCategoryIds(nextHidden),
          saveDefaultNameOverrides(nextNames),
          saveDefaultPriorityOverrides(nextPriorities),
        ]);
        setHiddenDefaultCategoryIds(nextHidden);
        setDefaultNameOverrides(nextNames);
        setDefaultPriorityOverrides(nextPriorities);
        if (value.categoryId === editingCategoryId) {
          patch({ categoryId: '', categoryLabel: null });
        }
        closeCategoryModal();
      } catch {
        Alert.alert('删除失败', '请稍后重试');
      }
      return;
    }

    const next = customCategories.filter((c) => c.id !== editingCategoryId);
    try {
      await saveCustomWishCategories(next);
      setCustomCategories(next);
      if (value.categoryId === editingCategoryId) {
        patch({ categoryId: '', categoryLabel: null });
      }
      closeCategoryModal();
    } catch {
      Alert.alert('删除失败', '请稍后重试');
    }
  }, [
    categoryOptions.length,
    closeCategoryModal,
    customCategories,
    defaultNameOverrides,
    defaultPriorityOverrides,
    editingCategoryId,
    hiddenDefaultCategoryIds,
    patch,
    value.categoryId,
  ]);

  const desireHint = useMemo(() => {
    const lv = value.desireLevel;
    if (lv >= 5) return '心之所向';
    if (lv >= 4) return '强烈想要';
    if (lv >= 3) return '中等兴趣';
    if (lv >= 2) return '可有可无';
    return '理智购买';
  }, [value.desireLevel]);

  const isWish = variant === 'wish';

  const fieldsBody = (
    <View
      style={[
        isWish ? styles.extrasCardWish : styles.extrasCard,
        {
          backgroundColor: isWish ? 'transparent' : colors.surface,
          borderColor: colors.outline,
        },
      ]}>
      <Text style={[Typography.caption, { color: colors.textSecondary }]}>所属类别</Text>
      <Pressable
        onPress={() => setCategoryMenuOpen((o) => !o)}
        style={[styles.extrasField, { borderColor: colors.outline, backgroundColor: colors.input }]}>
        <Text style={{ color: categoryTriggerLabel ? colors.text : colors.textMuted }}>
          {categoryTriggerLabel || '选择类别…'}
        </Text>
        <MaterialIcons
          name={categoryMenuOpen ? 'arrow-drop-up' : 'arrow-drop-down'}
          size={22}
          color={colors.textMuted}
        />
      </Pressable>
      {categoryMenuOpen ? (
        <View style={styles.categoryWrap}>
          {(categoriesLoaded ? categoryOptions : []).map((item) => {
            const active = item.id === value.categoryId;
            return (
              <Pressable
                key={item.id}
                delayLongPress={420}
                onPress={() => selectCategory(item)}
                onLongPress={() => openEditCategoryModal(item)}
                style={[
                  styles.categoryPill,
                  {
                    backgroundColor: active ? `${colors.primary}1A` : colors.input,
                    borderColor: active ? `${colors.primary}44` : colors.outline,
                  },
                ]}>
                <Text style={{ color: active ? colors.primary : colors.textSecondary, fontWeight: '600' }}>
                  {item.name}
                </Text>
              </Pressable>
            );
          })}
          <Pressable onPress={openAddCategoryModal} style={styles.addCategoryBtn}>
            <MaterialIcons name="add-circle-outline" size={18} color={colors.primary} />
            <Text style={{ color: colors.primary, fontWeight: '700' }}>添加自定义类别</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.desireHeader}>
        <Text style={[Typography.caption, { color: colors.textSecondary, marginTop: Spacing.lg }]}>
          心动等级
        </Text>
        <Text style={[Typography.caption, { color: colors.primary, marginTop: Spacing.lg, fontWeight: '800' }]}>
          {desireHint}
        </Text>
      </View>
      <View style={styles.starRow}>
        {[1, 2, 3, 4, 5].map((level) => (
          <Pressable key={level} onPress={() => patch({ desireLevel: level })} style={styles.starBtn}>
            <MaterialIcons
              name={level <= value.desireLevel ? 'star' : 'star-border'}
              size={isWish ? 32 : 28}
              color={level <= value.desireLevel ? colors.primary : colors.textMuted}
            />
          </Pressable>
        ))}
      </View>

      <Text style={[Typography.caption, { color: colors.textSecondary, marginTop: Spacing.lg }]}>
        心动理由
      </Text>
      <TextInput
        value={value.reason}
        onChangeText={(text) => patch({ reason: text })}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        placeholder="记录此刻的心动理由…"
        placeholderTextColor={colors.textMuted}
        style={[
          styles.reasonInput,
          { backgroundColor: colors.input, borderColor: colors.outline, color: colors.text },
        ]}
      />
    </View>
  );

  return (
    <>
      {collapsible ? (
        <>
          <Pressable
            onPress={() => setExpanded((o) => !o)}
            style={({ pressed }) => [
              styles.extrasToggle,
              { backgroundColor: colors.surfaceMuted, borderColor: colors.outline },
              pressed && { opacity: 0.9 },
            ]}>
            <Text style={[Typography.bodyStrong, { color: colors.text }]}>{sectionTitle}</Text>
            <MaterialIcons
              name={expanded ? 'expand-less' : 'expand-more'}
              size={22}
              color={colors.textSecondary}
            />
          </Pressable>
          {expanded ? fieldsBody : null}
        </>
      ) : (
        <>
          <Text
            style={[
              isWish ? Typography.label : Typography.caption,
              {
                color: colors.textSecondary,
                marginTop: isWish ? Spacing['4xl'] : Spacing.sm,
                marginBottom: Spacing.md,
              },
            ]}>
            {sectionTitle}
          </Text>
          {fieldsBody}
        </>
      )}

      <Modal visible={categoryModalVisible} transparent animationType="fade" onRequestClose={closeCategoryModal}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeCategoryModal} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalKb}
            pointerEvents="box-none">
            <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
              <Text style={[Typography.title, { color: colors.text }]}>
                {categoryModalMode === 'create'
                  ? '自定义类别'
                  : editingIsBuiltin
                    ? '编辑内置类别'
                    : '编辑类别'}
              </Text>
              <TextInput
                value={newCategoryName}
                onChangeText={(t) => {
                  setNewCategoryName(t);
                  setCategorySaveError(null);
                }}
                placeholder="类别名称"
                placeholderTextColor={colors.textMuted}
                style={[styles.modalInput, { color: colors.text, borderColor: colors.outline }]}
              />
              <TextInput
                value={newCategoryPriority}
                onChangeText={(v) => {
                  setNewCategoryPriority(v.replace(/\D/g, '').slice(0, 4));
                  setCategorySaveError(null);
                }}
                placeholder="优先级 0–9999"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                style={[styles.modalInput, { color: colors.text, borderColor: colors.outline }]}
              />
              {categorySaveError ? <Text style={{ color: colors.danger }}>{categorySaveError}</Text> : null}
              <View style={styles.modalActions}>
                <Pressable
                  onPress={closeCategoryModal}
                  style={[styles.modalSecondaryBtn, { borderColor: colors.outline }]}>
                  <Text style={{ color: colors.textSecondary }}>取消</Text>
                </Pressable>
                <Pressable
                  onPress={() => void commitCategoryModal()}
                  style={[styles.modalPrimaryBtn, { backgroundColor: colors.primary }]}>
                  <Text style={{ color: colors.onPrimary, fontWeight: '700' }}>保存</Text>
                </Pressable>
              </View>
              {categoryModalMode === 'edit' && editingCategoryId ? (
                <Pressable onPress={() => void deleteEditingCategory()} style={styles.modalDeleteBtn}>
                  <Text style={{ color: colors.danger, fontWeight: '700' }}>
                    {editingIsBuiltin ? '从列表移除' : '删除类别'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  extrasToggle: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  extrasCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: Spacing['2xl'],
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  extrasCardWish: {
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  desireHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  extrasField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  categoryWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  categoryPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addCategoryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
  },
  starRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
    justifyContent: 'center',
  },
  starBtn: {
    padding: 2,
  },
  reasonInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 96,
    marginTop: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  modalKb: {
    width: '100%',
  },
  modalCard: {
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  modalSecondaryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  modalPrimaryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  modalDeleteBtn: {
    alignItems: 'center',
    paddingTop: 8,
  },
});
