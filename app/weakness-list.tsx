import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  deleteUserWeakness,
  listUserWeaknesses,
  weaknessContextForAiReview,
  weaknessListPreviewDetail,
  weaknessListPreviewTitle,
  type UserWeaknessItem,
} from '@/lib/user-weaknesses';
import {
  addWeaknessAiPendingAnalysisListener,
  addWeaknessAiReviewSavedListener,
  clearWeaknessAiAnalysisPending,
  runWeaknessAiReview,
} from '@/lib/weakness-ai-background';
import { getZhipuApiKey } from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

export default function WeaknessListScreen() {
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
  const weaknessAccent = isDark ? '#fb923c' : '#c2410c';
  const borderSoft = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.25)';
  const cardBg = isDark ? '#111827' : '#ffffff';

  const zhipuReady = Boolean(getZhipuApiKey().trim());

  const [items, setItems] = useState<UserWeaknessItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [aiModalId, setAiModalId] = useState<string | null>(null);
  const [aiModalLoading, setAiModalLoading] = useState(false);
  const [modalAiFirstError, setModalAiFirstError] = useState<string | null>(null);
  const modalAutoRanRef = useRef(false);
  const [pendingAnalysisIds, setPendingAnalysisIds] = useState<ReadonlySet<string>>(() => new Set());

  const reload = useCallback(async () => {
    setError(null);
    try {
      const rows = await listUserWeaknesses();
      setItems(prev => {
        const prevAi = new Map(
          prev
            .filter(p => p.ai_review_at?.trim())
            .map(p => [
              p.id,
              {
                ai_evaluation: p.ai_evaluation,
                ai_suggestions: p.ai_suggestions,
                ai_review_at: p.ai_review_at,
              } as const,
            ]),
        );
        return rows.map(r => {
          if (r.ai_review_at?.trim()) return r;
          const keep = prevAi.get(r.id);
          return keep ? { ...r, ...keep } : r;
        });
      });
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

  const aiModalItem = useMemo(
    () => (aiModalId ? items.find(i => i.id === aiModalId) ?? null : null),
    [aiModalId, items],
  );

  const mergeRowIntoItems = useCallback((row: UserWeaknessItem) => {
    setItems(prev => {
      const idx = prev.findIndex(m => m.id === row.id);
      if (idx < 0) {
        return [...prev, row].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      }
      return prev.map(m => (m.id === row.id ? { ...m, ...row } : m));
    });
  }, []);

  useEffect(() => {
    return addWeaknessAiPendingAnalysisListener(ids => {
      setPendingAnalysisIds(ids);
    });
  }, []);

  useEffect(() => {
    const unsub = addWeaknessAiReviewSavedListener(row => {
      mergeRowIntoItems(row);
    });
    return unsub;
  }, [mergeRowIntoItems]);

  useEffect(() => {
    if (aiModalId == null) {
      modalAutoRanRef.current = false;
      setModalAiFirstError(null);
      return;
    }
    const item = items.find(i => i.id === aiModalId);
    if (!item) return;
    if (item.ai_review_at?.trim()) {
      modalAutoRanRef.current = false;
      return;
    }
    if (!weaknessContextForAiReview(item)) return;
    if (!zhipuReady) return;
    if (modalAutoRanRef.current) return;

    modalAutoRanRef.current = true;
    setModalAiFirstError(null);
    setAiModalLoading(true);
    void runWeaknessAiReview(item, { force: false }).then(res => {
      setAiModalLoading(false);
      if (res.ok) {
        if (!res.skipped) mergeRowIntoItems(res.row);
      } else {
        setModalAiFirstError(res.error);
      }
    });
  }, [aiModalId, items, mergeRowIntoItems, zhipuReady]);

  const openAiModal = useCallback((row: UserWeaknessItem) => {
    if (!weaknessContextForAiReview(row)) {
      Alert.alert('内容为空', '请先填写缺点名称或详情。');
      return;
    }
    setAiModalId(row.id);
  }, []);

  const onModalRegenerate = useCallback(async () => {
    if (!aiModalItem) return;
    setAiModalLoading(true);
    setModalAiFirstError(null);
    try {
      const res = await runWeaknessAiReview(aiModalItem, { force: true });
      if (!res.ok) {
        Alert.alert('生成失败', res.error);
        setModalAiFirstError(res.error);
      } else if (!res.skipped) {
        mergeRowIntoItems(res.row);
      }
    } finally {
      setAiModalLoading(false);
    }
  }, [aiModalItem, mergeRowIntoItems]);

  const onModalRetryFirst = useCallback(async () => {
    if (!aiModalItem) return;
    setAiModalLoading(true);
    setModalAiFirstError(null);
    try {
      const res = await runWeaknessAiReview(aiModalItem, { force: false });
      if (!res.ok) {
        setModalAiFirstError(res.error);
      } else if (!res.skipped) {
        mergeRowIntoItems(res.row);
      }
    } finally {
      setAiModalLoading(false);
    }
  }, [aiModalItem, mergeRowIntoItems]);

  const onDelete = useCallback((row: UserWeaknessItem) => {
    const title = weaknessListPreviewTitle(row);
    Alert.alert('删除条目', `确定删除「${title}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteUserWeakness(row.id);
              clearWeaknessAiAnalysisPending(row.id);
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
        <Text style={[styles.swipeListHint, { color: outline }]}>左滑条目可删除</Text>
      </View>
    );
  }, [items.length, outline]);

  const renderItem = useCallback(
    ({ item }: { item: UserWeaknessItem }) => (
      <Swipeable
        overshootRight={false}
        rightThreshold={48}
        renderRightActions={() => (
          <Pressable
            onPress={() => onDelete(item)}
            style={({ pressed }) => [styles.swipeDeleteAction, pressed && { opacity: 0.92 }]}
            accessibilityRole="button"
            accessibilityLabel={`删除 ${weaknessListPreviewTitle(item)}`}
          >
            <MaterialIcons name="delete-outline" size={24} color="#fff" />
            <Text style={styles.swipeDeleteText}>删除</Text>
          </Pressable>
        )}
      >
        <View style={[styles.rowCard, { backgroundColor: cardBg, borderColor: borderSoft }]}>
          <View style={[styles.rowAccent, { backgroundColor: weaknessAccent }]} />
          <Pressable
            onPress={() => router.push({ pathname: '/weakness-edit/[id]', params: { id: item.id } })}
            style={({ pressed }) => [styles.rowBody, { opacity: pressed ? 0.92 : 1 }]}
          >
            <Text style={[styles.rowTitle, { color: text }]} numberOfLines={2}>
              {weaknessListPreviewTitle(item)}
            </Text>
            <Text style={[styles.rowSub, { color: outline }]} numberOfLines={2}>
              {weaknessListPreviewDetail(item)}
            </Text>
            {item.ai_review_at?.trim() ? (
              <Text style={[styles.rowAiPreview, { color: secondary }]}>
                AI：{item.ai_evaluation?.trim() || '（已生成）'}
              </Text>
            ) : pendingAnalysisIds.has(item.id) ? (
              <View style={styles.rowAiPendingRow}>
                <ActivityIndicator size="small" color={primary} />
                <Text style={[styles.rowAiPreview, { color: outline }]}>AI 分析中…</Text>
              </View>
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
    ),
    [
      borderSoft,
      cardBg,
      onDelete,
      openAiModal,
      outline,
      pendingAnalysisIds,
      primary,
      router,
      secondary,
      text,
      weaknessAccent,
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
          <Text style={[styles.topBarTitle, { color: text }]}>我的缺点</Text>
          <Pressable
            style={styles.roundIconBtn}
            onPress={() => router.push({ pathname: '/weakness-edit/[id]', params: { id: 'new' } })}
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
              <MaterialIcons name="psychology-alt" size={44} color={outline} />
              <Text style={[styles.emptyTitle, { color: text }]}>还没有记录</Text>
              <Text style={[styles.emptySub, { color: outline }]}>
                诚实面对自己的短板是成长的第一步。点击右上角添加一条缺点与详情。
              </Text>
              <Pressable
                onPress={() => router.push({ pathname: '/weakness-edit/[id]', params: { id: 'new' } })}
                style={({ pressed }) => [styles.emptyCta, { opacity: pressed ? 0.88 : 1 }]}
              >
                <Text style={{ color: primary, fontSize: 15, fontWeight: '800' }}>添加缺点</Text>
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
            <Text style={[styles.modalTitle, { color: text }]}>AI 分析与建议</Text>
            <View style={{ width: 40 }} />
          </View>

          {aiModalItem ? (
            <ScrollView
              contentContainerStyle={[styles.modalScroll, { paddingBottom: Math.max(insets.bottom, 20) + 24 }]}
              keyboardShouldPersistTaps="handled"
            >
              {(() => {
                const hasPersistedAi = Boolean(aiModalItem.ai_review_at?.trim());
                const analysisText = hasPersistedAi
                  ? aiModalItem.ai_evaluation?.trim() || '（无）'
                  : aiModalLoading
                    ? '正在生成分析…'
                    : modalAiFirstError
                      ? `生成失败：${modalAiFirstError}`
                      : !zhipuReady
                        ? '未配置智谱 API 密钥（EXPO_PUBLIC_ZHIPU_API_KEY）。配置保存后，返回此处或关闭再打开可自动重试。'
                        : '正在准备首次分析…';
                const suggestionsText = hasPersistedAi
                  ? aiModalItem.ai_suggestions?.trim() || '（无）'
                  : aiModalLoading
                    ? '正在生成建议…'
                    : modalAiFirstError
                      ? '请修复网络或密钥后重试。'
                      : !zhipuReady
                        ? '配置密钥后将自动生成并保存到本机。'
                        : '请稍候…';
                return (
                  <>
                    <Text style={[styles.modalKicker, { color: outline }]}>你填写的内容</Text>
                    <View style={[styles.modalMemoBox, { borderColor: borderSoft, backgroundColor: cardBg }]}>
                      <Text style={[styles.modalMemoText, { color: text }]}>
                        {weaknessContextForAiReview(aiModalItem) || '（空）'}
                      </Text>
                    </View>

                    <Text style={[styles.modalKicker, { color: outline, marginTop: 18 }]}>分析</Text>
                    <Text style={[styles.modalBlock, { color: text }]}>{analysisText}</Text>

                    <Text style={[styles.modalKicker, { color: outline, marginTop: 18 }]}>建议</Text>
                    <Text style={[styles.modalBlock, { color: text }]}>{suggestionsText}</Text>

                    {hasPersistedAi ? (
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
                          <Text style={styles.modalRegenBtnText}>重新生成</Text>
                        )}
                      </Pressable>
                    ) : !aiModalLoading && (modalAiFirstError != null || !zhipuReady) ? (
                      <Pressable
                        onPress={() => void onModalRetryFirst()}
                        style={({ pressed }) => [
                          styles.modalRegenBtn,
                          { backgroundColor: primary, opacity: pressed ? 0.88 : 1 },
                        ]}
                      >
                        <Text style={styles.modalRegenBtnText}>重试生成</Text>
                      </Pressable>
                    ) : null}
                    <Text style={[styles.modalHint, { color: outline }]}>
                      首次分析在保存后或打开本页时自动生成并持久保存；仅在你点击「重新生成」时会再次请求模型。内容仅供自我梳理参考，不构成心理咨询或医疗建议。
                    </Text>
                  </>
                );
              })()}
            </ScrollView>
          ) : (
            <View style={styles.loadingWrap}>
              <Text style={{ color: outline }}>未找到该条目</Text>
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
  swipeDeleteAction: {
    width: 88,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#dc2626',
    borderRadius: 18,
    marginLeft: 10,
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
  rowAiPendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
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
