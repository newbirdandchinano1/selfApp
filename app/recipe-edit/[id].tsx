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
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import {
  createRecipe,
  getRecipe,
  getRecipeCategory,
  RECIPE_NOTES_MAX,
  RECIPE_TITLE_MAX,
  updateRecipe,
  type RecipeIngredient,
} from '@/lib/recipes';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
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
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const bg = isDark ? theme.background : '#faf8ff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.9)' : '#424754';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const borderSoft = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.35)';
  const inputBg = isDark ? 'rgba(15,23,42,0.5)' : '#ffffff';
  const headerBg = isDark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.96)';
  const accent = isDark ? '#fb923c' : '#ea580c';
  const accentSoft = isDark ? 'rgba(251,146,60,0.18)' : 'rgba(234,88,12,0.1)';
  const cardBg = isDark ? '#1e293b' : '#ffffff';

  const [categoryName, setCategoryName] = useState('');
  const [title, setTitle] = useState('');
  const [ingredientRows, setIngredientRows] = useState<RecipeIngredient[]>([{ name: '', amount: '' }]);
  const [stepLines, setStepLines] = useState<string[]>(['']);
  const [notes, setNotes] = useState('');
  const [finishedImageUri, setFinishedImageUri] = useState<string | null>(null);
  const [initialImageUri, setInitialImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (isNew) {
      if (!categoryId) return;
      setLoading(true);
      try {
        const cat = await getRecipeCategory(categoryId);
        setCategoryName(cat?.name ?? '');
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!id) return;
    setLoading(true);
    try {
      const row = await getRecipe(id);
      if (!row) {
        Alert.alert('未找到', '该菜谱可能已删除', [{ text: '确定', onPress: () => router.back() }]);
        return;
      }
      const cat = await getRecipeCategory(row.category_id);
      setCategoryName(cat?.name ?? '');
      setTitle(row.title);
      setIngredientRows(
        ensureMinIngredientRows(row.ingredients.length > 0 ? row.ingredients : [{ name: '', amount: '' }]),
      );
      setStepLines(ensureMinLines(row.steps.length > 0 ? row.steps : linesFromLegacyText('')));
      setNotes(row.notes ?? '');
      const img = row.finished_image_uri ?? null;
      setFinishedImageUri(img);
      setInitialImageUri(img);
    } catch {
      Alert.alert('加载失败', '请返回重试', [{ text: '确定', onPress: () => router.back() }]);
    } finally {
      setLoading(false);
    }
  }, [categoryId, id, isNew, router]);

  const { refreshControl } = usePullToRefresh(reload);

  useEffect(() => {
    if (isNew) {
      if (!categoryId) {
        Alert.alert('请先选择分类', '请从「我的菜谱」某个分类下新建菜谱', [
          { text: '确定', onPress: () => router.back() },
        ]);
        setLoading(false);
        return;
      }
      void reload();
      return;
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
      aspect: [4, 3],
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
    setSaving(true);
    try {
      if (isNew) {
        if (!categoryId) {
          Alert.alert('无法保存', '缺少分类');
          return;
        }
        await createRecipe({
          category_id: categoryId,
          title,
          ingredients,
          steps,
          notes: notes.trim() || undefined,
          finished_image_uri: finishedImageUri,
        });
      } else {
        const patch: Parameters<typeof updateRecipe>[1] = {
          title,
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
    categoryId,
    finishedImageUri,
    id,
    initialImageUri,
    ingredientRows,
    isNew,
    notes,
    router,
    stepLines,
    title,
  ]);

  if (!id) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 15, fontWeight: '600' }}>缺少菜谱 ID</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View
        style={[
          styles.topBarWrap,
          {
            paddingTop: insets.top,
            backgroundColor: headerBg,
            borderBottomColor: borderSoft,
          },
        ]}
      >
        <View style={styles.topBar}>
          <Pressable
            style={({ pressed }) => [
              styles.headerIconBtn,
              { backgroundColor: isDark ? 'rgba(30,41,59,0.6)' : '#fff', opacity: pressed || saving ? 0.7 : 1 },
            ]}
            onPress={() => router.back()}
            disabled={saving}
          >
            <MaterialIcons name="arrow-back-ios-new" size={18} color={primary} />
          </Pressable>
          <Text style={[styles.topBarTitle, { color: text }]}>{isNew ? '新建菜谱' : '编辑菜谱'}</Text>
          <Pressable
            style={({ pressed }) => [
              styles.saveBtnPill,
              { backgroundColor: primary, opacity: pressed || saving || loading ? 0.65 : 1 },
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

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={primary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flexOne}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 56}
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
            {categoryName ? (
              <View style={[styles.categoryBadge, { borderColor: borderSoft, backgroundColor: accentSoft }]}>
                <MaterialIcons name="folder" size={16} color={accent} />
                <Text style={[styles.categoryBadgeText, { color: accent }]}>{categoryName}</Text>
              </View>
            ) : null}

            <View style={[styles.formSection, { backgroundColor: cardBg, borderColor: borderSoft }]}>
            <Text style={[styles.sectionLabel, { color: text }]}>成品图</Text>
            {finishedImageUri ? (
              <View style={styles.imageBlock}>
                <Image source={{ uri: finishedImageUri }} style={styles.previewImage} contentFit="cover" />
                <View style={styles.imageActions}>
                  <Pressable
                    onPress={() => void pickFinishedImage()}
                    style={({ pressed }) => [styles.imageActionBtn, { opacity: pressed ? 0.85 : 1 }]}
                  >
                    <MaterialIcons name="photo-library" size={20} color={primary} />
                    <Text style={{ color: primary, fontWeight: '700', fontSize: 13 }}>更换</Text>
                  </Pressable>
                  <Pressable
                    onPress={clearFinishedImage}
                    style={({ pressed }) => [styles.imageActionBtn, { opacity: pressed ? 0.85 : 1 }]}
                  >
                    <MaterialIcons name="delete-outline" size={20} color={isDark ? '#f87171' : '#b91c1c'} />
                    <Text style={{ color: isDark ? '#f87171' : '#b91c1c', fontWeight: '700', fontSize: 13 }}>
                      移除
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                onPress={() => void pickFinishedImage()}
                style={({ pressed }) => [
                  styles.uploadPlaceholder,
                  { borderColor: borderSoft, opacity: pressed ? 0.88 : 1 },
                ]}
              >
                <MaterialIcons name="add-a-photo" size={32} color={primary} />
                <Text style={{ color: outline, fontSize: 13, marginTop: 6 }}>从相册上传成品图</Text>
              </Pressable>
            )}
            </View>

            <View style={[styles.formSection, { backgroundColor: cardBg, borderColor: borderSoft }]}>
            <Text style={[styles.sectionLabel, { color: text }]}>基本信息</Text>
            <Text style={[styles.label, { color: outline }]}>菜名</Text>
            <TextInput
              value={title}
              onChangeText={x => setTitle(x.length > RECIPE_TITLE_MAX ? x.slice(0, RECIPE_TITLE_MAX) : x)}
              placeholder="例如：番茄炒蛋"
              placeholderTextColor={outline}
              style={[styles.inputSingle, { color: text, borderColor: borderSoft, backgroundColor: inputBg }]}
            />
            </View>

            <View style={[styles.formSection, { backgroundColor: cardBg, borderColor: borderSoft }]}>
              <IngredientInputs
                rows={ingredientRows}
                onChange={setIngredientRows}
                textColor={text}
                outlineColor={outline}
                borderColor={borderSoft}
                inputBg={inputBg}
                primary={primary}
              />
            </View>

            <View style={[styles.formSection, { backgroundColor: cardBg, borderColor: borderSoft }]}>
              <DynamicLineInputs
                label="步骤"
                hint="每行一步，支持随时增删"
                lines={stepLines}
                onChange={setStepLines}
                placeholder="描述本步操作"
                textColor={text}
                outlineColor={outline}
                borderColor={borderSoft}
                inputBg={inputBg}
                primary={primary}
                stepPrefix={i => `${i + 1}.`}
              />
            </View>

            <View style={[styles.formSection, { backgroundColor: cardBg, borderColor: borderSoft }]}>
            <Text style={[styles.sectionLabel, { color: text }]}>备注</Text>
            <Text style={[styles.label, { color: outline }]}>可选，最多 {RECIPE_NOTES_MAX} 字</Text>
            <TextInput
              value={notes}
              onChangeText={x => setNotes(x.length > RECIPE_NOTES_MAX ? x.slice(0, RECIPE_NOTES_MAX) : x)}
              placeholder="火候、替换食材、个人口味等"
              placeholderTextColor={outline}
              multiline
              textAlignVertical="top"
              style={[styles.inputMulti, { color: text, borderColor: borderSoft, backgroundColor: inputBg }]}
            />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flexOne: { flex: 1 },
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
  topBarTitle: { flex: 1, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  saveBtnPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    minWidth: 64,
    alignItems: 'center',
  },
  saveBtnPillText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  formSection: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    gap: 8,
  },
  sectionLabel: { fontSize: 16, fontWeight: '900', marginBottom: 4 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollInner: { paddingHorizontal: 18, paddingTop: 16 },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 4,
  },
  categoryBadgeText: { fontSize: 14, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  inputSingle: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },
  inputMulti: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    minHeight: 88,
    lineHeight: 22,
  },
  uploadPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  imageBlock: { gap: 10 },
  previewImage: { width: '100%', height: 200, borderRadius: 12 },
  imageActions: { flexDirection: 'row', gap: 16 },
  imageActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
