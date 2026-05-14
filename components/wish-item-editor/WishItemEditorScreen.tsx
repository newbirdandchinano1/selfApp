import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { clearWishItemAiReview, createWishItem, getWishItemById, updateWishItem } from '@/lib/repositories/wish-list/wish-list';
import { tryPersistWishItemAiComment } from '@/lib/repositories/wish-list/wish-item-ai-comment';
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
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export type WishItemEditorMode = { kind: 'create' } | { kind: 'edit'; id: string };

type WishItemEditorScreenProps = {
  mode: WishItemEditorMode;
};

export function WishItemEditorScreen({ mode }: WishItemEditorScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [customCategories, setCustomCategories] = useState<WishCategoryDef[]>([]);
  const [defaultPriorityOverrides, setDefaultPriorityOverrides] = useState<Record<string, number>>({});
  const [defaultNameOverrides, setDefaultNameOverrides] = useState<Record<string, string>>({});
  const [hiddenDefaultCategoryIds, setHiddenDefaultCategoryIds] = useState<string[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [categoryModalMode, setCategoryModalMode] = useState<'create' | 'edit'>('create');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryPriority, setNewCategoryPriority] = useState('50');
  const [categorySaveError, setCategorySaveError] = useState<string | null>(null);
  const [desireLevel, setDesireLevel] = useState(3);
  const [reason, setReason] = useState('');
  const [referenceImageUri, setReferenceImageUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [unresolvedCategoryLabel, setUnresolvedCategoryLabel] = useState<string | null>(null);
  const [editLoadState, setEditLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    mode.kind === 'edit' ? 'loading' : 'idle',
  );
  const editHydrateKeyRef = useRef<string | null>(null);
  const initialReferenceUriRef = useRef<string | null | undefined>(undefined);

  const bg = isDark ? theme.background : '#faf8ff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.9)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.24)' : 'rgba(194,198,214,0.6)';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const surface = isDark ? '#111827' : '#ffffff';
  const surfaceLow = isDark ? '#1f2937' : '#f2f3ff';

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

  const selectedCategoryLabel = useMemo(() => {
    const hit = categoryOptions.find(c => c.id === selectedCategoryId);
    return hit?.name ?? '';
  }, [categoryOptions, selectedCategoryId]);

  const categoryTriggerLabel = selectedCategoryLabel || unresolvedCategoryLabel;

  useEffect(() => {
    if (mode.kind !== 'edit') {
      editHydrateKeyRef.current = null;
      setEditLoadState('idle');
      return;
    }
    if (!categoriesLoaded) return;
    const key = mode.id;
    if (editHydrateKeyRef.current === key) return;

    let cancelled = false;
    void (async () => {
      setEditLoadState('loading');
      const row = await getWishItemById(key);
      if (cancelled) return;
      if (!row) {
        setEditLoadState('error');
        return;
      }
      const merged = mergeWishCategories(
        customCategories,
        defaultPriorityOverrides,
        defaultNameOverrides,
        hiddenDefaultCategoryIds,
      );
      const cid = row.category_id ?? '';
      const hasCat = merged.some(c => c.id === cid);
      setName(row.name);
      setPrice(String(row.price));
      setSelectedCategoryId(cid);
      setUnresolvedCategoryLabel(!hasCat && row.category_label?.trim() ? row.category_label.trim() : null);
      setDesireLevel(Math.min(5, Math.max(1, Math.round(row.desire_level))));
      setReason(row.reason ?? '');
      setReferenceImageUri(row.reference_image_uri);
      initialReferenceUriRef.current = row.reference_image_uri;
      editHydrateKeyRef.current = key;
      setEditLoadState('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, categoriesLoaded, customCategories, defaultPriorityOverrides, defaultNameOverrides, hiddenDefaultCategoryIds]);

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
        if (alive) {
          setCategoriesLoaded(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

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
      const dupMsg = findDuplicateCategoryName(
        trimmed,
        mergeWishCategories(
          customCategories,
          defaultPriorityOverrides,
          defaultNameOverrides,
          hiddenDefaultCategoryIds,
        ),
      );
      if (dupMsg) {
        setCategorySaveError(dupMsg);
        return;
      }
      const nextCat: WishCategoryDef = {
        id: createCustomCategoryId(),
        name: trimmed,
        priority,
      };
      const next = [...customCategories, nextCat];
      try {
        await saveCustomWishCategories(next);
        setCustomCategories(next);
        setSelectedCategoryId(nextCat.id);
        setCategoryMenuOpen(false);
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
      const dupMsg = findDuplicateCategoryName(
        trimmed,
        mergeWishCategories(
          customCategories,
          defaultPriorityOverrides,
          defaultNameOverrides,
          hiddenDefaultCategoryIds,
        ),
        editingCategoryId,
      );
      if (dupMsg) {
        setCategorySaveError(dupMsg);
        return;
      }
      const base = DEFAULT_WISH_CATEGORIES.find(d => d.id === editingCategoryId);
      if (!base) {
        setCategorySaveError('无法保存');
        return;
      }
      const nextNames = { ...defaultNameOverrides };
      if (trimmed === base.name) {
        delete nextNames[editingCategoryId];
      } else {
        nextNames[editingCategoryId] = trimmed;
      }
      const nextPriorities = { ...defaultPriorityOverrides };
      if (priority === base.priority) {
        delete nextPriorities[editingCategoryId];
      } else {
        nextPriorities[editingCategoryId] = priority;
      }
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
    const dupMsg = findDuplicateCategoryName(
      trimmed,
      mergeWishCategories(
        customCategories,
        defaultPriorityOverrides,
        defaultNameOverrides,
        hiddenDefaultCategoryIds,
      ),
      editingCategoryId,
    );
    if (dupMsg) {
      setCategorySaveError(dupMsg);
      return;
    }
    const next = customCategories.map(c =>
      c.id === editingCategoryId ? { ...c, name: trimmed, priority } : c,
    );
    try {
      await saveCustomWishCategories(next);
      setCustomCategories(next);
      setCategoryMenuOpen(false);
      closeCategoryModal();
    } catch {
      setCategorySaveError('保存失败，请稍后重试');
    }
  }, [
    categoryModalMode,
    closeCategoryModal,
    customCategories,
    defaultPriorityOverrides,
    defaultNameOverrides,
    hiddenDefaultCategoryIds,
    editingCategoryId,
    newCategoryName,
    newCategoryPriority,
  ]);

  const editingIsBuiltin =
    categoryModalMode === 'edit' && editingCategoryId
      ? isBuiltinWishCategoryId(editingCategoryId)
      : false;

  const deleteEditingCategory = useCallback(async () => {
    if (!editingCategoryId) return;

    const merged = mergeWishCategories(
      customCategories,
      defaultPriorityOverrides,
      defaultNameOverrides,
      hiddenDefaultCategoryIds,
    );
    if (merged.length <= 1) {
      Alert.alert('无法删除', '至少需要保留 1 个类别。');
      return;
    }

    if (isBuiltinWishCategoryId(editingCategoryId)) {
      const base = DEFAULT_WISH_CATEGORIES.find(d => d.id === editingCategoryId);
      if (!base) return;
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
        if (selectedCategoryId === editingCategoryId) {
          setSelectedCategoryId('');
          setUnresolvedCategoryLabel(null);
        }
        closeCategoryModal();
      } catch {
        Alert.alert('删除失败', '请稍后重试');
      }
      return;
    }

    const next = customCategories.filter(c => c.id !== editingCategoryId);
    try {
      await saveCustomWishCategories(next);
      setCustomCategories(next);
      if (selectedCategoryId === editingCategoryId) {
        setSelectedCategoryId('');
        setUnresolvedCategoryLabel(null);
      }
      closeCategoryModal();
    } catch {
      Alert.alert('删除失败', '请稍后重试');
    }
  }, [
    closeCategoryModal,
    customCategories,
    defaultNameOverrides,
    defaultPriorityOverrides,
    editingCategoryId,
    hiddenDefaultCategoryIds,
    selectedCategoryId,
  ]);

  const pickReferenceImage = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('权限不足', '需要相册权限才能选择参考图');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.88,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setReferenceImageUri(result.assets[0].uri);
    }
  }, []);

  const handleSaveWish = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('提示', '请输入好物名称');
      return;
    }
    const p = price.trim();
    if (!p) {
      Alert.alert('提示', '请输入预估价格');
      return;
    }
    const priceNum = Number.parseFloat(p);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      Alert.alert('提示', '请输入有效的预估价格');
      return;
    }
    if (mode.kind === 'edit' && editLoadState !== 'ready') {
      return;
    }
    setSaving(true);
    try {
      if (mode.kind === 'create') {
        const newId = await createWishItem({
          name: trimmedName,
          price: priceNum,
          category_id: selectedCategoryId || null,
          category_label: selectedCategoryLabel || null,
          desire_level: desireLevel,
          reason: reason.trim() || null,
          reference_image_uri: referenceImageUri,
        });
        void tryPersistWishItemAiComment(newId, {
          name: trimmedName,
          price: priceNum,
          categoryLabel: selectedCategoryLabel?.trim() || null,
          desire_level: desireLevel,
          reason: reason.trim() || null,
        });
      } else {
        const labelOut = (selectedCategoryLabel || unresolvedCategoryLabel || '').trim() || null;
        const refChanged = referenceImageUri !== initialReferenceUriRef.current;
        await updateWishItem(mode.id, {
          name: trimmedName,
          price: priceNum,
          category_id: selectedCategoryId || null,
          category_label: labelOut,
          desire_level: desireLevel,
          reason: reason.trim() || null,
          ...(refChanged ? { reference_image_uri: referenceImageUri } : {}),
        });
        await clearWishItemAiReview(mode.id);
      }
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '请稍后重试';
      Alert.alert('保存失败', msg);
    } finally {
      setSaving(false);
    }
  }, [
    mode,
    editLoadState,
    name,
    price,
    selectedCategoryId,
    selectedCategoryLabel,
    unresolvedCategoryLabel,
    desireLevel,
    reason,
    referenceImageUri,
    router,
  ]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['left', 'right', 'top']}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 10) + 4,
            backgroundColor: isDark ? 'rgba(17,24,39,0.82)' : 'rgba(255,255,255,0.82)',
            borderBottomColor: outlineVariant,
          },
        ]}>
        <Pressable style={styles.headerBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={22} color={primary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: primary }]}>
          {mode.kind === 'create' ? '添加新好物' : '编辑好物'}
        </Text>
        <Pressable
          style={styles.headerSaveBtn}
          disabled={saving || (mode.kind === 'edit' && editLoadState !== 'ready')}
          onPress={() => void handleSaveWish()}>
          {saving ? (
            <ActivityIndicator size="small" color={primary} />
          ) : (
            <Text style={[styles.headerSaveText, { color: primary }]}>保存</Text>
          )}
        </Pressable>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) + 28 }]}>
        {mode.kind === 'edit' && editLoadState === 'loading' ? (
          <View style={styles.editStateWrap}>
            <ActivityIndicator size="large" color={primary} />
            <Text style={[styles.editStateHint, { color: outline }]}>加载心愿条目…</Text>
          </View>
        ) : null}
        {mode.kind === 'edit' && editLoadState === 'error' ? (
          <View style={styles.editStateWrap}>
            <MaterialIcons name="error-outline" size={48} color={outline} />
            <Text style={[styles.editStateTitle, { color: text }]}>未找到该条目</Text>
            <Text style={[styles.editStateHint, { color: outline }]}>可能已被删除，请返回清单。</Text>
            <Pressable
              onPress={() => router.back()}
              style={[styles.editBackBtn, { borderColor: outlineVariant, backgroundColor: surface }]}>
              <Text style={[styles.editBackBtnText, { color: primary }]}>返回</Text>
            </Pressable>
          </View>
        ) : null}
        {mode.kind === 'create' || editLoadState === 'ready' ? (
          <>
        <View style={styles.section}>
          <View style={[styles.nameUnderlineWrap, { borderBottomColor: outlineVariant }]}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="输入好物名称..."
              placeholderTextColor={outline}
              {...(Platform.OS === 'android'
                ? { textAlignVertical: 'center' as const, includeFontPadding: false }
                : {})}
              style={[styles.nameInput, { color: text }]}
            />
          </View>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: surfaceLow }]}>
          <View style={[styles.leftAccent, { backgroundColor: primary }]} />
          <Text style={[styles.kicker, { color: outline }]}>FINANCIAL ALLOCATION</Text>
          <Text style={[styles.sectionTitle, { color: text }]}>预估开销与分类</Text>

          <View style={styles.rowGrid}>
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: outline }]}>预估价格</Text>
              <View style={[styles.underlineWrap, { borderBottomColor: outlineVariant }]}>
                <Text style={[styles.currency, { color: text }]}>¥</Text>
                <TextInput
                  value={price}
                  onChangeText={v => setPrice(v.replace(/[^\d.]/g, ''))}
                  placeholder="0.00"
                  placeholderTextColor={outline}
                  keyboardType="default"
                  autoCorrect={false}
                  style={[styles.priceInput, { color: text }]}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: outline }]}>所属类别</Text>
              <Text style={[styles.categorySortHint, { color: outline }]}>
                列表按优先级从高到低排序；长按标签可编辑或从列表移除。
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: categoryMenuOpen }}
                onPress={() => setCategoryMenuOpen(o => !o)}
                style={({ pressed }) => [
                  styles.underlineWrap,
                  styles.categoryTrigger,
                  {
                    borderBottomColor: outlineVariant,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <Text style={[styles.categoryValue, { color: categoryTriggerLabel ? text : outline }]}>
                  {categoryTriggerLabel || '选择类别...'}
                </Text>
                <MaterialIcons
                  name={categoryMenuOpen ? 'arrow-drop-up' : 'arrow-drop-down'}
                  size={24}
                  color={outline}
                />
              </Pressable>
              {categoryMenuOpen ? (
                <View collapsable={false}>
                  <View style={styles.categoryWrap}>
                    {(categoriesLoaded
                      ? categoryOptions
                      : mergeWishCategories([], {}, {}, hiddenDefaultCategoryIds)
                    ).map(item => {
                      const active = item.id === selectedCategoryId;
                      return (
                        <Pressable
                          key={item.id}
                          accessibilityHint="长按可编辑或移除类别"
                          delayLongPress={420}
                          onPress={() => {
                            setSelectedCategoryId(item.id);
                            setUnresolvedCategoryLabel(null);
                            setCategoryMenuOpen(false);
                          }}
                          onLongPress={() => openEditCategoryModal(item)}
                          style={[
                            styles.categoryPill,
                            {
                              backgroundColor: active ? `${primary}1A` : surface,
                              borderColor: active ? `${primary}44` : outlineVariant,
                            },
                          ]}>
                          <Text style={[styles.categoryPillText, { color: active ? primary : outline }]}>
                            {item.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Pressable
                    onPress={openAddCategoryModal}
                    style={({ pressed }) => [
                      styles.addCategoryBtn,
                      {
                        borderColor: outlineVariant,
                        backgroundColor: pressed ? `${primary}0D` : 'transparent',
                      },
                    ]}>
                    <MaterialIcons name="add-circle-outline" size={20} color={primary} />
                    <Text style={[styles.addCategoryBtnText, { color: primary }]}>添加自定义类别</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={[styles.sectionCard, { backgroundColor: surface }]}>
          <Text style={[styles.kicker, { color: outline }]}>INTENT METRIC</Text>
          <Text style={[styles.sectionTitle, { color: text }]}>欲望等级</Text>
          <View style={styles.starRow}>
            <Text style={[styles.edgeText, { color: outline }]}>理智购买</Text>
            <View style={styles.starsWrap}>
              {[1, 2, 3, 4, 5].map(level => {
                const active = level <= desireLevel;
                return (
                  <Pressable key={level} onPress={() => setDesireLevel(level)} style={styles.starBtn}>
                    <MaterialIcons name="star" size={30} color={active ? primary : '#c2c6d6'} />
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.edgeText, { color: text }]}>心之所向</Text>
          </View>
        </View>

        <View style={[styles.reasonWrap, { borderLeftColor: outlineVariant }]}>
          <Text style={[styles.kicker, { color: outline }]}>RATIONALE</Text>
          <Text style={[styles.sectionTitle, { color: text }]}>心动理由</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            placeholder="记录此刻的心动理由或必要性分析..."
            placeholderTextColor={outline}
            style={[
              styles.reasonInput,
              {
                backgroundColor: surface,
                borderColor: outlineVariant,
                color: text,
              },
            ]}
          />
        </View>

        <View style={styles.uploadSection}>
          <Text style={[styles.fieldLabel, { color: outline }]}>参考图</Text>
          {referenceImageUri ? (
            <View
              style={[
                styles.uploadCardFilled,
                { backgroundColor: surface, borderColor: outlineVariant },
              ]}>
              <Pressable
                accessibilityRole="imagebutton"
                accessibilityLabel="点击更换参考图"
                onPress={pickReferenceImage}
                style={styles.uploadPreviewPress}>
                <Image
                  source={{ uri: referenceImageUri }}
                  style={styles.uploadPreviewImage}
                  contentFit="cover"
                  transition={200}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="移除参考图"
                onPress={() => setReferenceImageUri(null)}
                style={[styles.uploadRemoveBtn, { backgroundColor: 'rgba(15,23,42,0.55)' }]}>
                <MaterialIcons name="close" size={20} color="#fff" />
              </Pressable>
              <Text style={[styles.uploadReplaceHint, { color: outline }]}>点击图像可更换</Text>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="上传参考图"
              onPress={pickReferenceImage}
              style={[
                styles.uploadCard,
                { backgroundColor: surfaceLow, borderColor: outlineVariant },
              ]}>
              <View style={[styles.uploadIconWrap, { backgroundColor: isDark ? '#374151' : '#eaedff' }]}>
                <MaterialIcons name="add-photo-alternate" size={22} color={outline} />
              </View>
              <Text style={[styles.uploadText, { color: outline }]}>上传参考图</Text>
              <Text style={[styles.uploadSub, { color: outline }]}>支持相册，建议比例 4:3</Text>
            </Pressable>
          )}
        </View>
          </>
        ) : null}
      </ScrollView>

      <Modal
        visible={categoryModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeCategoryModal}>
        <View style={styles.modalBackdrop}>
          <Pressable
            accessibilityRole="button"
            style={StyleSheet.absoluteFillObject}
            onPress={closeCategoryModal}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalKb}
            pointerEvents="box-none">
            <View style={[styles.modalCard, { backgroundColor: surface }]}>
              <Text style={[styles.modalTitle, { color: text }]}>
                {categoryModalMode === 'create'
                  ? '自定义类别'
                  : editingIsBuiltin
                    ? '编辑内置类别'
                    : '编辑类别'}
              </Text>
              <Text style={[styles.modalHint, { color: outline }]}>
                {categoryModalMode === 'create'
                  ? '数值越大在列表中越靠前。'
                  : '可修改名称与优先级；可从列表中移除（至少保留 1 个）。数值越大越靠前。'}
              </Text>
              <Text style={[styles.modalFieldLabel, { color: outline }]}>类别名称</Text>
              <TextInput
                value={newCategoryName}
                onChangeText={t => {
                  setNewCategoryName(t);
                  setCategorySaveError(null);
                }}
                placeholder="例如：摄影器材"
                placeholderTextColor={outline}
                style={[styles.modalInput, { color: text, borderColor: outlineVariant }]}
              />
              <Text style={[styles.modalFieldLabel, { color: outline }]}>优先级（0–9999）</Text>
              <TextInput
                value={newCategoryPriority}
                onChangeText={v => {
                  setNewCategoryPriority(v.replace(/\D/g, '').slice(0, 4));
                  setCategorySaveError(null);
                }}
                placeholder="50"
                placeholderTextColor={outline}
                keyboardType="number-pad"
                style={[styles.modalInput, { color: text, borderColor: outlineVariant }]}
              />
              {categorySaveError ? (
                <Text style={styles.modalError}>{categorySaveError}</Text>
              ) : null}
              <View style={styles.modalActions}>
                <Pressable
                  onPress={closeCategoryModal}
                  style={[styles.modalSecondaryBtn, { borderColor: outlineVariant }]}>
                  <Text style={[styles.modalSecondaryText, { color: outline }]}>取消</Text>
                </Pressable>
                <Pressable
                  onPress={() => void commitCategoryModal()}
                  style={[styles.modalPrimaryBtn, { backgroundColor: primary }]}>
                  <Text style={styles.modalPrimaryText}>
                    {categoryModalMode === 'create' ? '保存' : '保存修改'}
                  </Text>
                </Pressable>
              </View>
              {categoryModalMode === 'edit' && editingCategoryId ? (
                <Pressable
                  onPress={() => {
                    if (!editingCategoryId) return;
                    const merged = mergeWishCategories(
                      customCategories,
                      defaultPriorityOverrides,
                      defaultNameOverrides,
                      hiddenDefaultCategoryIds,
                    );
                    if (merged.length <= 1) {
                      Alert.alert('无法删除', '至少需要保留 1 个类别。');
                      return;
                    }
                    const label = newCategoryName.trim() || '该类别';
                    Alert.alert(
                      editingIsBuiltin ? '移除类别' : '删除类别',
                      editingIsBuiltin
                        ? `确定从列表中移除「${label}」吗？已选该类别的心愿仍可保存，建议在保存前重新选择类别。`
                        : `确定删除「${label}」吗？使用该类别的心愿仍可保存，建议在保存前重新选择类别。`,
                      [
                        { text: '取消', style: 'cancel' },
                        {
                          text: editingIsBuiltin ? '移除' : '删除',
                          style: 'destructive',
                          onPress: () => void deleteEditingCategory(),
                        },
                      ],
                    );
                  }}
                  style={styles.modalDeleteBtn}>
                  <Text style={styles.modalDeleteText}>
                    {editingIsBuiltin ? '从列表移除' : '删除类别'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 20,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSaveBtn: {
    minWidth: 56,
    paddingVertical: 8,
    alignItems: 'flex-end',
  },
  headerSaveText: {
    fontSize: 16,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 112,
    gap: 18,
  },
  section: {
    gap: 8,
  },
  underlineWrap: {
    borderBottomWidth: 1,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  /** 大号标题输入避免与 underlineWrap 的垂直居中对齐裁切字形（尤其 Android） */
  nameUnderlineWrap: {
    borderBottomWidth: 1,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: 48,
  },
  nameInput: {
    flex: 1,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.4,
    padding: 0,
    minHeight: Platform.OS === 'android' ? 46 : 40,
    lineHeight: Platform.OS === 'ios' ? 36 : undefined,
  },
  sectionCard: {
    borderRadius: 16,
    padding: 20,
    gap: 10,
    overflow: 'hidden',
  },
  leftAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  rowGrid: {
    gap: 16,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  categorySortHint: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 15,
    marginTop: -2,
    marginBottom: 2,
  },
  currency: {
    fontSize: 20,
    fontWeight: '700',
  },
  priceInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    padding: 0,
  },
  categoryValue: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  categoryTrigger: {
    minHeight: 44,
    justifyContent: 'center',
  },
  categoryWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  categoryPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  addCategoryBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  addCategoryBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  modalKb: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  modalCard: {
    borderRadius: 16,
    padding: 20,
    gap: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  modalHint: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  modalFieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 4,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 16,
    fontWeight: '600',
  },
  modalError: {
    fontSize: 13,
    fontWeight: '600',
    color: '#dc2626',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  modalSecondaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  modalSecondaryText: {
    fontSize: 16,
    fontWeight: '700',
  },
  modalPrimaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
  },
  modalPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  modalDeleteBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  modalDeleteText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#dc2626',
  },
  starRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
  },
  edgeText: {
    fontSize: 13,
    fontWeight: '500',
  },
  starsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  starBtn: {
    padding: 2,
  },
  reasonWrap: {
    borderLeftWidth: 1,
    paddingLeft: 16,
    gap: 8,
  },
  reasonInput: {
    minHeight: 112,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
  },
  uploadSection: {
    gap: 8,
  },
  uploadCard: {
    minHeight: 180,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  uploadSub: {
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.85,
  },
  uploadCardFilled: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  uploadPreviewPress: {
    width: '100%',
  },
  uploadPreviewImage: {
    width: '100%',
    height: 200,
    backgroundColor: 'rgba(148,163,184,0.12)',
  },
  uploadRemoveBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadReplaceHint: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  uploadIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadText: {
    fontSize: 15,
    fontWeight: '700',
  },
  editStateWrap: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  editStateTitle: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  editStateHint: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
  },
  editBackBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  editBackBtnText: {
    fontSize: 16,
    fontWeight: '800',
  },
});
