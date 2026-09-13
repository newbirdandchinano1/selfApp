import { MemoFormatToolbar } from '@/components/memo/memo-format-toolbar';
import { MemoRichBodyInput } from '@/components/memo/memo-rich-body-input';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { startMemoAiReviewInBackground } from '@/lib/memo-ai-background';
import {
    applyMemoFormatToModel,
    emptyMemoEditModel,
    memoBodyFromEditModel,
    parseMemoBodyToEditModel,
    updateMemoEditModelPlain,
    type MemoEditModel,
    type MemoFormatAction,
    type TextSelection,
} from '@/lib/memo-format';
import {
    createMemo,
    getMemo,
    listMemoDimensions,
    MEMO_BODY_MAX,
    MEMO_TITLE_MAX,
    updateMemo,
    type MemoDimension,
} from '@/lib/memos';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
    useWindowDimensions,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function normalizeId(raw: string | string[] | undefined): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw[0]) return raw[0];
  return '';
}

function clampPlain(plain: string): string {
  return plain.length > MEMO_BODY_MAX ? plain.slice(0, MEMO_BODY_MAX) : plain;
}

export default function MemoEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { id: idParam, dimensionId: dimensionIdParam } = useLocalSearchParams<{
    id: string;
    dimensionId?: string;
  }>();
  const id = normalizeId(idParam);
  const dimensionId = normalizeId(dimensionIdParam);
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
  const headerBg = isDark ? 'rgba(17,24,39,0.98)' : 'rgba(255,255,255,0.98)';
  const toolbarBg = isDark ? 'rgba(30,41,59,0.45)' : 'rgba(0,88,190,0.04)';

  const bodyMinHeight = useMemo(() => Math.max(360, Math.round(windowHeight * 0.42)), [windowHeight]);

  const [title, setTitle] = useState('');
  const [bodyModel, setBodyModel] = useState<MemoEditModel>(emptyMemoEditModel);
  const [bodySelection, setBodySelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [controlledSelection, setControlledSelection] = useState<TextSelection | undefined>(undefined);
  const [dimensions, setDimensions] = useState<MemoDimension[]>([]);
  const [selectedDimensionId, setSelectedDimensionId] = useState(dimensionId);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedDimensionName = useMemo(() => {
    const hit = dimensions.find(d => d.id === selectedDimensionId);
    return hit?.name.trim() || '';
  }, [dimensions, selectedDimensionId]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const dims = await listMemoDimensions();
      setDimensions(dims);

      if (isNew) {
        const initialId =
          dimensionId && dims.some(d => d.id === dimensionId)
            ? dimensionId
            : dims[0]?.id ?? '';
        setSelectedDimensionId(initialId);
        return;
      }

      if (!id) return;
      const row = await getMemo(id);
      if (!row) {
        Alert.alert('未找到', '该备忘可能已删除', [{ text: '确定', onPress: () => router.back() }]);
        return;
      }
      setTitle(row.title);
      setBodyModel(parseMemoBodyToEditModel(row.body));
      const rowDimId = row.dimension_id?.trim() || '';
      setSelectedDimensionId(
        rowDimId && dims.some(d => d.id === rowDimId) ? rowDimId : dims[0]?.id ?? '',
      );
    } catch {
      Alert.alert('加载失败', '请返回重试', [{ text: '确定', onPress: () => router.back() }]);
    } finally {
      setLoading(false);
    }
  }, [dimensionId, id, isNew, router]);

  const { refreshControl } = usePullToRefresh(reload);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onFormatAction = useCallback(
    (action: MemoFormatAction) => {
      const result = applyMemoFormatToModel(bodyModel, bodySelection, action);
      setBodyModel(result.model);
      setBodySelection(result.selection);
      setControlledSelection(result.selection);
    },
    [bodyModel, bodySelection],
  );

  const onBodyPlainChange = useCallback(
    (plain: string) => {
      setControlledSelection(undefined);
      const nextPlain = clampPlain(plain);
      setBodyModel(prev => updateMemoEditModelPlain(prev, nextPlain));
    },
    [],
  );

  const onSave = useCallback(async () => {
    const t = title.trim();
    const body = memoBodyFromEditModel(bodyModel).trim();
    if (!t && !bodyModel.plain.trim()) {
      Alert.alert('无法保存', '请填写标题或正文');
      return;
    }
    if (!selectedDimensionId) {
      Alert.alert('无法保存', '请先选择备忘分类');
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        const created = await createMemo({ title, body, dimensionId: selectedDimensionId });
        startMemoAiReviewInBackground(created);
      } else {
        const ok = await updateMemo(id, { title, body, dimensionId: selectedDimensionId });
        if (!ok) {
          Alert.alert('保存失败', '该备忘可能已删除');
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
  }, [bodyModel, id, isNew, router, selectedDimensionId, title]);

  if (!id || (!isNew && id === '')) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 15, fontWeight: '600' }}>缺少备忘 ID</Text>
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
          <Pressable style={styles.roundIconBtn} onPress={() => router.back()} disabled={saving}>
            <MaterialIcons name="arrow-back-ios-new" size={20} color={primary} />
          </Pressable>
          <Text style={[styles.topBarTitle, { color: text }]}>{isNew ? '新建备忘' : '编辑备忘'}</Text>
          <Pressable style={styles.saveBtn} onPress={() => void onSave()} disabled={saving || loading}>
            {saving ? (
              <ActivityIndicator size="small" color={primary} />
            ) : (
              <Text style={[styles.saveBtnText, { color: primary }]}>保存</Text>
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
            <Text style={[styles.label, { color: outline }]}>分类</Text>
            <Pressable
              onPress={() => {
                if (dimensions.length === 0) {
                  Alert.alert('暂无分类', '请先在备忘录列表中新建分类（维度），再编辑备忘。');
                  return;
                }
                setCategoryModalVisible(true);
              }}
              disabled={saving || dimensions.length === 0}
              style={({ pressed }) => [
                styles.categoryPicker,
                {
                  borderColor: borderSoft,
                  backgroundColor: inputBg,
                  opacity: pressed || saving || dimensions.length === 0 ? 0.75 : 1,
                },
              ]}
            >
              <View style={styles.categoryPickerLeft}>
                <MaterialIcons name="folder" size={18} color={primary} />
                <Text style={[styles.categoryPickerText, { color: selectedDimensionName ? text : outline }]}>
                  {selectedDimensionName || '请选择分类'}
                </Text>
              </View>
              <MaterialIcons name="expand-more" size={22} color={outline} />
            </Pressable>

            <Text style={[styles.label, { color: outline, marginTop: 18 }]}>
              标题（可选，最多 {MEMO_TITLE_MAX} 字）
            </Text>
            <TextInput
              value={title}
              onChangeText={x => setTitle(x.length > MEMO_TITLE_MAX ? x.slice(0, MEMO_TITLE_MAX) : x)}
              placeholder="例如：买菜清单"
              placeholderTextColor={outline}
              style={[styles.inputTitle, { color: text, borderColor: borderSoft, backgroundColor: inputBg }]}
            />

            <Text style={[styles.label, { color: outline, marginTop: 18 }]}>
              正文（最多 {MEMO_BODY_MAX} 字，所见即所得）
            </Text>
            <MemoFormatToolbar
              onAction={onFormatAction}
              primary={primary}
              borderColor={borderSoft}
              backgroundColor={toolbarBg}
            />
            <Text style={[styles.formatHint, { color: outline }]}>
              选中文字后点工具栏设置格式；编辑时直接看到效果，保存后查看页一致
            </Text>
            <MemoRichBodyInput
              model={bodyModel}
              onChangePlain={onBodyPlainChange}
              onSelectionChange={sel => {
                setBodySelection(sel);
                if (controlledSelection != null) setControlledSelection(undefined);
              }}
              controlledSelection={controlledSelection}
              placeholder="写下详细内容…"
              textColor={text}
              placeholderColor={outline}
              caretColor={primary}
              containerStyle={[
                styles.bodyInputWrap,
                {
                  borderColor: borderSoft,
                  backgroundColor: inputBg,
                  minHeight: bodyMinHeight,
                },
              ]}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <Modal
        transparent
        visible={categoryModalVisible}
        animationType="fade"
        onRequestClose={() => setCategoryModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setCategoryModalVisible(false)}>
          <Pressable
            onPress={() => {}}
            style={[styles.modalCard, { backgroundColor: isDark ? '#111827' : '#ffffff', borderColor: borderSoft }]}
          >
            <Text style={[styles.modalTitle, { color: text }]}>选择备忘分类</Text>
            <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {dimensions.map(dim => (
                <Pressable
                  key={dim.id}
                  onPress={() => {
                    setSelectedDimensionId(dim.id);
                    setCategoryModalVisible(false);
                  }}
                  style={({ pressed }) => [
                    styles.modalItem,
                    { borderBottomColor: borderSoft },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <View style={styles.modalItemLeft}>
                    <MaterialIcons name="folder" size={18} color={primary} />
                    <Text style={[styles.modalItemText, { color: text }]}>
                      {dim.name.trim() || '未命名分类'}
                    </Text>
                  </View>
                  {selectedDimensionId === dim.id ? (
                    <MaterialIcons name="check" size={20} color={primary} />
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flexOne: { flex: 1 },
  topBarWrap: {
    borderBottomWidth: 1,
    zIndex: 10,
    elevation: 6,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    minHeight: 48,
    paddingBottom: 8,
  },
  roundIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: { fontSize: 17, fontWeight: '800' },
  saveBtn: {
    minWidth: 64,
    height: 44,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 16, fontWeight: '800' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollInner: { paddingHorizontal: 18, paddingTop: 20 },
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, marginBottom: 8 },
  formatHint: { fontSize: 11, fontWeight: '600', lineHeight: 16, marginBottom: 10 },
  categoryPicker: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  categoryPickerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  categoryPickerText: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  inputTitle: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    fontWeight: '700',
  },
  bodyInputWrap: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 20,
    paddingTop: 18,
    paddingHorizontal: 8,
    paddingBottom: 8,
    maxHeight: '70%',
  },
  modalTitle: { fontSize: 17, fontWeight: '900', paddingHorizontal: 10, marginBottom: 8 },
  modalList: { maxHeight: 360 },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  modalItemText: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
});
