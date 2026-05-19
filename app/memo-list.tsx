import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  deleteMemo,
  listMemos,
  memoContextForAiReview,
  memoListPreviewBody,
  memoListPreviewTitle,
  setMemoAiReview,
  type MemoItem,
} from '@/lib/memos';
import { createStandaloneTodoFromMemo } from '@/lib/memo-to-task';
import { analyzeMemoReviewFromText, getActiveAiLlmApiKey, isActiveAiLlmConfigured } from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
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
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

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

  const zhipuReady = isActiveAiLlmConfigured();

  const [items, setItems] = useState<MemoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [aiModalId, setAiModalId] = useState<string | null>(null);
  const [aiModalLoading, setAiModalLoading] = useState(false);
  const [convertingMemoId, setConvertingMemoId] = useState<string | null>(null);

  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});

  const reload = useCallback(async () => {
    setError(null);
    try {
      const rows = await listMemos();
      setItems(rows);
    } catch {
      setError('加载失败，请重试');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const aiModalItem = useMemo(() => (aiModalId ? items.find(i => i.id === aiModalId) ?? null : null), [aiModalId, items]);

  const runAiForMemo = useCallback(
    async (row: MemoItem): Promise<{ ok: true } | { ok: false; error: string }> => {
      const key = getActiveAiLlmApiKey().trim();
      if (!key) return { ok: false, error: '未配置智谱 API 密钥' };
      const ctx = memoContextForAiReview(row);
      if (!ctx) return { ok: false, error: '该备忘标题与正文均为空' };
      const r = await analyzeMemoReviewFromText({ apiKey: key, memoContextText: ctx });
      if (!r.ok) return { ok: false, error: r.error };
      const saved = await setMemoAiReview(row.id, { evaluation: r.evaluation, suggestions: r.suggestions });
      if (!saved) return { ok: false, error: '保存失败' };
      setItems(prev =>
        prev.map(m =>
          m.id === row.id
            ? {
                ...m,
                ai_evaluation: r.evaluation,
                ai_suggestions: r.suggestions,
                ai_review_at: saved.ai_review_at,
              }
            : m,
        ),
      );
      return { ok: true };
    },
    [],
  );

  const openAiModal = useCallback(
    (row: MemoItem) => {
      if (!zhipuReady) {
        Alert.alert(
          '无法调用 AI',
          '请配置智谱 API 密钥（EXPO_PUBLIC_ZHIPU_API_KEY），与项目内其他智谱能力一致。',
        );
        return;
      }
      if (!memoContextForAiReview(row)) {
        Alert.alert('内容为空', '请先为该备忘填写标题或正文。');
        return;
      }
      setAiModalId(row.id);
    },
    [zhipuReady],
  );

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

  const performConvertToTodo = useCallback(
    async (row: MemoItem) => {
      setConvertingMemoId(row.id);
      try {
        const { taskId, title } = await createStandaloneTodoFromMemo(row);
        setItems(prev => prev.filter(m => m.id !== row.id));
        delete swipeableRefs.current[row.id];
        setAiModalId(prevId => (prevId === row.id ? null : prevId));
        Alert.alert('已转为待办', `「${title}」已加入待办列表，原备忘已删除。`, [
          { text: '知道了', style: 'cancel' },
          {
            text: '查看待办',
            onPress: () => router.push({ pathname: '/task/[id]', params: { id: taskId } }),
          },
        ]);
      } catch {
        Alert.alert('转换失败', '请稍后重试');
      } finally {
        setConvertingMemoId(prev => (prev === row.id ? null : prev));
      }
    },
    [router],
  );

  const onConvertToTodo = useCallback(
    (row: MemoItem) => {
      if (convertingMemoId === row.id) return;
      void performConvertToTodo(row);
    },
    [convertingMemoId, performConvertToTodo],
  );

  const onDelete = useCallback((row: MemoItem) => {
    const title = memoListPreviewTitle(row);
    Alert.alert('删除备忘', `确定删除「${title}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteMemo(row.id);
              setItems(prev => prev.filter(i => i.id !== row.id));
              setAiModalId(prevId => (prevId === row.id ? null : prevId));
            } catch {
              Alert.alert('删除失败', '请稍后重试');
            }
          })();
        },
      },
    ]);
  }, []);

  const listHeader = useMemo(() => {
    if (items.length === 0) return null;
    return (
      <View style={styles.listHintRow}>
        <Text style={[styles.swipeListHint, { color: outline }]}>左滑可转待办或删除</Text>
      </View>
    );
  }, [items.length, outline]);

  const renderItem = useCallback(
    ({ item }: { item: MemoItem }) => {
      const isConverting = convertingMemoId === item.id;
      return (
      <Swipeable
        ref={r => {
          swipeableRefs.current[item.id] = r;
        }}
        overshootRight={false}
        rightThreshold={48}
        renderRightActions={() => (
          <View style={styles.swipeActionsRow}>
            <Pressable
              onPress={() => onConvertToTodo(item)}
              disabled={isConverting}
              style={({ pressed }) => [
                styles.swipeTodoAction,
                { backgroundColor: primary, opacity: isConverting ? 0.55 : pressed ? 0.92 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`将 ${memoListPreviewTitle(item)} 转为待办`}
            >
              {isConverting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <MaterialIcons name="playlist-add-check" size={22} color="#fff" />
              )}
              <Text style={styles.swipeTodoText}>转待办</Text>
            </Pressable>
            <Pressable
              onPress={() => onDelete(item)}
              style={({ pressed }) => [styles.swipeDeleteAction, pressed && { opacity: 0.92 }]}
              accessibilityRole="button"
              accessibilityLabel={`删除 ${memoListPreviewTitle(item)}`}
            >
              <MaterialIcons name="delete-outline" size={24} color="#fff" />
              <Text style={styles.swipeDeleteText}>删除</Text>
            </Pressable>
          </View>
        )}
      >
        <View style={[styles.rowCard, { backgroundColor: cardBg, borderColor: borderSoft }]}>
          <View style={[styles.rowAccent, { backgroundColor: tertiary }]} />
          <Pressable
            onPress={() => router.push({ pathname: '/memo-edit/[id]', params: { id: item.id } })}
            style={({ pressed }) => [styles.rowBody, { opacity: pressed ? 0.92 : 1 }]}
          >
            <Text style={[styles.rowTitle, { color: text }]} numberOfLines={2}>
              {memoListPreviewTitle(item)}
            </Text>
            <Text style={[styles.rowSub, { color: outline }]} numberOfLines={2}>
              {memoListPreviewBody(item)}
            </Text>
            {item.ai_evaluation ? (
              <Text style={[styles.rowAiPreview, { color: secondary }]} numberOfLines={2}>
                AI：{item.ai_evaluation}
              </Text>
            ) : null}
            <Text style={[styles.rowTime, { color: outline }]}>
              更新于 {new Date(item.updated_at).toLocaleString('zh-CN')}
              {item.ai_review_at
                ? ` · AI ${new Date(item.ai_review_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                : ''}
            </Text>
          </Pressable>
          <View style={styles.rowActions}>
            <Pressable
              hitSlop={8}
              onPress={() => openAiModal(item)}
              style={({ pressed }) => [styles.rowIconBtn, { opacity: pressed ? 0.65 : 1 }]}
            >
              <MaterialIcons name="auto-awesome" size={22} color={primary} />
            </Pressable>
          </View>
        </View>
      </Swipeable>
      );
    },
    [
      borderSoft,
      cardBg,
      convertingMemoId,
      onConvertToTodo,
      onDelete,
      openAiModal,
      outline,
      primary,
      router,
      secondary,
      tertiary,
      text,
    ],
  );

  const headerBg = isDark ? 'rgba(17,24,39,0.98)' : 'rgba(255,255,255,0.98)';

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
          <Text style={[styles.topBarTitle, { color: text }]}>备忘录</Text>
          <Pressable
            style={styles.roundIconBtn}
            onPress={() => router.push({ pathname: '/memo-edit/[id]', params: { id: 'new' } })}
          >
            <MaterialIcons name="add" size={26} color={primary} />
          </Pressable>
        </View>
      </View>

      {error ? (
        <Pressable onPress={() => void reload()} style={[styles.errorBanner, { borderColor: borderSoft }]}>
          <Text style={[styles.errorText, { color: text }]}>{error}</Text>
          <Text style={[styles.errorRetry, { color: primary }]}>点击重试</Text>
        </Pressable>
      ) : null}

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={primary} />
        </View>
      ) : (
        <FlatList
          style={styles.listFlex}
          data={items}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          ListHeaderComponent={listHeader}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(insets.bottom, 16) + 24 },
            items.length === 0 && styles.listContentEmpty,
          ]}
          ListEmptyComponent={
            <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor: borderSoft }]}>
              <MaterialIcons name="note-add" size={44} color={outline} />
              <Text style={[styles.emptyTitle, { color: text }]}>暂无备忘</Text>
              <Text style={[styles.emptySub, { color: outline }]}>点击右上角「+」添加第一条备忘</Text>
              <Pressable
                onPress={() => router.push({ pathname: '/memo-edit/[id]', params: { id: 'new' } })}
                style={({ pressed }) => [styles.emptyCta, { opacity: pressed ? 0.88 : 1 }]}
              >
                <Text style={{ color: primary, fontSize: 15, fontWeight: '800' }}>添加备忘</Text>
              </Pressable>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal
        visible={aiModalId != null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAiModalId(null)}
      >
        <SafeAreaView style={[styles.modalRoot, { backgroundColor: bg }]} edges={['left', 'right', 'bottom', 'top']}>
          <View style={[styles.modalTopBar, { borderBottomColor: borderSoft, backgroundColor: headerBg }]}>
            <Pressable onPress={() => setAiModalId(null)} style={styles.roundIconBtn}>
              <MaterialIcons name="close" size={24} color={primary} />
            </Pressable>
            <Text style={[styles.modalTitle, { color: text }]}>AI 评价与建议</Text>
            <View style={{ width: 40 }} />
          </View>

          {aiModalItem ? (
            <ScrollView
              contentContainerStyle={[styles.modalScroll, { paddingBottom: Math.max(insets.bottom, 20) + 24 }]}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={[styles.modalKicker, { color: outline }]}>备忘内容</Text>
              <View style={[styles.modalMemoBox, { borderColor: borderSoft, backgroundColor: cardBg }]}>
                <Text style={[styles.modalMemoText, { color: text }]}>
                  {memoContextForAiReview(aiModalItem) || '（空）'}
                </Text>
              </View>

              <Text style={[styles.modalKicker, { color: outline, marginTop: 18 }]}>评价</Text>
              <Text style={[styles.modalBlock, { color: text }]}>
                {aiModalItem.ai_evaluation?.trim() || '尚未生成，点击下方按钮。'}
              </Text>

              <Text style={[styles.modalKicker, { color: outline, marginTop: 18 }]}>建议</Text>
              <Text style={[styles.modalBlock, { color: text }]}>
                {aiModalItem.ai_suggestions?.trim() || '尚未生成，点击下方按钮。'}
              </Text>

              <Pressable
                onPress={() => void onModalRegenerate()}
                disabled={aiModalLoading}
                style={({ pressed }) => [
                  styles.modalRegenBtn,
                  { backgroundColor: secondary, opacity: aiModalLoading ? 0.55 : pressed ? 0.88 : 1 },
                ]}
              >
                {aiModalLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalRegenBtnText}>
                    {aiModalItem.ai_evaluation?.trim() || aiModalItem.ai_suggestions?.trim()
                      ? '重新生成'
                      : '生成评价与建议'}
                  </Text>
                )}
              </Pressable>
              <Text style={[styles.modalHint, { color: outline }]}>
                内容由智谱模型根据上文备忘生成，仅供自我梳理参考，不构成专业建议。
              </Text>
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
  listContent: { paddingHorizontal: 16, paddingTop: 16 },
  listContentEmpty: { flexGrow: 1, justifyContent: 'center' },
  listHintRow: { marginBottom: 10, paddingHorizontal: 2 },
  swipeListHint: { fontSize: 11, fontWeight: '600', opacity: 0.9 },
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
  modalMemoBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  modalMemoText: { fontSize: 14, fontWeight: '600', lineHeight: 21 },
  modalBlock: { fontSize: 15, fontWeight: '600', lineHeight: 24 },
  modalRegenBtn: {
    marginTop: 22,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalRegenBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  modalHint: { marginTop: 14, fontSize: 12, fontWeight: '600', lineHeight: 18 },
});
