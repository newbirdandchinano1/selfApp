import { CrudDetailScreen } from '@/components/crud';
import { MemoCenterSheet } from '@/components/memo/memo-center-sheet';
import {
  MemoAiConvertDraftBody,
  MemoAiSuggestTagsBody,
} from '@/components/memo/memo-ai-p0-sheets';
import { MemoAiLinkSuggestBody } from '@/components/memo/memo-ai-p2-sheets';
import { MemoFormattedBody } from '@/components/memo/memo-formatted-body';
import { MEMO_INK, MEMO_INK_SOFT, MEMO_WASH, MemoPaperPage } from '@/components/memo/memo-paper';
import { memoWallTone } from '@/components/memo/memo-wall';
import { AppIconButton } from '@/components/ui';
import { MemoRadius, MemoText, memoTagStyle } from '@/constants/memo-ui';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import type {
  MemoConvertDraftJson,
  MemoLinkSuggestJson,
  MemoSuggestTagsJson,
} from '@/lib/ai-types';
import { Alert, toast, toUserMessage } from '@/lib/app-feedback';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { memoHasAiReview } from '@/lib/memo-format';
import { createProjectFromMemoInInbox } from '@/lib/memo-to-project';
import {
  createStandaloneTodoFromMemo,
  createStandaloneTodosFromMemo,
} from '@/lib/memo-to-task';
import {
  getMemo,
  memoContextForAiReview,
  memoListPreviewTitle,
  setMemoLinkedTaskId,
  setMemoPinned,
  type MemoItem,
} from '@/lib/memos';
import {
  analyzeMemoConvertDraft,
  analyzeMemoLinkSuggest,
  analyzeMemoSuggestTags,
} from '@/lib/zhipu-image-parse';
import { getProjects } from '@/lib/repositories/projects/project';
import { createTask, getTasks } from '@/lib/repositories/tasks/task';
import { isTaskTerminalStatus } from '@/lib/repositories/tasks/task.types';
import {
  createMemoTag,
  getMemoTags,
  getTagIdsByEntity,
  getTagsByEntity,
  setMemoTagIds,
} from '@/lib/repositories/tags/tag';
import type { TagRow } from '@/lib/repositories/tags/tag.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function normalizeId(raw: string | string[] | undefined): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw[0]) return raw[0];
  return '';
}

const PAGE_API_KEY = 'memo-view';

export default function MemoViewScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = normalizeId(idParam);
  const { colors, isDark } = useAppTheme();
  const { height: windowHeight } = useWindowDimensions();
  const wall = useMemo(() => memoWallTone(isDark), [isDark]);
  const ink = colors.text;
  const muted = colors.textSecondary;
  const secondary = colors.secondary;
  const primary = colors.primary;
  const line = colors.outline;
  const [viewportHeight, setViewportHeight] = useState(0);
  const pageMinHeight = Math.max(360, (viewportHeight || windowHeight - insets.top - 96) - 36);

  const [row, setRow] = useState<MemoItem | null>(null);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [allMemoTags, setAllMemoTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pinning, setPinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackedId, setTrackedId] = useState(id);
  const rowRef = useRef(row);
  rowRef.current = row;
  const motion = useReducedMotionState();
  const aiOpacity = useRef(new Animated.Value(0)).current;
  const hadAiRef = useRef(false);

  const [convertOpen, setConvertOpen] = useState(false);
  const [convertLoading, setConvertLoading] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertDraft, setConvertDraft] = useState<MemoConvertDraftJson | null>(null);

  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestData, setSuggestData] = useState<MemoSuggestTagsJson | null>(null);
  const [suggestSelectedIds, setSuggestSelectedIds] = useState<string[]>([]);
  const [suggestNewNames, setSuggestNewNames] = useState<string[]>([]);

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkData, setLinkData] = useState<MemoLinkSuggestJson | null>(null);
  const [linkProjects, setLinkProjects] = useState<{ id: string; name: string }[]>([]);
  const [linkTodos, setLinkTodos] = useState<{ id: string; title: string }[]>([]);
  const [linkSelectedProjectId, setLinkSelectedProjectId] = useState<string | null>(null);
  const [linkSelectedTaskId, setLinkSelectedTaskId] = useState<string | null>(null);
  const convertingLockRef = useRef(false);

  if (trackedId !== id) {
    setTrackedId(id);
    setRow(null);
    setTags([]);
    setError(null);
    setLoading(true);
  }

  const reload = useCallback(
    async (forceRefresh = false) => {
      if (!id) {
        setLoading(false);
        return;
      }
      setError(null);
      try {
        await wrapLoad(async () => {
          const item = await getMemo(id);
          if (!item) {
            setRow(null);
            setTags([]);
            return;
          }
          setRow(item);
          const [linked, catalog] = await Promise.all([
            getTagsByEntity('memo', id),
            getMemoTags(),
          ]);
          setTags(linked);
          setAllMemoTags(catalog);
        }, forceRefresh);
      } catch {
        setError('加载失败，请重试');
        setRow(null);
        setTags([]);
      } finally {
        setLoading(false);
      }
    },
    [id, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      const current = rowRef.current;
      if (!(current && current.id === id)) {
        setLoading(true);
      }
      void reload();
    }, [id, reload]),
  );

  const displayTitle = row ? memoListPreviewTitle(row) : '';
  const showAi = row ? memoHasAiReview(row) : false;

  useLayoutEffect(() => {
    if (!showAi) {
      hadAiRef.current = false;
      aiOpacity.setValue(0);
      return;
    }
    if (loading) return;
    if (hadAiRef.current) {
      aiOpacity.setValue(1);
      return;
    }
    hadAiRef.current = true;
    if (!motion.ready || motion.enabled) {
      aiOpacity.setValue(1);
      return;
    }
    aiOpacity.setValue(0);
    const anim = Animated.timing(aiOpacity, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [aiOpacity, loading, motion.enabled, motion.ready, showAi]);

  const onTogglePin = useCallback(async () => {
    if (!row || pinning) return;
    setPinning(true);
    try {
      const next = !row.is_pinned;
      const updated = await setMemoPinned(row.id, next);
      if (!updated) {
        toast.error('该备忘可能已删除');
        return;
      }
      setRow({ ...row, is_pinned: next || undefined });
    } catch (e) {
      toast.error(toUserMessage(e, '操作失败，请稍后重试'));
    } finally {
      setPinning(false);
    }
  }, [pinning, row]);

  const runConvertDraft = useCallback(async (item: MemoItem) => {
    setConvertLoading(true);
    setConvertError(null);
    setConvertDraft(null);
    try {
      const ctx = memoContextForAiReview(item);
      if (!ctx) {
        setConvertError('备忘内容为空');
        return;
      }
      const aiSummary = [item.ai_evaluation, item.ai_suggestions].filter(Boolean).join('\n').slice(0, 800);
      const r = await analyzeMemoConvertDraft({
        memoContextText: ctx,
        target: 'auto',
        aiSummary: aiSummary || undefined,
      });
      if (!r.ok) {
        setConvertError(r.error);
        return;
      }
      setConvertDraft(r.data);
    } finally {
      setConvertLoading(false);
    }
  }, []);

  const openSmartConvert = useCallback(() => {
    if (!row) return;
    setConvertOpen(true);
    void runConvertDraft(row);
  }, [row, runConvertDraft]);

  const runSuggestTags = useCallback(async (item: MemoItem) => {
    setSuggestLoading(true);
    setSuggestError(null);
    setSuggestData(null);
    setSuggestSelectedIds([]);
    setSuggestNewNames([]);
    try {
      const ctx = memoContextForAiReview(item);
      if (!ctx) {
        setSuggestError('备忘内容为空');
        return;
      }
      const catalog = (allMemoTags.length ? allMemoTags : await getMemoTags()).map(t => ({
        id: t.id,
        name: t.name,
      }));
      if (!allMemoTags.length) setAllMemoTags(await getMemoTags());
      const existing = await getTagIdsByEntity('memo', item.id);
      const r = await analyzeMemoSuggestTags({
        memoContextText: ctx,
        tags: catalog,
        tagIds: existing,
      });
      if (!r.ok) {
        setSuggestError(r.error);
        return;
      }
      setSuggestData(r.data);
      setSuggestSelectedIds(r.data.tag_ids);
    } finally {
      setSuggestLoading(false);
    }
  }, [allMemoTags]);

  const openSuggestTags = useCallback(() => {
    if (!row) return;
    setSuggestOpen(true);
    void runSuggestTags(row);
  }, [row, runSuggestTags]);

  const runLinkSuggest = useCallback(async (item: MemoItem) => {
    setLinkLoading(true);
    setLinkError(null);
    setLinkData(null);
    setLinkSelectedProjectId(null);
    setLinkSelectedTaskId(null);
    try {
      const ctx = memoContextForAiReview(item);
      if (!ctx) {
        setLinkError('备忘内容为空');
        return;
      }
      const [projects, tasks] = await Promise.all([getProjects(), getTasks()]);
      const openProjects = projects
        .filter(p => p.status !== 'completed' && p.status !== 'archived')
        .slice(0, 40)
        .map(p => ({ id: p.id, name: p.name }));
      const openTodos = tasks
        .filter(t => !isTaskTerminalStatus(t.status) && t.status !== 'shelved')
        .slice(0, 60)
        .map(t => ({ id: t.id, title: t.title }));
      setLinkProjects(openProjects);
      setLinkTodos(openTodos);
      if (!openProjects.length && !openTodos.length) {
        setLinkError('暂无开放中的项目或待办可关联');
        return;
      }
      const r = await analyzeMemoLinkSuggest({
        memoContextText: ctx,
        projects: openProjects,
        todos: openTodos,
      });
      if (!r.ok) {
        setLinkError(r.error);
        return;
      }
      setLinkData(r.data);
      setLinkSelectedProjectId(r.data.project_ids[0] ?? null);
      setLinkSelectedTaskId(r.data.task_ids[0] ?? null);
    } finally {
      setLinkLoading(false);
    }
  }, []);

  const openLinkSuggest = useCallback(() => {
    if (!row) return;
    setLinkOpen(true);
    void runLinkSuggest(row);
  }, [row, runLinkSuggest]);

  const confirmSuggestTags = useCallback(async () => {
    if (!row) return;
    try {
      const existing = await getTagIdsByEntity('memo', row.id);
      const next = new Set(existing);
      for (const tid of suggestSelectedIds) next.add(tid);
      let catalog = allMemoTags;
      for (const name of suggestNewNames) {
        const trimmed = name.trim();
        if (!trimmed) continue;
        const dup = catalog.find(t => t.name.trim().toLowerCase() === trimmed.toLowerCase());
        if (dup) {
          next.add(dup.id);
          continue;
        }
        const tagId = makeTimestampEntityId('ptag_', 8);
        await createMemoTag({ id: tagId, name: trimmed.slice(0, 20), color: '#64748B' });
        next.add(tagId);
      }
      await setMemoTagIds(row.id, [...next]);
      catalog = await getMemoTags();
      setAllMemoTags(catalog);
      setTags(await getTagsByEntity('memo', row.id));
      setSuggestOpen(false);
      toast.success('已更新标签');
    } catch (e) {
      toast.error(toUserMessage(e, '挂标签失败'));
    }
  }, [allMemoTags, row, suggestNewNames, suggestSelectedIds]);

  if (!id) {
    return (
      <CrudDetailScreen title="备忘" onBack={() => router.back()} missing missingMessage="缺少备忘 ID" />
    );
  }

  return (
    <CrudDetailScreen
      title="备忘"
      onBack={() => router.back()}
      headerProps={{ style: styles.wallHeader }}
      headerRight={
        <View style={styles.headerActions}>
          <AppIconButton
            icon="label-outline"
            onPress={openSuggestTags}
            disabled={!row}
            color={wall.ink}
            accessibilityLabel="建议标签"
          />
          <AppIconButton
            icon="link"
            onPress={openLinkSuggest}
            disabled={!row}
            color={wall.ink}
            accessibilityLabel="关联到"
          />
          <AppIconButton
            icon="alt-route"
            onPress={openSmartConvert}
            disabled={!row}
            color={wall.ink}
            accessibilityLabel="智能拆分"
          />
          <AppIconButton
            icon="push-pin"
            onPress={() => void onTogglePin()}
            disabled={!row || pinning}
            color={row?.is_pinned ? '#C4453A' : wall.ink}
            accessibilityLabel={row?.is_pinned ? '取消置顶' : '置顶'}
          />
          <AppIconButton
            icon="edit"
            onPress={() => router.push({ pathname: '/memo-edit/[id]', params: { id } })}
            disabled={!row}
            color={wall.ink}
            accessibilityLabel="编辑"
          />
        </View>
      }
      loading={loading}
      loadingHint="加载备忘…"
      error={error}
      onRetryError={() => {
        setLoading(true);
        void reload(true);
      }}
      missing={!loading && !error && !row}
      missingMessage="未找到该备忘"
      style={{ backgroundColor: wall.base }}>
      {row ? (
        <ScrollView
          refreshControl={refreshControl}
          onLayout={event => {
            const next = Math.ceil(event.nativeEvent.layout.height);
            setViewportHeight(prev => (prev === next ? prev : next));
          }}
          contentContainerStyle={[
            styles.scrollInner,
            { paddingBottom: Math.max(insets.bottom, 16) + 28 },
          ]}
          showsVerticalScrollIndicator={false}>
          <MemoPaperPage memoId={row.id} pinned={Boolean(row.is_pinned)} minHeight={pageMinHeight}>
            <Text style={styles.title}>{displayTitle}</Text>
            <Text style={styles.meta}>更新于 {new Date(row.updated_at).toLocaleString('zh-CN')}</Text>
            {row.created_at !== row.updated_at || row.is_pinned ? (
              <Text style={styles.metaSecond}>
                {[
                  row.created_at !== row.updated_at
                    ? `创建于 ${new Date(row.created_at).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                      })}`
                    : '',
                  row.is_pinned ? '已置顶' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            ) : null}

            {tags.length > 0 ? (
              <View style={styles.tagRow}>
                {tags.map(t => {
                  const tagStyle = memoTagStyle(t.color, false);
                  return (
                    <View key={t.id} style={styles.tagChip}>
                      <View style={[styles.tagDot, { backgroundColor: tagStyle.color }]} />
                      <Text style={styles.tagText}>{t.name}</Text>
                    </View>
                  );
                })}
              </View>
            ) : null}

            <View style={styles.bodyBlock}>
              <MemoFormattedBody
                body={row.body}
                color={MEMO_INK}
                mutedColor={MEMO_INK_SOFT}
                quoteBg={MEMO_WASH}
              />
            </View>

            {row.linked_task_id ? (
              <Text style={[styles.metaSecond, { marginTop: 10 }]}>
                已关联待办 · 点顶栏链接图标可重新匹配
              </Text>
            ) : null}

            {showAi ? (
              <Animated.View style={[styles.aiBlock, { opacity: aiOpacity }]}>
                <View style={styles.aiHeader}>
                  <MaterialIcons name="auto-awesome" size={18} color={MEMO_INK_SOFT} />
                  <Text style={styles.aiTitle}>AI 评价与建议</Text>
                </View>
                <Text style={styles.aiKicker}>评价</Text>
                <Text style={styles.aiText}>{row.ai_evaluation?.trim() || '（暂无评价内容）'}</Text>
                <Text style={[styles.aiKicker, styles.aiSection]}>建议</Text>
                <Text style={styles.aiSuggest}>{row.ai_suggestions?.trim() || '（暂无建议内容）'}</Text>
                {row.ai_review_at ? (
                  <Text style={styles.aiTime}>生成于 {new Date(row.ai_review_at).toLocaleString('zh-CN')}</Text>
                ) : null}
              </Animated.View>
            ) : null}
          </MemoPaperPage>
        </ScrollView>
      ) : null}

      <MemoCenterSheet
        visible={convertOpen}
        onClose={() => setConvertOpen(false)}
        style={[styles.sheet, { backgroundColor: colors.surface, borderColor: line }]}>
        {row ? (
          <MemoAiConvertDraftBody
            colors={{ ink, muted, secondary, primary }}
            loading={convertLoading}
            error={convertError}
            draft={convertDraft}
            onRetry={() => void runConvertDraft(row)}
            onConfirmTodo={todo => {
              if (convertingLockRef.current) return;
              convertingLockRef.current = true;
              setConvertOpen(false);
              void (async () => {
                try {
                  const { taskId, title } = await createStandaloneTodoFromMemo(row, {
                    title: todo.title,
                    note: todo.note,
                    priority: todo.priority,
                  });
                  Alert.alert('已转为待办', `「${title}」已加入待办列表，原备忘已删除。`, [
                    { text: '知道了', style: 'cancel', onPress: () => router.back() },
                    {
                      text: '查看待办',
                      onPress: () => router.replace({ pathname: '/task/[id]', params: { id: taskId } }),
                    },
                  ]);
                } catch (e) {
                  toast.error(toUserMessage(e, '转换失败'));
                } finally {
                  convertingLockRef.current = false;
                }
              })();
            }}
            onConfirmProject={project => {
              if (convertingLockRef.current) return;
              convertingLockRef.current = true;
              setConvertOpen(false);
              void (async () => {
                try {
                  const { projectId, name } = await createProjectFromMemoInInbox(row, {
                    name: project.name,
                    note: project.note,
                  });
                  Alert.alert('已转为项目', `「${name}」已加入收集箱，原备忘已删除。`, [
                    { text: '知道了', style: 'cancel', onPress: () => router.back() },
                    {
                      text: '查看项目',
                      onPress: () =>
                        router.replace({ pathname: '/edit-project', params: { id: projectId } }),
                    },
                  ]);
                } catch (e) {
                  if (e instanceof Error && e.message === 'duplicate_name') {
                    toast.warn('已有同名项目，请修改名称后再转换。');
                  } else {
                    toast.error(toUserMessage(e, '转换失败'));
                  }
                } finally {
                  convertingLockRef.current = false;
                }
              })();
            }}
            onConfirmSplit={todos => {
              if (convertingLockRef.current) return;
              convertingLockRef.current = true;
              setConvertOpen(false);
              void (async () => {
                try {
                  const { titles } = await createStandaloneTodosFromMemo(row, todos);
                  Alert.alert('已拆分为待办', `已创建 ${titles.length} 条待办，原备忘已删除。`, [
                    { text: '知道了', onPress: () => router.back() },
                  ]);
                } catch (e) {
                  toast.error(toUserMessage(e, '拆分失败'));
                } finally {
                  convertingLockRef.current = false;
                }
              })();
            }}
          />
        ) : null}
      </MemoCenterSheet>

      <MemoCenterSheet
        visible={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        style={[styles.sheet, { backgroundColor: colors.surface, borderColor: line }]}>
        {row ? (
          <MemoAiSuggestTagsBody
            colors={{ ink, muted, secondary, primary }}
            loading={suggestLoading}
            error={suggestError}
            catalog={allMemoTags.map(t => ({ id: t.id, name: t.name }))}
            suggestion={suggestData}
            selectedIds={suggestSelectedIds}
            selectedNewNames={suggestNewNames}
            onToggleId={tid =>
              setSuggestSelectedIds(prev =>
                prev.includes(tid) ? prev.filter(x => x !== tid) : [...prev, tid],
              )
            }
            onToggleNewName={name =>
              setSuggestNewNames(prev =>
                prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name],
              )
            }
            onRetry={() => void runSuggestTags(row)}
            onConfirm={() => void confirmSuggestTags()}
          />
        ) : null}
      </MemoCenterSheet>

      <MemoCenterSheet
        visible={linkOpen}
        onClose={() => setLinkOpen(false)}
        style={[styles.sheet, { backgroundColor: colors.surface, borderColor: line }]}>
        {row ? (
          <MemoAiLinkSuggestBody
            colors={{ ink, muted, secondary, primary }}
            loading={linkLoading}
            error={linkError}
            suggestion={linkData}
            projects={linkProjects}
            todos={linkTodos}
            selectedProjectId={linkSelectedProjectId}
            selectedTaskId={linkSelectedTaskId}
            onSelectProject={setLinkSelectedProjectId}
            onSelectTask={setLinkSelectedTaskId}
            onRetry={() => void runLinkSuggest(row)}
            onConfirmLinkTask={taskId => {
              void (async () => {
                try {
                  const saved = await setMemoLinkedTaskId(row.id, taskId);
                  if (!saved) {
                    toast.error('备忘可能已删除');
                    return;
                  }
                  setRow(saved);
                  setLinkOpen(false);
                  toast.success('已关联待办');
                } catch (e) {
                  toast.error(toUserMessage(e, '关联失败'));
                }
              })();
            }}
            onOpenProject={projectId => {
              setLinkOpen(false);
              router.push({ pathname: '/edit-project', params: { id: projectId } });
            }}
            onCreateTodoDraft={draft => {
              void (async () => {
                try {
                  const taskId = makeTimestampEntityId('tsk_', 8);
                  await createTask({
                    id: taskId,
                    project_id: null,
                    category_id: null,
                    parent_task_id: null,
                    title: draft.title.slice(0, 50) || '来自备忘的待办',
                    note: draft.note || null,
                    status: 'todo',
                    priority: 0,
                    due_date: null,
                    extra_data: JSON.stringify({
                      source: 'memo_link',
                      memo_id: row.id,
                      linked_at: new Date().toISOString(),
                    }),
                  });
                  const saved = await setMemoLinkedTaskId(row.id, taskId);
                  if (saved) setRow(saved);
                  setLinkOpen(false);
                  Alert.alert('已新建并关联', `「${draft.title}」已加入待办，备忘已保留。`, [
                    { text: '知道了', style: 'cancel' },
                    {
                      text: '查看待办',
                      onPress: () => router.push({ pathname: '/task/[id]', params: { id: taskId } }),
                    },
                  ]);
                } catch (e) {
                  toast.error(toUserMessage(e, '创建待办失败'));
                }
              })();
            }}
          />
        ) : null}
      </MemoCenterSheet>
    </CrudDetailScreen>
  );
}

const styles = StyleSheet.create({
  wallHeader: {
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  scrollInner: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  title: { ...MemoText.detailTitle, color: MEMO_INK },
  meta: {
    ...MemoText.caption,
    color: MEMO_INK_SOFT,
    marginTop: 8,
  },
  metaSecond: {
    ...MemoText.caption,
    color: MEMO_INK_SOFT,
    marginTop: 2,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 14,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: MEMO_WASH,
    borderRadius: MemoRadius.tag,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minHeight: 22,
  },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  tagText: { ...MemoText.tag, color: MEMO_INK, fontWeight: '600' },
  bodyBlock: {
    marginTop: 18,
    minHeight: 120,
  },
  aiBlock: {
    marginTop: 28,
    paddingTop: 16,
    paddingRight: 36,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(58,42,26,0.2)',
  },
  aiSection: { marginTop: 12 },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  aiTitle: { ...MemoText.listTitle, color: MEMO_INK },
  aiKicker: { ...MemoText.kicker, color: MEMO_INK_SOFT },
  aiText: { ...MemoText.aiBody, color: MEMO_INK, marginTop: 4 },
  aiSuggest: { ...MemoText.aiBody, color: MEMO_INK_SOFT, marginTop: 4 },
  aiTime: { ...MemoText.time, color: MEMO_INK_SOFT, marginTop: 12 },
  sheet: {
    borderRadius: MemoRadius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: '80%',
  },
});
