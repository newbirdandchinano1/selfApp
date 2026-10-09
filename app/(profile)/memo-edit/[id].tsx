import { CrudEditScreen } from '@/components/crud';
import { MemoFormatToolbar } from '@/components/memo/memo-format-toolbar';
import {
  MemoRichBodyInput,
  type MemoRichBodyInputHandle,
} from '@/components/memo/memo-rich-body-input';
import { ProjectTagPickerField } from '@/components/projects/ProjectTagPickerField';
import { AppIconButton } from '@/components/ui';
import { Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { startMemoAiReviewInBackground } from '@/lib/memo-ai-background';
import {
  emptyMemoEditModel,
  type MemoEditModel,
  type MemoFormatAction,
} from '@/lib/memo-format';
import {
  editModelToRichDoc,
  MEMO_BODY_MAX_BYTES,
  parseMemoBody,
  richDocToEditModel,
  serializeEditModelToBody,
  serializeRichDoc,
} from '@/lib/memo-richdoc';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  createMemo,
  getMemo,
  memoBodyByteLength,
  MEMO_TITLE_MAX,
  updateMemo,
} from '@/lib/memos';
import { getTagIdsByEntity, getMemoTags } from '@/lib/repositories/tags/tag';
import type { TagRow } from '@/lib/repositories/tags/tag.types';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

function promptImageUri(): Promise<string | null> {
  return new Promise(resolve => {
    if (Platform.OS === 'ios') {
      Alert.prompt(
        '图片链接',
        '仅 URI，禁止 base64',
        [
          { text: '取消', style: 'cancel', onPress: () => resolve(null) },
          {
            text: '插入',
            onPress: (v?: string) => resolve((v ?? '').trim() || null),
          },
        ],
        'plain-text',
        'https://',
      );
      return;
    }
    Alert.alert('插入图片', '将插入图片链接占位，请在正文中改成真实 URI', [
      { text: '取消', style: 'cancel', onPress: () => resolve(null) },
      { text: '插入', onPress: () => resolve('https://') },
    ]);
  });
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

  const editorRef = useRef<MemoRichBodyInputHandle>(null);
  const [title, setTitle] = useState('');
  const [bodyModel, setBodyModel] = useState<MemoEditModel>(emptyMemoEditModel);
  const [allTags, setAllTags] = useState<TagRow[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bodyBytes = useMemo(
    () => memoBodyByteLength(serializeRichDoc(editModelToRichDoc(bodyModel))),
    [bodyModel],
  );
  const overLimit = bodyBytes > MEMO_BODY_MAX_BYTES;

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
      setBodyModel(richDocToEditModel(parseMemoBody(row.body)) as MemoEditModel);
      setPinned(Boolean(row.is_pinned));
      const selected = await getTagIdsByEntity('memo', id);
      const memoTagIdSet = new Set(tags.map(t => t.id));
      setSelectedTagIds(selected.filter(sid => memoTagIdSet.has(sid)));
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

  const onFormatAction = useCallback(async (action: MemoFormatAction) => {
    let extras: { imageUri?: string } | undefined;
    if (action === 'image') {
      const uri = await promptImageUri();
      if (!uri) return;
      extras = { imageUri: uri };
    }
    // 格式在 WebView 内应用（缓存选区 + execCommand / 模型重刷），避免点工具栏丢选区
    editorRef.current?.applyFormat(action, extras);
  }, []);

  const onBodyModelChange = useCallback((next: MemoEditModel) => {
    setBodyModel(next);
  }, []);

  const onSave = useCallback(async () => {
    const t = title.trim();
    if (!t && !bodyModel.plain.trim()) {
      toast.warn('请填写标题或正文');
      return;
    }
    let body: string;
    try {
      body = serializeEditModelToBody(bodyModel);
    } catch (e) {
      toast.error(toUserMessage(e, '正文过大或格式无效'));
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
          toast.error('该备忘可能已删除');
          setSaving(false);
          return;
        }
      }
      toast.success('已保存');
      router.back();
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请稍后重试'));
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
          <Pressable style={styles.saveBtn} onPress={() => void onSave()} disabled={saving || loading || overLimit}>
            {saving ? (
              <ActivityIndicator size="small" color={primary} />
            ) : (
              <Text style={[styles.saveText, { color: overLimit ? muted : primary }]}>保存</Text>
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
        keyboardShouldPersistTaps="always"
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
          onAction={a => void onFormatAction(a)}
          primary={primary}
          borderColor={line}
          backgroundColor={toolbarBg}
        />
        <Text style={[styles.formatHint, { color: overLimit ? colors.danger : muted }]}>
          {overLimit
            ? `内容过大（${Math.ceil(bodyBytes / 1024)}KB / ${MEMO_BODY_MAX_BYTES / 1024}KB），请删减`
            : `选中文字设行内格式；约 ${Math.ceil(bodyBytes / 1024)}KB / ${MEMO_BODY_MAX_BYTES / 1024}KB`}
        </Text>
        <MemoRichBodyInput
          ref={editorRef}
          model={bodyModel}
          onChangeModel={onBodyModelChange}
          onSelectionChange={() => {}}
          onNeedSelection={() => toast.warn('请先选中文字再设置格式')}
          placeholder="写下想法…"
          textColor={ink}
          placeholderColor={muted}
          caretColor={primary}
          backgroundColor={inputBg}
          minHeight={bodyMinHeight}
          containerStyle={[
            styles.bodyInputWrap,
            {
              borderColor: line,
              backgroundColor: inputBg,
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
