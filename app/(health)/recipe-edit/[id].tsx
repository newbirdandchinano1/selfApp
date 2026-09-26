import { CrudEditScreen } from '@/components/crud';
import {
  DynamicLineInputs,
  ensureMinLines,
  linesFromLegacyText,
  trimRecipeLines,
} from '@/components/recipe/dynamic-line-inputs';
import {
  ensureMinIngredientRows,
  IngredientInputs,
  trimIngredientRows,
} from '@/components/recipe/ingredient-inputs';
import { RecipeMotionPressable } from '@/components/recipe/recipe-motion-pressable';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import {
  createRecipe,
  getRecipe,
  listRecipeCategories,
  RECIPE_NOTES_MAX,
  RECIPE_TITLE_MAX,
  updateRecipe,
  type RecipeCategory,
  type RecipeIngredient,
} from '@/lib/recipes';
import { getRecipePalette } from '@/lib/recipe-theme';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function normalizeId(raw: string | string[] | undefined): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw[0]) return raw[0];
  return '';
}

export default function RecipeEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id: idParam, categoryId: categoryIdParam } = useLocalSearchParams<{
    id: string;
    categoryId?: string;
  }>();
  const id = normalizeId(idParam);
  const categoryId = normalizeId(categoryIdParam);
  const isNew = id === 'new';

  const colorScheme = useColorScheme();
  const p = getRecipePalette(colorScheme);

  const [categories, setCategories] = useState<RecipeCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [ingredientRows, setIngredientRows] = useState<RecipeIngredient[]>([
    { name: '', amount: '', remark: '' },
  ]);
  const [stepLines, setStepLines] = useState<string[]>(['']);
  const [notes, setNotes] = useState('');
  const [finishedImageUri, setFinishedImageUri] = useState<string | null>(null);
  const [initialImageUri, setInitialImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCategoryName = useMemo(() => {
    if (!selectedCategoryId) return '';
    return categories.find(c => c.id === selectedCategoryId)?.name ?? '';
  }, [categories, selectedCategoryId]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cats = await listRecipeCategories();
      setCategories(cats);

      if (isNew) {
        if (categoryId) {
          setSelectedCategoryId(categoryId);
        } else if (cats.length > 0) {
          setSelectedCategoryId(cats[0].id);
        } else {
          setSelectedCategoryId('');
        }
        return;
      }

      if (!id) return;
      const row = await getRecipe(id);
      if (!row) {
        setError('该菜谱可能已删除');
        return;
      }
      setSelectedCategoryId(row.category_id);
      setTitle(row.title);
      setIngredientRows(
        ensureMinIngredientRows(
          row.ingredients.length > 0 ? row.ingredients : [{ name: '', amount: '', remark: '' }],
        ),
      );
      setStepLines(ensureMinLines(row.steps.length > 0 ? row.steps : linesFromLegacyText('')));
      setNotes(row.notes ?? '');
      const img = row.finished_image_uri ?? null;
      setFinishedImageUri(img);
      setInitialImageUri(img);
    } catch {
      setError('加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [categoryId, id, isNew]);

  const { refreshControl } = usePullToRefresh(reload);

  useEffect(() => {
    if (isNew && !categoryId) {
      void (async () => {
        setLoading(true);
        try {
          const cats = await listRecipeCategories();
          if (cats.length === 0) {
            Alert.alert('请先创建分类', '请先在「我的菜谱」中创建分类，再添加菜谱', [
              { text: '确定', onPress: () => router.back() },
            ]);
          }
        } finally {
          setLoading(false);
        }
      })();
    }
    if (!id) {
      setLoading(false);
      return;
    }
    void reload();
  }, [categoryId, id, isNew, reload, router]);

  const pickFinishedImage = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('权限不足', '需要相册权限才能上传成品图');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.88,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setFinishedImageUri(result.assets[0].uri);
    }
  }, []);

  const clearFinishedImage = useCallback(() => {
    setFinishedImageUri(null);
  }, []);

  const onSave = useCallback(async () => {
    const t = title.trim();
    const ingredients = trimIngredientRows(ingredientRows);
    const steps = trimRecipeLines(stepLines);
    if (!t && ingredients.length === 0 && steps.length === 0) {
      Alert.alert('无法保存', '请至少填写菜名、食材或步骤之一');
      return;
    }
    const imageChanged = finishedImageUri !== initialImageUri;
    if (!selectedCategoryId) {
      Alert.alert('无法保存', '请选择菜谱分类');
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        await createRecipe({
          category_id: selectedCategoryId,
          title,
          ingredients,
          steps,
          notes: notes.trim() || undefined,
          finished_image_uri: finishedImageUri,
        });
      } else {
        const patch: Parameters<typeof updateRecipe>[1] = {
          title,
          category_id: selectedCategoryId,
          ingredients,
          steps,
          notes: notes.trim() || null,
        };
        if (imageChanged) {
          patch.finished_image_uri = finishedImageUri;
        }
        const ok = await updateRecipe(id, patch);
        if (!ok) {
          Alert.alert('保存失败', '该菜谱可能已删除');
          setSaving(false);
          return;
        }
      }
      router.back();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [
    finishedImageUri,
    id,
    initialImageUri,
    ingredientRows,
    isNew,
    notes,
    router,
    selectedCategoryId,
    stepLines,
    title,
  ]);

  const recipeHeader = (
    <View
      style={[
        styles.topBarWrap,
        {
          paddingTop: insets.top,
          backgroundColor: p.header,
          borderBottomColor: p.border,
        },
      ]}
    >
      <View style={styles.topBar}>
        <Pressable
          style={({ pressed }) => [
            styles.headerIconBtn,
            {
              backgroundColor: p.card,
              borderColor: p.border,
              opacity: pressed || saving ? 0.7 : 1,
            },
          ]}
          onPress={() => router.back()}
          disabled={saving}
        >
          <MaterialIcons name="arrow-back-ios-new" size={18} color={p.primary} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.topBarTitle, { color: p.text }]}>
            {isNew ? '写进菜谱本' : '改一改'}
          </Text>
          <Text style={[styles.topBarSub, { color: p.textSecondary }]}>
            {isNew ? '成品图越清楚越好吃' : '保存后立刻更新'}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.saveBtnPill,
            { backgroundColor: p.primary, opacity: pressed || saving || loading ? 0.65 : 1 },
          ]}
          onPress={() => void onSave()}
          disabled={saving || loading}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.saveBtnPillText}>保存</Text>
          )}
        </Pressable>
      </View>
    </View>
  );

  if (!id) {
    return (
      <CrudEditScreen
        header={recipeHeader}
        missing
        missingMessage="缺少菜谱 ID"
        style={{ backgroundColor: p.bg }}
      />
    );
  }

  return (
    <>
      <CrudEditScreen
        header={recipeHeader}
        loading={loading}
        loadingHint="加载菜谱…"
        error={error}
        onRetryError={() => void reload()}
        style={{ backgroundColor: p.bg }}
      >
        <ScrollView
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.scrollInner,
            { paddingBottom: Math.max(insets.bottom, 20) + 24 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <RecipeMotionPressable
            enterDelay={40}
            onPress={() => void pickFinishedImage()}
            style={[styles.heroCard, { backgroundColor: p.card, borderColor: p.border }]}
          >
            {finishedImageUri ? (
              <>
                <Image source={{ uri: finishedImageUri }} style={styles.previewImage} contentFit="cover" />
                <View style={styles.heroOverlay}>
                  <View style={[styles.heroChip, { backgroundColor: 'rgba(28,20,16,0.55)' }]}>
                    <MaterialIcons name="photo-camera" size={16} color="#fff" />
                    <Text style={styles.heroChipText}>点按更换</Text>
                  </View>
                </View>
              </>
            ) : (
              <View style={[styles.uploadPlaceholder, { backgroundColor: p.placeholderBg }]}>
                <View style={[styles.uploadIconRing, { backgroundColor: p.accentSoft }]}>
                  <MaterialIcons name="add-a-photo" size={28} color={p.accent} />
                </View>
                <Text style={[styles.uploadTitle, { color: p.text }]}>上传成品图</Text>
                <Text style={[styles.uploadHint, { color: p.outlineMuted }]}>正方形裁切 · 列表里更好看</Text>
              </View>
            )}
          </RecipeMotionPressable>

          {finishedImageUri ? (
            <Pressable onPress={clearFinishedImage} style={styles.removeImageRow}>
              <MaterialIcons name="delete-outline" size={18} color={p.danger} />
              <Text style={{ color: p.danger, fontWeight: '700', fontSize: 13 }}>移除成品图</Text>
            </Pressable>
          ) : null}

          <View style={[styles.formSection, { backgroundColor: p.card, borderColor: p.border }]}>
            <Text style={[styles.sectionLabel, { color: p.text }]}>基本信息</Text>
            <Text style={[styles.label, { color: p.outline }]}>分类</Text>
            <Pressable
              onPress={() => {
                if (categories.length === 0) {
                  Alert.alert('暂无分类', '请先在「我的菜谱」中创建分类');
                  return;
                }
                setCategoryModalVisible(true);
              }}
              disabled={saving || categories.length === 0}
              style={({ pressed }) => [
                styles.categoryPicker,
                {
                  borderColor: p.border,
                  backgroundColor: p.inputBg,
                  opacity: pressed || saving || categories.length === 0 ? 0.75 : 1,
                },
              ]}
            >
              <View style={styles.categoryPickerLeft}>
                <MaterialIcons name="auto-stories" size={18} color={p.accent} />
                <Text
                  style={[
                    styles.categoryPickerText,
                    { color: selectedCategoryName ? p.text : p.outlineMuted },
                  ]}
                >
                  {selectedCategoryName || '请选择分类'}
                </Text>
              </View>
              <MaterialIcons name="expand-more" size={22} color={p.outline} />
            </Pressable>
            <Text style={[styles.label, { color: p.outline, marginTop: 4 }]}>菜名</Text>
            <TextInput
              value={title}
              onChangeText={x => setTitle(x.length > RECIPE_TITLE_MAX ? x.slice(0, RECIPE_TITLE_MAX) : x)}
              placeholder="例如：番茄炒蛋"
              placeholderTextColor={p.outlineMuted}
              style={[
                styles.inputSingle,
                { color: p.text, borderColor: p.border, backgroundColor: p.inputBg },
              ]}
            />
          </View>

          <View style={[styles.formSection, { backgroundColor: p.card, borderColor: p.border }]}>
            <IngredientInputs
              rows={ingredientRows}
              onChange={setIngredientRows}
              textColor={p.text}
              outlineColor={p.outline}
              borderColor={p.border}
              inputBg={p.inputBg}
              primary={p.primary}
            />
          </View>

          <View style={[styles.formSection, { backgroundColor: p.card, borderColor: p.border }]}>
            <DynamicLineInputs
              label="步骤"
              hint="每行一步，支持随时增删"
              lines={stepLines}
              onChange={setStepLines}
              placeholder="描述本步操作"
              textColor={p.text}
              outlineColor={p.outline}
              borderColor={p.border}
              inputBg={p.inputBg}
              primary={p.primary}
              stepPrefix={i => `${i + 1}.`}
            />
          </View>

          <View style={[styles.formSection, { backgroundColor: p.card, borderColor: p.border }]}>
            <Text style={[styles.sectionLabel, { color: p.text }]}>备注</Text>
            <Text style={[styles.label, { color: p.outline }]}>可选，最多 {RECIPE_NOTES_MAX} 字</Text>
            <TextInput
              value={notes}
              onChangeText={x => setNotes(x.length > RECIPE_NOTES_MAX ? x.slice(0, RECIPE_NOTES_MAX) : x)}
              placeholder="火候、替换食材、个人口味等"
              placeholderTextColor={p.outlineMuted}
              multiline
              textAlignVertical="top"
              style={[
                styles.inputMulti,
                { color: p.text, borderColor: p.border, backgroundColor: p.inputBg },
              ]}
            />
          </View>
        </ScrollView>
      </CrudEditScreen>

      <Modal
        transparent
        visible={categoryModalVisible}
        animationType="fade"
        onRequestClose={() => setCategoryModalVisible(false)}
      >
        <Pressable style={[styles.modalOverlay, { backgroundColor: p.overlay }]} onPress={() => setCategoryModalVisible(false)}>
          <Pressable
            onPress={() => {}}
            style={[styles.modalCard, { backgroundColor: p.card, borderColor: p.border }]}
          >
            <Text style={[styles.modalTitle, { color: p.text }]}>选择菜谱分类</Text>
            <ScrollView
              style={styles.modalList}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {categories.map(cat => (
                <Pressable
                  key={cat.id}
                  onPress={() => {
                    setSelectedCategoryId(cat.id);
                    setCategoryModalVisible(false);
                  }}
                  style={({ pressed }) => [
                    styles.modalItem,
                    { borderBottomColor: p.border },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <View style={styles.modalItemLeft}>
                    <MaterialIcons name="auto-stories" size={18} color={p.accent} />
                    <Text style={[styles.modalItemText, { color: p.text }]}>{cat.name}</Text>
                  </View>
                  {selectedCategoryId === cat.id ? (
                    <MaterialIcons name="check" size={20} color={p.primary} />
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
  topBarTitle: { fontSize: 18, fontWeight: '900' },
  topBarSub: { fontSize: 11, fontWeight: '600' },
  saveBtnPill: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 14,
    minWidth: 64,
    alignItems: 'center',
  },
  saveBtnPillText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  formSection: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    gap: 8,
  },
  sectionLabel: { fontSize: 16, fontWeight: '900', marginBottom: 4 },
  scrollInner: { paddingHorizontal: 16, paddingTop: 14 },
  heroCard: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 8,
  },
  previewImage: { width: '100%', aspectRatio: 1 },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    padding: 12,
  },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  heroChipText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  uploadPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  uploadIconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  uploadTitle: { fontSize: 16, fontWeight: '900' },
  uploadHint: { fontSize: 12, fontWeight: '600' },
  removeImageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
    paddingVertical: 6,
  },
  categoryPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 46,
  },
  categoryPickerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  categoryPickerText: { fontSize: 15, fontWeight: '600', flex: 1 },
  label: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    maxHeight: '70%',
  },
  modalTitle: { fontSize: 17, fontWeight: '900', marginBottom: 12 },
  modalList: { maxHeight: 360 },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  modalItemText: { fontSize: 15, fontWeight: '600', flex: 1 },
  inputSingle: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  inputMulti: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 88,
    lineHeight: 22,
  },
});
