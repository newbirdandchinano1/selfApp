import { CrudEditScreen } from '@/components/crud';
import { MemoFormatToolbar } from '@/components/memo/memo-format-toolbar';
import { MemoRichBodyInput } from '@/components/memo/memo-rich-body-input';
import { ProjectTagPickerField } from '@/components/projects/ProjectTagPickerField';
import { AppIconButton } from '@/components/ui';
import { Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
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
  MEMO_BODY_MAX,
  MEMO_TITLE_MAX,
  updateMemo,
} from '@/lib/memos';
import { getTagIdsByEntity, getMemoTags, getTagsByIds } from '@/lib/repositories/tags/tag';
import type { TagRow } from '@/lib/repositories/tags/tag.types';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = normalizeId(idParam);
  const isNew = id === 'new';
  const { colors, isDark } = useAppTheme();

  const paper = colors.background;
  const ink = colors.text;
  const muted = colors.textSecondary;
  const line = isDark ? 'rgba(148,163,184,0.22)' : colors.outlineStrong;
  const primary = colors.primary;
  const inputBg = isDark ? colors.input : colors.surface;
  const toolbarBg = isDark ? colors.surfaceMuted : colors.surfaceSubtle;

  const bodyMinHeight = useMemo(() => Math.max(360, Math.round(windowHeight * 0.42)), [windowHeight]);

  const [title, setTitle] = useState('');
  const [bodyModel, setBodyModel] = useState<MemoEditModel>(emptyMemoEditModel);
  const [bodySelection, setBodySelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [controlledSelection, setControlledSelection] = useState<TextSelection | undefined>(undefined);
  const [allTags, setAllTags] = useState<TagRow[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setTagsLoading(true);
    setError(null);
    try {
      const tags = await getMemoTags();
      setAllTags(tags);
      setTagsLoading(false);

      if (isNew) {
        setSelectedTagIds([]);
        setPinned(false);
        return;
      }

      if (!id) return;
      const row = await getMemo(id);
      if (!row) {
        setError('该备忘可能已删除');
        return;
      }
      setTitle(row.title);
      setBodyModel(parseMemoBodyToEditModel(row.body));
      setPinned(Boolean(row.is_pinned));
      const selected = await getTagIdsByEntity('memo', id);
      setSelectedTagIds(selected);
      // 历史跨域关联：补进列表以便展示，但不影响本域新建
      const missing = selected.filter((sid) => !tags.some((t) => t.id === sid));
      if (missing.length > 0) {
        const extras = await getTagsByIds(missing);
        if (extras.length > 0) setAllTags([...tags, ...extras]);
      }
    } catch {
      setError('加载失败，请重试');
    } finally {
      setLoading(false);
      setTagsLoading(false);
    }
  }, [id, isNew]);

  const { refreshControl } = usePullToRefresh(reload);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const onFormatAction = useCallback(
    (action: MemoFormatAction) => {
      const result = applyMemoFormatToModel(bodyModel, bodySelection, action);
      setBodyModel(result.model);
      setBodySelection(result.selection);
      setControlledSelection(result.selection);
    },
    [bodyModel, bodySelection],
  );

  const onBodyPlainChange = useCallback((plain: string) => {
    setControlledSelection(undefined);
    const nextPlain = clampPlain(plain);
    setBodyModel(prev => updateMemoEditModelPlain(prev, nextPlain));
  }, []);

  const onSave = useCallback(async () => {
    const t = title.trim();
    const body = memoBodyFromEditModel(bodyModel).trim();
    if (!t && !bodyModel.plain.trim()) {
      Alert.alert('无法保存', '请填写标题或正文');
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        const created = await createMemo({
          title,
          body,
          tagIds: selectedTagIds,
          is_pinned: pinned,
        });
        startMemoAiReviewInBackground(created);
      } else {
        const ok = await updateMemo(id, {
          title,
          body,
          tagIds: selectedTagIds,
          is_pinned: pinned,
        });
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
  }, [bodyModel, id, isNew, pinned, router, selectedTagIds, title]);

  if (!id || (!isNew && id === '')) {
    return (
      <CrudEditScreen title="编辑备忘" onBack={() => router.back()} missing missingMessage="缺少备忘 ID" />
    );
  }

  return (
    <CrudEditScreen
      title={isNew ? '新建备忘' : '编辑备忘'}
      onBack={saving ? undefined : () => router.back()}
      headerRight={
        <View style={styles.headerActions}>
          <AppIconButton
            icon="push-pin"
            onPress={() => setPinned(p => !p)}
            disabled={saving || loading}
            color={pinned ? colors.tertiary : muted}
            accessibilityLabel={pinned ? '取消置顶' : '置顶'}
          />
          <Pressable style={styles.saveBtn} onPress={() => void onSave()} disabled={saving || loading}>
            {saving ? (
              <ActivityIndicator size="small" color={primary} />
            ) : (
              <Text style={[styles.saveText, { color: primary }]}>保存</Text>
            )}
          </Pressable>
        </View>
      }
      loading={loading}
      loadingHint="加载备忘…"
      error={error}
      onRetryError={() => void reload()}
      style={{ backgroundColor: paper }}>
      <ScrollView
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scrollInner,
          { paddingBottom: Math.max(insets.bottom, 20) + 24 },
        ]}
        showsVerticalScrollIndicator={false}>
        <Text style={[styles.label, { color: muted }]}>标签（可选，可多选）</Text>
        <ProjectTagPickerField
          selectedIds={selectedTagIds}
          allTags={allTags}
          loading={tagsLoading}
          disabled={saving}
          tagDomain="memo"
          onChange={setSelectedTagIds}
          textColor={ink}
          outline={muted}
          placeholderColor={muted}
          primary={primary}
          surfaceLow={inputBg}
          surfaceLowest={colors.surface}
          isDark={isDark}
        />

        <TextInput
          value={title}
          onChangeText={x => setTitle(x.length > MEMO_TITLE_MAX ? x.slice(0, MEMO_TITLE_MAX) : x)}
          placeholder="标题（可选）"
          placeholderTextColor={muted}
          style={[styles.titleInput, { color: ink, borderBottomColor: line }]}
        />

        <MemoFormatToolbar
          onAction={onFormatAction}
          primary={primary}
          borderColor={line}
          backgroundColor={toolbarBg}
        />
        <Text style={[styles.formatHint, { color: muted }]}>
          选中文字后点工具栏设置格式；保存后查看页一致
        </Text>
        <MemoRichBodyInput
          model={bodyModel}
          onChangePlain={onBodyPlainChange}
          onSelectionChange={sel => {
            setBodySelection(sel);
            if (controlledSelection != null) setControlledSelection(undefined);
          }}
          controlledSelection={controlledSelection}
          placeholder="写下想法…"
          textColor={ink}
          placeholderColor={muted}
          caretColor={primary}
          containerStyle={[
            styles.bodyInputWrap,
            {
              borderColor: line,
              backgroundColor: inputBg,
              minHeight: bodyMinHeight,
            },
          ]}
        />
      </ScrollView>
    </CrudEditScreen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  saveBtn: {
    minWidth: 52,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  saveText: { fontSize: 16, fontWeight: '800' },
  scrollInner: { paddingHorizontal: Spacing['5xl'], paddingTop: Spacing['5xl'], gap: 10 },
  label: {
    ...Typography.label,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  titleInput: {
    marginTop: 10,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  formatHint: { fontSize: 11, fontWeight: '600', lineHeight: 16, marginBottom: 4 },
  bodyInputWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
  },
});
