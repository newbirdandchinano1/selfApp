import { CrudEditScreen } from '@/components/crud';
import { MemoFormatToolbar } from '@/components/memo/memo-format-toolbar';
import { MEMO_INK, MEMO_INK_SOFT, MEMO_WASH, MemoPaperPage, memoPagePaper, memoPaperColor } from '@/components/memo/memo-paper';
import {
  MemoRichBodyInput,
  type MemoRichBodyInputHandle,
} from '@/components/memo/memo-rich-body-input';
import { memoWallTone } from '@/components/memo/memo-wall';
import { ProjectTagPickerField } from '@/components/projects/ProjectTagPickerField';
import { AppIconButton } from '@/components/ui';
import { MemoText } from '@/constants/memo-ui';
import { useAppTheme } from '@/hooks/use-app-theme';
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
import { forgetUnusedMemoUploads, uploadMemoImage } from '@/lib/memo-images';
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
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const MIN_EDITOR = 168;

function keyboardTopFromEvent(screenY: number, height: number): number {
  if (screenY > 0) return screenY;
  return Dimensions.get('screen').height - height;
}

function normalizeId(raw: string | string[] | undefined): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw[0]) return raw[0];
  return '';
}

async function pickMemoImageUri(memoId: string | null): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    toast.warn('需要相册权限才能插入图片');
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.88,
  });
  if (result.canceled || !result.assets[0]?.uri) return null;
  const saved = await uploadMemoImage({
    localUri: result.assets[0].uri,
    memoId,
  });
  return saved.uri;
}

export default function MemoEditScreen() {
  const router = useRouter();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = normalizeId(idParam);
  const isNew = id === 'new';
  const { colors, isDark } = useAppTheme();
  const wall = useMemo(() => memoWallTone(isDark), [isDark]);
  const pagePaper = memoPagePaper(memoPaperColor(id || 'new'));
  const sheetRef = useRef<View>(null);
  const sheetBoxRef = useRef({ y: 0, height: 0 });
  const metaHeightRef = useRef(0);
  const keyboardTopRef = useRef<number | null>(null);
  const [slots, setSlots] = useState<{ editor: number; metaMax: number } | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const recomputeSlots = useCallback(() => {
    const { y, height } = sheetBoxRef.current;
    const metaH = metaHeightRef.current;
    if (height <= 0 || metaH <= 0) return;
    const keyboardTop = keyboardTopRef.current;
    const limit = keyboardTop == null ? y + height : Math.min(y + height, keyboardTop);
    const room = Math.max(0, limit - y);
    const metaMax = Math.max(88, Math.round(room - MIN_EDITOR));
    const usedMeta = Math.min(metaH, metaMax);
    const editor = Math.max(MIN_EDITOR, Math.round(room - usedMeta));
    setSlots(prev => (prev && prev.editor === editor && prev.metaMax === metaMax ? prev : { editor, metaMax }));
  }, []);

  const measureSheet = useCallback(() => {
    sheetRef.current?.measureInWindow((_x, y, _w, height) => {
      if (height <= 0) return;
      sheetBoxRef.current = { y, height };
      recomputeSlots();
    });
  }, [recomputeSlots]);

  useEffect(() => {
    const showEvents = Platform.OS === 'ios'
      ? (['keyboardWillShow', 'keyboardDidShow'] as const)
      : (['keyboardDidShow'] as const);
    const hideEvents = Platform.OS === 'ios'
      ? (['keyboardWillHide', 'keyboardDidHide'] as const)
      : (['keyboardDidHide'] as const);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const align = (screenY: number, height: number) => {
      keyboardTopRef.current = keyboardTopFromEvent(screenY, height);
      setKeyboardOpen(true);
      measureSheet();
      requestAnimationFrame(measureSheet);
      if (timer) clearTimeout(timer);
      timer = setTimeout(measureSheet, 80);
    };
    const showSubs = showEvents.map(eventName =>
      Keyboard.addListener(eventName, event => {
        align(event.endCoordinates.screenY, event.endCoordinates.height);
      }),
    );
    const hideSubs = hideEvents.map(eventName =>
      Keyboard.addListener(eventName, () => {
        keyboardTopRef.current = null;
        setKeyboardOpen(false);
        measureSheet();
        requestAnimationFrame(measureSheet);
      }),
    );
    return () => {
      if (timer) clearTimeout(timer);
      showSubs.forEach(sub => sub.remove());
      hideSubs.forEach(sub => sub.remove());
    };
  }, [measureSheet]);

  const editorRef = useRef<MemoRichBodyInputHandle>(null);
  const uploadedUrisRef = useRef<string[]>([]);
  const [title, setTitle] = useState('');
  const [bodyModel, setBodyModel] = useState<MemoEditModel>(emptyMemoEditModel);
  const [allTags, setAllTags] = useState<TagRow[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [titleFocused, setTitleFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

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

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const onFormatAction = useCallback(async (action: MemoFormatAction) => {
    let extras: { imageUri?: string } | undefined;
    if (action === 'image') {
      try {
        const uri = await pickMemoImageUri(isNew ? null : id);
        if (!uri) return;
        uploadedUrisRef.current.push(uri);
        extras = { imageUri: uri };
      } catch (e) {
        toast.error(toUserMessage(e, '图片上传失败'));
        return;
      }
    }
    // 格式在 WebView 内应用（缓存选区 + execCommand / 模型重刷），避免点工具栏丢选区
    editorRef.current?.applyFormat(action, extras);
  }, [id, isNew]);

  const onBodyModelChange = useCallback((next: MemoEditModel) => {
    setBodyModel(next);
  }, []);

  const onSave = useCallback(async () => {
    if (saving || savingRef.current) return;
    savingRef.current = true;
    const t = title.trim();
    if (!t && !bodyModel.plain.trim()) {
      savingRef.current = false;
      toast.warn('请填写标题或正文');
      return;
    }
    let body: string;
    try {
      body = serializeEditModelToBody(bodyModel);
    } catch (e) {
      savingRef.current = false;
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
      await forgetUnusedMemoUploads(uploadedUrisRef.current, body);
      uploadedUrisRef.current = [];
      router.back();
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请稍后重试'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [bodyModel, id, isNew, pinned, router, saving, selectedTagIds, title]);

  if (!id || (!isNew && id === '')) {
    return (
      <CrudEditScreen title="编辑备忘" onBack={() => router.back()} missing missingMessage="缺少备忘 ID" />
    );
  }

  return (
    <CrudEditScreen
      title={isNew ? '新建备忘' : '编辑备忘'}
      onBack={saving ? undefined : () => router.back()}
      headerProps={{ style: styles.wallHeader }}
      headerRight={
        <View style={styles.headerActions}>
          <AppIconButton
            icon="push-pin"
            onPress={() => setPinned(p => !p)}
            disabled={saving || loading}
            color={pinned ? '#C4453A' : wall.ink}
            accessibilityLabel={pinned ? '取消置顶' : '置顶'}
          />
          <Pressable
            style={styles.saveBtn}
            onPress={() => void onSave()}
            disabled={saving || loading || overLimit}>
            {saving ? (
              <ActivityIndicator size="small" color={wall.ink} />
            ) : (
              <Text style={[styles.saveText, { color: loading || overLimit ? wall.muted : wall.ink }]}>
                保存
              </Text>
            )}
          </Pressable>
        </View>
      }
      keyboardAvoiding={false}
      loading={loading}
      loadingHint="加载备忘…"
      error={error}
      onRetryError={() => void reload()}
      style={{ backgroundColor: wall.base }}>
      <View style={styles.column}>
        <MemoPaperPage
          memoId={id}
          pinned={pinned}
          minHeight={0}
          clip={false}
          stretch
          paddingBottom={keyboardOpen ? 8 : 64}>
          <View ref={sheetRef} style={styles.sheet} collapsable={false} onLayout={measureSheet}>
            <ScrollView
              style={slots ? { maxHeight: slots.metaMax, flexGrow: 0 } : styles.metaScroll}
              keyboardShouldPersistTaps="always"
              scrollsChildToFocus={false}
              nestedScrollEnabled
              contentContainerStyle={styles.metaContent}
              onLayout={event => {
                const next = Math.ceil(event.nativeEvent.layout.height);
                if (metaHeightRef.current === next) return;
                metaHeightRef.current = next;
                recomputeSlots();
              }}
              showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>标签（可选，可多选）</Text>
              <ProjectTagPickerField
                selectedIds={selectedTagIds}
                allTags={allTags}
                loading={tagsLoading}
                disabled={saving}
                tagDomain="memo"
                onChange={setSelectedTagIds}
                textColor={MEMO_INK}
                outline={MEMO_INK_SOFT}
                placeholderColor="rgba(30,57,50,0.28)"
                primary={MEMO_INK}
                surfaceLow={MEMO_WASH}
                surfaceLowest="#FFFEF8"
                isDark={false}
              />

              <Text style={styles.modeCaption}>{isNew ? '新笔记' : '编辑笔记'}</Text>
              <TextInput
                value={title}
                onChangeText={x => setTitle(x.length > MEMO_TITLE_MAX ? x.slice(0, MEMO_TITLE_MAX) : x)}
                onFocus={() => setTitleFocused(true)}
                onBlur={() => setTitleFocused(false)}
                placeholder="标题（可选）"
                placeholderTextColor={MEMO_INK_SOFT}
                style={[
                  styles.titleInput,
                  { borderBottomColor: titleFocused ? MEMO_INK : 'rgba(30,57,50,0.2)' },
                ]}
              />

              <MemoFormatToolbar
                onAction={a => void onFormatAction(a)}
                primary={MEMO_INK}
                borderColor="rgba(30,57,50,0.16)"
                backgroundColor="rgba(255,254,248,0.45)"
                pressedBackgroundColor="rgba(30,57,50,0.1)"
              />
              <Text style={[styles.formatHint, overLimit ? { color: colors.danger } : null]}>
                {overLimit
                  ? `内容过大（${Math.ceil(bodyBytes / 1024)}KB / ${MEMO_BODY_MAX_BYTES / 1024}KB），请删减`
                  : `选中文字设行内格式；约 ${Math.ceil(bodyBytes / 1024)}KB / ${MEMO_BODY_MAX_BYTES / 1024}KB`}
              </Text>
            </ScrollView>
            <View style={slots ? { height: slots.editor, flexGrow: 0, overflow: 'hidden' } : styles.bodyFill}>
              <MemoRichBodyInput
                ref={editorRef}
                fill
                model={bodyModel}
                onChangeModel={onBodyModelChange}
                onSelectionChange={() => {}}
                onNeedSelection={() => toast.warn('请先选中文字再设置格式')}
                placeholder="写下想法…"
                textColor={MEMO_INK}
                placeholderColor={MEMO_INK_SOFT}
                caretColor={MEMO_INK}
                backgroundColor={pagePaper}
                containerStyle={[
                  styles.bodyInputWrap,
                  styles.bodyFill,
                  { borderColor: overLimit ? colors.danger : 'transparent' },
                ]}
              />
            </View>
          </View>
        </MemoPaperPage>
      </View>
    </CrudEditScreen>
  );
}

const styles = StyleSheet.create({
  wallHeader: {
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  saveBtn: {
    minWidth: 64,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  saveText: MemoText.save,
  column: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  sheet: { flex: 1, minHeight: 0 },
  metaScroll: { flexGrow: 0, flexShrink: 1 },
  metaContent: { gap: 10, paddingBottom: 8 },
  label: {
    ...MemoText.tag,
    color: MEMO_INK_SOFT,
    marginBottom: 2,
  },
  modeCaption: { ...MemoText.caption, color: MEMO_INK_SOFT },
  titleInput: {
    ...MemoText.editTitle,
    color: MEMO_INK,
    marginTop: 4,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  formatHint: { ...MemoText.time, color: MEMO_INK_SOFT, marginBottom: 4 },
  bodyInputWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 2,
    overflow: 'hidden',
  },
  bodyFill: {
    flex: 1,
    minHeight: 120,
  },
});
