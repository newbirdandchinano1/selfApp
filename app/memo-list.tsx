import { ScreenLoadingShell } from '@/components/screen-loading-shell';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createProjectFromMemoInInbox } from '@/lib/memo-to-project';
import { createStandaloneTodoFromMemo } from '@/lib/memo-to-task';
import {
  MEMO_DIMENSION_MAX,
  createMemoDimension,
  deleteMemo,
  deleteMemoDimension,
  listMemoDimensions,
  listMemos,
  memoContextForAiReview,
  memoListPreviewBody,
  memoListPreviewTitle,
  setMemoAiReview,
  updateMemoDimension,
  type MemoDimension,
  type MemoItem,
} from '@/lib/memos';
import { analyzeMemoReviewFromText, getActiveAiLlmApiKey, isActiveAiLlmConfigured } from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const MEMO_LIST_PAGE_KEY = 'memo-list';

function sortByOrderThenTime<T extends { sort_order: number; updated_at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sort_order - b.sort_order || b.updated_at.localeCompare(a.updated_at));
}

export default function MemoListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const bg = isDark ? theme.background : '#faf8ff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.9)' : '#424754';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';
  const tertiary = isDark ? '#fbbf24' : '#825100';
  const borderSoft = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.25)';
  const cardBg = isDark ? '#111827' : '#ffffff';
  const headerBg = isDark ? 'rgba(17,24,39,0.98)' : 'rgba(255,255,255,0.98)';
  const inputBg = isDark ? 'rgba(15,23,42,0.5)' : '#ffffff';

  const zhipuReady = isActiveAiLlmConfigured();

  const [dimensions, setDimensions] = useState<MemoDimension[]>([]);
  const [items, setItems] = useState<MemoItem[]>([]);
  const [selectedDimensionId, setSelectedDimensionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dimensionModalVisible, setDimensionModalVisible] = useState(false);
  const [editingDimension, setEditingDimension] = useState<MemoDimension | null>(null);
  const [dimensionName, setDimensionName] = useState('');
  const [dimensionSaving, setDimensionSaving] = useState(false);

  const [aiModalId, setAiModalId] = useState<string | null>(null);
  const [aiModalLoading, setAiModalLoading] = useState(false);
  const [convertingMemoId, setConvertingMemoId] = useState<string | null>(null);

  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});
  const { wrapLoad, resetSync } = usePageApiSync(MEMO_LIST_PAGE_KEY);

  const reload = useCallback(
    async (forceApi = false) => {
      setError(null);
      try {
        await wrapLoad(async () => {
          const dims = sortByOrderThenTime(await listMemoDimensions());
          setDimensions(dims);
          const activeId =
            selectedDimensionId && dims.some(d => d.id === selectedDimensionId)
              ? selectedDimensionId
              : dims[0]?.id ?? null;
          if (activeId !== selectedDimensionId) setSelectedDimensionId(activeId);
          setItems(activeId ? await listMemos(activeId) : []);
        }, forceApi);
      } catch {
        setError('加载失败，请重试');
        setDimensions([]);
        setItems([]);
        setSelectedDimensionId(null);
      } finally {
        setLoading(false);
      }
    },
    [wrapLoad, selectedDimensionId],
  );

  const { refreshControl } = usePagePullRefresh(MEMO_LIST_PAGE_KEY, reload);

  useFocusEffect(useCallback(() => {
    void reload();
  }, [reload]));

  const selectedDimension = useMemo(() => dimensions.find(d => d.id === selectedDimensionId) ?? null, [dimensions, selectedDimensionId]);
  const aiModalItem = useMemo(() => (aiModalId ? items.find(i => i.id === aiModalId) ?? null : null), [aiModalId, items]);

  const openCreateDimension = useCallback(() => {
    setEditingDimension(null);
    setDimensionName('');
    setDimensionModalVisible(true);
  }, []);

  const openEditDimension = useCallback((dimension: MemoDimension) => {
    setEditingDimension(dimension);
    setDimensionName(dimension.name);
    setDimensionModalVisible(true);
  }, []);

  const closeDimensionModal = useCallback(() => {
    if (dimensionSaving) return;
    setDimensionModalVisible(false);
    setEditingDimension(null);
    setDimensionName('');
  }, [dimensionSaving]);

  const saveDimension = useCallback(async () => {
    const name = dimensionName.trim();
    if (!name) {
      Alert.alert('无法保存', '请填写维度名称');
      return;
    }
    setDimensionSaving(true);
    try {
      if (editingDimension) {
        const updated = await updateMemoDimension(editingDimension.id, { name });
        if (!updated) {
          Alert.alert('保存失败', '该维度可能已删除');
          return;
        }
        setDimensions(prev => prev.map(d => (d.id === updated.id ? updated : d)));
      } else {
        const created = await createMemoDimension({ name });
        setDimensions(prev => sortByOrderThenTime([...prev, created]));
        setSelectedDimensionId(created.id);
        setItems([]);
      }
      closeDimensionModal();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setDimensionSaving(false);
    }
  }, [closeDimensionModal, dimensionName, editingDimension]);

  const performDeleteDimension = useCallback(async (dimension: MemoDimension) => {
    setDimensionSaving(true);
    try {
      const ok = await deleteMemoDimension(dimension.id);
      if (!ok) {
        Alert.alert('删除失败', '该维度可能已删除');
        return;
      }
      const nextDims = dimensions.filter(d => d.id !== dimension.id);
      setDimensions(nextDims);
      if (selectedDimensionId === dimension.id) {
        const nextId = nextDims[0]?.id ?? null;
        setSelectedDimensionId(nextId);
        setItems(nextId ? await listMemos(nextId) : []);
      } else {
        setItems(prev => prev.filter(m => m.dimension_id !== dimension.id));
      }
      if (editingDimension?.id === dimension.id) {
        closeDimensionModal();
      }
    } catch {
      Alert.alert('删除失败', '请稍后重试');
    } finally {
      setDimensionSaving(false);
    }
  }, [closeDimensionModal, dimensions, editingDimension, selectedDimensionId]);

  const requestDeleteDimension = useCallback((dimension: MemoDimension) => {
    const label = dimension.name.trim() || '未命名维度';
    Alert.alert('删除维度', `确定删除维度「${label}」吗？该维度下的所有备忘也会一起删除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void performDeleteDimension(dimension);
        },
      },
    ]);
  }, [performDeleteDimension]);

  const openDimensionActions = useCallback((dimension: MemoDimension) => {
    const label = dimension.name.trim() || '未命名维度';
    Alert.alert(label, '管理该维度', [
      { text: '编辑名称', onPress: () => openEditDimension(dimension) },
      { text: '删除维度', style: 'destructive', onPress: () => requestDeleteDimension(dimension) },
      { text: '取消', style: 'cancel' },
    ]);
  }, [openEditDimension, requestDeleteDimension]);

  const runAiForMemo = useCallback(async (row: MemoItem): Promise<{ ok: true } | { ok: false; error: string }> => {
    const key = getActiveAiLlmApiKey().trim();
    if (!key) return { ok: false, error: '未配置智谱 API 密钥' };
    const ctx = memoContextForAiReview(row);
    if (!ctx) return { ok: false, error: '该备忘标题与正文均为空' };
    const r = await analyzeMemoReviewFromText({ apiKey: key, memoContextText: ctx });
    if (!r.ok) return { ok: false, error: r.error };
    const saved = await setMemoAiReview(row.id, { evaluation: r.evaluation, suggestions: r.suggestions });
    if (!saved) return { ok: false, error: '保存失败' };
    setItems(prev => prev.map(m => (m.id === row.id ? { ...m, ai_evaluation: r.evaluation, ai_suggestions: r.suggestions, ai_review_at: saved.ai_review_at } : m)));
    return { ok: true };
  }, []);

  const openAiModal = useCallback((row: MemoItem) => {
    if (!zhipuReady) {
      Alert.alert('无法调用 AI', '请配置智谱 API 密钥（EXPO_PUBLIC_ZHIPU_API_KEY），与项目内其他智谱能力一致。');
      return;
    }
    if (!memoContextForAiReview(row)) {
      Alert.alert('内容为空', '请先为该备忘填写标题或正文。');
      return;
    }
    setAiModalId(row.id);
  }, [zhipuReady]);

  const onModalRegenerate = useCallback(async () => {
    if (!aiModalItem) return;
    setAiModalLoading(true);
    try {
      const res = await runAiForMemo(aiModalItem);
      if (!res.ok) Alert.alert('生成失败', res.error);
    } finally {
      setAiModalLoading(false);
    }
  }, [aiModalItem, runAiForMemo]);

  const performConvertToTodo = useCallback(async (row: MemoItem) => {
    setConvertingMemoId(row.id);
    try {
      const { taskId, title } = await createStandaloneTodoFromMemo(row);
      setItems(prev => prev.filter(m => m.id !== row.id));
      delete swipeableRefs.current[row.id];
      setAiModalId(prevId => (prevId === row.id ? null : prevId));
      Alert.alert('已转为待办', `「${title}」已加入待办列表，原备忘已删除。`, [
        { text: '知道了', style: 'cancel' },
        { text: '查看待办', onPress: () => router.push({ pathname: '/task/[id]', params: { id: taskId } }) },
      ]);
    } catch {
      Alert.alert('转换失败', '请稍后重试');
    } finally {
      setConvertingMemoId(prev => (prev === row.id ? null : prev));
    }
  }, [router]);

  const performConvertToProject = useCallback(async (row: MemoItem) => {
    setConvertingMemoId(row.id);
    try {
      const { projectId, name } = await createProjectFromMemoInInbox(row);
      setItems(prev => prev.filter(m => m.id !== row.id));
      delete swipeableRefs.current[row.id];
      setAiModalId(prevId => (prevId === row.id ? null : prevId));
      Alert.alert('已转为项目', `「${name}」已加入收集箱，原备忘已删除。`, [
        { text: '知道了', style: 'cancel' },
        { text: '查看项目', onPress: () => router.push({ pathname: '/edit-project', params: { id: projectId } }) },
      ]);
    } catch (e) {
      if (e instanceof Error && e.message === 'duplicate_name') {
        Alert.alert('转换失败', '已有同名项目，请修改备忘标题后再转换。');
      } else {
        Alert.alert('转换失败', '请稍后重试');
      }
    } finally {
      setConvertingMemoId(prev => (prev === row.id ? null : prev));
    }
  }, [router]);

  const onDeleteMemo = useCallback((row: MemoItem) => {
    const title = memoListPreviewTitle(row);
    Alert.alert('删除备忘', `确定删除「${title}」？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => { void (async () => { try { await deleteMemo(row.id); setItems(prev => prev.filter(i => i.id !== row.id)); setAiModalId(prevId => (prevId === row.id ? null : prevId)); } catch { Alert.alert('删除失败', '请稍后重试'); } })(); } },
    ]);
  }, []);

  const filteredItems = useMemo(() => {
    if (!selectedDimensionId) return [];
    return items.filter(item => item.dimension_id === selectedDimensionId);
  }, [items, selectedDimensionId]);

  const openNewMemo = useCallback(() => {
    if (!selectedDimensionId) {
      Alert.alert('请先选择维度', '请先选择一个维度，再在该维度下新建备忘。');
      return;
    }
    router.push({ pathname: '/memo-edit/[id]', params: { id: 'new', dimensionId: selectedDimensionId } });
  }, [router, selectedDimensionId]);

  const renderHeader = useMemo(() => (
    <View style={styles.pageHeaderBlock}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dimensionPillsRow}>
        {dimensions.map(d => {
          const active = d.id === selectedDimensionId;
          return (
            <Pressable
              key={d.id}
              onPress={() => setSelectedDimensionId(d.id)}
              onLongPress={() => openDimensionActions(d)}
              delayLongPress={380}
              style={({ pressed }) => [
                styles.dimensionPill,
                {
                  borderColor: active ? primary : borderSoft,
                  backgroundColor: active ? (isDark ? 'rgba(96,165,250,0.14)' : 'rgba(0,88,190,0.08)') : cardBg,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
            >
              <MaterialIcons name="folder-special" size={16} color={active ? primary : outline} />
              <Text style={[styles.dimensionPillText, { color: active ? primary : text }]} numberOfLines={1}>
                {d.name.trim() || '未命名维度'}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={openCreateDimension}
          style={({ pressed }) => [styles.dimensionPill, { borderColor: borderSoft, backgroundColor: cardBg, opacity: pressed ? 0.9 : 1 }]}
        >
          <MaterialIcons name="add" size={16} color={primary} />
          <Text style={[styles.dimensionPillText, { color: primary }]}>新建维度</Text>
        </Pressable>
      </ScrollView>
      <Text style={[styles.pageHint, { color: outline }]}>点击切换维度；长按维度可编辑或删除。右上角在当前维度下新建备忘。</Text>
    </View>
  ), [borderSoft, cardBg, dimensions, isDark, openCreateDimension, openDimensionActions, outline, primary, selectedDimensionId, text]);

  const renderItem = useCallback(({ item }: { item: MemoItem }) => {
    const isConverting = convertingMemoId === item.id;
    return (
      <Swipeable
        ref={r => { swipeableRefs.current[item.id] = r; }}
        overshootRight={false}
        rightThreshold={48}
        renderRightActions={() => (
          <View style={styles.swipeActionsRow}>
            <Pressable
              onPress={() => performConvertToTodo(item)}
              disabled={isConverting}
              style={({ pressed }) => [styles.swipeTodoAction, { backgroundColor: primary, opacity: isConverting ? 0.55 : pressed ? 0.92 : 1 }]}
            >
              {isConverting ? <ActivityIndicator color="#fff" size="small" /> : <MaterialIcons name="playlist-add-check" size={22} color="#fff" />}
              <Text style={styles.swipeTodoText}>转待办</Text>
            </Pressable>
            <Pressable
              onPress={() => performConvertToProject(item)}
              disabled={isConverting}
              style={({ pressed }) => [styles.swipeProjectAction, { backgroundColor: secondary, opacity: isConverting ? 0.55 : pressed ? 0.92 : 1 }]}
            >
              {isConverting ? <ActivityIndicator color="#fff" size="small" /> : <MaterialIcons name="folder-special" size={22} color="#fff" />}
              <Text style={styles.swipeProjectText}>转项目</Text>
            </Pressable>
            <Pressable onPress={() => onDeleteMemo(item)} style={({ pressed }) => [styles.swipeDeleteAction, pressed && { opacity: 0.92 }]}>
              <MaterialIcons name="delete-outline" size={24} color="#fff" />
              <Text style={styles.swipeDeleteText}>删除</Text>
            </Pressable>
          </View>
        )}
      >
        <View style={[styles.rowCard, { backgroundColor: cardBg, borderColor: borderSoft }]}>
          <View style={[styles.rowAccent, { backgroundColor: tertiary }]} />
          <Pressable
            onPress={() => router.push({ pathname: '/memo-view/[id]', params: { id: item.id } })}
            style={({ pressed }) => [styles.rowBody, { opacity: pressed ? 0.92 : 1 }]}
          >
            <Text style={[styles.rowTitle, { color: text }]} numberOfLines={2}>{memoListPreviewTitle(item)}</Text>
            <Text style={[styles.rowSub, { color: outline }]} numberOfLines={2}>{memoListPreviewBody(item)}</Text>
            {item.ai_evaluation ? <Text style={[styles.rowAiPreview, { color: secondary }]} numberOfLines={2}>AI：{item.ai_evaluation}</Text> : null}
            <Text style={[styles.rowTime, { color: outline }]}>更新于 {new Date(item.updated_at).toLocaleString('zh-CN')}</Text>
          </Pressable>
          <View style={styles.rowActions}>
            <Pressable hitSlop={8} onPress={() => openAiModal(item)} style={({ pressed }) => [styles.rowIconBtn, { opacity: pressed ? 0.65 : 1 }]}>
              <MaterialIcons name="auto-awesome" size={22} color={primary} />
            </Pressable>
          </View>
        </View>
      </Swipeable>
    );
  }, [borderSoft, cardBg, convertingMemoId, onDeleteMemo, openAiModal, performConvertToProject, performConvertToTodo, outline, primary, router, secondary, tertiary, text]);

  const currentDimensionLabel = selectedDimension?.name.trim() || '备忘录';

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
          <Pressable style={styles.roundIconBtn} onPress={() => router.back()}>
            <MaterialIcons name="arrow-back-ios-new" size={20} color={primary} />
          </Pressable>
          <Pressable
            style={styles.topBarTitleWrap}
            onLongPress={selectedDimension ? () => openDimensionActions(selectedDimension) : undefined}
            delayLongPress={380}
          >
            <Text style={[styles.topBarTitle, { color: text }]} numberOfLines={1}>{currentDimensionLabel}</Text>
          </Pressable>
          <Pressable style={styles.roundIconBtn} onPress={selectedDimensionId ? openNewMemo : openCreateDimension}>
            <MaterialIcons name={selectedDimensionId ? 'add' : 'folder-plus'} size={26} color={primary} />
          </Pressable>
        </View>
      </View>

      {error ? (
        <Pressable
          onPress={() => {
            resetSync();
            void reload(true);
          }}
          style={[styles.errorBanner, { borderColor: borderSoft }]}>
          <Text style={[styles.errorText, { color: text }]}>{error}</Text>
          <Text style={[styles.errorRetry, { color: primary }]}>点击重试</Text>
        </Pressable>
      ) : null}

      <ScreenLoadingShell loading={loading} style={styles.listFlex}>
        <View style={[styles.filterBarWrap, { backgroundColor: headerBg, borderBottomColor: borderSoft }]}>
          {renderHeader}
        </View>
        <FlatList
          style={styles.listFlex}
          data={filteredItems}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          refreshControl={refreshControl}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
          ListEmptyComponent={
            <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor: borderSoft }]}>
              <MaterialIcons name={selectedDimensionId ? 'note-add' : 'create-new-folder'} size={44} color={outline} />
              <Text style={[styles.emptyTitle, { color: text }]}>{selectedDimensionId ? '该维度暂无备忘' : '请先新建维度'}</Text>
              <Text style={[styles.emptySub, { color: outline }]}>{selectedDimensionId ? '点击右上角「+」在当前维度下新建备忘' : '备忘与维度在同一页面管理。先建立维度，再在维度下添加备忘。'}</Text>
              <Pressable
                onPress={selectedDimensionId ? openNewMemo : openCreateDimension}
                style={({ pressed }) => [styles.primaryCta, { backgroundColor: primary, opacity: pressed ? 0.88 : 1 }]}
              >
                <Text style={styles.primaryCtaText}>{selectedDimensionId ? '添加备忘' : '新建维度'}</Text>
              </Pressable>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      </ScreenLoadingShell>

      <Modal visible={dimensionModalVisible} animationType="fade" transparent onRequestClose={closeDimensionModal}>
        <View style={styles.modalOverlay}>
          <View style={[styles.dimensionModalCard, { backgroundColor: cardBg, borderColor: borderSoft }]}>
            <Text style={[styles.dimensionModalTitle, { color: text }]}>{editingDimension ? '编辑维度' : '新建维度'}</Text>
            <Text style={[styles.label, { color: outline }]}>维度名称（最多 {MEMO_DIMENSION_MAX} 字）</Text>
            <TextInput
              value={dimensionName}
              onChangeText={x => setDimensionName(x.length > MEMO_DIMENSION_MAX ? x.slice(0, MEMO_DIMENSION_MAX) : x)}
              placeholder="例如：工作 / 学习 / 灵感"
              placeholderTextColor={outline}
              style={[styles.dimensionInput, { color: text, borderColor: borderSoft, backgroundColor: inputBg }]}
              editable={!dimensionSaving}
              autoFocus
            />
            {editingDimension ? (
              <Pressable
                onPress={() => requestDeleteDimension(editingDimension)}
                disabled={dimensionSaving}
                style={({ pressed }) => [
                  styles.dimensionDeleteBtn,
                  { borderColor: borderSoft, opacity: dimensionSaving ? 0.55 : pressed ? 0.88 : 1 },
                ]}
              >
                <MaterialIcons name="delete-outline" size={20} color="#dc2626" />
                <Text style={styles.dimensionDeleteText}>删除此维度及下属备忘</Text>
              </Pressable>
            ) : null}
            <View style={styles.dimensionModalActions}>
              <Pressable onPress={closeDimensionModal} disabled={dimensionSaving} style={styles.modalCancelBtn}>
                <Text style={[styles.modalCancelText, { color: outline }]}>取消</Text>
              </Pressable>
              <Pressable onPress={() => void saveDimension()} disabled={dimensionSaving} style={[styles.modalSaveBtn, { backgroundColor: primary, opacity: dimensionSaving ? 0.55 : 1 }]}>
                {dimensionSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSaveText}>保存</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={aiModalId != null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAiModalId(null)}>
        <SafeAreaView style={[styles.modalRoot, { backgroundColor: bg }]} edges={['left', 'right', 'bottom', 'top']}>
          <View style={[styles.modalTopBar, { borderBottomColor: borderSoft, backgroundColor: headerBg }]}>
            <Pressable onPress={() => setAiModalId(null)} style={styles.roundIconBtn}>
              <MaterialIcons name="close" size={24} color={primary} />
            </Pressable>
            <Text style={[styles.modalTitle, { color: text }]}>AI 评价与建议</Text>
            <View style={{ width: 40 }} />
          </View>
          {aiModalItem ? (
            <ScrollView contentContainerStyle={[styles.modalScroll, { paddingBottom: Math.max(insets.bottom, 20) + 24 }]} keyboardShouldPersistTaps="handled">
              <Text style={[styles.modalKicker, { color: outline }]}>备忘内容</Text>
              <View style={[styles.modalMemoBox, { borderColor: borderSoft, backgroundColor: cardBg }]}>
                <Text style={[styles.modalMemoText, { color: text }]}>{memoContextForAiReview(aiModalItem) || '（空）'}</Text>
              </View>
              <Text style={[styles.modalKicker, { color: outline, marginTop: 18 }]}>评价</Text>
              <Text style={[styles.modalBlock, { color: text }]}>{aiModalItem.ai_evaluation?.trim() || '尚未生成，点击下方按钮。'}</Text>
              <Text style={[styles.modalKicker, { color: outline, marginTop: 18 }]}>建议</Text>
              <Text style={[styles.modalBlock, { color: text }]}>{aiModalItem.ai_suggestions?.trim() || '尚未生成，点击下方按钮。'}</Text>
              <Pressable onPress={() => void onModalRegenerate()} disabled={aiModalLoading} style={({ pressed }) => [styles.modalRegenBtn, { backgroundColor: secondary, opacity: aiModalLoading ? 0.55 : pressed ? 0.88 : 1 }]}>
                {aiModalLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalRegenBtnText}>{aiModalItem.ai_evaluation?.trim() || aiModalItem.ai_suggestions?.trim() ? '重新生成' : '生成评价与建议'}</Text>}
              </Pressable>
              <Text style={[styles.modalHint, { color: outline }]}>内容由智谱模型根据上文备忘生成，仅供自我梳理参考，不构成专业建议。</Text>
            </ScrollView>
          ) : (
            <View style={styles.loadingWrap}>
              <Text style={{ color: outline }}>未找到该备忘</Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBarWrap: {
    borderBottomWidth: 1,
    zIndex: 10,
    elevation: 6,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    minHeight: 48,
    paddingBottom: 8,
  },
  listFlex: { flex: 1 },
  filterBarWrap: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    zIndex: 5,
    elevation: 4,
  },
  roundIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  topBarTitleWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    minHeight: 40,
  },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    gap: 6,
  },
  errorText: { fontSize: 14, fontWeight: '600' },
  errorRetry: { fontSize: 14, fontWeight: '800' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 48 },
  listContent: { paddingHorizontal: 16, paddingTop: 16, flexGrow: 1 },
  pageHeaderBlock: { gap: 10 },
  dimensionPillsRow: { gap: 8, paddingRight: 8 },
  dimensionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 180,
  },
  dimensionPillText: { fontSize: 12, fontWeight: '800' },
  pageHint: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  swipeActionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginLeft: -8,
    gap: 8,
    paddingLeft: 8,
  },
  swipeTodoAction: {
    width: 92,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 18,
    marginVertical: 2,
    gap: 4,
  },
  swipeTodoText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  swipeProjectAction: {
    width: 92,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 18,
    marginVertical: 2,
    gap: 4,
  },
  swipeProjectText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  swipeDeleteAction: {
    width: 88,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#dc2626',
    borderRadius: 18,
    marginVertical: 2,
    gap: 4,
  },
  swipeDeleteText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 88,
  },
  rowAccent: { width: 4 },
  rowBody: { flex: 1, paddingVertical: 14, paddingHorizontal: 14, gap: 4 },
  rowTitle: { fontSize: 16, fontWeight: '800', lineHeight: 22 },
  rowSub: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  rowAiPreview: { fontSize: 12, fontWeight: '600', lineHeight: 17, marginTop: 2 },
  rowTime: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  rowActions: { justifyContent: 'center', paddingRight: 8, paddingLeft: 4, gap: 4 },
  rowIconBtn: { padding: 8, alignItems: 'center', justifyContent: 'center' },
  emptyCard: {
    marginHorizontal: 4,
    paddingVertical: 36,
    paddingHorizontal: 24,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { fontSize: 18, fontWeight: '900', marginTop: 8 },
  emptySub: { fontSize: 14, fontWeight: '600', textAlign: 'center', lineHeight: 20 },
  emptyCta: { marginTop: 14 },
  primaryCta: { marginTop: 14, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12 },
  primaryCtaText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  dimensionModalCard: { width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: 20, padding: 18 },
  dimensionModalTitle: { fontSize: 18, fontWeight: '900', marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4, marginBottom: 8 },
  dimensionInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '700',
  },
  dimensionDeleteBtn: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  dimensionDeleteText: { color: '#dc2626', fontSize: 14, fontWeight: '800' },
  dimensionModalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 18 },
  modalCancelBtn: { paddingHorizontal: 14, paddingVertical: 11 },
  modalCancelText: { fontSize: 15, fontWeight: '800' },
  modalSaveBtn: {
    minWidth: 86,
    borderRadius: 13,
    paddingHorizontal: 16,
    paddingVertical: 11,
    alignItems: 'center',
  },
  modalSaveText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  modalRoot: { flex: 1 },
  modalTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 17, fontWeight: '800' },
  modalScroll: { paddingHorizontal: 18, paddingTop: 16 },
  modalKicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginBottom: 8 },
  modalMemoBox: { borderWidth: 1, borderRadius: 14, padding: 12 },
  modalMemoText: { fontSize: 14, fontWeight: '600', lineHeight: 21 },
  modalBlock: { fontSize: 15, fontWeight: '600', lineHeight: 24 },
  modalRegenBtn: { marginTop: 22, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  modalRegenBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  modalHint: { marginTop: 14, fontSize: 12, fontWeight: '600', lineHeight: 18 },
});
